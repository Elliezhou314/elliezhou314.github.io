__squidDefine('src/review/replay.js', function (exports) {
'use strict';
// 牌局回放的纯逻辑：把 toRecord() 存下的一手牌还原成一步一步的画面（不碰界面，Node 里也能跑）。
//
// 还原的办法就是把记录里的事件按顺序重新记一遍账：前注、盲注从后手里扣、记进投入；
// 跟注、下注、加注从后手里扣、记进投入和本街下注；换街时本街下注清零（收进池）；最后按记录里的派彩发回去。
// 每一步都拿记录里引擎当时自己写下的数核对：动作前的底池（potBefore）、动作前后的后手（stackBefore / stackAfter）、
// 要跟的数（toCall）、本街最高下注（currentBetBefore）、当时的公共牌；结束时核对派彩总额 = 底池、
// 各家最终后手 = 记录里的 stackEnd、净输赢、谁弃了牌、谁亮了牌、每个池的金额和赢家（按牌力重新比一遍）。
// 任何一处对不上就不回放（ok 为 false），宁可说「回放不了」也不画一张错的画面。
//
// 输出的每一步是牌桌组件（ui/table.js）能直接吃的那些数：各座位的后手、本街下注、是否弃牌、公共牌、
// 已收进池的数、轮到谁、这一步的中文描述；stepView() 把它拼成牌桌要的对象。
const { cardsToPretty } = __squidRequire('src/core/cards.js');
const { evaluate, describeValue } = __squidRequire('src/core/evaluator.js');
const { positionName, STREET_CN } = __squidRequire('src/engine/game.js');

/** 步骤类型：下盲注（发牌）、某人行动、换街发牌、摊牌、派彩 */
const STEP = { BLINDS: 'blinds', ACTION: 'action', STREET: 'street', SHOWDOWN: 'showdown', AWARD: 'award' };

const ACTS = new Set(['fold', 'check', 'call', 'bet', 'raise']);
const EPS = 1e-6;
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b));
const r3 = (x) => Math.round(x * 1000) / 1000;
const f1 = (x) => (Math.round(x * 10) / 10).toString();

class Mismatch extends Error {}
function need(cond, why) { if (!cond) throw new Mismatch(why); }

/**
 * 主入口。返回 { ok:true, steps, hero, button, n, players } 或 { ok:false, reason, detail }。
 * reason 给玩家看；detail 是哪一处对不上（测试和排查用，也是中文）。
 */
function buildReplay(rec) {
  try {
    return { ok: true, ...reconstruct(rec) };
  } catch (e) {
    const old = !(rec && typeof rec === 'object' && rec.v >= 2);
    return { ok: false, reason: old ? '这手是旧版本记的，回放不了' : '这手的记录不完整，回放不了', detail: e && e.message ? e.message : String(e) };
  }
}

function isCard(c) { return Number.isInteger(c) && c >= 0 && c < 52; }

