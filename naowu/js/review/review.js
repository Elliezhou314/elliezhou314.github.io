__squidDefine('src/review/review.js', function (exports) {
'use strict';
// 每局详细解析 + 中文文字复盘（数学口径驱动，不依赖大模型）。
//
// 所有数字都来自真实计算：
//   - 权益：手牌 vs “假设范围”（假设范围按对手翻前动作与位置粗估，并在文字里明确标注“假设”）
//   - 底池赔率、所需权益、MDF、诈唬盈亏平衡弃牌率、SPR：公式直接算
// 想要更硬的结论，用 buildSolverSpec() 把这个点丢给鱿鱼解算器。

const { COMBOS, comboIndex, comboToNotation, cardsToPretty, cardToPretty, cardsToStr } = __squidRequire('src/core/cards.js');
const { evaluate, describeValue } = __squidRequire('src/core/evaluator.js');
const { equityHandVsRange, equityRangeVsRange, equityHandVsRanges } = __squidRequire('src/core/equity.js');
const { parseRange, removeDead, rangeToText } = __squidRequire('src/core/range.js');
const { positionName, STREET_CN } = __squidRequire('src/engine/game.js');
const { topPercentRange } = __squidRequire('src/engine/bot.js');

// 各位置的示例翻前范围（复盘时的“假设范围”起点）
const OPEN = {
  UTG: '77+,ATs+,KQs,AJo+,KQo,T9s,98s', MP: '66+,A9s+,KTs+,QTs+,JTs,T9s,98s,87s,ATo+,KJo+',
  CO: '22+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,87s,76s,A9o+,KTo+,QTo+,JTo',
  BTN: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,64s+,53s+,A8o+,K9o+,Q9o+,J9o+,T9o',
  SB: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,ATo+,KJo+,QJo', 'BTN/SB': '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o',
  BB: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o',
};
const CALL_VS_OPEN = '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,64s+,ATo+,KJo+,QJo';
const THREEBET = 'TT+,AQs+,AQo+,A5s-A2s,KJs+,76s,65s';

/** 按对手翻前动作估一个假设范围文本 */
function assumedPreflopRange(rec, seat) {
  const pos = positionName(seat, rec.button, rec.n);
  const pre = rec.history.filter((h) => h.street === 0 && h.seat === seat && ['fold', 'call', 'raise', 'check'].includes(h.kind));
  const raises = pre.filter((h) => h.kind === 'raise').length;
  const raisesBefore = rec.history.filter((h) => h.street === 0 && h.kind === 'raise').findIndex((h) => h.seat === seat);
  if (raises >= 2 || (raises === 1 && raisesBefore >= 1)) return { text: THREEBET, why: `${pos} 翻前 3bet` };
  if (raises === 1) return { text: OPEN[pos] || OPEN.CO, why: `${pos} 翻前开池加注` };
  if (pre.some((h) => h.kind === 'call')) return { text: pos === 'BB' ? OPEN.BB : CALL_VS_OPEN, why: `${pos} 翻前跟注` };
  return { text: OPEN[pos] || OPEN.BB, why: `${pos} 翻前未加注` };
}

/** 假设范围随对手翻后动作收窄：每次下注/加注保留权益最强的一部分 */
function narrowByAggression(rangeW, board, keepFrac) {
  const rv = equityRangeVsRange(rangeW, parseRange('random'), board, { maxRunouts: 80 });
  const idx = [];
  for (let i = 0; i < 1326; i++) if (rangeW[i] > 0 && !Number.isNaN(rv.perCombo[i])) idx.push(i);
  idx.sort((a, b) => rv.perCombo[b] - rv.perCombo[a]);
  const out = new Float32Array(1326);
  let acc = 0, total = idx.reduce((s, i) => s + rangeW[i], 0);
  for (const i of idx) { if (acc / total >= keepFrac) break; out[i] = rangeW[i]; acc += rangeW[i]; }
  return out;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const f1 = (x) => (Math.round(x * 10) / 10).toString();

/**
 * 主入口：返回 { decisions:[...], summary, solverSpecs:[...], text }
 */
function analyzeHand(rec) {
  const hero = rec.seats[rec.heroSeat];
  if (!hero) throw new Error('记录里没有英雄');
  const heroPos = positionName(hero.seat, rec.button, rec.n);
  const decisions = [];
  const solverSpecs = [];
  const oppRanges = {}; // seat -> Float32Array（随行动收窄）
  for (const s of rec.seats) if (s.seat !== hero.seat) { const a = assumedPreflopRange(rec, s.seat); oppRanges[s.seat] = { w: parseRange(a.text), why: a.why, text: a.text }; }
  let board = [];
  let lastNarrowStreet = {};

  for (let i = 0; i < rec.history.length; i++) {
    const h = rec.history[i];
    if (h.kind === 'board') { board = h.board.slice(); continue; }
    if (!['fold', 'check', 'call', 'bet', 'raise'].includes(h.kind)) continue;
    // 对手激进动作 -> 收窄其假设范围（每街最多一次）
    if (h.seat !== hero.seat && (h.kind === 'bet' || h.kind === 'raise') && h.street > 0 && lastNarrowStreet[h.seat] !== h.street) {
      const o = oppRanges[h.seat];
      o.w = narrowByAggression(removeDead(o.w, [...board, ...hero.hole]), board, 0.55);
      o.narrowed = (o.narrowed || 0) + 1;
      lastNarrowStreet[h.seat] = h.street;
    }
    if (h.seat !== hero.seat) continue;

    // 英雄决策点
    const street = h.street;
    const pot = h.potBefore, toCall = h.toCall, stack = h.stackBefore;
    const alive = rec.seats.filter((s) => !rec.history.slice(0, i).some((x) => x.kind === 'fold' && x.seat === s.seat) && s.seat !== hero.seat);
    const d = { index: i, street, streetCn: STREET_CN[street], board: board.slice(), action: h, pot, toCall, stack, heroPos, opponents: alive.map((s) => s.seat) };
    // 权益 vs 每个对手的假设范围
    d.equities = alive.map((s) => {
      const o = oppRanges[s.seat];
      const r = equityHandVsRange(hero.hole, o.w, board, { samples: 6000, seed: 5 });
      return { seat: s.seat, name: s.name, equity: r.equity, exact: r.exact, stderr: r.stderr, rangeWhy: o.why + (o.narrowed ? `（翻后下注后收窄 ${o.narrowed} 次）` : ''), rangeText: rangeToText(o.w).slice(0, 160) };
    });
    const eqMin = Math.min(...d.equities.map((e) => e.equity).filter((x) => !Number.isNaN(x)), 1);
    d.equity = eqMin;
    if (alive.length > 1) {
      // 多人局直接对"所有对手手牌 + 补牌"联合抽样，不再用幂次公式折算。
      // 旧的 eq^(1+0.35(n-1)) 没有依据，实测在 2 个对手时高估约 11 个百分点。
      const mw = equityHandVsRanges(hero.hole, alive.map((s) => oppRanges[s.seat].w), board, { samples: 900, seed: 20260909 + i });
      d.multiwayEquity = Number.isNaN(mw.equity) ? eqMin : mw.equity;
      d.multiwayStderr = mw.stderr;
      d.multiwaySamples = mw.samples;
    } else d.multiwayEquity = eqMin;
    d.potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    d.spr = pot > 0 ? stack / pot : Infinity;
    if (toCall > 0) {
      d.mdfForHero = pot > toCall ? (pot - toCall) / pot : 0; // 从对手视角：其下注 b 于底池 p-b，我方应防守 (p-b)/p
      d.villainBluffBreakeven = toCall / pot; // 对手诈唬需要的弃牌率 = b/(p) 其中 p 已含 b
    }
    if (h.kind === 'bet' || h.kind === 'raise') {
      const b = h.amount, p0 = pot + (h.kind === 'raise' ? toCall : 0);
      d.betFrac = b / Math.max(p0, 1);
      d.bluffBreakeven = b / (p0 + b);
      d.mdfForVillain = p0 / (p0 + b);
    }
    // 翻牌时算范围 vs 范围（范围优势）
    if (street === 1 && alive.length === 1) {
      const heroRange = parseRange(assumedPreflopRange(rec, hero.seat).text);
      const rv = equityRangeVsRange(removeDead(heroRange, board), oppRanges[alive[0].seat].w, board, { maxRunouts: 120 });
      d.rangeAdvantage = rv.equity;
    }
    // 手牌描述
    if (board.length >= 3) d.handNow = describeValue(evaluate([...board, ...hero.hole]));
    d.verdict = verdictFor(d);
    d.text = narrate(d, hero, rec);
    decisions.push(d);
    if (board.length >= 3 && alive.length <= 2) {
      const ranges = [];
      const order = rec.seats.filter((s) => s.seat === hero.seat || alive.some((a) => a.seat === s.seat)).map((s) => s.seat).sort((a, b) => ((a - rec.button + rec.n) % rec.n) - ((b - rec.button + rec.n) % rec.n));
      // 翻后行动顺序：从按钮后第一个开始
      const seatsInOrder = order.map((s) => ({ seat: s, d: (s - rec.button - 1 + rec.n * 2) % rec.n })).sort((a, b) => a.d - b.d).map((x) => x.seat);
      for (const s of seatsInOrder) ranges.push(s === hero.seat ? assumedPreflopRange(rec, hero.seat).text : rangeToText(oppRanges[s].w));
      solverSpecs.push({ decisionIndex: i, streetCn: STREET_CN[street], board: cardsToStr(board), pot, stack: Math.min(...seatsInOrder.map((s) => (s === hero.seat ? stack : rec.seats[s].stack0 - 0))), players: seatsInOrder.length, ranges, heroSeat: seatsInOrder.indexOf(hero.seat), label: `第${rec.handNo}手 ${STREET_CN[street]} 决策` });
    }
  }
  const summary = summarize(decisions, rec, hero);
  return { decisions, summary, solverSpecs, text: [summary, ...decisions.map((d) => d.text)].join('\n\n') };
}

function verdictFor(d) {
  const a = d.action.kind, eq = d.multiwayEquity;
  const isRiver = d.street === 3;
  // 只有河牌的"权益"才等于胜率：牌发完了、没有后续街，跟注 EV 就是 眼下权益 vs 底池赔率。
  // 翻牌/转牌上，裸权益既不等于你能实现的权益（位置、被再下注、听牌被打掉），
  // 也没算上隐含赔率，所以不能拿它直接盖章"漏洞"，只能作为参考并说清口径。
  const soft = (v) => (isRiver ? v : (v === 'bad' ? 'meh' : v));
  const caveat = isRiver ? '' : '（翻后还有街：这只是即时赔率对比，未计权益实现与隐含赔率）';

  if (d.toCall > 0) {
    const edge = eq - d.potOdds;
    if (a === 'fold') {
      if (edge > 0.06) return { level: soft('bad'), tag: isRiver ? '过度弃牌' : '可能弃得偏紧', why: `权益 ${pct(eq)} 高于所需 ${pct(d.potOdds)}${caveat}` };
      if (edge > 0) return { level: 'meh', tag: '偏紧的弃牌', why: `权益略高于所需（${pct(eq)} vs ${pct(d.potOdds)}）` };
      return { level: 'ok', tag: '合理弃牌', why: `权益 ${pct(eq)} 低于所需 ${pct(d.potOdds)}` };
    }
    if (a === 'call') {
      if (edge >= 0) return { level: 'ok', tag: '有利可图的跟注', why: `权益 ${pct(eq)} ≥ 所需 ${pct(d.potOdds)}` };
      if (edge > -0.05) return { level: 'meh', tag: '边缘跟注', why: `权益 ${pct(eq)} 略低于所需 ${pct(d.potOdds)}，要靠隐含赔率补` };
      return { level: soft('bad'), tag: '跟注过松', why: `权益 ${pct(eq)} 明显低于所需 ${pct(d.potOdds)}${caveat}` };
    }
    if (a === 'raise') {
      if (eq > 0.6) return { level: 'ok', tag: '价值加注', why: `权益 ${pct(eq)}` };
      return { level: 'meh', tag: eq > 0.35 ? '半诈唬加注' : '纯诈唬加注', why: `权益 ${pct(eq)}，需要对手弃牌率 ≥ ${pct(d.bluffBreakeven)}` };
    }
  }
  if (a === 'check') {
    // 过牌不等于错：慢打、控池、范围保护都是合理动机，河牌上才好说"错失价值"
    if (isRiver && eq > 0.7) return { level: 'meh', tag: '可能错失价值', why: `河牌权益 ${pct(eq)} 却过牌，除非在诱下注` };
    return { level: 'ok', tag: '过牌', why: `权益 ${pct(eq)}` };
  }
  if (a === 'bet') {
    if (eq > 0.6) return { level: 'ok', tag: '价值下注', why: `权益 ${pct(eq)}，尺度 ${pct(d.betFrac)} 底池` };
    return { level: 'meh', tag: eq > 0.35 ? '半诈唬' : '诈唬', why: `权益 ${pct(eq)}，盈亏平衡弃牌率 ${pct(d.bluffBreakeven)}` };
  }
  return { level: 'ok', tag: '', why: '' };
}

function narrate(d, hero, rec) {
  const L = [];
  const hand = cardsToPretty(hero.hole);
  L.push(`【${d.streetCn}】${d.board.length ? '公共牌 ' + cardsToPretty(d.board) + '，' : ''}你（${d.heroPos}）拿 ${hand}${d.handNow ? '（' + d.handNow + '）' : ''}，底池 ${f1(d.pot)}，后手 ${f1(d.stack)}（SPR ${d.spr === Infinity ? '∞' : d.spr.toFixed(1)}）。`);
  for (const e of d.equities) {
    L.push(`对 ${e.name} 的假设范围（${e.rangeWhy}）权益 ${Number.isNaN(e.equity) ? '无法计算' : pct(e.equity)}${e.exact ? '' : `（蒙特卡洛 ±${pct(e.stderr || 0)}）`}。`);
  }
  if (d.opponents.length > 1) L.push(`同时面对 ${d.opponents.length} 个对手时，你的实际权益是 ${pct(d.multiwayEquity)}${d.multiwayStderr ? `（蒙特卡洛 ${d.multiwaySamples} 次抽样，±${pct(d.multiwayStderr)}）` : ''} —— 注意这远低于对单个对手的 ${pct(d.equity)}，多人底池权益被稀释得很快。`);
  if (d.rangeAdvantage != null) L.push(`范围对范围：你的翻前范围在这个翻牌上权益 ${pct(d.rangeAdvantage)}${d.rangeAdvantage > 0.55 ? '，范围优势在你' : d.rangeAdvantage < 0.45 ? '，范围优势在对手' : '，双方接近'}。`);
  if (d.toCall > 0) {
    L.push(`面对 ${f1(d.toCall)} 的下注：底池赔率 ${f1(d.pot)}:${f1(d.toCall)}，所需权益 ${pct(d.potOdds)}；对手这次诈唬只要你弃牌超过 ${pct(d.villainBluffBreakeven)} 就有利可图，所以你至少要防守 ${pct(1 - d.villainBluffBreakeven)} 的范围（MDF）。`);
  }
  if (d.action.kind === 'bet' || d.action.kind === 'raise') {
    L.push(`你${d.action.kind === 'bet' ? '下注' : '加注'} ${f1(d.action.amountTo)}（约 ${pct(d.betFrac)} 底池）：对手需要防守 ${pct(d.mdfForVillain)} 才不被剥削；作为诈唬，盈亏平衡弃牌率 ${pct(d.bluffBreakeven)}。`);
  }
  const v = d.verdict;
  const actCn = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注' }[d.action.kind];
  L.push(`你的动作：${actCn}。评价：${v.tag}${v.why ? '——' + v.why : ''}。${v.level === 'bad' ? '⚠ 河牌上这是可量化的漏洞（牌已发完，权益就是胜率）。' : v.level === 'meh' ? '△ 边缘决策：这里的判断只基于假设范围与即时赔率，点"解算此点"才有均衡结论。' : '✓'}`);
  return L.join('\n');
}

function summarize(decisions, rec, hero) {
  const net = rec.result ? rec.result.net[hero.seat] : 0;
  const bad = decisions.filter((d) => d.verdict.level === 'bad');
  const meh = decisions.filter((d) => d.verdict.level === 'meh');
  const L = [`第 ${rec.handNo} 手复盘：${net >= 0 ? '+' : ''}${f1(net)}（${(net / rec.bb).toFixed(1)} bb）。你做了 ${decisions.length} 个决策，${bad.length} 个明显漏洞，${meh.length} 个边缘决策。`];
  if (bad.length) L.push('优先修正：' + bad.map((d) => `${d.streetCn}${d.verdict.tag}`).join('、') + '。');
  L.push('注意：以上“假设范围”是按位置与动作粗估的，对手真实范围可能不同；用“解算此点”得到的是范围对范围的均衡结论。结果好坏不代表决策好坏，只看 EV。');
  return L.join('\n');
}

/** 把某个决策点变成解算 spec（供界面“一键解算”） */
function buildSolverSpec(analysis, decisionIndex) {
  return analysis.solverSpecs.find((s) => s.decisionIndex === decisionIndex) || null;
}

/** 给大模型用的复盘提示词（把所有已算好的数字喂进去，让模型只做“讲解”，不让它编数字） */
function buildLLMPrompt(rec, analysis, handText) {
  return [
    '你是德州扑克教练。下面是一手牌的完整记录和已经算好的数学指标（权益、底池赔率、MDF、SPR）。',
    '要求：只基于给出的数字讲解，不要编造新的概率；指出最大的一个漏洞，并给出下次遇到类似局面的行动规则；用中文，300 字以内。',
    '', '=== 手牌记录 ===', handText, '', '=== 数学指标与初步评价 ===', analysis.text,
  ].join('\n');
}

exports.assumedPreflopRange = assumedPreflopRange;
exports.analyzeHand = analyzeHand;
exports.buildSolverSpec = buildSolverSpec;
exports.buildLLMPrompt = buildLLMPrompt;
});
