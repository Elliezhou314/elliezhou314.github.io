__squidDefine('src/solver/cfr.js', function (exports) {
'use strict';
// 鱿鱼解算器内核（SquidSolver core）
//
// 两个引擎：
//   VectorCFR  —— 2 人，向量化 Discounted CFR（Brown & Sandholm 2019），
//                 终端用 O(N log N) 摊牌扫描；能算可利用度（exploitability），是严格意义上的求解。
//   SampledCFR —— 2~3 人，外部采样 MCCFR（Lanctot 2009）+ Regret Matching+。
//                 3 人博弈不存在“纳什均衡保证”，输出是自博弈收敛的近似策略；EV 由蒙特卡洛估计并带标准误。
//
// 口径纪律：所有 EV 单位是“筹码”，相对于进入本树时的状态（已投入的钱算沉没）。

const { COMBOS, COMBO_COUNT, cardToStr, remainingDeck, makeRng } = __squidRequire('src/core/cards.js');
const { boardStrengths, evaluate } = __squidRequire('src/core/evaluator.js');
const { sortByStrength, showdownSweep, liveWeightPerCombo, equityMatrix } = __squidRequire('src/core/equity.js');
const { removeDead } = __squidRequire('src/core/range.js');

// 简单的栈式数组池，避免每次递归都分配 1326 长度数组
class Pool {
  constructor() { this.free = []; }
  get() { return this.free.length ? this.free.pop() : new Float64Array(COMBO_COUNT); }
  put(a) { this.free.push(a); }
}

function compactList(w) {
  const l = [];
  for (let i = 0; i < COMBO_COUNT; i++) if (w[i] > 0) l.push(i);
  return Int16Array.from(l);
}

function linkParents(tree) {
  for (const n of tree.nodes) {
    if (n.type === 'D') for (let a = 0; a < n.actions.length; a++) { n.actions[a].next.parent = n; n.actions[a].next.viaAction = a; }
    else if (n.type === 'C') for (const ch of n.children) { ch.next.parent = n; ch.next.viaCard = ch.card; }
  }
  tree.root.parent = null;
}

// ===========================================================================
// 2 人向量化 DCFR
// ===========================================================================

class VectorCFR {
  constructor(tree, ranges, opts = {}) {
    if (tree.players !== 2) throw new Error('VectorCFR 只支持 2 人');
    this.tree = tree;
    this.opts = opts;
    linkParents(tree);
    this.ranges = ranges.map((w) => removeDead(w, tree.board));
    this.L = this.ranges.map(compactList);
    this.pos = this.L.map((l) => { const m = new Int16Array(COMBO_COUNT).fill(-1); for (let k = 0; k < l.length; k++) m[l[k]] = k; return m; });
    if (this.L.some((l) => l.length === 0)) throw new Error('有玩家范围为空（可能全部与公共牌冲突）');
    this.regret = new Array(tree.decisionCount);
    this.ssum = new Array(tree.decisionCount);
    for (const n of tree.nodes) {
      if (n.type !== 'D') continue;
      const size = n.actions.length * this.L[n.player].length;
      this.regret[n.dIndex] = new Float32Array(size);
      this.ssum[n.dIndex] = new Float32Array(size);
    }
    this.strCache = new Map();
    this.eqCache = new Map();
    this.pool = new Pool();
    this.iter = 0;
    this.alpha = opts.alpha ?? 1.5; this.beta = opts.beta ?? 0; this.gamma = opts.gamma ?? 2;
    this.win = new Float64Array(COMBO_COUNT); this.tie = new Float64Array(COMBO_COUNT); this.lose = new Float64Array(COMBO_COUNT);
    this.live = new Float64Array(COMBO_COUNT);
    this._nzIdx = new Int32Array(COMBO_COUNT); this._nzW = new Float64Array(COMBO_COUNT);
    this.maxRunouts = opts.maxRunouts || 400;
    // 剥削解算用：override[seat] 非空时该玩家的策略被钉死；brOut 非空时记录最佳回应的具体打法
    this.override = null;
    this.brOut = null;
    this.brTol = 0;   // 最佳回应的并列容差，见 bestResponse
    this.Z = this._normalizer();
  }

  _normalizer() {
    // Σ_{h,j 不冲突} w0[h] w1[j]
    liveWeightPerCombo(this.ranges[1], this.live);
    let z = 0;
    for (const h of this.L[0]) z += this.ranges[0][h] * this.live[h];
    return z;
  }

  _str(boardKey) {
    let e = this.strCache.get(boardKey);
    if (!e) {
      const str = boardStrengths(this.tree.boardKeys.get(boardKey));
      e = { str, sorted: sortByStrength(str) };
      this.strCache.set(boardKey, e);
    }
    return e;
  }

  _eq(boardKey) {
    let e = this.eqCache.get(boardKey);
    if (!e) {
      const board = this.tree.boardKeys.get(boardKey);
      e = equityMatrix(board, this.L[0], this.L[1], { maxRunouts: this.maxRunouts });
      this.eqCache.set(boardKey, e);
    }
    return e;
  }

  /** 预热：把所有叶子需要的牌力表/权益矩阵先算好（可带进度回调） */
  precompute(onProgress) {
    const keys = [...this.tree.boardKeys.keys()];
    let done = 0;
    const needEq = new Set(), needStr = new Set();
    for (const n of this.tree.nodes) {
      if (n.type === 'E') needEq.add(n.boardKey);
      else if (n.type === 'T' && n.kind === 'showdown') needStr.add(n.boardKey);
    }
    for (const k of needStr) { this._str(k); done++; if (onProgress && done % 8 === 0) onProgress(done, needStr.size + needEq.size); }
    for (const k of needEq) { this._eq(k); done++; if (onProgress) onProgress(done, needStr.size + needEq.size); }
    return { strengthTables: needStr.size, equityMatrices: needEq.size };
  }

  // ---- 策略 ----------------------------------------------------------------

  /** 当前策略（regret matching），写入 out[a*n+k] */
  _currentStrategy(node, out) {
    const R = this.regret[node.dIndex], nA = node.actions.length, n = this.L[node.player].length;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let a = 0; a < nA; a++) { const r = R[a * n + k]; if (r > 0) s += r; }
      if (s > 0) for (let a = 0; a < nA; a++) { const r = R[a * n + k]; out[a * n + k] = r > 0 ? r / s : 0; }
      else for (let a = 0; a < nA; a++) out[a * n + k] = 1 / nA;
    }
    return out;
  }

  /** 平均策略（最终输出） */
  averageStrategy(dIndex) {
    const node = this.tree.nodes.find((x) => x.dIndex === dIndex && x.type === 'D');
    return this._avg(node, new Float32Array(this.ssum[dIndex].length));
  }

  /**
   * 这个节点当前该用哪份策略。所有需要策略的地方都走这里，
   * 否则 override 在 _traverse 里生效、在 reachAt 里不生效，两条路径口径不一致——
   * 现在剥削路径不调 reachAt 所以碰不到，但那是运气不是设计。
   */
  _sigmaAt(node, out, mode) {
    const ov = this.override && this.override[node.player] && this.override[node.player][node.dIndex];
    if (ov) { out.set(ov); return out; }
    if (mode === 'cfr') return this._currentStrategy(node, out);
    return this._avg(node, out);
  }

  _avg(node, out) {
    const S = this.ssum[node.dIndex], nA = node.actions.length, n = this.L[node.player].length;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let a = 0; a < nA; a++) s += S[a * n + k];
      if (s > 0) for (let a = 0; a < nA; a++) out[a * n + k] = S[a * n + k] / s;
      else for (let a = 0; a < nA; a++) out[a * n + k] = 1 / nA;
    }
    return out;
  }

  // ---- 终端 ----------------------------------------------------------------

  _terminal(node, t, reach) {
    const u = this.pool.get();
    const o = 1 - t, ro = reach[o];
    if (node.type === 'T' && node.kind === 'fold') {
      liveWeightPerCombo(ro, this.live);
      const gain = node.winner === t ? node.pot - node.invested[t] : -node.invested[t];
      for (const h of this.L[t]) u[h] = gain * this.live[h];
      return u;
    }
    if (node.type === 'T') {
      const { str, sorted } = this._str(node.boardKey);
      showdownSweep(sorted, str, ro, this.win, this.tie, this.lose);
      const pot = node.pot, inv = node.invested[t];
      for (const h of this.L[t]) {
        if (str[h] < 0) { u[h] = 0; continue; }
        u[h] = pot * (this.win[h] + this.tie[h] / 2) - inv * (this.win[h] + this.tie[h] + this.lose[h]);
      }
      return u;
    }
    // E：权益结算
    const { S, nA, nB } = this._eq(node.boardKey);
    liveWeightPerCombo(ro, this.live);
    const pot = node.pot, inv = node.invested[t];
    const Lt = this.L[t], Lo = this.L[o];
    // 只遍历对手 reach 非零的组合（越深的节点越稀疏，省很多）
    const nz = this._nzIdx, nzW = this._nzW;
    let m = 0;
    for (let j = 0; j < Lo.length; j++) { const r = ro[Lo[j]]; if (r !== 0) { nz[m] = j; nzW[m] = r; m++; } }
    if (t === 0) {
      for (let i = 0; i < nA; i++) {
        const h = Lt[i];
        let s = 0;
        const row = i * nB;
        for (let q = 0; q < m; q++) s += nzW[q] * S[row + nz[q]];
        u[h] = pot * s - inv * this.live[h];
      }
    } else {
      // 玩家 1 的份额 = 1 - S[i][j]，但冲突对（S 记为 0）不应贡献 1：
      // Σ_i r_i (1 - S) 会把冲突对算成 r_i，扣掉“对手总权重 - 活权重”即可。
      let tot = 0;
      for (let q = 0; q < m; q++) tot += nzW[q];
      for (let j = 0; j < nB; j++) {
        const h = Lt[j];
        let s = 0;
        for (let q = 0; q < m; q++) s += nzW[q] * (1 - S[nz[q] * nB + j]);
        s -= tot - this.live[h];
        u[h] = pot * s - inv * this.live[h];
      }
    }
    return u;
  }

  // ---- 递归 ----------------------------------------------------------------
  // mode: 'cfr'（更新遗憾）| 'br'（最佳回应）| 'ev'（按平均策略算期望）

  _traverse(node, t, reach, mode) {
    if (node.type === 'T' || node.type === 'E') return this._terminal(node, t, reach);
    if (node.type === 'C') {
      const u = this.pool.get().fill(0);
      const r0 = this.pool.get(), r1 = this.pool.get();
      for (const { card, next } of node.children) {
        maskCard(reach[0], card, r0); maskCard(reach[1], card, r1);
        const cu = this._traverse(next, t, [r0, r1], mode);
        for (const h of this.L[t]) { const c = COMBOS[h]; if (c[0] !== card && c[1] !== card) u[h] += cu[h]; }
        this.pool.put(cu);
      }
      this.pool.put(r0); this.pool.put(r1);
      const div = node.children.length - 4;
      for (const h of this.L[t]) u[h] /= div;
      return u;
    }
    const p = node.player, L = this.L[p], n = L.length, nA = node.actions.length;
    const sigma = new Float64Array(nA * n);
    // 被 override 钉死的玩家用给定策略，其余照旧。
    // 剥削解算靠的就是这一条：把对手钉成某个非均衡打法，再对它求最佳回应。
    const ov = this.override && this.override[p] && this.override[p][node.dIndex];
    this._sigmaAt(node, sigma, mode);
    const u = this.pool.get().fill(0);
    const rp = this.pool.get();
    if (p === t) {
      if (mode === 'br' && !ov) {
        // 最佳回应：逐组合取最大。brOut 非空时把选中的动作记下来，
        // 这样拿到的不只是「能赢多少」，还有「具体该怎么打」。
        //
        // 并列怎么办，决定了这份最佳回应有多容易被反打。
        // 早先是「取动作下标最小的那个」——纯策略，而且并列越多、偏离均衡越离谱。
        // 经典例子：对手完全均衡时，我的诈唬手牌下注和过牌的 EV 恰好相等（这正是均衡的定义），
        // 于是最佳回应把它们全推到某一个动作上，EV 一分不多赚，却把自己打成靶子
        // （实测暴露风险 1.667 筹码，而均衡本身也是一份最佳回应、风险是 0）。
        //
        // 改成：EV 差在 brTol 以内的动作视为并列，并列的部分**按均衡策略的比例分配**。
        // 于是「只在真有得赚的地方偏离均衡」，其余照旧。这仍然是最佳回应
        // （u 取的还是精确最大值，记录的策略 EV 与它的差不超过 brTol）。
        // brTol 由调用方给，默认取解出来的残余可利用度——EV 差小于它的地方，
        // 我们本来就没有证据说哪个动作更好，那就别赌。
        const rec = this.brOut ? (this.brOut[node.dIndex] || (this.brOut[node.dIndex] = new Float32Array(nA * n))) : null;
        if (!rec) {
          let first = true;
          for (let a = 0; a < nA; a++) {
            const cu = this._traverse(node.actions[a].next, t, reach, mode);
            if (first) { for (let k = 0; k < n; k++) u[L[k]] = cu[L[k]]; first = false; }
            else for (let k = 0; k < n; k++) { const h = L[k]; if (cu[h] > u[h]) u[h] = cu[h]; }
            this.pool.put(cu);
          }
          this.pool.put(rp);
          return u;
        }
        const ua = new Array(nA);
        for (let a = 0; a < nA; a++) ua[a] = this._traverse(node.actions[a].next, t, reach, mode);
        const tol = this.brTol > 0 ? this.brTol : 0;
        for (let k = 0; k < n; k++) {
          const h = L[k];
          let best = ua[0][h];
          for (let a = 1; a < nA; a++) if (ua[a][h] > best) best = ua[a][h];
          u[h] = best;
          let wsum = 0;
          for (let a = 0; a < nA; a++) if (ua[a][h] >= best - tol) wsum += sigma[a * n + k];
          if (wsum > 1e-12) {
            for (let a = 0; a < nA; a++) rec[a * n + k] = ua[a][h] >= best - tol ? sigma[a * n + k] / wsum : 0;
          } else {
            // 并列的这几个动作在均衡里全是 0 概率（例如均衡从不这么打、但对手的漏洞让它变得同样好）：
            // 没有均衡比例可依，退回取第一个最大值
            let bi = 0;
            for (let a = 1; a < nA; a++) if (ua[a][h] > ua[bi][h]) bi = a;
            for (let a = 0; a < nA; a++) rec[a * n + k] = a === bi ? 1 : 0;
          }
        }
        for (let a = 0; a < nA; a++) this.pool.put(ua[a]);
        this.pool.put(rp);
        return u;
      }
      const ua = new Array(nA);
      const rt = reach[t];
      for (let a = 0; a < nA; a++) {
        // 自己的 reach 也要乘上策略：平均策略按 π_i 加权才有收敛保证
        rp.fill(0);
        for (let k = 0; k < n; k++) { const h = L[k]; rp[h] = rt[h] * sigma[a * n + k]; }
        const childReach = t === 0 ? [rp, reach[1]] : [reach[0], rp];
        ua[a] = this._traverse(node.actions[a].next, t, childReach, mode);
        for (let k = 0; k < n; k++) { const h = L[k]; u[h] += sigma[a * n + k] * ua[a][h]; }
      }
      if (mode === 'cfr') {
        const R = this.regret[node.dIndex], S = this.ssum[node.dIndex];
        const it = this.iter;
        const posD = Math.pow(it, this.alpha) / (Math.pow(it, this.alpha) + 1);
        const negD = this.beta === 0 ? 0.5 : Math.pow(it, this.beta) / (Math.pow(it, this.beta) + 1);
        const sD = Math.pow(it / (it + 1), this.gamma);
        for (let a = 0; a < nA; a++) {
          const base = a * n;
          for (let k = 0; k < n; k++) {
            const h = L[k];
            let r = R[base + k];
            r = (r > 0 ? r * posD : r * negD) + (ua[a][h] - u[h]);
            R[base + k] = r;
            S[base + k] = S[base + k] * sD + rt[h] * sigma[base + k];
          }
        }
      }
      for (let a = 0; a < nA; a++) this.pool.put(ua[a]);
      this.pool.put(rp);
      return u;
    }
    // 对手节点：把对手 reach 乘以策略后向下求和
    const o = p;
    for (let a = 0; a < nA; a++) {
      rp.fill(0);
      for (let k = 0; k < n; k++) { const h = L[k]; rp[h] = reach[o][h] * sigma[a * n + k]; }
      const child = o === 0 ? [rp, reach[1]] : [reach[0], rp];
      const cu = this._traverse(node.actions[a].next, t, child, mode);
      for (const h of this.L[t]) u[h] += cu[h];
      this.pool.put(cu);
    }
    this.pool.put(rp);
    return u;
  }

  /** 跑 n 轮（每轮两位玩家各遍历一次） */
  iterate(n = 1) {
    for (let i = 0; i < n; i++) {
      this.iter++;
      for (let t = 0; t < 2; t++) {
        const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'cfr');
        this.pool.put(u);
      }
    }
    return this.iter;
  }

  /** 各玩家在根节点按平均策略的 EV（筹码） */
  /**
   * 每手具体牌在根节点的 EV（筹码），已按对手活权重归一。
   * 用来量「权益实现」：把它和这手牌的裸权益份额比，差额就是这手牌靠打法多拿或少拿的部分。
   */
  handEVs(t) {
    const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'ev');
    liveWeightPerCombo(this.ranges[1 - t], this.live);
    const out = new Float64Array(COMBO_COUNT).fill(NaN);
    for (const h of this.L[t]) {
      const lw = this.live[h];
      if (lw > 0) out[h] = u[h] / lw;
    }
    this.pool.put(u);
    return out;
  }

  rootEV() {
    const ev = [];
    for (let t = 0; t < 2; t++) {
      const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'ev');
      let s = 0;
      for (const h of this.L[t]) s += this.ranges[t][h] * u[h];
      this.pool.put(u);
      ev.push(s / this.Z);
    }
    return ev;
  }

  /** 可利用度（筹码）= ½(BR0 + BR1 − pot0)，另附占底池百分比 */
  exploitability() {
    const br = [];
    for (let t = 0; t < 2; t++) {
      const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'br');
      let s = 0;
      for (const h of this.L[t]) s += this.ranges[t][h] * u[h];
      this.pool.put(u);
      br.push(s / this.Z);
    }
    const chips = (br[0] + br[1] - this.tree.pot0) / 2;
    return { chips, pctPot: (chips / this.tree.pot0) * 100, br };
  }

  // ---- 剥削：对固定的非均衡对手求最佳回应 ------------------------------------
  //
  // 均衡解回答的是「对手也最优时我该怎么打」。真实牌桌上对手不最优：
  // 跟注站什么都跟、疯狂型乱诈唬。对这种人打均衡是「不输」，不是「赚最多」。
  // 下面三个方法把「赚最多」也算出来：
  //   perturbedStrategy  按可解释的旋钮（弃/过/跟/激进）扰动均衡策略，造一个有漏洞的对手
  //   bestResponse       把对手钉死，对它求精确最佳回应（值 + 具体打法）
  //   evWith             任意固定策略组合下双方的 EV
  // 合起来能量出剥削多赚多少，以及这么打之后自己露出多大破绽。

  /** 某个玩家全部决策节点的平均策略：dIndex -> Float32Array(nA*n) */
  strategyTable(seat) {
    const out = {};
    for (const node of this.tree.nodes) {
      if (node.type !== 'D' || node.player !== seat) continue;
      const n = this.L[seat].length;
      out[node.dIndex] = this._avg(node, new Float32Array(node.actions.length * n));
    }
    return out;
  }

  /**
   * 造一个「有特定漏洞」的对手：
   *
   *     σ_漏洞(a | 这手牌) = (1 − λ)·σ_均衡(a | 这手牌) + λ·τ(a)
   *
   * λ 是「有多大比例的决策是不看牌力、按固定倾向乱做的」，τ 是「乱做时倾向做什么」。
   *
   * 必须是**混合**、不能只是「乘系数再归一」。均衡的定义就是对手支撑集里每个动作都是
   * 最优应对，所以在支撑集内部重新分配概率，对手的 EV 一分不变——实测四种「风格」
   * 用乘法造出来时，你打均衡的 EV 完全相同（3.959），剥削也就无从谈起。
   * 真实的坏玩家恰恰会打均衡里概率为 0 的动作：拿均衡 100% 弃的牌去跟。
   * 加性混合才能把概率推到支撑集外面去。
   *
   * @param tendency 按动作类别给的倾向权重，例 { fold: 0.05, check: 0.35, call: 0.6, aggro: 0 }
   * @param lambda   混入强度 0~1（0 就是均衡本身）
   */
  perturbedStrategy(seat, tendency = {}, lambda = 0.5) {
    const T = { fold: 0, check: 0, call: 0, aggro: 0, ...tendency };
    const kindOf = (k) => (k === 'fold' ? 'fold' : k === 'check' ? 'check' : k === 'call' ? 'call' : 'aggro');
    const lam = Math.max(0, Math.min(1, lambda));
    const out = {};
    for (const node of this.tree.nodes) {
      if (node.type !== 'D' || node.player !== seat) continue;
      const nA = node.actions.length, n = this.L[seat].length;
      const base = this._avg(node, new Float32Array(nA * n));
      // τ 只在这个节点实际有的动作上归一；同一类别有多个尺度时平摊
      const raw = node.actions.map((a) => T[kindOf(a.kind)]);
      const byKind = {};
      node.actions.forEach((a) => { const k = kindOf(a.kind); byKind[k] = (byKind[k] || 0) + 1; });
      let tot = 0;
      const tau = raw.map((v, i) => { const k = kindOf(node.actions[i].kind); const x = v / byKind[k]; tot += x; return x; });
      if (tot > 0) for (let a = 0; a < nA; a++) tau[a] /= tot;
      else for (let a = 0; a < nA; a++) tau[a] = 1 / nA;   // 这个节点没有倾向覆盖到的动作，退化成均匀
      const s = new Float32Array(nA * n);
      for (let c = 0; c < n; c++) {
        for (let a = 0; a < nA; a++) s[a * n + c] = (1 - lam) * base[a * n + c] + lam * tau[a];
      }
      out[node.dIndex] = s;
    }
    return out;
  }

  /**
   * 对手钉死时，玩家 t 的精确最佳回应。
   * @param t 求解方
   * @param oppPolicy 对手的固定策略（strategyTable / perturbedStrategy 的输出）
   * @returns { ev, strategy } —— strategy 是纯策略（每个组合在每个节点上选一个动作）
   */
  /**
   * 对固定对手策略求最佳回应。
   * tol：把 EV 差小于它的动作当成并列，并列部分按均衡比例分配（见 _traverse 的 'br' 分支）。
   *      默认 0 = 严格 argmax。传残余可利用度进来，得到的是「不白冒风险」的那一份最佳回应。
   */
  bestResponse(t, oppPolicy, tol = 0) {
    const o = 1 - t;
    const prev = this.override, prevOut = this.brOut, prevTol = this.brTol;
    this.override = [null, null];
    this.override[o] = oppPolicy || null;
    this.brOut = {};
    this.brTol = tol > 0 ? tol : 0;
    const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'br');
    let s = 0;
    for (const h of this.L[t]) s += this.ranges[t][h] * u[h];
    this.pool.put(u);
    const strategy = this.brOut;
    this.override = prev; this.brOut = prevOut; this.brTol = prevTol;
    return { ev: s / this.Z, strategy };
  }

  /** 给定固定策略（可只钉一方）时双方的 EV（筹码）。两者之和恒等于初始底池。 */
  evWith(policies) {
    const prev = this.override;
    this.override = policies || [null, null];
    const ev = [];
    for (let t = 0; t < 2; t++) {
      const u = this._traverse(this.tree.root, t, [this.ranges[0], this.ranges[1]], 'ev');
      let s = 0;
      for (const h of this.L[t]) s += this.ranges[t][h] * u[h];
      this.pool.put(u);
      ev.push(s / this.Z);
    }
    this.override = prev;
    return ev;
  }

  /** 沿路径按平均策略推到某节点：返回 [reach0, reach1]（1326 长） */
  reachAt(node) {
    const path = [];
    for (let x = node; x.parent; x = x.parent) path.push(x);
    path.reverse();
    let r = [Float64Array.from(this.ranges[0]), Float64Array.from(this.ranges[1])];
    let cur = this.tree.root;
    for (const nx of path) {
      if (cur.type === 'D') {
        const p = cur.player, L = this.L[p], n = L.length, a = nx.viaAction;
        const sigma = this._sigmaAt(cur, new Float64Array(cur.actions.length * n), 'ev');
        const nr = new Float64Array(COMBO_COUNT);
        for (let k = 0; k < n; k++) nr[L[k]] = r[p][L[k]] * sigma[a * n + k];
        r[p] = nr;
      } else if (cur.type === 'C') {
        const card = nx.viaCard;
        r = r.map((x) => { const y = new Float64Array(COMBO_COUNT); maskCard(x, card, y); return y; });
      }
      cur = nx;
    }
    return r;
  }

  /**
   * 某决策节点上，该玩家每个组合、每个动作的 EV（筹码，已除以对手活权重，即“条件期望”）。
   * 返回 { evs: Float64Array(nA*1326), best: Int8Array(1326), liveOpp }
   */
  actionEVs(node) {
    const reach = this.reachAt(node);
    const p = node.player, o = 1 - p, nA = node.actions.length;
    const live = liveWeightPerCombo(reach[o], new Float64Array(COMBO_COUNT)); // 终端会覆写 this.live，这里要独立一份
    const evs = new Float64Array(nA * COMBO_COUNT).fill(NaN);
    for (let a = 0; a < nA; a++) {
      const u = this._traverse(node.actions[a].next, p, reach, 'ev');
      for (const h of this.L[p]) evs[a * COMBO_COUNT + h] = live[h] > 1e-12 ? u[h] / live[h] : NaN;
      this.pool.put(u);
    }
    return { evs, liveOpp: live };
  }

  /**
   * 把一份现成的策略装回去（用于内置的预解均衡）。
   *
   * 不需要新机制：_avg 把 ssum 按每手牌归一，而策略本来就是每手牌和为 1 的分布，
   * 所以直接写进 ssum，_avg 就会原样返回它。于是 actionEVs / reachAt /
   * exploitability / strategyAt 全部自动走这份策略，一行遗憾更新都不用跑。
   */
  loadStrategy(strategies) {
    for (const n of this.tree.nodes) {
      if (n.type !== 'D') continue;
      const src = strategies[n.dIndex];
      const dst = this.ssum[n.dIndex];
      if (!src) throw new Error(`策略缺决策节点 ${n.dIndex}`);
      if (src.length !== dst.length) throw new Error(`节点 ${n.dIndex} 的策略长度 ${src.length} 与树对不上（应为 ${dst.length}）`);
      dst.set(src);
    }
    return this;
  }

  /** 导出可序列化的解 */
  export() {
    const strategies = [];
    for (const n of this.tree.nodes) if (n.type === 'D') strategies[n.dIndex] = this._avg(n, new Float32Array(this.ssum[n.dIndex].length));
    return { engine: 'vector', players: 2, iterations: this.iter, combos: this.L.map((l) => Array.from(l)), strategies };
  }
}

