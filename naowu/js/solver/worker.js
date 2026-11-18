__squidDefine('src/solver/worker.js', function (exports) {
'use strict';
// 解算 Worker：主线程发 spec，这里建树、迭代、回传进度和序列化的解。
// 也承担权益计算，避免卡 UI。
const { createSolver, runSolve, serialize, exploitAnalysis, VILLAIN_MODELS, MAX_CACHED_SOLVERS } = __squidRequire('src/solver/squid.js');
const { equityHandVsRange, equityRangeVsRange, equityMultiway } = __squidRequire('src/core/equity.js');
const { parseRange } = __squidRequire('src/core/range.js');
const { buildEquityTable169, buildPreflopTree, PreflopSolver } = __squidRequire('src/solver/preflop.js');
const { getPuzzle } = __squidRequire('src/train/puzzles.js');
const { makeVariant } = __squidRequire('src/train/variants/index.js');

let current = null; // { id, solver, cancelled } —— 只用于 cancel
let eq169 = null;

// 已解出的 solver 按 solveId 保留。主线程会缓存 Solution 并在以后回到同一场景时直接用，
// 那时不会再发 solve，所以不能只留"最后一个 solver"——否则 actionEVs 会拿错的树去索引节点，
// 静默算出别的场景的 EV。保留最近 MAX_CACHED_SOLVERS 个，超出按插入顺序淘汰。
const solvers = new Map();
let solveSeq = 0;

function rememberSolver(id, solver) {
  solvers.set(id, solver);
  while (solvers.size > MAX_CACHED_SOLVERS) solvers.delete(solvers.keys().next().value);
}

function getSolver(solveId) {
  if (!solveId) {
    // 不能回落到 current.solver：主线程可能拿的是缓存的旧解、或云端解算返回的解，
    // 那时 current 是另一棵树，索引下去会静默算出别的局面的 EV。
    throw new Error('这个解没有 solveId（可能来自云端解算或旧缓存），无法在本地取动作 EV，请重新解算');
  }
  const s = solvers.get(solveId);
  if (!s) throw new Error(`解 ${solveId} 已不在 Worker 缓存里（最多保留 ${MAX_CACHED_SOLVERS} 个），请重新解算该场景`);
  return s;
}

async function solvePreflop(msg) {
  const post = (p) => self.postMessage({ id: msg.id, type: 'progress', ...p });
  if (!eq169) {
    if (msg.eqTable) eq169 = Float32Array.from(msg.eqTable);
    else eq169 = buildEquityTable169(msg.samplesPerPair || 250, 42, (a, n) => post({ phase: 'eq169', done: a, total: n }));
  }
  const tree = buildPreflopTree({ players: msg.players || 2, stack: msg.stack || 100 });
  // 权益实现差必须由主线程带进来：Worker 跑在 Blob URL 里，读不到页面内嵌的 <script type="application/json">。
  // 漏了它的话，现场解算出来的是 v0.3 之前的纯权益模型，而界面文案说的是带修正的模型。
  const solver = new PreflopSolver(tree, eq169, { seed: 1, mcBoards: 30, realization: msg.realization || null });
  const t0 = performance.now();
  const ms = msg.ms || 20000;
  let batch = 500;
  while (performance.now() - t0 < ms) {
    const tb = performance.now();
    solver.iterate(batch);
    const dt = performance.now() - tb;
    post({ phase: 'solve', iter: solver.iter, elapsed: performance.now() - t0 });
    batch = Math.max(200, Math.min(5000, Math.round(batch * (250 / Math.max(dt, 1)))));
    await new Promise((r) => setTimeout(r, 0));
  }
  const charts = solver.exportCharts();
  self.postMessage({ id: msg.id, type: 'done', charts, eqTable: msg.eqTable ? null : Array.from(eq169) });
}

/** base64 的 Uint8 策略 → 概率表，逐手牌归一把量化误差摊掉 */
function dequantizeB64(b64, nA, n) {
  const bin = atob(b64);
  if (bin.length !== nA * n) throw new Error('策略长度 ' + bin.length + ' 与形状 ' + nA + 'x' + n + ' 对不上');
  const out = new Float32Array(nA * n);
  for (let c = 0; c < n; c++) {
    let s = 0;
    for (let a = 0; a < nA; a++) s += bin.charCodeAt(a * n + c);
    if (s > 0) for (let a = 0; a < nA; a++) out[a * n + c] = bin.charCodeAt(a * n + c) / s;
    else for (let a = 0; a < nA; a++) out[a * n + c] = 1 / nA;
  }
  return out;
}

/** 内置解的摘要：把离线解算的参数一并带上，界面要如实显示这不是现场解的 */
function summarizeLoaded(solver, meta) {
  const m = meta || {};
  return {
    engine: 'vector', players: 2, iterations: m.iterations || 0, elapsedMs: 0,
    exploitPct: solver.exploit.pctPot, exploitChips: solver.exploit.chips,
    rootEV: solver.rootEV, nodes: solver.tree.nodes.length, decisionNodes: solver.tree.decisionCount,
    leafMode: solver.spec.leafMode, precomputed: solver.precomputed, preloaded: true,
    offlineSeconds: m.solveSeconds || null, offlineExploitPct: m.exploitPct != null ? m.exploitPct : null,
    note: '内置的预解均衡（离线解 ' + (m.solveSeconds || '?') + ' 秒、' + (m.iterations || '?') + ' 次迭代，'
      + '量化成 Uint8 内嵌）。装载后现场重算的可利用度就是上面那个数，不是转录的。',
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'solve': {
        if (current) current.cancelled = true;
        const solver = createSolver(msg.spec);
        current = { id: msg.id, solver, cancelled: false };
        const me = current;
        self.postMessage({ id: msg.id, type: 'tree', nodes: solver.tree.nodes.length, decisionNodes: solver.tree.decisionCount, engine: solver.engine, memory: solver.memoryEstimate });
        const summary = await runSolve(solver, msg.budget || {}, (p) => self.postMessage({ id: msg.id, type: 'progress', ...p }), () => me.cancelled);
        if (me.cancelled) { self.postMessage({ id: msg.id, type: 'cancelled' }); return; }
        const solveId = `s${++solveSeq}`;
        rememberSolver(solveId, solver);
        const data = serialize(solver, summary);
        data.solveId = solveId; // 主线程缓存 Solution 后，靠它找回对应的 solver 算 EV
        self.postMessage({ id: msg.id, type: 'done', data });
        break;
      }
      case 'cancel':
        if (current) current.cancelled = true;
        break;
      case 'preflop':
        await solvePreflop(msg);
        break;
      case 'actionEVs': {
        const solver = getSolver(msg.solveId);
        if (!Number.isInteger(msg.nodeId) || msg.nodeId < 0 || msg.nodeId >= solver.tree.nodes.length) throw new Error(`节点号 ${msg.nodeId} 越界（这棵树有 ${solver.tree.nodes.length} 个节点）`);
        const node = solver.tree.nodes[msg.nodeId];
        if (node.type !== 'D') throw new Error(`节点 ${msg.nodeId} 不是决策节点（type=${node.type}）`);
        if (solver.engine !== 'vector' && !(Number.isInteger(msg.combo) && msg.combo >= 0 && msg.combo < 1326)) throw new Error(`采样引擎需要合法的手牌组合号，收到 ${msg.combo}`);
        if (solver.engine === 'vector') {
          const r = solver.core.actionEVs(node);
          self.postMessage({ id: msg.id, type: 'result', evs: r.evs, liveOpp: r.liveOpp, exact: true });
        } else {
          const r = solver.core.actionEVs(node, msg.combo, msg.samples || 4000);
          self.postMessage({ id: msg.id, type: 'result', ...r, exact: false });
        }
        break;
      }
      case 'loadSolution': {
        // 装载内置的预解均衡：建树 + 预计算，然后把策略直接写进去，一轮 CFR 都不跑。
        // 形状对不上就报错而不是悄悄用一份错位的策略——那样策略网格和判分都是错的、而且看不出来。
        const solver = createSolver(msg.spec);
        if (solver.engine !== 'vector') throw new Error('只有 2 人局有内置均衡解');
        const pre = solver.core.precompute((done, total) => self.postMessage({ id: msg.id, type: 'progress', phase: 'precompute', done, total }));
        solver.precomputed = pre;
        const st = [];
        for (const node of solver.tree.nodes) {
          if (node.type !== 'D') continue;
          const dim = msg.dims[node.dIndex];
          if (!dim) throw new Error('内置解缺决策节点 ' + node.dIndex);
          const nA = node.actions.length, n = solver.core.L[node.player].length;
          if (dim[0] !== nA || dim[1] !== n) throw new Error('内置解与当前树对不上（节点 ' + node.dIndex + '：' + dim.join('x') + ' vs ' + nA + 'x' + n + '）');
          st[node.dIndex] = dequantizeB64(msg.strategies[node.dIndex], nA, n);
        }
        solver.core.loadStrategy(st);
        solver.elapsed = 0;
        solver.exploit = solver.core.exploitability();
        solver.rootEV = solver.core.rootEV();
        const summary = summarizeLoaded(solver, msg.meta);
        const solveId = 'p' + (++solveSeq);
        rememberSolver(solveId, solver);
        const data = serialize(solver, summary);
        data.solveId = solveId;
        self.postMessage({ id: msg.id, type: 'done', data });
        break;
      }
      case 'exploit': {
        // 剥削分析要复用已解好的那棵树与均衡策略，所以走 solveId 找回 solver，
        // 不能重解一遍——重解出来的均衡是另一份，四个 EV 就没法互相比较了。
        const solver = getSolver(msg.solveId);
        if (solver.engine !== 'vector') throw new Error('剥削分析只支持 2 人局（3 人局无纳什均衡保证，最佳回应也就没有基准）');
        const hero = msg.hero === 1 ? 1 : 0;
        if (msg.model != null && !VILLAIN_MODELS[msg.model]) throw new Error(`不认识的对手模型：${msg.model}`);
        self.postMessage({ id: msg.id, type: 'result', analysis: exploitAnalysis(solver, hero, msg.model || 'station') });
        break;
      }
      case 'puzzle': {
        // 题目的标准答案在 Worker 里算：P01 要枚举 C(52,5)=2598960 手，
        // 放主线程会把页面卡住（手机上实测约 5 秒），解算内核这边本来就是干这个的。
        const p = getPuzzle(msg.puzzleId);
        if (!p) throw new Error('没有这道题：' + msg.puzzleId);
        const r = p.compute();
        self.postMessage({ id: msg.id, type: 'result', value: r.value, evidence: r.evidence || '', detail: r.detail || null });
        break;
      }
      case 'variant': {
        // 变式练习按「题型 + 种子」在这里重新出同一道题再算：五张牌的牌型要判 2598960 手、公共牌发 5 张要查 2118760 种发法，
        // 放主线程手机上会卡。出题只由种子决定，所以这边出的题和页面上显示的是同一道（tools/uicheck 核对过）。
        const q = makeVariant(msg.variantType, msg.seed);
        const r = q.compute();
        self.postMessage({ id: msg.id, type: 'result', value: r.value, evidence: r.evidence || '', detail: r.detail || null, statement: q.statement });
        break;
      }
      case 'equity': {
        const board = msg.board || [];
        let r;
        if (msg.kind === 'hvr') r = equityHandVsRange(msg.hole, parseRange(msg.range), board, { samples: msg.samples });
        else if (msg.kind === 'rvr') { const x = equityRangeVsRange(parseRange(msg.rangeA), parseRange(msg.rangeB), board, { samples: msg.samples, maxRunouts: msg.maxRunouts }); r = { equity: x.equity, exact: x.exact, perCombo: x.perCombo, runouts: x.runouts }; }
        else if (msg.kind === 'multi') r = equityMultiway(msg.hands, board, { samples: msg.samples });
        else throw new Error('未知 equity 类型');
        self.postMessage({ id: msg.id, type: 'result', ...r });
        break;
      }
      default:
        throw new Error(`未知消息: ${msg.type}`);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: 'error', message: err.message || String(err) });
  }
};


});
