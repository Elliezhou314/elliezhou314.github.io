__squidDefine('src/solver/preflop.js', function (exports) {
'use strict';
// 翻前预解算：2~6 人，169 类起手牌，外部采样 MCCFR。
//
// 模型口径（界面上必须标注）：
//   - “权益结算 + 权益实现差”：翻前行动结束后没有真的翻后行动，
//     叶子按 底池 × 全下权益 + （Δ自己 − 在场各家 Δ 的均值）结算，
//     Δ 是用解算器在全部 1755 个同构翻牌上量出来的「实际 EV − 裸权益份额」。
//     仍是近似：Δ 在固定范围与两档 SPR 上测得，河牌仍是权益结算。详见 README「翻前模型」一章。
//   - 不允许平跟（limp）；尺度固定：开池 2.5bb（小盲 3bb），3bet = 3×，4bet = 2.2×，之后全下。
//   - 2 人摊牌用 169×169 权益表（蒙特卡洛预生成）；3 人及以上摊牌当场蒙特卡洛。

const { COMBOS, COMBO_COUNT, NOTATION_TO_COMBOS, comboToNotation, makeRng, NOTATIONS_GRID } = __squidRequire('src/core/cards.js');
const { evaluate } = __squidRequire('src/core/evaluator.js');

const NOTATION_LIST = NOTATIONS_GRID.flat();
const NOTATION_IDX = new Map(NOTATION_LIST.map((n, i) => [n, i]));
const COMBO_CLASS = new Int16Array(COMBO_COUNT);
for (let i = 0; i < COMBO_COUNT; i++) COMBO_CLASS[i] = NOTATION_IDX.get(comboToNotation(i));

const POSITIONS = { 2: ['SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['CO', 'BTN', 'SB', 'BB'], 5: ['MP', 'CO', 'BTN', 'SB', 'BB'], 6: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'] };

// ---------------------------------------------------------------------------
// 169×169 全下权益表（蒙特卡洛）
// ---------------------------------------------------------------------------
function buildEquityTable169(samplesPerPair = 400, seed = 42, onProgress) {
  const rng = makeRng(seed);
  const n = 169;
  const E = new Float32Array(n * n);
  const buf = new Int32Array(7);
  const deck = new Int32Array(52);
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      const ca = NOTATION_TO_COMBOS.get(NOTATION_LIST[a]), cb = NOTATION_TO_COMBOS.get(NOTATION_LIST[b]);
      let win = 0, tie = 0, cnt = 0;
      for (let s = 0; s < samplesPerPair; s++) {
        const x = COMBOS[ca[(rng() * ca.length) | 0]], y = COMBOS[cb[(rng() * cb.length) | 0]];
        if (x[0] === y[0] || x[0] === y[1] || x[1] === y[0] || x[1] === y[1]) continue;
        let m = 0;
        for (let c = 0; c < 52; c++) if (c !== x[0] && c !== x[1] && c !== y[0] && c !== y[1]) deck[m++] = c;
        for (let k = 0; k < 5; k++) { const j = k + ((rng() * (m - k)) | 0); const t = deck[k]; deck[k] = deck[j]; deck[j] = t; buf[k] = deck[k]; }
        buf[5] = x[0]; buf[6] = x[1]; const vx = evaluate(buf, 7);
        buf[5] = y[0]; buf[6] = y[1]; const vy = evaluate(buf, 7);
        if (vx > vy) win++; else if (vx === vy) tie++;
        cnt++;
      }
      // 同一类对自己：按对称性权益恰好是 1/2，不要让蒙特卡洛噪声留在对角线上
      const e = a === b ? 0.5 : (cnt ? (win + tie / 2) / cnt : 0.5);
      E[a * n + b] = e; E[b * n + a] = 1 - e;
    }
    if (onProgress && a % 10 === 0) onProgress(a, n);
  }
  return E;
}