function reconstruct(rec) {
  need(rec && typeof rec === 'object', '不是一手牌的记录');
  const n = rec.n;
  need(Number.isInteger(n) && n >= 2 && n <= 6, '人数不对');
  need(Array.isArray(rec.seats) && rec.seats.length === n, '座位数和人数对不上');
  need(Array.isArray(rec.history) && rec.history.length > 0, '没有动作记录');
  need(Number.isInteger(rec.button) && rec.button >= 0 && rec.button < n, '庄位不对');
  need(Number.isInteger(rec.heroSeat) && rec.heroSeat >= 0 && rec.heroSeat < n && rec.seats[rec.heroSeat].isHero, '找不到你的座位');
  need(typeof rec.bb === 'number' && rec.bb > 0, '大盲不对');
  const seen = new Set();
  rec.seats.forEach((s, i) => {
    need(s && s.seat === i && typeof s.name === 'string', `第 ${i + 1} 个座位的记录不对`);
    need(typeof s.stack0 === 'number' && Number.isFinite(s.stack0) && s.stack0 >= 0, `${s.name} 的起始后手不对`);
    need(Array.isArray(s.hole) && s.hole.length === 2 && s.hole.every(isCard), `${s.name} 的手牌不对`);
    for (const c of s.hole) { need(!seen.has(c), '牌有重复'); seen.add(c); }
  });
  const res = rec.result;
  need(res && Array.isArray(res.payouts) && res.payouts.length === n && Array.isArray(res.pots), '没有结果');

  const players = rec.seats.map((s, i) => ({ seat: i, name: s.name, pos: positionName(i, rec.button, n), hole: s.hole.slice(), isHero: i === rec.heroSeat }));
  const who = (i) => `${players[i].name}（${players[i].pos}）`;
  const stack = rec.seats.map((s) => s.stack0), bet = new Array(n).fill(0), inv = new Array(n).fill(0);
  const folded = new Array(n).fill(false), shown = new Array(n).fill(false);
  let street = 0, board = [], cur = 0, dealt = false, ended = false;
  const steps = [], posts = [];
  const H = rec.history;
  const total = () => inv.reduce((a, b) => a + b, 0);
  const put = (i, amt, streetBet) => {
    stack[i] -= amt; inv[i] += amt;
    if (streetBet) bet[i] += amt;
    if (stack[i] <= 1e-9) stack[i] = 0;   // 和引擎同一条规则：后手剩下不到 1e-9 就是全下
  };
  /** 下一条记录如果是动作，就是它的座位（这一步之后轮到谁）；否则没人 */
  const nextActor = (k) => { const e = H[k + 1]; return e && ACTS.has(e.kind) ? e.seat : -1; };
  const snap = (type, k, text, extra = {}) => {
    const tot = total();
    const out = bet.reduce((a, b) => a + b, 0);
    const step = {
      type, street, board: board.slice(), text,
      stacks: stack.map(r3), bets: bet.map(r3), invested: inv.map(r3), folded: folded.slice(), shown: shown.slice(),
      total: r3(tot), pot: r3(tot - out), acting: k == null ? -1 : nextActor(k), say: null, awards: null, win: null, done: false, heroCall: null, ...extra,
    };
    // 轮到你、面前有下注：跟多少、能争到多少（只算你跟得上的那部分：每家投入按你跟完后的总投入封顶）
    const h = rec.heroSeat;
    if (step.acting === h && cur - bet[h] > EPS) {
      const call = Math.min(cur - bet[h], stack[h]);
      const after = inv[h] + call;
      let win = 0;
      for (let i = 0; i < n; i++) win += Math.min(inv[i] + (i === h ? call : 0), after);
      step.heroCall = { call: r3(call), win: r3(win), need: call / win, allin: call >= stack[h] - EPS };
    }
    steps.push(step);
    return step;
  };

  for (let k = 0; k < H.length; k++) {
    const h = H[k];
    need(h && typeof h === 'object', `第 ${k + 1} 条记录不对`);
    need(!ended, '结果之后还有记录');
    const seatOk = Number.isInteger(h.seat) && h.seat >= 0 && h.seat < n;
    if (h.kind === 'ante' || h.kind === 'sb' || h.kind === 'bb') {
      need(!dealt && seatOk, '盲注记录的位置不对');
      need(typeof h.amount === 'number' && h.amount >= 0 && h.amount <= stack[h.seat] + EPS, `${players[h.seat].name} 的盲注金额不对`);
      put(h.seat, h.amount, h.kind !== 'ante');   // 前注不算本街下注（引擎的口径）
      if (h.potAfter !== undefined) need(near(h.potAfter, total()), '盲注后的底池对不上');
      posts.push(h);
      continue;
    }
    if (h.kind === 'deal') {
      need(!dealt, '发了两次牌');
      dealt = true; cur = rec.bb;   // 引擎翻前的本街最高下注就是大盲（大盲后手不够也一样）
      snap(STEP.BLINDS, k, blindsText(posts, players, who));
      continue;
    }
    if (ACTS.has(h.kind)) {
      need(dealt && seatOk, '动作记录的位置不对');
      const i = h.seat;
      need(h.street === street, `${who(i)} 的动作记在了别的街上`);
      need(!folded[i] && stack[i] > 0, `${who(i)} 已经弃牌或全下，却还有动作`);
      const toCall = Math.max(0, cur - bet[i]);
      need(near(h.potBefore, total()), `${who(i)} 动作前的底池对不上（记录 ${h.potBefore}，还原 ${r3(total())}）`);
      need(near(h.stackBefore, stack[i]), `${who(i)} 动作前的后手对不上（记录 ${h.stackBefore}，还原 ${r3(stack[i])}）`);
      need(near(h.toCall, toCall), `${who(i)} 要跟的数对不上（记录 ${h.toCall}，还原 ${r3(toCall)}）`);
      if (h.currentBetBefore !== undefined) need(near(h.currentBetBefore, cur), `${who(i)} 动作前的最高下注对不上`);
      if (Array.isArray(h.board)) need(h.board.length === board.length && h.board.every((c, j) => c === board[j]), `${who(i)} 动作时的公共牌对不上`);
      let sayText;
      if (h.kind === 'fold') { need(toCall > EPS, '没人下注却弃牌'); folded[i] = true; sayText = '弃牌'; }
      else if (h.kind === 'check') { need(toCall <= EPS, '有人下注却过牌'); sayText = '过牌'; }
      else if (h.kind === 'call') {
        need(toCall > EPS, '没人下注却跟注');
        need(near(h.amount, Math.min(toCall, stack[i])), `${who(i)} 跟注的金额对不上`);
        put(i, h.amount, true);
        sayText = '跟注';
      } else {
        need(h.kind === 'bet' ? toCall <= EPS : toCall > EPS, '下注和加注分错了');
        const add = h.amountTo - bet[i];
        need(typeof h.amountTo === 'number' && near(h.amount, add) && add > 0 && add <= stack[i] + EPS && h.amountTo > cur, `${who(i)} 下注的金额对不上`);
        put(i, add, true);
        cur = h.amountTo;
        sayText = h.kind === 'bet' ? `下注 ${f1(h.amountTo)}` : `加注到 ${f1(h.amountTo)}`;
      }
      need(near(h.stackAfter, stack[i]), `${who(i)} 动作后的后手对不上（记录 ${h.stackAfter}，还原 ${r3(stack[i])}）`);
      const allin = h.kind !== 'fold' && h.kind !== 'check' && stack[i] === 0;
      if (allin) sayText = `全下 ${f1(bet[i])}`;
      snap(STEP.ACTION, k, actionText(h, i, who, bet[i], allin), { actor: i, kind: h.kind, say: { seat: i, text: sayText } });
      continue;
    }
    if (h.kind === 'board') {
      need(dealt && h.street === street + 1 && street < 3, '换街的记录顺序不对');
      const want = h.street === 1 ? 3 : h.street + 2;
      need(Array.isArray(h.board) && h.board.length === want && h.board.every(isCard) && board.every((c, j) => h.board[j] === c), '公共牌对不上');
      for (const c of h.board.slice(board.length)) { need(!seen.has(c), '牌有重复'); seen.add(c); }
      const fresh = h.board.slice(board.length);
      bet.fill(0); cur = 0; street = h.street; board = h.board.slice();
      snap(STEP.STREET, k, `发${STREET_CN[street]}：${cardsToPretty(fresh)}。底池 ${f1(total())}。`);
      continue;
    }
    if (h.kind === 'result') { need(dealt, '还没发牌就有结果'); ended = true; continue; }
    need(false, `不认识的记录：第 ${k + 1} 条`);
  }
  need(ended, '这手没有打完');

  // ---- 结束：摊牌（两人以上没弃牌）和派彩
  const live = [], own = [];
  for (let i = 0; i < n; i++) if (!folded[i]) live.push(i);
  need(live.length >= 1, '所有人都弃牌了');
  const tot = total();
  need(near(res.payouts.reduce((a, b) => a + b, 0), tot), '派彩总额和底池对不上');
  need(near(res.pots.reduce((a, p) => a + (p && typeof p.amount === 'number' ? p.amount : NaN), 0), tot), '各个池加起来和底池对不上');
  for (const p of res.pots) {
    need(Array.isArray(p.winners) && p.winners.length && Array.isArray(p.eligible), '池的记录不对');
    need(p.winners.every((w) => p.eligible.includes(w) && !folded[w]), '池分给了没资格的人');
  }
  if (live.length > 1) {
    // 引擎在摊牌时把公共牌补满 5 张；正常流程里换街都记了，这里只认记录里最终的公共牌接得上
    if (board.length < 5 && Array.isArray(rec.board) && rec.board.length === 5 && board.every((c, j) => rec.board[j] === c)) board = rec.board.slice();
    need(board.length === 5, '摊牌时公共牌不是 5 张');
    const vals = new Array(n).fill(-1);
    for (const i of live) vals[i] = evaluate([...board, ...players[i].hole]);
    // 每个池：按投入分层重新切一遍，金额和赢家都要和记录一致（引擎同一个口径：有资格的是投入够到这一层、没弃牌的人）
    // 投入是按和引擎相同的顺序、相同的数一笔笔加出来的，所以分层直接用原值（和引擎逐位一致），不取整
    const levels = [...new Set(inv.filter((x) => x > 0))].sort((a, b) => a - b);
    let prev = 0, pi = 0;
    for (const L of levels) {
      let amount = 0, from = 0;
      for (let i = 0; i < n; i++) { const d = Math.max(0, Math.min(inv[i], L) - prev); amount += d; if (d > 0) from++; }
      const eligible = live.filter((i) => inv[i] >= L);
      if (amount > 0 && eligible.length) {
        own[pi] = from === 1;   // 这一层只有赢家自己的钱：是没人跟到、退回去的下注
        const p = res.pots[pi++];
        need(p && near(p.amount, amount), '池的金额对不上');
        const best = Math.max(...eligible.map((i) => vals[i]));
        const winners = eligible.filter((i) => vals[i] === best);
        need(winners.length === p.winners.length && winners.every((w) => p.winners.includes(w)), '池的赢家和牌力对不上');
      }
      prev = L;
    }
    need(pi === res.pots.length, '池的个数对不上');
    for (const i of live) shown[i] = true;
    bet.fill(0);
    const desc = live.map((i) => `${players[i].name} ${cardsToPretty(players[i].hole)}（${describeValue(vals[i])}）`).join('；');
    snap(STEP.SHOWDOWN, null, `摊牌：${desc}。`);
  } else {
    need(res.pots.length === 1 && res.pots[0].winners.length === 1 && res.pots[0].winners[0] === live[0], '只剩一人时的派彩对不上');
  }
  bet.fill(0);
  for (let i = 0; i < n; i++) stack[i] += res.payouts[i];
  rec.seats.forEach((s, i) => {
    need(near(stack[i], s.stackEnd), `${who(i)} 的最终后手对不上（记录 ${s.stackEnd}，还原 ${r3(stack[i])}）`);
    if (typeof s.folded === 'boolean') need(s.folded === folded[i], `${who(i)} 是否弃牌对不上`);
    if (typeof s.showed === 'boolean') need(s.showed === shown[i], `${who(i)} 是否亮牌对不上`);
    if (res.net && typeof res.net[i] === 'number') need(near(res.net[i], stack[i] - s.stack0), `${who(i)} 的净输赢对不上`);
  });
  const awards = res.pots.map((p) => ({ amount: p.amount, winners: p.winners.slice() }));
  const win = new Array(n).fill(false);
  for (const p of res.pots) for (const w of p.winners) win[w] = true;
  const heroNet = stack[rec.heroSeat] - rec.seats[rec.heroSeat].stack0;
  snap(STEP.AWARD, null, awardText(res.pots, own, live, players, tot) + `你本手 ${heroNet >= 0 ? '+' : ''}${f1(heroNet)}。`, { awards, win, done: true });

  return { steps, hero: rec.heroSeat, button: rec.button, n, players, handNo: rec.handNo };
}

