__squidDefine('src/solver/squid.js', function (exports) {
'use strict';
// 鱿鱼解算器（SquidSolver）门面：
//   createSolver(spec) -> 建树 + 选引擎
//   runSolve(solver, budget, onProgress) -> 按时间/轮数/目标可利用度跑
//   serialize(solver) -> 可跨 Worker 传输的解
//   Solution -> 主线程用的只读解（策略网格、范围频率、reach 推进）
//   RemoteSolverAdapter -> “云端解算”接口：POST spec，返回同格式的 serialize 结果

const { buildTree, DEFAULT_SIZES, streetOfBoard } = __squidRequire('src/solver/tree.js');
const { VectorCFR, SampledCFR } = __squidRequire('src/solver/cfr.js');
const { parseRange, removeDead } = __squidRequire('src/core/range.js');
const { COMBO_COUNT, COMBOS, NOTATION_TO_COMBOS, comboToNotation, cardsToStr } = __squidRequire('src/core/cards.js');
const { liveWeightPerCombo } = __squidRequire('src/core/equity.js');

/**
 * Worker 里保留多少个已解出的 solver。
 *
 * 放在这里而不是 worker.js，是因为主线程缓存的 Solution 必须比它**少**：
 * 取动作 EV 要拿 solveId 回 Worker 索引，主线程留得多就会出现
 * 「主线程还有这个场景、Worker 已经淘汰了」→ 判分报错。
 * 两处从同一个常量派生，就不会各改各的了。
 */
const MAX_CACHED_SOLVERS = 6;

function normalizeSpec(spec) {
  const players = spec.players || 2;
  const board = spec.board;
  if (!board || board.length < 3 || board.length > 5) throw new Error('公共牌需要 3~5 张');
  const ranges = (spec.ranges || []).slice(0, players).map((r) => (typeof r === 'string' ? parseRange(r) : r));
  if (ranges.length !== players) throw new Error(`需要 ${players} 个范围`);
  const street = streetOfBoard(board);
  const leafMode = Object.assign(
    { turn: 'full', river: street === 0 ? 'equity' : 'full' }, // 翻牌默认：翻牌+转牌完整，河牌权益结算
    spec.leafMode || {},
  );
  return {
    players, board, ranges,
    pot: spec.pot ?? 10,
    stack: spec.stack ?? 100,
    sizes: spec.sizes || DEFAULT_SIZES,
    raiseCap: spec.raiseCap ?? 3,
    allin: spec.allin ?? true,
    allinThreshold: spec.allinThreshold ?? 0.75,
    leafMode,
    engine: spec.engine || 'auto',
    seed: spec.seed ?? 1,
    maxRunouts: spec.maxRunouts ?? 400,
    maxNodes: spec.maxNodes ?? 400000,
    // 实测真实 RSS 约为这里估算值的 1.5 倍（建树本身也吃内存，且不在估算里），
    // 所以默认阈值定在 350MB 而不是浏览器标签页的实际上限。
    maxMemoryMB: spec.maxMemoryMB ?? 350,
    label: spec.label || '',
  };
}


/** 解算前估算内存占用（MB），用于在分配之前拦住会撑爆浏览器的配置 */
function estimateMemory(tree, spec) {
  const combos = spec.ranges.map((w) => { let n = 0; for (let i = 0; i < COMBO_COUNT; i++) if (w[i] > 0) n++; return n; });
  let strategyBytes = 0;
  for (const n of tree.nodes) {
    if (n.type !== 'D') continue;
    strategyBytes += 2 * n.actions.length * (combos[n.player] || 0) * 4; // regret + strategySum，Float32
  }
  // 权益结算叶子按不同公共牌去重后各存一份矩阵
  const eqBoards = new Set();
  for (const n of tree.nodes) if (n.type === 'E') eqBoards.add(n.boardKey);
  const equityBytes = eqBoards.size * (combos[0] || 0) * (combos[1] || 0) * 4;
  // 摊牌牌力表：每个河牌面 1326 个 Int32
  const strBoards = new Set();
  for (const n of tree.nodes) if (n.type === 'T' && n.kind === 'showdown') strBoards.add(n.boardKey);
  const strengthBytes = strBoards.size * COMBO_COUNT * 4 * 2; // 牌力表 + 排序索引
  const MB = 1024 * 1024;
  return {
    combos,
    strategyMB: strategyBytes / MB,
    equityMB: equityBytes / MB,
    strengthMB: strengthBytes / MB,
    totalMB: (strategyBytes + equityBytes + strengthBytes) / MB,
    equityBoards: eqBoards.size,
    strengthBoards: strBoards.size,
  };
}

function createSolver(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const tree = buildTree({
    players: spec.players, board: spec.board, pot: spec.pot, stacks: new Array(spec.players).fill(spec.stack),
    sizes: spec.sizes, raiseCap: spec.raiseCap, allin: spec.allin, allinThreshold: spec.allinThreshold, leafMode: spec.leafMode, maxNodes: spec.maxNodes,
  });
  const engine = spec.engine === 'auto' ? (spec.players === 2 ? 'vector' : 'sampled') : spec.engine;

  // 先估内存再分配。节点数上限管不住内存：真正的开销是
  //   每个决策节点  2 张表(遗憾+策略和) x 动作数 x 该玩家组合数 x 4 字节
  //   每个权益结算叶子  nA x nB x 4 字节的权益矩阵
  // 宽范围 + 完整街可以轻松要几百 MB，Worker 会直接崩掉、主线程的按钮永远卡在禁用态。
  const est = estimateMemory(tree, spec);
  const limitMB = spec.maxMemoryMB;
  if (est.totalMB > limitMB) {
    throw new Error(`这套配置预计需要约 ${est.totalMB.toFixed(0)} MB 内存（策略表 ${est.strategyMB.toFixed(0)} MB + 权益矩阵 ${est.equityMB.toFixed(0)} MB），超过 ${limitMB} MB 上限。` +
      `建议：减少下注尺度或加注上限、收窄范围（当前 ${est.combos.join(' / ')} 个组合）、或把街的深度改成截断模式。`);
  }

  const core = engine === 'vector' ? new VectorCFR(tree, spec.ranges, { maxRunouts: spec.maxRunouts }) : new SampledCFR(tree, spec.ranges, { seed: spec.seed });
  return { spec, tree, core, engine, startedAt: 0, elapsed: 0, history: [], memoryEstimate: est };
}

const yieldLoop = () => new Promise((r) => setTimeout(r, 0));

/**
 * budget: { ms, iterations, targetExploitPct }
 * onProgress({ iter, elapsed, exploit, ev, phase })
 * 每一批之间让出事件循环，所以可以被 cancel。
 */
async function runSolve(solver, budget = {}, onProgress = () => {}, shouldStop = () => false) {
  const ms = budget.ms ?? 20000;
  const maxIter = budget.iterations ?? Infinity;
  const target = budget.targetExploitPct ?? 0.5;
  const t0 = performance.now();
  solver.startedAt = t0;
  const core = solver.core;

  if (solver.engine === 'vector') {
    const pre = core.precompute((done, total) => onProgress({ phase: 'precompute', done, total, elapsed: performance.now() - t0 }));
    solver.precomputed = pre;
    let batch = 4;
    let lastExploit = null;
    while (true) {
      const tb = performance.now();
      core.iterate(batch);
      const dt = performance.now() - tb;
      const elapsed = performance.now() - t0;
      // 每 ~1.5 秒或每 20 轮评估一次可利用度
      if (core.iter % 20 === 0 || elapsed - (solver._lastEvalAt || 0) > 1500 || elapsed > ms || core.iter >= maxIter) {
        const ex = core.exploitability();
        lastExploit = ex;
        solver._lastEvalAt = elapsed;
        solver.history.push({ iter: core.iter, elapsed, exploitPct: ex.pctPot });
        onProgress({ phase: 'solve', iter: core.iter, elapsed, exploit: ex, batchMs: dt });
        if (ex.pctPot <= target) break;
      }
      if (elapsed > ms || core.iter >= maxIter || shouldStop()) break;
      batch = Math.max(2, Math.min(50, Math.round(batch * (300 / Math.max(dt, 1)))));
      await yieldLoop();
    }
    solver.elapsed = performance.now() - t0;
    solver.exploit = lastExploit || core.exploitability();
    solver.rootEV = core.rootEV();
    return summarize(solver);
  }

  // 采样引擎
  let batch = 500;
  while (true) {
    const tb = performance.now();
    core.iterate(batch);
    const dt = performance.now() - tb;
    const elapsed = performance.now() - t0;
    onProgress({ phase: 'solve', iter: core.iter, elapsed, batchMs: dt });
    if (elapsed > ms || core.iter >= maxIter || shouldStop()) break;
    batch = Math.max(100, Math.min(20000, Math.round(batch * (300 / Math.max(dt, 1)))));
    await yieldLoop();
  }
  solver.elapsed = performance.now() - t0;
  return summarize(solver);
}

function summarize(solver) {
  const { tree, core, engine, spec } = solver;
  return {
    engine,
    players: spec.players,
    iterations: core.iter,
    elapsedMs: Math.round(solver.elapsed),
    exploitPct: solver.exploit ? solver.exploit.pctPot : null,
    exploitChips: solver.exploit ? solver.exploit.chips : null,
    rootEV: solver.rootEV || null,
    nodes: tree.nodes.length,
    decisionNodes: tree.decisionCount,
    leafMode: spec.leafMode,
    precomputed: solver.precomputed || null,
    note: engine === 'vector'
      ? '2 人向量化 DCFR，可利用度为对当前平均策略的最佳回应收益（占底池 %）。'
      : `${spec.players} 人外部采样 MCCFR：多人博弈无纳什均衡保证，此为自博弈近似策略；EV 为蒙特卡洛估计。`,
  };
}

// ---------------------------------------------------------------------------
// 剥削分析：对不同类型的对手，均衡打法与最大剥削打法各值多少
// ---------------------------------------------------------------------------

/**
 * 剥削打法的「并列容差」：EV 差不到底池这么多的动作，视为并列、保持均衡比例。
 *
 * 取 0.5%，与判分的三星门槛（season.js 的 starsFromLoss，平均 EV 损失 ≤ 0.5% 底池 = 满分）
 * 是同一个数，这是有意的：应用一边告诉用户「损失不到底池 0.5% 就算打得完美」，
 * 一边自己为了不到 0.5% 的收益就偏离均衡、把自己变成靶子，那是双标。
 *
 * 实测（见 CHANGELOG）：容差从 0 加到底池的 5%，四种对手的剥削收益一分没变
 * （+0.433 / +1.683 / +0.188），说明真正赚钱的偏离，每手牌的 EV 优势都远大于这个量级；
 * 而「对手完全均衡」时的暴露风险从 1.667 掉到 0——那部分本来就是拿噪声当信号。
 */
const EXPLOIT_TIE_TOL_PCT = 0.5;

/**
 * 四种对手模型：σ_漏洞 = (1 − λ)·σ_均衡 + λ·τ。
 * λ 是「有多大比例的决策不看牌力、按固定倾向乱做」，τ 是「乱做时倾向做什么」。
 * 与自由牌局那四个机器人风格是同一套语言，但这里是精确解、不是启发式。
 * 「均衡型」是对照组：λ = 0，剥削收益必须恰好为 0——这是这套算法的自检。
 */
const VILLAIN_MODELS = {
  balanced: { cn: '均衡型（对照组）', desc: '按均衡打，没有漏洞', lambda: 0, tendency: { fold: 0, check: 1, call: 0, aggro: 0 } },
  station: { cn: '跟注站', desc: '一半的决策不看牌力，倾向跟到底', lambda: 0.5, tendency: { fold: 0.05, check: 0.35, call: 0.6, aggro: 0 } },
  maniac: { cn: '疯狂型', desc: '近一半的决策不看牌力，倾向下注加注', lambda: 0.45, tendency: { fold: 0.1, check: 0.1, call: 0.2, aggro: 0.6 } },
  nit: { cn: '过紧型', desc: '四成的决策不看牌力，一有压力就弃', lambda: 0.4, tendency: { fold: 0.7, check: 0.25, call: 0.05, aggro: 0 } },
};

/**
 * 对一个已解好的 2 人局面做剥削分析。
 *
 * 四个数（都是 hero 的 EV，筹码）：
 *   evGtoVsGto      均衡对均衡 —— 基线
 *   evGtoVsVillain  你打均衡、对手带漏洞 —— 均衡本身就能赢一些
 *   evExploit       你打最佳回应、对手带漏洞 —— 赚最多
 *   evPunished      你继续用这套剥削打法，但对手醒过来最佳回应你 —— 破绽的代价
 *
 * 「剥削多赚」= evExploit − evGtoVsVillain（增量，不是拿均衡对均衡当分母）。
 * 「暴露风险」= evGtoVsGto − evPunished（你偏离均衡后被反打回来会亏多少）。
 */
function exploitAnalysis(solver, hero = 0, model = 'station', tolPct = null) {
  if (solver.engine !== 'vector') throw new Error('剥削分析只支持 2 人局（向量化解算）');
  const core = solver.core;
  const villain = 1 - hero;
  const m = VILLAIN_MODELS[model] || VILLAIN_MODELS.station;
  const leak = core.perturbedStrategy(villain, m.tendency, m.lambda);
  const heroGto = core.strategyTable(hero);

  const evGtoVsGto = core.evWith(null)[hero];
  const pinVillain = []; pinVillain[villain] = leak; pinVillain[hero] = null;
  const evGtoVsVillain = core.evWith(pinVillain)[hero];

  // 并列容差：EV 差不到底池 0.5% 的动作保持均衡，不白冒被反打的风险
  //（见 cfr.js 'br' 分支与 EXPLOIT_TIE_TOL_PCT 的注释）。
  const tieTol = (tolPct != null ? tolPct : EXPLOIT_TIE_TOL_PCT) / 100 * solver.tree.pot0;
  const br = core.bestResponse(hero, leak, tieTol);
  // br.ev 是精确的最佳回应值；br.strategy 是「并列处保持均衡」的那一份，
  // 它的 EV 最多比 br.ev 低 tieTol。四个数要能互相加减，所以按实际策略重算一遍。
  const pinBoth = []; pinBoth[hero] = br.strategy; pinBoth[villain] = leak;
  const evExploit = core.evWith(pinBoth)[hero];
  // 对手醒过来：把 hero 钉在剥削打法上，让对手对它求最佳回应。
  // 双方 EV 之和恒等于初始底池，所以 hero 那时拿到的是 pot0 − 对手的最佳回应值。
  const counter = core.bestResponse(villain, br.strategy);
  const evPunished = solver.tree.pot0 - counter.ev;

  // 剥削打法与均衡打法差在哪：按节点统计「有多大比例的范围换了动作」
  //
  // 权重必须是「走到这个节点时 hero 手上还剩多少范围」（reachAt），不是根节点的范围权重。
  // 根节点上两者恰好相等，往下每走一步就差一截——而界面里的策略网格用的正是 reachAt，
  // 用根权重会让同一屏上两个数打架（实测 X-B33- 节点「加注」一个报 55%、一个报 17%），
  // 排序也跟着错：最该看的节点排不到前面。
  const diffs = [];
  const heroL = core.L[hero];
  const liveBuf = new Float64Array(COMBO_COUNT);
  for (const node of solver.tree.nodes) {
    if (node.type !== 'D' || node.player !== hero) continue;
    const gto = heroGto[node.dIndex], ex = br.strategy[node.dIndex];
    if (!gto || !ex) continue;
    const nA = node.actions.length, L = heroL, n = L.length;
    const reach = core.reachAt(node);
    const rp = reach[hero];
    let moved = 0, tot = 0;
    const to = new Float64Array(nA), from = new Float64Array(nA);
    for (let c = 0; c < n; c++) {
      const w = rp[L[c]];
      if (!(w > 0)) continue;
      tot += w;
      let best = 0;
      for (let a = 1; a < nA; a++) if (ex[a * n + c] > ex[best * n + c]) best = a;
      for (let a = 0; a < nA; a++) from[a] += w * gto[a * n + c];
      to[best] += w;
      // 均衡里这个动作的频率越低，说明换得越彻底
      moved += w * (1 - gto[best * n + c]);
    }
    if (tot <= 0) continue;
    // 这个节点在均衡对局里有多常走到：双方 reach 去掉牌面冲突后的联合权重 / 根节点上的同一个量。
    // 只数 hero 那一侧会漏掉对手的行动概率，那不叫节点频率。
    liveWeightPerCombo(reach[1 - hero], liveBuf);
    let joint = 0;
    for (const h of heroL) joint += rp[h] * liveBuf[h];
    diffs.push({
      nodeId: node.id, history: node.history, pot: node.pot, toCall: node.toCall,
      movedPct: (moved / tot) * 100,
      reachPct: core.Z > 0 ? (joint / core.Z) * 100 : 0,
      actions: node.actions.map((a, i) => ({ label: a.label, kind: a.kind, gto: (from[i] / tot) * 100, exploit: (to[i] / tot) * 100 })),
    });
  }
  // 只按「换得多不多」排会把几乎走不到的节点顶到前面（实测有 1.5% 频率的节点换动作比例最高）。
  // 真正影响 EV 的是「走到频率 × 换动作比例」，所以按这个乘积排。
  for (const d of diffs) d.impact = (d.movedPct * d.reachPct) / 100;
  diffs.sort((a, b) => (b.impact - a.impact) || (b.movedPct - a.movedPct));

  return {
    hero, model, modelName: m.cn, modelDesc: m.desc, lambda: m.lambda, tendency: m.tendency,
    pot0: solver.tree.pot0,
    evGtoVsGto, evGtoVsVillain, evExploit, evPunished,
    gain: evExploit - evGtoVsVillain,
    risk: evGtoVsGto - evPunished,
    tieTol, tieTolPct: (tieTol / solver.tree.pot0) * 100, brEvExact: br.ev, brEvGap: br.ev - evExploit,
    diffs: diffs.slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// 序列化：树 + 策略 + 范围
// ---------------------------------------------------------------------------

function serializeTree(tree) {
  return tree.nodes.map((n) => {
    const o = { id: n.id, type: n.type, street: n.street, board: n.board, pot: n.pot, invested: n.invested, alive: n.alive, history: n.history };
    if (n.type === 'D') Object.assign(o, { player: n.player, toCall: n.toCall, stacks: n.stacks, dIndex: n.dIndex, actions: n.actions.map((a) => ({ kind: a.kind, amount: a.amount, pct: a.pct ?? null, label: a.label, next: a.next.id })) });
    else if (n.type === 'C') o.children = n.children.map((c) => ({ card: c.card, next: c.next.id }));
    else if (n.type === 'T') Object.assign(o, { kind: n.kind, winner: n.winner ?? null, boardKey: n.boardKey ?? null });
    else if (n.type === 'E') Object.assign(o, { boardKey: n.boardKey, reason: n.reason });
    return o;
  });
}

function serialize(solver, summary) {
  const ex = solver.core.export();
  return {
    format: 'squid-solution-v1',
    spec: { ...solver.spec, ranges: solver.spec.ranges.map((w) => Array.from(w)) },
    summary: summary || summarize(solver),
    nodes: serializeTree(solver.tree),
    combos: ex.combos,
    strategies: ex.strategies,
  };
}

// ---------------------------------------------------------------------------
// 主线程只读解
// ---------------------------------------------------------------------------

class Solution {
  constructor(data) {
    this.data = data;
    this.spec = data.spec;
    this.summary = data.summary;
    this.solveId = data.solveId || null; // Worker 里对应 solver 的句柄，算动作 EV 时要带上
    // 引擎类型只在这里判一次。以前界面里写的是字符串 'vector-dcfr'，
    // 而 summary.engine 实际是 'vector'，判定恒为 false —— 2 人局训练因此走了采样分支，
    // 拿到长度为 动作数x1326 的数组当成"每个动作一个 EV"，判分全是垃圾。
    this.isVector = this.summary.engine === 'vector';
    this.nodes = data.nodes;
    this.root = data.nodes[0];
    this.players = data.spec.players;
    // 与内核一致：范围先剔除与公共牌冲突的组合，否则 reach 里会有不在紧凑列表里的组合
    this.ranges = data.spec.ranges.map((r) => removeDead(Float32Array.from(r), data.spec.board));
    this.combos = data.combos.map((l) => Int16Array.from(l));
    this.pos = this.combos.map((l) => { const m = new Int16Array(COMBO_COUNT).fill(-1); for (let k = 0; k < l.length; k++) m[l[k]] = k; return m; });
    this.strategies = data.strategies.map((s) => (s instanceof Float32Array ? s : Float32Array.from(s)));
    for (const n of this.nodes) n.parent = null;
    for (const n of this.nodes) {
      if (n.type === 'D') n.actions.forEach((a, i) => { const c = this.nodes[a.next]; c.parent = n; c.viaAction = i; });
      else if (n.type === 'C') n.children.forEach((c) => { const ch = this.nodes[c.next]; ch.parent = n; ch.viaCard = c.card; });
    }
  }

  node(id) { return this.nodes[id]; }

  /** 某决策节点上，各玩家到达此处的 reach（1326） */
  reachAt(node) {
    const path = [];
    for (let x = node; x.parent; x = x.parent) path.push(x);
    path.reverse();
    let r = this.ranges.map((w) => Float64Array.from(w));
    let cur = this.root;
    for (const nx of path) {
      if (cur.type === 'D') {
        const p = cur.player, L = this.combos[p], n = L.length, a = nx.viaAction, S = this.strategies[cur.dIndex];
        const nr = new Float64Array(COMBO_COUNT);
        for (let k = 0; k < n; k++) nr[L[k]] = r[p][L[k]] * S[a * n + k];
        r[p] = nr;
      } else if (cur.type === 'C') {
        r = r.map((x) => { const y = new Float64Array(COMBO_COUNT); for (let i = 0; i < COMBO_COUNT; i++) { const c = COMBOS[i]; y[i] = c[0] === nx.viaCard || c[1] === nx.viaCard ? 0 : x[i]; } return y; });
      }
      cur = nx;
    }
    return r;
  }

  /** 决策节点的策略视图 */
  strategyAt(node) {
    if (node.type !== 'D') throw new Error('不是决策节点');
    const p = node.player, L = this.combos[p], n = L.length, nA = node.actions.length, S = this.strategies[node.dIndex];
    const reach = this.reachAt(node);
    const rp = reach[p];
    const byCombo = new Float32Array(nA * COMBO_COUNT).fill(NaN);
    const freq = new Float64Array(nA);
    let tot = 0;
    for (let k = 0; k < n; k++) {
      const h = L[k], w = rp[h];
      tot += w;
      for (let a = 0; a < nA; a++) { byCombo[a * COMBO_COUNT + h] = S[a * n + k]; freq[a] += w * S[a * n + k]; }
    }
    const byNotation = {};
    for (const [nt, idxs] of NOTATION_TO_COMBOS) {
      let wsum = 0;
      const acc = new Float64Array(nA);
      for (const h of idxs) { const w = rp[h]; if (w > 0) { wsum += w; for (let a = 0; a < nA; a++) acc[a] += w * byCombo[a * COMBO_COUNT + h]; } }
      byNotation[nt] = wsum > 0 ? { weight: wsum / idxs.length, probs: Array.from(acc, (x) => x / wsum) } : null;
    }
    return { player: p, actions: node.actions, byCombo, byNotation, rangeFreq: Array.from(freq, (f) => (tot > 0 ? f / tot : 0)), reach, totalReach: tot };
  }

  /** 找到从根出发按动作序列走到的节点；acts 是动作下标或 {card} */
  walk(steps) {
    let cur = this.root;
    for (const s of steps) {
      if (cur.type === 'D') cur = this.nodes[cur.actions[s].next];
      else if (cur.type === 'C') { const ch = cur.children.find((c) => c.card === s); if (!ch) throw new Error('该牌不可用'); cur = this.nodes[ch.next]; }
      else throw new Error('已到终端');
    }
    return cur;
  }

  boardStr() { return cardsToStr(this.spec.board); }
}

// ---------------------------------------------------------------------------
// 云端解算适配器：把 spec POST 给服务器，期望返回 serialize() 同格式的 JSON。
// 本地没有这样的服务器；这是给以后接自建/第三方解算服务留的口子。
// ---------------------------------------------------------------------------

class RemoteSolverAdapter {
  constructor(url, headers = {}) { this.url = url; this.headers = headers; }
  async solve(spec, budget = {}) {
    const res = await fetch(this.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({ spec: { ...spec, board: spec.board, ranges: spec.ranges }, budget }),
    });
    if (!res.ok) throw new Error(`云端解算失败：HTTP ${res.status}`);
    const data = await res.json();
    if (data.format !== 'squid-solution-v1') throw new Error('云端返回格式不是 squid-solution-v1');
    return new Solution(data);
  }
}

exports.normalizeSpec = normalizeSpec;
exports.estimateMemory = estimateMemory;
exports.createSolver = createSolver;
exports.runSolve = runSolve;
exports.exploitAnalysis = exploitAnalysis;
exports.serializeTree = serializeTree;
exports.serialize = serialize;
exports.Solution = Solution;
exports.RemoteSolverAdapter = RemoteSolverAdapter;
exports.MAX_CACHED_SOLVERS = MAX_CACHED_SOLVERS;
exports.EXPLOIT_TIE_TOL_PCT = EXPLOIT_TIE_TOL_PCT;
exports.VILLAIN_MODELS = VILLAIN_MODELS;
});