// ---------------------------------------------------------------------------
// 翻前树
// ---------------------------------------------------------------------------
function buildPreflopTree(cfg = {}) {
  const P = cfg.players || 6;
  const stack = cfg.stack || 100;
  const openTo = cfg.openTo || 2.5, sbOpenTo = cfg.sbOpenTo || 3;
  const m3 = cfg.threeBetMult || 3, m4 = cfg.fourBetMult || 2.2;
  const allinThreshold = cfg.allinThreshold || 0.6;
  const pos = POSITIONS[P];
  const nodes = [];
  let dCount = 0;
  const sbIdx = P - 2, bbIdx = P - 1;

  function make(n) { n.id = nodes.length; nodes.push(n); return n; }

  function build(s) {
    if (s.pending.length === 0) return end(s);
    const p = s.pending[0];
    const toCall = s.currentBet - s.bets[p];
    const node = make({ type: 'D', player: p, pos: pos[p], toCall, pot: s.bets.reduce((a, b) => a + b, 0), bets: s.bets.slice(), alive: s.alive.slice(), raises: s.raises, history: s.history, actions: [], dIndex: dCount++ });
    const acts = [];
    if (toCall > 0) {
      acts.push({ kind: 'fold', to: s.bets[p] });
      // 不允许平跟：无人加注时只能弃牌或加注（大盲无人加注时是过牌）
      if (s.raises > 0) acts.push({ kind: 'call', to: Math.min(s.currentBet, stack) });
    } else acts.push({ kind: 'check', to: s.bets[p] });
    const remaining = stack - s.bets[p];
    if (remaining > toCall) {
      let to;
      if (s.raises === 0) to = p === sbIdx ? sbOpenTo : openTo;
      else if (s.raises === 1) to = s.currentBet * m3;
      else if (s.raises === 2) to = s.currentBet * m4;
      else to = stack;
      to = Math.round(to * 10) / 10;
      if (to >= stack * allinThreshold) to = stack;
      if (to > s.currentBet) acts.push({ kind: to === stack ? 'allin' : 'raise', to });
    }
    for (const a of acts) {
      a.label = { fold: '弃牌', check: '过牌', call: `跟注${a.to}`, raise: `加注到${a.to}`, allin: `全下${a.to}` }[a.kind];
      a.next = build(apply(s, p, a));
      node.actions.push(a);
    }
    return node;
  }

  function apply(s, p, a) {
    const bets = s.bets.slice(), alive = s.alive.slice();
    let pending = s.pending.slice(1), currentBet = s.currentBet, raises = s.raises;
    const tag = { fold: 'F', check: 'X', call: 'C', raise: 'R', allin: 'A' }[a.kind];
    if (a.kind === 'fold') alive[p] = false;
    else if (a.kind === 'call' || a.kind === 'check') bets[p] = a.to;
    else {
      bets[p] = a.to; currentBet = a.to; raises++;
      pending = [];
      for (let k = 1; k < P; k++) { const q = (p + k) % P; if (alive[q] && bets[q] < stack) pending.push(q); }
    }
    return { bets, alive, pending, currentBet, raises, history: s.history + pos[p] + ':' + tag + ' ' };
  }

  function end(s) {
    const aliveList = [];
    for (let p = 0; p < P; p++) if (s.alive[p]) aliveList.push(p);
    const pot = s.bets.reduce((a, b) => a + b, 0);
    if (aliveList.length === 1) return make({ type: 'T', kind: 'fold', winner: aliveList[0], pot, bets: s.bets.slice(), alive: s.alive.slice(), history: s.history });
    return make({ type: 'T', kind: 'settle', pot, bets: s.bets.slice(), alive: s.alive.slice(), history: s.history });
  }

  const bets = new Array(P).fill(0); bets[sbIdx] = 0.5; bets[bbIdx] = 1;
  const pending = [];
  for (let k = 0; k < P; k++) pending.push(k); // UTG..BTN,SB,BB（2 人：SB 先）
  const root = build({ bets, alive: new Array(P).fill(true), pending, currentBet: 1, raises: 0, history: '' });
  return { root, nodes, decisionCount: dCount, players: P, stack, positions: pos };
}