function blindsText(posts, players, who) {
  const parts = ['发好手牌。'];
  const antes = posts.filter((p) => p.kind === 'ante');
  if (antes.length) parts.push(`每人先下前注 ${f1(Math.max(...antes.map((p) => p.amount)))}（共 ${f1(antes.reduce((a, p) => a + p.amount, 0))}）。`);
  const blinds = posts.filter((p) => p.kind !== 'ante').map((p) => `${who(p.seat)} 下${p.kind === 'sb' ? '小盲' : '大盲'} ${f1(p.amount)}`);
  if (blinds.length) parts.push(blinds.join('，') + '。');
  return parts.join('');
}

function actionText(h, i, who, betTo, allin) {
  const verb = h.kind === 'fold' ? '弃牌' : h.kind === 'check' ? '过牌' : h.kind === 'call' ? `跟注 ${f1(h.amount)}` : h.kind === 'bet' ? `下注 ${f1(betTo)}` : `加注到 ${f1(betTo)}`;
  return `${STREET_CN[h.street]}：${who(i)} ${verb}${allin ? '，全下' : ''}。`;
}

/**
 * 派彩那句话。own[k] 为真的池只有赢家自己的钱（没人跟到的下注），说「退回」；
 * 其余的按顺序叫底池 / 主池、边池（边池不止一个时编号）。只剩一个人有资格争的边池（别人弃牌了）写明这一点。
 */
