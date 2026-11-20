__squidDefine('src/ui/views/play.js', function (exports) {
'use strict';
// 「自由牌局」视图：2~6 人牌局引擎 + 机器人对手 + 每手复盘。
// 这个文件只做「引擎 ↔ 牌桌」的翻译和页面编排：tableView() 把引擎状态翻译成牌桌组件吃的普通对象，
// 下面几个流程函数决定一手牌的节奏（机器人想一下 → 动作气泡和筹码 → 收池、翻牌 → 下一个）。
// 牌桌怎么画、怎么动在 ../table.js，牌面在 ../cards.js，音效在 ../sfx.js（开关在页面顶栏，见 ../settings.js）。
// 牌局回放（../replay/replay.js）借用同一个牌桌：回放时操作区换成回放的控制条，「回到牌局」再把引擎此刻的画面放回去。
// 页面骨架（v0.16 一屏放下：牌桌、操作区、记录一栏、桌子设置弹层）在 ../play/shell.js，轮到你时的按钮在 ../play/heroact.js。
const { HeuristicBot, PROFILES } = __squidRequire('src/engine/bot.js');
const { HandEngine, positionName, handToText } = __squidRequire('src/engine/game.js');
const { analyzeHand, buildLLMPrompt } = __squidRequire('src/review/review.js');
const { h, $, f1, toast } = __squidRequire('src/ui/dom.js');
const { heroControls } = __squidRequire('src/ui/play/heroact.js');
const { buildShell } = __squidRequire('src/ui/play/shell.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');
const { sfx } = __squidRequire('src/ui/sfx.js');
const { mountReplay } = __squidRequire('src/ui/replay/replay.js');
const { createTable } = __squidRequire('src/ui/table.js');
const { solverState } = __squidRequire('src/ui/views/solver.js');

const playState = { engine: null, seats: [], handNo: 0, button: 0, lastRecord: null, analysis: null, session: 0, recorded: null, table: null, openReplay: null, hold: false };
// 测试钩子（tools/uicheck_fit.mjs）：hold(true) 让机器人先别出手，页面停在「等待对手」，好量这一刻的版面；hold(false) 接着打
if (typeof window !== 'undefined') window.__squidPlayTest = { hold: (on) => { playState.hold = !!on; } };

/** 没有牌局时的空桌（回放结束、而之前没开过桌或放弃了这一手） */
const BLANK = { key: 'blank', hero: 0, button: -1, acting: -1, board: [], pot: 0, seats: [], awards: null, done: false, say: null };

/** 回放一手打完的牌（「历史与数据」经 router.js 的 replayHand 走到这里）。正在打的一手没结束时先问打完还是放弃 */
function openReplay(rec) { if (playState.openReplay) playState.openReplay(rec); }

// 节奏（毫秒）：机器人「想」多久、动作亮出来后停多久、自己出手后停多久。
// 要让人看清每个气泡和筹码，又不能拖：6 人桌一手牌大约十秒上下。
const PACE = { think: 450, after: 650, heroAfter: 420 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 收起 / 放出一块（带 display 样式的块上 hidden 属性不管用，直接写 display）
const vis = (el, on) => { el.style.display = on ? '' : 'none'; };
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * 引擎 → 牌桌。桌子中间只放「已经收进池里的」：引擎的 pot 是各家 invested 之和，
 * 已经含本街还摆在各家面前的下注，所以中间 = pot − 各家 streetBet 之和，各家面前 = 自己的 streetBet。
 * 一手结束时桌上的注都算收进池（引擎这时不再清 streetBet），中间就是整个 pot，再按 result.pots 派给赢家。
 */
function tableView(eng) {
  const over = eng.over;
  const pots = over ? eng.result.pots : [];
  const winners = new Set(pots.flatMap((p) => p.winners));
  const out = over ? 0 : eng.seats.reduce((a, s) => a + s.streetBet, 0);
  return {
    key: playState.session + ':' + eng.handNo,
    hero: eng.hero.seat, button: eng.button,
    acting: eng.toActSeat ? eng.toActSeat.seat : -1,
    board: eng.board.slice(),
    pot: round3(eng.pot - out),
    seats: eng.seats.map((s, i) => ({
      name: s.name, pos: positionName(i, eng.button, eng.n), stack: s.stack,
      bet: over ? 0 : s.streetBet,
      cards: s.isHero || (over && s.showed) ? s.hole.slice() : null,
      folded: s.folded, win: winners.has(i),
    })),
    awards: over ? pots.map((p) => ({ amount: p.amount, winners: p.winners.slice() })) : null,
    done: over, say: null,
  };
}

/** 动作刚做完、还没收池翻牌的那一帧：动作前的画面，加上这一个动作（数全部取自引擎的动作记录） */
function actionView(pre, eng, rec) {
  const i = rec.seat, betTo = pre.seats[i].bet + rec.amount;
  const allin = rec.amount > 0 && rec.stackAfter === 0;
  const text = rec.kind === 'fold' ? '弃牌' : rec.kind === 'check' ? '过牌' : allin ? `全下 ${f1(betTo)}`
    : rec.kind === 'call' ? '跟注' : rec.kind === 'bet' ? `下注 ${f1(betTo)}` : `加注到 ${f1(betTo)}`;
  const seats = pre.seats.map((s, k) => (k !== i ? s : { ...s, bet: betTo, stack: rec.stackAfter, folded: eng.seats[i].folded }));
  return { ...pre, seats, acting: -1, say: { seat: i, text } };
}

function buildPlayView() {
  const v = $('#view-play');
  v.innerHTML = '';
  const cfg = { n: 3, stack: 100, sb: 0.5, bb: 1, profiles: ['balanced', 'tight', 'station', 'maniac', 'balanced', 'tight'], seed: 0 };
  const nSel = h('select', { onchange: (e) => { cfg.n = Number(e.target.value); renderProfiles(); } }, [2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === cfg.n }, `${n} 人`)));
  const stackIn = h('input', { type: 'number', value: cfg.stack, oninput: (e) => (cfg.stack = Number(e.target.value)) });
  const profilesEl = h('div', { class: 'botfields' });
  function renderProfiles() {
    profilesEl.innerHTML = '';
    for (let i = 1; i < cfg.n; i++) profilesEl.append(h('div', { class: 'field' }, h('label', {}, `机器人 ${i}`), h('select', { onchange: (e) => (cfg.profiles[i] = e.target.value) }, Object.entries(PROFILES).map(([k, p]) => h('option', { value: k, selected: cfg.profiles[i] === k }, p.cn)))));
  }
  renderProfiles();
  if (playState.table) playState.table.destroy();
  const tableEl = h('div', { class: 'fit' });
  const table = createTable(tableEl);
  playState.table = table;
  const newBtn = h('button', { class: 'primary', onclick: () => newSession() }, '开新桌');
  const shell = buildShell({ tableEl, newBtn, fields: [h('div', { class: 'tablefields' }, h('div', { class: 'field' }, h('label', {}, '人数'), nSel), h('div', { class: 'field' }, h('label', {}, '起始后手(bb)'), stackIn)), profilesEl] });
  const actionsEl = h('div', { class: 'actions playact' });
  const logEl = shell.log;
  const reviewEl = shell.review;
  const replayEl = h('div', { class: 'replayhost', style: { display: 'none' } });
  shell.dock.append(actionsEl, replayEl);
  let replayCtl = null, askEl = null;

  // 流程计数：每开一手、每开一桌加一。上一手还在播的动画和机器人循环看到对不上就停，不会改到下一手的画面。
  const flow = { gen: 0 };

  function newSession() {
    closeReplay(false);
    shell.settings(false); shell.started();
    playState.session++;
    playState.seats = [];
    for (let i = 0; i < cfg.n; i++) playState.seats.push({ name: i === 0 ? '你' : `${PROFILES[cfg.profiles[i]].cn}${i}`, stack: cfg.stack * cfg.bb, isHero: i === 0, bot: i === 0 ? null : new HeuristicBot(cfg.profiles[i], 100 + i) });
    playState.handNo = 0; playState.button = cfg.n - 1;
    playState.engine = null;   // 上一桌打到一半也直接作废
    logEl.textContent = '';
    nextHand();
  }
  async function nextHand() {
    if (playState.engine && !playState.engine.over) { toast('本手还没结束'); return; }
    if (!playState.seats.length) { newSession(); return; }
    closeReplay(false);
    // 淘汰 0 筹码的机器人：补满
    for (const s of playState.seats) if (s.stack <= 0) { s.stack = cfg.stack * cfg.bb; }
    playState.handNo++;
    playState.button = (playState.button + 1) % cfg.n;
    const eng = new HandEngine({ seats: playState.seats.map((s) => ({ ...s })), button: playState.button, sb: cfg.sb, bb: cfg.bb, seed: (Date.now() ^ (playState.handNo * 7919)) >>> 0, handNo: playState.handNo });
    playState.engine = eng;
    const g = ++flow.gen;
    reviewEl.innerHTML = '';
    appendLog();
    renderActions(true);
    if (!(await table.show(tableView(eng))) || g !== flow.gen) return;
    playOut();
  }
  /** 机器人一个接一个打，直到轮到自己或这手结束 */
  async function playOut() {
    const g = flow.gen, eng = playState.engine;
    const alive = () => g === flow.gen && eng === playState.engine;
    while (!eng.over && !eng.isHeroTurn()) {
      await sleep(PACE.think); if (!alive()) return;
      while (playState.hold) { await sleep(60); if (!alive()) return; }
      const s = eng.toActSeat;
      const pre = tableView(eng);
      const d = s.bot.decide(eng);
      let rec = null;
      try { rec = eng.act(d.kind, d.amountTo); } catch (e) { try { rec = eng.act(eng.legalActions()[0].kind); } catch (_) { /* 忽略 */ } }
      if (!rec) break;
      engineChanged();
      if (!(await animateAction(pre, rec, PACE.after)) || !alive()) return;
    }
    renderActions();
    if (eng.over) {
      const net = eng.result.net[eng.hero.seat];
      if (net > 0) sfx.win(); else if (net < 0) sfx.lose();
    }
  }
  /** 一个动作的演出：先亮动作（气泡、筹码），停一下，再收池、翻牌、轮到下一个 */
  async function animateAction(pre, rec, holdMs) {
    const g = flow.gen, eng = playState.engine;
    if (!(await table.show(actionView(pre, eng, rec)))) return false;
    await sleep(holdMs);
    if (g !== flow.gen) return false;
    return table.show(tableView(eng));
  }
  async function heroAct(kind, amountTo) {
    const eng = playState.engine;
    const pre = tableView(eng);
    let rec;
    try { rec = eng.act(kind, amountTo); } catch (e) { toast(e.message); return; }
    engineChanged();
    renderActions(true);
    const g = flow.gen;
    if (!(await animateAction(pre, rec, PACE.heroAfter)) || g !== flow.gen) return;
    playOut();
  }
  /** 引擎每变一次：更新记录；这手刚结束就立刻记账（和动画无关，动画被打断也不会漏记） */
  function engineChanged() {
    appendLog();
    const eng = playState.engine;
    if (eng.over && playState.recorded !== eng) finishHand();
  }
  const nextBtn = () => h('button', { class: 'primary', onclick: () => nextHand() }, '下一手');
  /**
   * 操作区。只在画面静止时画出可点的按钮（等待对手、动画进行中 busy 都不给点），
   * 同时在牌桌根元素上写下引擎此刻的总底池与各家后手，测试拿它和页面上显示的数对账。
   */
  function renderActions(busy = false) {
    const eng = playState.engine;
    actionsEl.innerHTML = '';
    const idle = !busy && !!eng && (eng.over || eng.isHeroTurn());
    tableEl.dataset.idle = idle ? '1' : '0';
    actionsEl.dataset.state = !eng ? (playState.seats.length ? 'blank' : 'setup') : !idle ? 'wait' : eng.over ? 'over' : 'hero';
    if (eng) { tableEl.dataset.enginePot = String(round3(eng.pot)); tableEl.dataset.engineStacks = eng.seats.map((s) => round3(s.stack)).join(','); }
    if (!eng) {
      // 开桌之前：桌子设置摊开在牌桌上；放弃了一手回到空桌时：点「下一手」接着打
      if (playState.seats.length) actionsEl.append(h('span', { class: 'muted dockmsg' }, '这一桌还在，点「下一手」接着打；换人数或对手点左上角「桌子」。'), nextBtn());
      else actionsEl.append(h('span', { class: 'muted dockmsg' }, '选好人数和每个机器人的打法，点「开新桌」。'), h('button', { class: 'primary', onclick: () => newSession() }, '开新桌'));
      return;
    }
    if (!idle) { actionsEl.append(h('span', { class: 'muted dockmsg' }, eng.over || eng.isHeroTurn() ? '…' : '等待对手…')); return; }
    if (eng.over) {
      // 一句话：谁拿到多少、你本手输赢多少（v0.17）。各个池、谁亮了什么牌型写在「记录」一栏的「结果」那一行
      const r = eng.result, net = r.net[eng.hero.seat];
      const won = eng.seats.filter((s) => r.payouts[s.seat] > 0).map((s) => `${s.name}拿到 ${f1(r.payouts[s.seat])}`).join('、');
      actionsEl.append(h('div', { class: 'result' }, h('span', {}, won ? won + '；' : ''), h('b', { class: 'mono' }, `你本手 ${net >= 0 ? '+' : ''}${f1(net)}`)));
      actionsEl.append(h('div', { class: 'overbtns' }, nextBtn(), h('button', { onclick: () => startReplay(playState.lastRecord) }, '回放这手'), h('button', { onclick: () => reviewHand() }, '复盘这手')));
      return;
    }
    actionsEl.append(...heroControls(eng, cfg.sb, heroAct));
  }
  function appendLog() {
    const eng = playState.engine;
    const rec = eng.toRecord();
    // 打完时补一行你本手的输赢（操作区只写一句，详细的各池和牌型在上面「结果」那一行）
    logEl.textContent = handToText(rec) + (eng.over && eng.result ? `\n你本手 ${eng.result.net[eng.hero.seat] >= 0 ? '+' : ''}${f1(eng.result.net[eng.hero.seat])}` : '');
    logEl.scrollTop = logEl.scrollHeight;
  }
  function finishHand() {
    const eng = playState.engine;
    if (!eng.over) return;
    playState.recorded = eng;
    for (const s of eng.seats) playState.seats[s.seat].stack = s.stack;
    playState.lastRecord = eng.toRecord();
    store.addHand(playState.lastRecord);
  }
  /** 文字复盘：写在「记录」一栏里（手机上把这一栏弹出来） */
  function reviewHand(rec = playState.lastRecord) {
    if (!rec) return;
    shell.panel(true, 'log');
    reviewEl.innerHTML = '';
    reviewEl.append(h('div', { class: 'muted small' }, '计算中（权益按枚举精确计算，可能需要几秒）…'));
    setTimeout(() => {
      try {
        const an = analyzeHand(rec);
        playState.analysis = an;
        reviewEl.innerHTML = '';
        reviewEl.append(h('h3', {}, '每局详细解析'), h('pre', { class: 'review' }, an.text));
        if (an.solverSpecs.length) reviewEl.append(h('div', { class: 'row' }, an.solverSpecs.map((s) => h('button', { onclick: () => { solverState.applySpec({ players: s.players, board: s.board, pot: s.pot, stack: s.stack, ranges: s.ranges }); switchView('solver'); toast(`已载入 ${s.streetCn} 决策点（假设范围），点“开始解算”`); } }, `用解算器解：${s.streetCn}`))));
        reviewEl.append(h('button', { onclick: () => { const p = buildLLMPrompt(rec, an, handToText(rec)); navigator.clipboard && navigator.clipboard.writeText(p); toast('大模型复盘提示词已复制到剪贴板（数字已算好，让它只做讲解）'); } }, '复制给 AI 讲解的提示词'));
        reviewEl.scrollIntoView({ block: 'nearest' });
      } catch (e) { reviewEl.textContent = '复盘失败：' + e.message; }
    }, 30);
  }
  // ---- 牌局回放：借用这张牌桌，操作区换成回放的控制条，记录一栏换成胜率折线
  function startReplay(rec) {
    if (!rec) return;
    closeReplay(false);
    flow.gen++;   // 这手已经结束；还在演的派彩动画、机器人循环看到计数变了就停，不再碰牌桌
    vis(actionsEl, false); vis(replayEl, true);
    shell.wrap.classList.add('replaying');
    shell.panel(false, 'replay'); shell.logLabel('胜率图');
    replayCtl = mountReplay({ host: replayEl, table, rec, chartHost: shell.chart,
      onExit: () => closeReplay(true), onReview: (r) => { closeReplay(true); reviewHand(r); } });
  }
  /** 收起回放。restore 为真时把引擎此刻的画面（或空桌）放回牌桌、重画操作区 */
  function closeReplay(restore) {
    if (replayCtl) { replayCtl.destroy(); replayCtl = null; }
    if (askEl) { askEl.remove(); askEl = null; }
    replayEl.innerHTML = ''; shell.chart.innerHTML = '';
    vis(replayEl, false); vis(actionsEl, true);
    if (shell.wrap.classList.contains('replaying')) { shell.wrap.classList.remove('replaying'); shell.panel(false, 'log'); shell.logLabel('记录'); }
    if (!restore) return;
    const eng = playState.engine;
    table.show(eng ? tableView(eng) : BLANK, { instant: true });
    renderActions();
  }
  /** 从历史进回放：正在打的一手没结束时不动它，先问打完还是放弃（放弃 = 这手不记录、筹码回到这手开始前）。问话盖在牌桌上，操作区原样留着 */
  playState.openReplay = (rec) => {
    const eng = playState.engine;
    if (!eng || eng.over) { startReplay(rec); return; }
    closeReplay(false);
    askEl = h('div', { class: 'panel replayask stagepop' },
      h('div', { class: 'note' }, `第 ${eng.handNo} 手还没打完。回放要用这张牌桌：可以先回去打完这手再回放，也可以放弃这一手（不记录，筹码回到这手开始前）。`),
      h('div', { class: 'row' },
        h('button', { onclick: () => { askEl.remove(); askEl = null; } }, '回去打完这手'),
        h('button', { class: 'danger', onclick: () => {
          const e2 = playState.engine;
          if (e2 && !e2.over) { flow.gen++; playState.engine = null; logEl.textContent = ''; }
          startReplay(rec);
        } }, '放弃这一手，开始回放')));
    shell.stage.append(askEl);
  };
  v.append(shell.wrap);
  renderActions();
}

exports.openReplay = openReplay;
exports.buildPlayView = buildPlayView;
});