// ---------------------------------------------------------------------------
// 翻前 MCCFR
// ---------------------------------------------------------------------------
class PreflopSolver {
  constructor(tree, equityTable, opts = {}) {
    this.tree = tree; this.P = tree.players; this.E = equityTable;
    // 权益实现差（可选）。没有它时退化成原来的纯权益结算模型。
    // 见 tools/precompute_realization.mjs：用解算器解代表性翻后局面测出来的
    // 「实际 EV − 裸权益份额」，按 169 类与位置聚合。
    this.realization = opts.realization || null;
    this.postflopOrder = this.P === 2 ? [1, 0] : [this.P - 2, this.P - 1, ...Array.from({ length: this.P - 2 }, (_, i) => i)];
    this.postflopRank = new Int16Array(this.P);
    this.postflopOrder.forEach((seat, k) => { this.postflopRank[seat] = k; });
    this.rng = makeRng(opts.seed ?? 9);
    this.regret = []; this.ssum = [];
    for (const n of tree.nodes) if (n.type === 'D') { this.regret[n.dIndex] = new Float32Array(n.actions.length * 169); this.ssum[n.dIndex] = new Float32Array(n.actions.length * 169); }
    this.hands = new Int16Array(this.P); this.cls = new Int16Array(this.P);
    this.iter = 0;
    this.buf = new Int32Array(7); this.deck = new Int32Array(52);
    this.mcBoards = opts.mcBoards || 60;
  }

  _deal() {
    const used = new Uint8Array(52);
    for (let p = 0; p < this.P; p++) {
      for (;;) {
        const h = (this.rng() * COMBO_COUNT) | 0;
        const [a, b] = COMBOS[h];
        if (!used[a] && !used[b]) { used[a] = 1; used[b] = 1; this.hands[p] = h; this.cls[p] = COMBO_CLASS[h]; break; }
      }
    }
  }

  /**
   * 这手牌在这个叶子上的「权益实现差」（筹码）。
   * 位置按翻后行动顺序定：最后行动的那个是 IP，其余是 OOP。
   * SPR 就近取一套 delta —— 3bet 底池的 SPR 低得多，隐含赔率也小，不能和单加注底池混用。
   */
  _deltaOf(node, seat, alive) {
    const R = this.realization;
    if (!R || !R.spots) return 0;
    // 有效 SPR 用在场各家里最小的剩余后手算——能玩的钱由最短的那一家决定。
    // 早先按 seat 自己的后手算，全下叶子上还照样加修正：那里双方后手都是 0、
    // 翻后根本不存在，权益结算本身就是精确的，实测 AA 在底池 200 的全下叶子上
    // 被加了 +47.4 筹码（23.7% 底池），把 4bet/全下线的 EV 整个带偏。
    let behind = Infinity;
    for (const p of alive) behind = Math.min(behind, this.tree.stack - node.bets[p]);
    const spr = Math.max(0, behind) / Math.max(node.pot, 0.01);
    // 在场玩家里翻后最后行动的是 IP
    let ipSeat = alive[0];
    for (const p of alive) if (this.postflopRank[p] > this.postflopRank[ipSeat]) ipSeat = p;
    const t = seat === ipSeat ? 1 : 0;
    const cls = NOTATION_LIST[this.cls[seat]];

    // 每单位底池的实现差随 SPR 变化。我们只有两个实测点，加上一个精确点：
    //   SPR = 0        → 0（全下之后没有翻后，权益结算就是精确解）
    //   SPR = 4.5      → 3bet 底池那一档
    //   SPR = 17.6     → 单加注底池那一档
    // 三点之间线性插值，高于最高那档就截平。
    // 原来的做法是「取 SPR 最近的一档，再按底池比例放大」，在低 SPR 上是反的：
    // SPR 越低隐含赔率越小，实现差本该更小，而按底池放大反而更大。
    const pts = [{ spr: 0, d: 0 }];
    for (const k of Object.keys(R.spots)) {
      const sp = R.spots[k];
      const tbl = sp.delta[t];
      const v = tbl ? tbl[cls] : undefined;
      if (!Number.isFinite(v)) continue;
      pts.push({ spr: sp.spr || sp.stack / sp.pot, d: v / sp.pot });
    }
    if (pts.length < 2) return 0;   // 这一类没有任何实测值
    pts.sort((a, b) => a.spr - b.spr);
    let perPot;
    if (spr >= pts[pts.length - 1].spr) perPot = pts[pts.length - 1].d;
    else {
      let i = 0;
      while (i < pts.length - 1 && pts[i + 1].spr < spr) i++;
      const a = pts[i], b = pts[i + 1];
      const w = b.spr > a.spr ? (spr - a.spr) / (b.spr - a.spr) : 0;
      perPot = a.d + w * (b.d - a.d);
    }
    return perPot * node.pot;
  }