function awardText(pots, own, live, players, tot) {
  const names = (ws) => ws.map((w) => players[w].name).join('、');
  if (live.length === 1) return `其余人都弃牌，${players[live[0]].name} 收下底池 ${f1(tot)}。`;
  const real = pots.filter((p, k) => !own[k]).length;
  let seq = 0;
  const parts = pots.map((p, k) => {
    if (own[k]) return `没人跟到的 ${f1(p.amount)} 退回给 ${names(p.winners)}`;
    const label = real === 1 ? '底池' : seq === 0 ? '主池' : `边池${real > 2 ? seq : ''}`;
    seq++;
    if (p.eligible.length === 1) return `${label} ${f1(p.amount)} 归 ${names(p.winners)}（能争它的其他人都弃牌了）`;
    return `${label} ${f1(p.amount)} ${p.winners.length > 1 ? `由 ${names(p.winners)} 平分` : `归 ${names(p.winners)}`}`;
  });
  return '派彩：' + parts.join('；') + '。';
}

/**
 * 第 i 步画在牌桌上的样子（ui/table.js 的 show() 吃的对象）。
 * reveal 为真时所有人的牌都翻开（事后视角）；为假时只有你的牌和真的走到摊牌、亮过的牌（从摊牌那一步起）是正面。
 */
