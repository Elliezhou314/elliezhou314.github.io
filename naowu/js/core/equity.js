__squidDefine('src/core/equity.js', function (exports) {
'use strict';
// 权益（equity）计算 + 解算器用的摊牌扫描。
//
// 口径说明：
//   - 公共牌 >= 3 张时全部精确枚举剩余发牌，结果是准确值。
//   - 翻前用蒙特卡洛，返回 samples 和标准误，界面上必须把误差一起显示。

const { COMBOS, COMBO_COUNT, comboIndex, remainingDeck, makeRng, shuffle } = __squidRequire('src/core/cards.js');
const { evaluate, boardStrengths } = __squidRequire('src/core/evaluator.js');
const { removeDead } = __squidRequire('src/core/range.js');

// ---------------------------------------------------------------------------
// 摊牌扫描（O(N log N) 一次排序 + O(N) 扫描），解算器终端节点的核心。
// 给定牌力表 str（-1 表示与公共牌冲突）和对手权重 w，
// 得到每个组合 i：对手所有不与 i 冲突的组合中，比 i 弱/相同/强 的权重和。
// ---------------------------------------------------------------------------

/** 按牌力升序排好的活组合序号（每张公共牌只需要算一次，缓存起来给 sweep 反复用） */
function sortByStrength(str) {
  const idx = [];
  for (let i = 0; i < COMBO_COUNT; i++) if (str[i] >= 0) idx.push(i);
  idx.sort((a, b) => str[a] - str[b]);
  return Int16Array.from(idx);
}

const cardSum = new Float64Array(52);
const gCard = new Float64Array(52);

/**
 * @param sorted sortByStrength(str)
 * @param str    boardStrengths(board)
 * @param w      对手权重 Float32Array/Float64Array(1326)
 * @param win,tie,lose 输出 Float64Array(1326)，只写活组合
 */
function showdownSweep(sorted, str, w, win, tie, lose) {
  const n = sorted.length;
  cardSum.fill(0);
  let sum = 0, i = 0;
  while (i < n) {
    const s = str[sorted[i]];
    let j = i;
    while (j < n && str[sorted[j]] === s) j++;
    let gsum = 0;
    for (let k = i; k < j; k++) {
      const c = sorted[k], a = COMBOS[c][0], b = COMBOS[c][1];
      win[c] = sum - cardSum[a] - cardSum[b];
      const wc = w[c];
      gsum += wc; gCard[a] += wc; gCard[b] += wc;
    }
    for (let k = i; k < j; k++) {
      const c = sorted[k], a = COMBOS[c][0], b = COMBOS[c][1];
      tie[c] = gsum - gCard[a] - gCard[b] + w[c];
    }
    for (let k = i; k < j; k++) {
      const c = sorted[k], a = COMBOS[c][0], b = COMBOS[c][1], wc = w[c];
      gCard[a] = 0; gCard[b] = 0;
      cardSum[a] += wc; cardSum[b] += wc;
    }
    sum += gsum;
    i = j;
  }
  cardSum.fill(0);
  sum = 0; i = n - 1;
  while (i >= 0) {
    const s = str[sorted[i]];
    let j = i;
    while (j >= 0 && str[sorted[j]] === s) j--;
    for (let k = i; k > j; k--) {
      const c = sorted[k], a = COMBOS[c][0], b = COMBOS[c][1];
      lose[c] = sum - cardSum[a] - cardSum[b];
    }
    for (let k = i; k > j; k--) {
      const c = sorted[k], wc = w[c];
      cardSum[COMBOS[c][0]] += wc; cardSum[COMBOS[c][1]] += wc;
      sum += wc;
    }
    i = j;
  }
}

/** 对手权重中，不与组合 i 冲突的总权重（含容斥修正）。用于弃牌终端。 */
function liveWeightPerCombo(w, out) {
  cardSum.fill(0);
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const wc = w[i];
    if (wc === 0) continue;
    total += wc; cardSum[COMBOS[i][0]] += wc; cardSum[COMBOS[i][1]] += wc;
  }
  for (let i = 0; i < COMBO_COUNT; i++) {
    out[i] = total - cardSum[COMBOS[i][0]] - cardSum[COMBOS[i][1]] + w[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 发牌枚举
// ---------------------------------------------------------------------------

/** 列出所有补牌组合（0/1/2 张），每项是数组 */
function enumerateRunouts(board, dead = []) {
  const deck = remainingDeck([...board, ...dead]);
  const need = 5 - board.length;
  if (need <= 0) return [[]];
  if (need === 1) return deck.map((c) => [c]);
  if (need === 2) {
    const out = [];
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) out.push([deck[i], deck[j]]);
    return out;
  }
  throw new Error('翻前请用蒙特卡洛');
}

// ---------------------------------------------------------------------------
// 手牌 vs 范围
// ---------------------------------------------------------------------------

function equityHandVsRange(hole, rangeW, board, opts = {}) {
  const w = removeDead(rangeW, [...board, ...hole]);
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) total += w[i];
  if (total <= 0) return { equity: NaN, win: 0, tie: 0, lose: 0, exact: true, note: '对手范围与已知牌全部冲突' };

  if (board.length >= 3) {
    const runouts = enumerateRunouts(board, hole);
    let win = 0, tie = 0, lose = 0;
    const full = [...board, 0, 0].slice(0, 5);
    const buf = new Int32Array(7);
    const oppIdx = [];
    for (let i = 0; i < COMBO_COUNT; i++) if (w[i] > 0) oppIdx.push(i);
    const dead = new Uint8Array(52);
    for (const r of runouts) {
      for (let k = 0; k < r.length; k++) full[board.length + k] = r[k];
      for (let k = 0; k < 5; k++) buf[k] = full[k];
      buf[5] = hole[0]; buf[6] = hole[1];
      const hv = evaluate(buf, 7);
      for (const c of r) dead[c] = 1;
      for (const j of oppIdx) {
        const a = COMBOS[j][0], b = COMBOS[j][1];
        if (dead[a] || dead[b]) continue;
        buf[5] = a; buf[6] = b;
        const ov = evaluate(buf, 7);
        const wj = w[j];
        if (hv > ov) win += wj; else if (hv < ov) lose += wj; else tie += wj;
      }
      for (const c of r) dead[c] = 0;
    }
    const t = win + tie + lose;
    return { equity: (win + tie / 2) / t, win: win / t, tie: tie / t, lose: lose / t, exact: true, runouts: runouts.length };
  }

  // 翻前：蒙特卡洛
  const samples = opts.samples || 20000;
  const rng = opts.rng || makeRng(opts.seed ?? 12345);
  const cum = new Float64Array(COMBO_COUNT);
  let acc = 0;
  for (let i = 0; i < COMBO_COUNT; i++) { acc += w[i]; cum[i] = acc; }
  const buf = new Int32Array(7);
  let win = 0, tie = 0, lose = 0;
  const deck = new Int32Array(52);
  for (let s = 0; s < samples; s++) {
    // 按权重抽对手组合
    let x = rng() * acc, lo = 0, hi = COMBO_COUNT - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    const oa = COMBOS[lo][0], ob = COMBOS[lo][1];
    // 抽 5 张公共牌（部分洗牌）
    let n = 0;
    for (let c = 0; c < 52; c++) if (c !== hole[0] && c !== hole[1] && c !== oa && c !== ob) deck[n++] = c;
    for (let k = 0; k < 5; k++) {
      const j = k + ((rng() * (n - k)) | 0);
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      buf[k] = deck[k];
    }
    buf[5] = hole[0]; buf[6] = hole[1];
    const hv = evaluate(buf, 7);
    buf[5] = oa; buf[6] = ob;
    const ov = evaluate(buf, 7);
    if (hv > ov) win++; else if (hv < ov) lose++; else tie++;
  }
  const eq = (win + tie / 2) / samples;
  return { equity: eq, win: win / samples, tie: tie / samples, lose: lose / samples, exact: false, samples, stderr: Math.sqrt(eq * (1 - eq) / samples) };
}

// ---------------------------------------------------------------------------
// 范围 vs 范围：返回范围 A 每个组合对范围 B 的权益，以及加权总权益
// ---------------------------------------------------------------------------

function equityRangeVsRange(wA, wB, board, opts = {}) {
  const a = removeDead(wA, board), b = removeDead(wB, board);
  const eq = new Float32Array(COMBO_COUNT).fill(NaN);
  const score = new Float64Array(COMBO_COUNT), tot = new Float64Array(COMBO_COUNT);
  const win = new Float64Array(COMBO_COUNT), tie = new Float64Array(COMBO_COUNT), lose = new Float64Array(COMBO_COUNT);

  if (board.length >= 3) {
    let runouts = enumerateRunouts(board);
    const maxR = opts.maxRunouts || Infinity;
    let sampled = false;
    if (runouts.length > maxR) { shuffle(runouts, makeRng(opts.seed ?? 7)); runouts = runouts.slice(0, maxR); sampled = true; }
    const full = [...board, 0, 0].slice(0, 5);
    for (const r of runouts) {
      for (let k = 0; k < r.length; k++) full[board.length + k] = r[k];
      const str = boardStrengths(full);
      const sorted = sortByStrength(str);
      showdownSweep(sorted, str, b, win, tie, lose);
      for (let k = 0; k < sorted.length; k++) {
        const i = sorted[k];
        if (a[i] === 0) continue;
        score[i] += win[i] + tie[i] / 2;
        tot[i] += win[i] + tie[i] + lose[i];
      }
    }
    let num = 0, den = 0;
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (a[i] > 0 && tot[i] > 0) { eq[i] = score[i] / tot[i]; num += a[i] * tot[i] * eq[i]; den += a[i] * tot[i]; }
    }
    return { perCombo: eq, equity: den > 0 ? num / den : NaN, exact: !sampled, runouts: runouts.length };
  }

  // 翻前：对 A 的每个组合做蒙特卡洛（样本数摊到每个组合上，默认总量 20 万）
  const rng = makeRng(opts.seed ?? 99);
  const liveA = [];
  for (let i = 0; i < COMBO_COUNT; i++) if (a[i] > 0) liveA.push(i);
  const perCombo = Math.max(200, Math.floor((opts.samples || 200000) / Math.max(1, liveA.length)));
  let num = 0, den = 0;
  for (const i of liveA) {
    const r = equityHandVsRange(COMBOS[i], b, board, { samples: perCombo, rng });
    eq[i] = r.equity;
    if (!Number.isNaN(r.equity)) { num += a[i] * r.equity; den += a[i]; }
  }
  return { perCombo: eq, equity: den > 0 ? num / den : NaN, exact: false, samplesPerCombo: perCombo };
}

// ---------------------------------------------------------------------------
// 多人（2~3 手具体手牌）权益
// ---------------------------------------------------------------------------

/**
 * 一手具体牌 对 N 个"范围"的权益（N ≥ 1），底池按并列平分。
 *
 * 为什么需要它：多人局不能拿"对单个对手的权益"去套幂次公式折算。
 * 我早先用的 eq^(1+0.35(n-1)) 没有任何依据，对同一批局面实测会高估 3~5 个百分点、
 * 最坏 13.5 个百分点——因为多个对手的手牌之间既不独立（互相占牌），
 * 与公共牌的相关性也不同（同花听牌被别人挡住的概率随人数变化）。
 * 这里直接对"对手手牌 + 补牌"联合抽样，并给出标准误。
 *
 * 抽对手手牌必须**整组独立抽、任一冲突就整组重抽**，不能逐个玩家各自重抽到不冲突为止：
 * 后者的联合分布是 w0(h0)/W0 · w1(h1)/Z1(h0) · …，多出来的 1/Z 依赖前面玩家的手牌，
 * 会系统性偏袒"挡住对手较多组合"的牌（实测最大 5.9 个百分点）。cfr.js 的发牌是同一个道理。
 *
 * board 为 5 张时补牌唯一，只需对对手手牌抽样；4 张时枚举 44 张河牌；
 * 3 张时枚举全部 C(45,2)=990 种补牌（可用 maxRunouts 改为抽样）。
 */
function equityHandVsRanges(hole, ranges, board, opts = {}) {
  const N = ranges.length;
  if (N < 1) throw new Error('至少要一个对手范围');
  const rng = opts.rng || makeRng(opts.seed ?? 20260909);
  const samples = opts.samples || (N === 1 ? 800 : 1500);

  // 每个对手范围先去掉与公共牌、英雄手牌冲突的组合，并做累积分布
  const cums = [];
  for (const r of ranges) {
    const w = removeDead(r, [...board, ...hole]);
    const cum = new Float64Array(COMBO_COUNT);
    let acc = 0;
    for (let i = 0; i < COMBO_COUNT; i++) { acc += w[i]; cum[i] = acc; }
    if (acc <= 0) return { equity: NaN, note: '某个对手范围与已知牌全部冲突', samples: 0 };
    cums.push(cum);
  }
  const pick = (cum) => {
    const total = cum[COMBO_COUNT - 1];
    let x = rng() * total, lo = 0, hi = COMBO_COUNT - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };

  const need = 5 - board.length;
  const buf = new Int32Array(7);
  const dead = new Uint8Array(52);
  const oppHands = new Array(N);
  let sum = 0, sumSq = 0, used = 0, rejected = 0;

  for (let s = 0; s < samples; s++) {
    // 整组抽：任一冲突就把这一整组丢掉重抽，联合分布严格正比于 w0·w1·…·w_{N-1}
    let ok = false;
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      dead.fill(0);
      for (const c of board) dead[c] = 1;
      dead[hole[0]] = 1; dead[hole[1]] = 1;
      ok = true;
      for (let p = 0; p < N; p++) {
        const h = pick(cums[p]);
        const [a, b] = COMBOS[h];
        if (dead[a] || dead[b]) { ok = false; break; }
        oppHands[p] = h; dead[a] = 1; dead[b] = 1;
      }
    }
    if (!ok) { rejected++; continue; }

    // 这一组手牌下，对补牌取平均（可枚举就枚举，保证方差只来自对手手牌）
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
    const full = [...board, 0, 0].slice(0, 5);
    let share = 0, runouts = 0;
    const settle = () => {
      for (let k = 0; k < 5; k++) buf[k] = full[k];
      buf[5] = hole[0]; buf[6] = hole[1];
      const mine = evaluate(buf, 7);
      let best = mine, winners = 1;
      for (let p = 0; p < N; p++) {
        buf[5] = COMBOS[oppHands[p]][0]; buf[6] = COMBOS[oppHands[p]][1];
        const v = evaluate(buf, 7);
        if (v > best) { best = v; winners = 1; } else if (v === best) winners++;
      }
      if (mine === best) share += 1 / winners;
      runouts++;
    };
    if (need === 0) settle();
    else if (need === 1) { for (const c of deck) { full[4] = c; settle(); } }
    else {
      const cap = opts.maxRunouts || Infinity;
      const total = (deck.length * (deck.length - 1)) / 2;
      if (total <= cap) { for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { full[3] = deck[i]; full[4] = deck[j]; settle(); } }
      else for (let k = 0; k < cap; k++) { const i = (rng() * deck.length) | 0; let j = (rng() * deck.length) | 0; if (i === j) j = (j + 1) % deck.length; full[3] = deck[i]; full[4] = deck[j]; settle(); }
    }
    const eq = share / runouts;
    sum += eq; sumSq += eq * eq; used++;
  }
  if (!used) return { equity: NaN, note: '范围之间冲突过多，抽不到合法牌', samples: 0 };
  const mean = sum / used;
  return {
    equity: mean,
    // 这是"对手手牌"这一层的标准误（补牌那层已被枚举平均掉），只量噪声不量系统偏差
    stderr: used > 1 ? Math.sqrt(Math.max(sumSq / used - mean * mean, 0) / used) : NaN,
    samples: used, rejected, opponents: N, exact: false,
  };
}