  /**
   * 中心化后的实现差：减去在场各家的均值，保证 Σ 修正 = 0，零和不受影响。
   *
   * 再加一道界限：结算叶子的 EV 必须落在 [−自己投入, 底池 − 自己投入] 里——
   * 输不能输得比投入还多，赢也不能赢走比底池更多。Δ 本身没有任何约束，
   * 极端类（如低 SPR 下的 AA）加上修正后可能跑出这个区间，那是物理上不存在的收益。
   * 直接截断单家的 EV 会破坏零和，所以改成把**整个修正向量**乘上同一个
   * 缩放系数 λ ≤ 1：各家修正之和本来就是 0，乘一个常数仍然是 0。
   */
  _realizationAdj(node, t, alive, shares) {
    if (!this.realization) return 0;
    const raw = [], n = alive.length;
    let sum = 0;
    for (const p of alive) { const d = this._deltaOf(node, p, alive); raw.push(d); sum += d; }
    const mean = sum / n;
    let lam = 1;
    for (let k = 0; k < n; k++) {
      const p = alive[k], adj = raw[k] - mean;
      if (adj === 0) continue;
      // base 必须是**这一家真正的结算基准**。早先 3 人以上用 1/n 等分代替，
      // 而实际结算走的是蒙特卡洛份额，两者不是一回事，界就定歪了：
      // 实测 3 人翻前 2060 次结算里有 16 次跑出物理区间，最差的一次
      // 一个只投了 7.5 的座位结算成 −10.71，等于输掉了比自己投入还多 3.2 个筹码。
      const base = node.pot * shares[k] - node.bets[p];
      const lo = -node.bets[p], hi = node.pot - node.bets[p];
      // base + lam*adj 必须落在 [lo, hi] 里
      if (adj > 0 && base + adj > hi) lam = Math.min(lam, Math.max(0, (hi - base) / adj));
      if (adj < 0 && base + adj < lo) lam = Math.min(lam, Math.max(0, (lo - base) / adj));
    }
    const idx = alive.indexOf(t);
    return lam * (raw[idx] - mean);
  }

  /**
   * 在场各家在这个叶子上的裸权益份额（占底池的比例，和为 1），顺序与 alive 一致。
   * 2 人用 169x169 精确权益表，3 人以上用蒙特卡洛——和真正结算用的是同一份数，
   * 所以修正的界限也就是真的界限。
   */
  _shares(node, alive) {
    const n = alive.length;
    if (n === 2) {
      // 两个方向都直接查表（表本身是按 E[b][a] = 1 - E[a][b] 建的），
      // 这样和改动前逐座位取值的写法逐位一致，2 人图不会因为这次重构漂一点点
      return [this.E[this.cls[alive[0]] * 169 + this.cls[alive[1]]], this.E[this.cls[alive[1]] * 169 + this.cls[alive[0]]]];
    }
    const out = new Array(n).fill(0);
    const used = new Uint8Array(52);
    for (const p of alive) { used[COMBOS[this.hands[p]][0]] = 1; used[COMBOS[this.hands[p]][1]] = 1; }
    let m = 0;
    for (let c = 0; c < 52; c++) if (!used[c]) this.deck[m++] = c;
    for (let s = 0; s < this.mcBoards; s++) {
      for (let k = 0; k < 5; k++) { const j = k + ((this.rng() * (m - k)) | 0); const tmp = this.deck[k]; this.deck[k] = this.deck[j]; this.deck[j] = tmp; this.buf[k] = this.deck[k]; }
      let best = -1, winners = 0;
      const vals = new Array(n);
      for (let k = 0; k < n; k++) {
        this.buf[5] = COMBOS[this.hands[alive[k]]][0]; this.buf[6] = COMBOS[this.hands[alive[k]]][1];
        const v = evaluate(this.buf, 7);
        vals[k] = v;
        if (v > best) { best = v; winners = 1; } else if (v === best) winners++;
      }
      for (let k = 0; k < n; k++) if (vals[k] === best) out[k] += 1 / winners;
    }
    for (let k = 0; k < n; k++) out[k] /= this.mcBoards;
    return out;
  }

  _settle(node, t) {
    const alive = [];
    for (let p = 0; p < this.P; p++) if (node.alive[p]) alive.push(p);
    const shares = this._shares(node, alive);
    const idx = alive.indexOf(t);
    // 修正必须在算完份额之后：它的界限就是按这份份额定的
    return node.pot * shares[idx] + this._realizationAdj(node, t, alive, shares) - node.bets[t];
  }