function maskCard(src, card, dst) {
  for (let i = 0; i < COMBO_COUNT; i++) {
    const c = COMBOS[i];
    dst[i] = c[0] === card || c[1] === card ? 0 : src[i];
  }
}

// ===========================================================================
// 2~3 人 外部采样 MCCFR
// ===========================================================================

class SampledCFR {
  constructor(tree, ranges, opts = {}) {
    this.tree = tree;
    this.P = tree.players;
    linkParents(tree);
    this.ranges = ranges.slice(0, this.P).map((w) => removeDead(w, tree.board));
    this.L = this.ranges.map(compactList);
    this.pos = this.L.map((l) => { const m = new Int16Array(COMBO_COUNT).fill(-1); for (let k = 0; k < l.length; k++) m[l[k]] = k; return m; });
    if (this.L.some((l) => l.length === 0)) throw new Error('有玩家范围为空');
    this.cum = this.ranges.map((w) => { const c = new Float64Array(COMBO_COUNT); let s = 0; for (let i = 0; i < COMBO_COUNT; i++) { s += w[i]; c[i] = s; } return c; });
    this.regret = new Array(tree.decisionCount);
    this.ssum = new Array(tree.decisionCount);
    for (const n of tree.nodes) {
      if (n.type !== 'D') continue;
      const size = n.actions.length * this.L[n.player].length;
      this.regret[n.dIndex] = new Float32Array(size);
      this.ssum[n.dIndex] = new Float32Array(size);
    }
    this.rng = makeRng(opts.seed ?? 20240601);
    this.strCache = new Map();
    this.iter = 0;
    this.hands = new Int16Array(this.P);
    this.deadCards = new Uint8Array(52);
    this.evalBuf = new Int32Array(7);
  }