function stepView(rep, i, opts = {}) {
  const s = rep.steps[i];
  return {
    key: opts.key || 'replay', hero: rep.hero, button: rep.button, acting: s.acting,
    board: s.board.slice(), pot: s.pot,
    seats: rep.players.map((p, k) => ({
      name: p.name, pos: p.pos, stack: s.stacks[k], bet: s.bets[k],
      cards: k === rep.hero || opts.reveal || s.shown[k] ? p.hole.slice() : null,
      folded: s.folded[k], win: !!(s.win && s.win[k]),
    })),
    awards: s.awards ? s.awards.map((a) => ({ amount: a.amount, winners: a.winners.slice() })) : null,
    done: s.done, say: s.say ? { ...s.say } : null,
  };
}

/** 「跟注需要的胜率」那句话：跟 X 去争 Y，至少要 Z% 的胜率才不亏（Z = X / Y，一位小数） */
function callNeedText(hc) {
  return `跟 ${f1(hc.call)}${hc.allin ? '（全下）' : ''} 去争 ${f1(hc.win)}，至少要 ${(hc.need * 100).toFixed(1)}% 的胜率才不亏。`;
}

exports.buildReplay = buildReplay;
exports.stepView = stepView;
exports.callNeedText = callNeedText;
exports.STEP = STEP;
});