  _traverse(node, t) {
    if (node.type === 'T') {
      if (node.kind === 'fold') return node.winner === t ? node.pot - node.bets[t] : -node.bets[t];
      if (!node.alive[t]) return -node.bets[t];
      return this._settle(node, t);
    }
    const p = node.player, k = this.cls[p], nA = node.actions.length, R = this.regret[node.dIndex];
    let s = 0;
    const sigma = new Float64Array(nA);
    for (let a = 0; a < nA; a++) { const r = R[a * 169 + k]; if (r > 0) s += r; }
    for (let a = 0; a < nA; a++) sigma[a] = s > 0 ? Math.max(R[a * 169 + k], 0) / s : 1 / nA;
    if (p === t) {
      const va = new Float64Array(nA);
      let v = 0;
      for (let a = 0; a < nA; a++) { va[a] = this._traverse(node.actions[a].next, t); v += sigma[a] * va[a]; }
      for (let a = 0; a < nA; a++) { const i = a * 169 + k; R[i] = Math.max(R[i] + va[a] - v, 0); }
      return v;
    }
    const S = this.ssum[node.dIndex];
    for (let a = 0; a < nA; a++) S[a * 169 + k] += this.iter * sigma[a];
    let x = this.rng(), a = 0;
    for (; a < nA - 1; a++) { x -= sigma[a]; if (x <= 0) break; }
    return this._traverse(node.actions[a].next, t);
  }

  iterate(n) {
    for (let i = 0; i < n; i++) { this.iter++; this._deal(); for (let t = 0; t < this.P; t++) this._traverse(this.tree.root, t); }
    return this.iter;
  }

  /** 平均策略：节点 -> Float32Array(nA*169) */
  strategy(node) {
    const S = this.ssum[node.dIndex], nA = node.actions.length, out = new Float32Array(nA * 169);
    for (let k = 0; k < 169; k++) {
      let s = 0;
      for (let a = 0; a < nA; a++) s += S[a * 169 + k];
      for (let a = 0; a < nA; a++) out[a * 169 + k] = s > 0 ? S[a * 169 + k] / s : 1 / nA;
    }
    return out;
  }

  /**
   * 导出图表：决策节点 -> { history, pos, actions, probs(nA x 169) }
   * 默认只导出“没有人跟注过”的路径（RFI / 面对开池 / 面对 3bet / 面对 4bet…），
   * 否则 6 人树有几十万节点，文件几百 MB。
   */
  exportCharts(opts = {}) {
    const charts = [];
    const allowCallers = !!opts.allowCallers;
    for (const n of this.tree.nodes) {
      if (n.type !== 'D') continue;
      if (!allowCallers && /:C /.test(n.history)) continue;
      const st = this.strategy(n);
      charts.push({ id: n.id, history: n.history.trim(), pos: n.pos, player: n.player, toCall: n.toCall, pot: n.pot, raises: n.raises, actions: n.actions.map((a) => ({ kind: a.kind, to: a.to, label: a.label, next: a.next.id })), probs: Array.from(st) });
    }
    return { format: 'squid-preflop-v1', hasRealization: !!this.realization, players: this.P, stack: this.tree.stack, positions: this.tree.positions, iterations: this.iter, notations: NOTATION_LIST, model: this.realization ? '权益结算 + 权益实现差修正（实现差在全部 1755 个同构翻牌上解得、含转牌截断的配对差分修正，见 tools/precompute_realization.mjs）；尺度固定：开池2.5bb/小盲3bb，3bet=3x，4bet=2.2x，之后全下；不允许平跟' : '权益结算模型（无翻后行动），尺度固定：开池2.5bb/小盲3bb，3bet=3x，4bet=2.2x，之后全下；不允许平跟', charts };
  }
}

/** 给图表 JSON 提供检索：按 history 前缀找节点 */
// 面板里的权益有两层误差：eq169 本身是蒙特卡洛（标准误约 0.22 个百分点），
// 而且这里没有扣除牌张移除（拿着某张牌会改变对手范围的构成），实测系统性偏差最大约 0.9 个百分点。
// 所以小于这个量级的权益差不能当结论，判据统一用它。
const EQ_NOISE = 0.012;