  _str(boardKey) {
    let s = this.strCache.get(boardKey);
    if (!s) { s = boardStrengths(this.tree.boardKeys.get(boardKey)); this.strCache.set(boardKey, s); }
    return s;
  }

  _sampleCombo(p) {
    const cum = this.cum[p], total = cum[COMBO_COUNT - 1];
    const x = this.rng() * total;
    let lo = 0, hi = COMBO_COUNT - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /**
   * 发牌：整组独立抽样 + 整组拒绝，得到的联合分布正比于 w0·w1·…·w_{P-1}（限制在互不冲突的组合上）。
   *
   * 不能用"逐个玩家、各自重抽到不冲突为止"的顺序抽样：那样的联合分布是
   *   w0(h0)/W0 · w1(h1)/Z1(h0) · w2(h2)/Z2(h0,h1)
   * 多出来的 1/Z 依赖于前面玩家的手牌，会系统性偏袒"挡住对手较多组合"的手牌
   * （对手可选项少 → Z 小 → 该分支概率被放大）。范围窄且互相重叠时偏差尤其大。
   * 整组拒绝法去掉了这些归一化因子，是无偏的。
   */
  _deal() {
    const board = this.tree.board;
    for (let attempt = 0; attempt < 400; attempt++) {
      this.deadCards.fill(0);
      for (const c of board) this.deadCards[c] = 1;
      let ok = true;
      for (let p = 0; p < this.P; p++) {
        const h = this._sampleCombo(p);
        const [a, b] = COMBOS[h];
        if (this.deadCards[a] || this.deadCards[b]) { ok = false; break; }
        this.hands[p] = h; this.deadCards[a] = 1; this.deadCards[b] = 1;
      }
      if (ok) return;
    }
    // 极窄且高度重叠的范围下整组重抽可能长期失败，退化为顺序抽样（有偏），并记账以便如实报告
    this.biasedDeals = (this.biasedDeals || 0) + 1;
    this.deadCards.fill(0);
    for (const c of board) this.deadCards[c] = 1;
    for (let p = 0; p < this.P; p++) {
      let got = false;
      for (let tries = 0; tries < 2000 && !got; tries++) {
        const h = this._sampleCombo(p);
        const [a, b] = COMBOS[h];
        if (!this.deadCards[a] && !this.deadCards[b]) { this.hands[p] = h; this.deadCards[a] = 1; this.deadCards[b] = 1; got = true; }
      }
      if (!got) throw new Error('范围之间冲突过多，无法发牌');
    }
  }

  _sampleCard(board) {
    // 从未被占用的牌里均匀抽一张
    let n = 0;
    for (let c = 0; c < 52; c++) if (!this.deadCards[c]) n++;
    let k = (this.rng() * n) | 0;
    for (let c = 0; c < 52; c++) if (!this.deadCards[c]) { if (k === 0) return c; k--; }
    return -1;
  }

  _showdownShare(node, board5, t) {
    // 活玩家比牌，返回 t 的份额
    const buf = this.evalBuf;
    for (let k = 0; k < 5; k++) buf[k] = board5[k];
    let best = -1, winners = 0, mine = -1;
    for (let p = 0; p < this.P; p++) {
      if (!node.alive[p]) continue;
      const c = COMBOS[this.hands[p]];
      buf[5] = c[0]; buf[6] = c[1];
      const v = evaluate(buf, 7);
      if (p === t) mine = v;
      if (v > best) { best = v; winners = 1; } else if (v === best) winners++;
    }
    return mine === best ? 1 / winners : 0;
  }

  _terminalValue(node, t) {
    if (node.type === 'T' && node.kind === 'fold') return node.winner === t ? node.pot - node.invested[t] : -node.invested[t];
    if (!node.alive[t]) return -node.invested[t];
    if (node.type === 'T') {
      const str = this._str(node.boardKey);
      let best = -1, winners = 0, mine = -1;
      for (let p = 0; p < this.P; p++) {
        if (!node.alive[p]) continue;
        const v = str[this.hands[p]];
        if (p === t) mine = v;
        if (v > best) { best = v; winners = 1; } else if (v === best) winners++;
      }
      return (mine === best ? node.pot / winners : 0) - node.invested[t];
    }
    // E：随机补完公共牌
    const board = node.board.slice();
    const added = [];
    while (board.length < 5) { const c = this._sampleCard(board); board.push(c); added.push(c); this.deadCards[c] = 1; }
    const share = this._showdownShare(node, board, t);
    for (const c of added) this.deadCards[c] = 0;
    return share * node.pot - node.invested[t];
  }

  _traverse(node, t, updating) {
    if (node.type === 'T' || node.type === 'E') return this._terminalValue(node, t);
    if (node.type === 'C') {
      const c = this._sampleCard(node.board);
      this.deadCards[c] = 1;
      const child = node.children.find((x) => x.card === c);
      const v = this._traverse(child.next, t, updating);
      this.deadCards[c] = 0;
      return v;
    }
    const p = node.player, k = this.pos[p][this.hands[p]];
    const nA = node.actions.length, n = this.L[p].length;
    const R = this.regret[node.dIndex];
    // regret matching+
    let s = 0;
    const sigma = new Float64Array(nA);
    for (let a = 0; a < nA; a++) { const r = R[a * n + k]; if (r > 0) s += r; }
    for (let a = 0; a < nA; a++) sigma[a] = s > 0 ? Math.max(R[a * n + k], 0) / s : 1 / nA;
    if (p === t) {
      const va = new Float64Array(nA);
      let v = 0;
      for (let a = 0; a < nA; a++) { va[a] = this._traverse(node.actions[a].next, t, updating); v += sigma[a] * va[a]; }
      if (updating) for (let a = 0; a < nA; a++) { const idx = a * n + k; R[idx] = Math.max(R[idx] + va[a] - v, 0); }
      return v;
    }
    if (updating) {
      const S = this.ssum[node.dIndex];
      const w = this.iter; // 线性加权平均
      for (let a = 0; a < nA; a++) S[a * n + k] += w * sigma[a];
    }
    let x = this.rng(), a = 0;
    for (; a < nA - 1; a++) { x -= sigma[a]; if (x <= 0) break; }
    return this._traverse(node.actions[a].next, t, updating);
  }

  iterate(n = 1000) {
    for (let i = 0; i < n; i++) {
      this.iter++;
      this._deal();
      for (let t = 0; t < this.P; t++) this._traverse(this.tree.root, t, true);
    }
    return this.iter;
  }

  _avg(node, out) {
    const S = this.ssum[node.dIndex], nA = node.actions.length, n = this.L[node.player].length;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let a = 0; a < nA; a++) s += S[a * n + k];
      if (s > 0) for (let a = 0; a < nA; a++) out[a * n + k] = S[a * n + k] / s;
      else for (let a = 0; a < nA; a++) out[a * n + k] = 1 / nA;
    }
    return out;
  }

  /** 沿路径按平均策略推到某节点：返回各玩家 reach（1326 长） */
  reachAt(node) {
    const path = [];
    for (let x = node; x.parent; x = x.parent) path.push(x);
    path.reverse();
    let r = this.ranges.map((w) => Float64Array.from(w));
    let cur = this.tree.root;
    for (const nx of path) {
      if (cur.type === 'D') {
        const p = cur.player, L = this.L[p], n = L.length, a = nx.viaAction;
        const sigma = this._avg(cur, new Float64Array(cur.actions.length * n));
        const nr = new Float64Array(COMBO_COUNT);
        for (let k = 0; k < n; k++) nr[L[k]] = r[p][L[k]] * sigma[a * n + k];
        r[p] = nr;
      } else if (cur.type === 'C') {
        r = r.map((x) => { const y = new Float64Array(COMBO_COUNT); maskCard(x, nx.viaCard, y); return y; });
      }
      cur = nx;
    }
    return r;
  }

  /** 按平均策略走完（不更新），返回 t 的收益 */
  _playout(node, t) {
    if (node.type === 'T' || node.type === 'E') return this._terminalValue(node, t);
    if (node.type === 'C') {
      const c = this._sampleCard(node.board);
      this.deadCards[c] = 1;
      const v = this._playout(node.children.find((x) => x.card === c).next, t);
      this.deadCards[c] = 0;
      return v;
    }
    const p = node.player, k = this.pos[p][this.hands[p]], n = this.L[p].length, nA = node.actions.length;
    const S = this.ssum[node.dIndex];
    let s = 0;
    for (let a = 0; a < nA; a++) s += S[a * n + k];
    let x = this.rng() * (s > 0 ? s : nA), a = 0;
    for (; a < nA - 1; a++) { x -= s > 0 ? S[a * n + k] : 1; if (x <= 0) break; }
    return this._playout(node.actions[a].next, t);
  }

  /**
   * 某节点上英雄某组合、各动作的 EV 蒙特卡洛估计（对手手牌按到达该节点的 reach 抽样）。
   * 返回 { evs:[...], se:[...], samples }
   */
  actionEVs(node, heroCombo, samples = 4000) {
    const p = node.player, nA = node.actions.length;
    const reach = this.reachAt(node);
    const cums = reach.map((w) => { const c = new Float64Array(COMBO_COUNT); let s = 0; for (let i = 0; i < COMBO_COUNT; i++) { s += w[i]; c[i] = s; } return c; });
    const sum = new Float64Array(nA), sq = new Float64Array(nA);
    let used = 0;
    for (let s = 0; s < samples; s++) {
      this.deadCards.fill(0);
      for (const c of node.board) this.deadCards[c] = 1;
      const [ha, hb] = COMBOS[heroCombo];
      if (this.deadCards[ha] || this.deadCards[hb]) throw new Error('英雄手牌与公共牌冲突');
      this.deadCards[ha] = 1; this.deadCards[hb] = 1;
      this.hands[p] = heroCombo;
      // 其他玩家（包括已弃牌的，挡牌效应仍在）按到达本节点的 reach 抽手牌
      let ok = true;
      for (let q = 0; q < this.P && ok; q++) {
        if (q === p) continue;
        const cum = cums[q], total = cum[COMBO_COUNT - 1];
        if (total <= 0) { ok = false; break; }
        let found = false;
        for (let tries = 0; tries < 200; tries++) {
          const x = this.rng() * total;
          let lo = 0, hi = COMBO_COUNT - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
          const [a, b] = COMBOS[lo];
          if (!this.deadCards[a] && !this.deadCards[b]) { this.hands[q] = lo; this.deadCards[a] = 1; this.deadCards[b] = 1; found = true; break; }
        }
        if (!found) ok = false;
      }
      if (!ok) continue;
      used++;
      for (let a = 0; a < nA; a++) {
        const v = this._playout(node.actions[a].next, p);
        sum[a] += v; sq[a] += v * v;
      }
    }
    const evs = [], se = [];
    for (let a = 0; a < nA; a++) {
      const m = used ? sum[a] / used : NaN;
      evs.push(m);
      se.push(used > 1 ? Math.sqrt(Math.max(sq[a] / used - m * m, 0) / used) : NaN);
    }
    return { evs, se, samples: used };
  }

  export() {
    const strategies = [];
    for (const n of this.tree.nodes) if (n.type === 'D') strategies[n.dIndex] = this._avg(n, new Float32Array(this.ssum[n.dIndex].length));
    return { engine: 'mccfr-es', players: this.P, iterations: this.iter, combos: this.L.map((l) => Array.from(l)), strategies };
  }
}

exports.VectorCFR = VectorCFR;
exports.SampledCFR = SampledCFR;
});