function equityMultiway(hands, board, opts = {}) {
  const n = hands.length;
  const dead = hands.flat();
  const buf = new Int32Array(7);
  const shares = new Float64Array(n);
  const sq = new Float64Array(n);   // 每次结算分到的份额的平方和：抽样时用来算标准误（翻前回放要写明误差）
  const vals = new Int32Array(n);
  let count = 0;
  const settle = (full) => {
    let best = -1;
    for (let p = 0; p < n; p++) {
      for (let k = 0; k < 5; k++) buf[k] = full[k];
      buf[5] = hands[p][0]; buf[6] = hands[p][1];
      vals[p] = evaluate(buf, 7);
      if (vals[p] > best) best = vals[p];
    }
    let winners = 0;
    for (let p = 0; p < n; p++) if (vals[p] === best) winners++;
    for (let p = 0; p < n; p++) if (vals[p] === best) { shares[p] += 1 / winners; sq[p] += 1 / (winners * winners); }
    count++;
  };
  if (board.length >= 3) {
    const full = [...board, 0, 0].slice(0, 5);
    for (const r of enumerateRunouts(board, dead)) {
      for (let k = 0; k < r.length; k++) full[board.length + k] = r[k];
      settle(full);
    }
    return { equities: Array.from(shares, (s) => s / count), exact: true, runouts: count };
  }
  const samples = opts.samples || 20000;
  const rng = opts.rng || makeRng(opts.seed ?? 3);
  const deck = remainingDeck(dead);
  const full = new Int32Array(5);
  for (let s = 0; s < samples; s++) {
    for (let k = 0; k < 5; k++) {
      const j = k + ((rng() * (deck.length - k)) | 0);
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      full[k] = deck[k];
    }
    settle(full);
  }
  // 标准误：每次抽样里这个人分到的份额（赢 1、几人平分 1/k、输 0）的样本方差 / 抽样次数，再开方
  const stderrs = Array.from(shares, (s, p) => { const m = s / count; return Math.sqrt(Math.max(sq[p] / count - m * m, 0) / count); });
  return { equities: Array.from(shares, (s) => s / count), exact: false, samples, stderrs };
}