/** 一张图里可能有多个玩家都能跟开池，把候选都列出来，别让 Array.find 的顺序偷偷决定结论 */
function preflopAuditCandidates(chart) {
  const root = chart.charts[0];
  const rootPos = root.pos;
  const combos = (n) => (n.length === 2 ? 6 : n.endsWith('s') ? 4 : 12);
  const out = [];
  for (const c of chart.charts) {
    if (!c.history || !c.actions.some((a) => a.kind === 'call')) continue;
    const parts = c.history.split(/\s+/);
    if (parts[0] !== rootPos + ':R' || !parts.slice(1).every((x) => x.endsWith(':F'))) continue;
    const ci = c.actions.findIndex((a) => a.kind === 'call');
    let tot = 0;
    for (let k = 0; k < 169; k++) tot += c.probs[ci * 169 + k] * combos(chart.notations[k]);
    out.push({ node: c, ci, pct: tot / 1326, label: c.pos + '（' + c.history + '），跟注 ' + (tot / 1326 * 100).toFixed(1) + '%' });
  }
  return out;
}

/**
 * 翻前图的模型自检：把「这张图为什么会错」量化出来，而不是只写一句免责声明。
 *
 * 模型 = 翻前行动树 + 权益结算叶子，中间没有任何翻后博弈。
 * 直接后果是每手牌恰好实现它的全下权益，于是开池与否几乎退化成「对跟注范围的权益」的一个阈值。
 *
 * 参照的跟注范围由调用方显式指定：3 人图里 SB 跟 27%、BB 跟 90%，选谁结论差很多，
 * 这个选择必须摆到台面上。
 */
function preflopModelAudit(chart, eqTable, candIdx = 0, realization = null) {
  const T = eqTable;
  if (!T || !chart) return null;
  const cands = preflopAuditCandidates(chart);
  if (!cands.length) return null;
  const useIdx = Math.min(Math.max(0, candIdx), cands.length - 1);
  const pick = cands[useIdx];
  const callNode = pick.node, ci = pick.ci;
  const combos = (n) => (n.length === 2 ? 6 : n.endsWith('s') ? 4 : 12);
  const root = chart.charts[0];
  const ri = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
  if (ri < 0) return null;

  const w = new Float64Array(169);
  for (let k = 0; k < 169; k++) w[k] = callNode.probs[ci * 169 + k] * combos(chart.notations[k]);

  const idx = (n) => NOTATION_LIST.indexOf(n);
  const eqVsCall = (n) => {
    const i = idx(n);
    let num = 0, den = 0;
    for (let j = 0; j < 169; j++) {
      const x = w[j]; if (x <= 0) continue;
      num += x * T[i * 169 + idx(chart.notations[j])];
      den += x;
    }
    return den > 0 ? num / den : NaN;
  };
  const openOf = (n) => root.probs[ri * 169 + chart.notations.indexOf(n)];

  // 模型自己的「实现份额」。
  // 加了权益实现差之后，「裸权益更高却开得更少」不一定是错：同花连牌的裸权益低、
  // 实现率高，模型就是有意让它多开的。所以下面两个口径都算：
  //   worst    ——  按裸权益判，衡量这张图离「纯权益阈值」有多远；
  //   worstAdj ——  按模型自己的实现份额判，这才是真正的内部自相矛盾。
  //
  // 口径必须和 _realizationAdj 完全一致：叶子上加的是「自己的 Δ 减去在场各家 Δ 的均值」，
  // 两人时就是 (Δ自己 − Δ对手)/2，不是 Δ自己 − Δ对手 —— 差一倍。
  // 这里的「对手」是整个跟注范围，所以用它按同一套权重加权的平均 Δ。
  // 这个均值对所有手牌是同一个常数，不改变排序，但会把 Δ 的影响幅度对折，
  // 早先按 Δ/底池 整个加进去，会把模型本来自洽的地方误报成矛盾。
  // 开池方是不是 IP，不能写死。翻后行动顺序与 PreflopSolver 用的是同一条规则：
  // 2 人是 [BB, SB]（SB 就是按钮，最后行动），P≥3 是 [SB, BB, 其余按翻前顺序]。
  // 2 人图与 3 人图里开池方（座位 0）恰好都是最后行动，但 6 人图里 UTG 开池、
  // 被 CO 或 BTN 跟注时开池方是 OOP，写死成 IP 会把 Δ 取反。
  const P = chart.positions.length;
  const postflopOrder = P === 2 ? [1, 0] : [P - 2, P - 1, ...Array.from({ length: P - 2 }, (_, i) => i)];
  const postflopRank = new Array(P).fill(0);
  postflopOrder.forEach((seat, k) => { postflopRank[seat] = k; });
  const callerSeat = chart.positions.indexOf(callNode.pos);
  const openerIsIP = callerSeat < 0 ? true : postflopRank[0] > postflopRank[callerSeat];
  const OPEN_POT = 5.5;
  let deltaSpot = null;
  if (realization && realization.spots) {
    const sprOpen = (chart.stack - 2.5) / OPEN_POT;
    for (const k of Object.keys(realization.spots)) {
      const sp = realization.spots[k];
      if (!deltaSpot || Math.abs(sp.spr - sprOpen) < Math.abs(deltaSpot.spr - sprOpen)) deltaSpot = sp;
    }
  }
  const deltaOfNotation = (n) => {
    if (!deltaSpot) return NaN;
    const d = deltaSpot.delta[openerIsIP ? 1 : 0][n];
    return Number.isFinite(d) ? d : NaN;
  };
  // 跟注范围按 combo 权重加权的平均 Δ（OOP 那一侧）
  let dOpp = 0;
  if (deltaSpot) {
    let num = 0, den = 0;
    for (let j = 0; j < 169; j++) {
      const x = w[j]; if (x <= 0) continue;
      const v = deltaSpot.delta[openerIsIP ? 0 : 1][chart.notations[j]];
      num += x * (Number.isFinite(v) ? v : 0); den += x;
    }
    dOpp = den > 0 ? num / den : 0;
  }

  const rows = chart.notations.map((n) => {
    const d = deltaOfNotation(n);
    const eq = eqVsCall(n);
    const adj = deltaSpot ? ((Number.isFinite(d) ? d : 0) - dOpp) / 2 : 0;
    return { n, eq, open: openOf(n), delta: d, adjChips: adj, eqAdj: eq + adj / OPEN_POT };
  }).filter((r) => Number.isFinite(r.eq));
  rows.sort((a, b) => b.eq - a.eq);
  const opened = rows.filter((r) => r.open >= 0.5);
  const folded = rows.filter((r) => r.open < 0.5);
  const lowOpen = opened.length ? Math.min(...opened.map((r) => r.eq)) : NaN;
  const highFold = folded.length ? Math.max(...folded.map((r) => r.eq)) : NaN;

  // 找「明显更高却开得明显更少」的一对。两个量纲分开判：
  // 权益差必须超过 EQ_NOISE，开池频率差必须超过 40 个百分点。
  // 早先把两个差直接相加当打分，结果由频率差主导，选出来的权益差只有 0.6pt、比误差还小。
  const worstBy = (key) => {
    let w = null;
    for (const x of rows) for (const y of rows) {
      if (x[key] - y[key] <= EQ_NOISE) continue;
      if (y.open - x.open < 0.4) continue;
      if (!w || x[key] - y[key] > w.eqGap) w = { hi: x, lo: y, eqGap: x[key] - y[key] };
    }
    return w;
  };
  const worst = worstBy('eq');
  const worstAdj = deltaSpot ? worstBy('eqAdj') : null;
  const deltaCoverage = deltaSpot ? rows.filter((r) => Number.isFinite(r.delta)).length : 0;
  return {
    cands, useIdx, callNode, callPct: pick.pct, rows, lowOpen, highFold, worst, rootPos: root.pos,
    worstAdj, deltaSpot: deltaSpot ? { label: deltaSpot.label, spr: deltaSpot.spr, pot: OPEN_POT, oppMeanDelta: dOpp, openerIsIP } : null, deltaCoverage,
  };
}

function findChart(charts, history) {
  const h = history.trim();
  return charts.charts.find((c) => c.history === h) || null;
}

exports.buildEquityTable169 = buildEquityTable169;
exports.buildPreflopTree = buildPreflopTree;
exports.preflopAuditCandidates = preflopAuditCandidates;
exports.preflopModelAudit = preflopModelAudit;
exports.findChart = findChart;
exports.PreflopSolver = PreflopSolver;
exports.NOTATION_LIST = NOTATION_LIST;
exports.POSITIONS = POSITIONS;
exports.EQ_NOISE = EQ_NOISE;
});