// ---------------------------------------------------------------------------
// 解算器用：两组组合之间、在剩余发牌上平均的“权益分”矩阵
//   S[ia*nB+ib] = 平均(赢=1, 平=0.5, 输=0)，冲突对为 0
// 用于翻牌/转牌截断树的“权益结算”叶子。
// ---------------------------------------------------------------------------

function equityMatrix(board, combosA, combosB, opts = {}) {
  const nA = combosA.length, nB = combosB.length;
  const S = new Float32Array(nA * nB);
  let runouts = enumerateRunouts(board);
  const maxR = opts.maxRunouts || Infinity;
  let sampled = false;
  if (runouts.length > maxR) { shuffle(runouts, makeRng(opts.seed ?? 11)); runouts = runouts.slice(0, maxR); sampled = true; }
  const need = 5 - board.length;
  // 每对组合真正参与平均的补牌数，必须逐对精确统计。
  // 早先的实现用"期望有效补牌数"（全枚举数 × 抽样比例）当统一分母：
  // 全枚举时恰好等于实际值，但一旦抽样，各对的实际命中数围绕期望波动，
  // 结果就是单格 S 可能 > 1、且 S[i][j] + S[j][i] ≠ 1，破坏了常和性质，
  // 翻牌全下的权益结算叶子实测最大偏差 6.5 个百分点。
  //
  // 用容斥可以精确还原每对的分母，且只需 52 + 52² 个计数器：
  //   一个补牌组合"命中"某手牌 ⇔ 它包含那 4 张底牌之一。
  //   补牌为 1 张时  命中数 = Σ n1[c]
  //   补牌为 2 张时  命中数 = Σ n1[c] − Σ_{c<d} n2[c][d]（两张都在集合里的被算了两次）
  const n1 = new Int32Array(52);
  const n2 = new Int32Array(52 * 52);
  for (const r of runouts) {
    for (let x = 0; x < r.length; x++) {
      n1[r[x]]++;
      for (let y = x + 1; y < r.length; y++) { n2[r[x] * 52 + r[y]]++; n2[r[y] * 52 + r[x]]++; }
    }
  }
  const K = runouts.length;
  const denomFor = (a0, a1, b0, b1) => {
    const cs = [a0, a1, b0, b1];
    let hit = 0;
    for (let x = 0; x < 4; x++) hit += n1[cs[x]];
    if (need >= 2) for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) hit -= n2[cs[x] * 52 + cs[y]];
    return K - hit;
  };

  const full = [...board, 0, 0].slice(0, 5);
  const buf = new Int32Array(7);
  const vA = new Int32Array(nA), vB = new Int32Array(nB);
  const dead = new Uint8Array(52);
  for (const r of runouts) {
    for (let k = 0; k < r.length; k++) { full[board.length + k] = r[k]; dead[r[k]] = 1; }
    for (let k = 0; k < 5; k++) buf[k] = full[k];
    for (let i = 0; i < nA; i++) {
      const c = COMBOS[combosA[i]];
      vA[i] = dead[c[0]] || dead[c[1]] ? -1 : (buf[5] = c[0], buf[6] = c[1], evaluate(buf, 7));
    }
    for (let j = 0; j < nB; j++) {
      const c = COMBOS[combosB[j]];
      vB[j] = dead[c[0]] || dead[c[1]] ? -1 : (buf[5] = c[0], buf[6] = c[1], evaluate(buf, 7));
    }
    for (let i = 0; i < nA; i++) {
      const va = vA[i];
      if (va < 0) continue;
      const a0 = COMBOS[combosA[i]][0], a1 = COMBOS[combosA[i]][1];
      const row = i * nB;
      for (let j = 0; j < nB; j++) {
        const vb = vB[j];
        if (vb < 0) continue;
        const b0 = COMBOS[combosB[j]][0], b1 = COMBOS[combosB[j]][1];
        if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) continue;
        if (va > vb) S[row + j] += 1; else if (va === vb) S[row + j] += 0.5;
      }
    }
    for (const c of r) dead[c] = 0;
  }
  // 逐对用实际分母归一
  for (let i = 0; i < nA; i++) {
    const a0 = COMBOS[combosA[i]][0], a1 = COMBOS[combosA[i]][1];
    const row = i * nB;
    for (let j = 0; j < nB; j++) {
      const b0 = COMBOS[combosB[j]][0], b1 = COMBOS[combosB[j]][1];
      if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) { S[row + j] = 0; continue; }
      const d = denomFor(a0, a1, b0, b1);
      S[row + j] = d > 0 ? S[row + j] / d : 0;
    }
  }
  return { S, nA, nB, runouts: runouts.length, exact: !sampled };
}

exports.sortByStrength = sortByStrength;
exports.showdownSweep = showdownSweep;
exports.liveWeightPerCombo = liveWeightPerCombo;
exports.enumerateRunouts = enumerateRunouts;
exports.equityHandVsRange = equityHandVsRange;
exports.equityRangeVsRange = equityRangeVsRange;
exports.equityHandVsRanges = equityHandVsRanges;
exports.equityMultiway = equityMultiway;
exports.equityMatrix = equityMatrix;
});
