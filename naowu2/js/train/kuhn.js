__squidDefine('src/train/kuhn.js', function (exports) {
'use strict';
// Kuhn 扑克：博弈论教科书里最小的、有解析解的不完全信息博弈。
//
// 规则：3 张牌 J < Q < K，每人一张，各下 1 个底注（底池 2）。玩家 0 先行动：
//   过牌 → 玩家 1 过牌（摊牌）或下注 1 → 玩家 0 弃牌或跟注
//   下注 1 → 玩家 1 弃牌或跟注
// 已知结论（Kuhn 1950）：博弈值 = −1/18（对先行动方），且存在一族参数化均衡：
//   玩家 0 拿 J 以概率 α ∈ [0, 1/3] 诈唬下注，拿 K 以概率 3α 下注，拿 Q 永不下注；
//   玩家 0 过牌后面对下注，拿 Q 以 α + 1/3 跟注（正是这一项让 α 可以自由取值）；
//   玩家 1 的策略唯一：拿 J 面对过牌以 1/3 下注、面对下注必弃；
//   拿 Q 面对下注以 1/3 跟注、面对过牌必过；拿 K 必下注/必跟注。
//
// 这个模块用两种方式求解并互相验证：
//   solveKuhnExact()  —— 线性规划规模太小，直接用"序贯理性 + 无差异条件"解析给出
//   solveKuhnCFR()    —— 用 CFR+ 自博弈迭代，返回博弈值与可利用度
// 界面上的"定理实验室"就是让评委现场跑 CFR，看它收敛到 −1/18。

const CARDS = ['J', 'Q', 'K'];
// 6 种发牌（有序对），等概率
const DEALS = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];

// 信息集：'<card><history>'，history ∈ {'', 'p', 'b', 'pb'}
const INFOSETS = [];
for (let c = 0; c < 3; c++) for (const h of ['', 'p', 'b', 'pb']) INFOSETS.push(CARDS[c] + h);
const IDX = new Map(INFOSETS.map((k, i) => [k, i]));

/** 终局收益（对当前行动方之外的结算统一由 payoff 处理），history 为完整动作串 */
function terminalPayoff(history, myCard, oppCard) {
  // 返回玩家 0 的收益
  const win = myCard > oppCard ? 1 : -1;
  switch (history) {
    case 'pp': return win;          // 双过牌，摊牌争 2 的底池，净 ±1
    case 'bp': return 1;            // 玩家 0 下注、玩家 1 弃牌
    case 'pbp': return -1;          // 玩家 0 过牌、玩家 1 下注、玩家 0 弃牌
    case 'bb': return 2 * win;      // 双下注摊牌
    case 'pbb': return 2 * win;     // 过牌-下注-跟注摊牌
    default: return null;           // 非终局
  }
}

/**
 * CFR+ 自博弈求解 Kuhn 扑克。
 * @returns { value, strategy, exploitability, iterations }
 *   value 是玩家 0 在双方按平均策略下的期望收益（理论值 −1/18 ≈ −0.055556）
 */
function solveKuhnCFR(iterations = 20000) {
  const n = INFOSETS.length;
  const regret = new Float64Array(n * 2);
  const stratSum = new Float64Array(n * 2);

  const strategyAt = (i, out) => {
    const r0 = Math.max(regret[i * 2], 0), r1 = Math.max(regret[i * 2 + 1], 0);
    const s = r0 + r1;
    if (s > 0) { out[0] = r0 / s; out[1] = r1 / s; } else { out[0] = 0.5; out[1] = 0.5; }
  };

  const sigma = new Float64Array(2);
  /**
   * 返回"玩家 0 的期望收益"。
   * p0/p1 是两位玩家各自的到达概率；发牌概率 chance 单独传，
   * 因为它属于反事实权重（对手 + 机会），不能算进某一方自己的到达概率——
   * 塞错位置会让两方的遗憾权重不对称，收敛到错误的策略。
   */
  function cfr(history, cards, p0, p1, chance) {
    const t = terminalPayoff(history, cards[0], cards[1]);
    if (t !== null) return t;
    const player = history.length % 2;           // 0 或 1 行动
    const i = IDX.get(CARDS[cards[player]] + history);
    strategyAt(i, sigma);
    // 必须先把策略取到局部变量：sigma 是整个递归共用的缓冲区，
    // 下面递归进子节点时会被深层节点覆盖，直接用 sigma[...] 会拿到别人的策略。
    const s0 = sigma[0], s1 = sigma[1];
    const myReach = player === 0 ? p0 : p1;
    stratSum[i * 2] += chance * myReach * s0;
    stratSum[i * 2 + 1] += chance * myReach * s1;

    // 动作 0 = 过牌/弃牌('p')，动作 1 = 下注/跟注('b')
    const u0 = player === 0 ? cfr(history + 'p', cards, p0 * s0, p1, chance) : cfr(history + 'p', cards, p0, p1 * s0, chance);
    const u1 = player === 0 ? cfr(history + 'b', cards, p0 * s1, p1, chance) : cfr(history + 'b', cards, p0, p1 * s1, chance);
    const util = [u0, u1];
    const nodeUtil = s0 * u0 + s1 * u1;
    // 玩家 0 最大化、玩家 1 最小化（零和）；反事实权重 = 机会 × 对手到达概率
    const sign = player === 0 ? 1 : -1;
    const cfReach = chance * (player === 0 ? p1 : p0);
    for (let a = 0; a < 2; a++) {
      const r = sign * (util[a] - nodeUtil) * cfReach;
      regret[i * 2 + a] = Math.max(regret[i * 2 + a] + r, 0); // CFR+
    }
    return nodeUtil;
  }

  for (let it = 0; it < iterations; it++) {
    for (const d of DEALS) cfr('', d, 1, 1, 1 / 6);
  }

  // 平均策略
  const strategy = {};
  for (let i = 0; i < n; i++) {
    const a = stratSum[i * 2], b = stratSum[i * 2 + 1];
    const s = a + b;
    strategy[INFOSETS[i]] = s > 0 ? [a / s, b / s] : [0.5, 0.5];
  }
  return { value: valueOf(strategy), strategy, exploitability: exploitabilityOf(strategy), iterations };
}

/** 给定策略（每个信息集 [过牌/弃牌概率, 下注/跟注概率]），算玩家 0 的期望收益 */
function valueOf(strategy) {
  let total = 0;
  for (const cards of DEALS) total += walk('', cards, strategy) / 6;
  return total;
}

function walk(history, cards, strategy) {
  const t = terminalPayoff(history, cards[0], cards[1]);
  if (t !== null) return t;
  const player = history.length % 2;
  const s = strategy[CARDS[cards[player]] + history];
  return s[0] * walk(history + 'p', cards, strategy) + s[1] * walk(history + 'b', cards, strategy);
}

/** 可利用度：双方各自最佳回应收益之和（零和博弈里均衡时为 0） */
function exploitabilityOf(strategy) {
  // 零和博弈：双方各自最佳回应收益之和，均衡时恰好为 0（一方得 v、另一方得 −v）
  return (bruteForceBR(strategy, 0) + bruteForceBR(strategy, 1)) / 2;
}

/** 暴力最佳回应：br 方 6 个信息集各 2 个选择，枚举 64 种纯策略取最大 */
function bruteForceBR(strategy, br) {
  const myKeys = INFOSETS.filter((k) => {
    const h = k.slice(1);
    return h.length % 2 === br;
  });
  let best = -Infinity;
  const trial = { ...strategy };
  const total = 1 << myKeys.length;
  for (let mask = 0; mask < total; mask++) {
    for (let i = 0; i < myKeys.length; i++) trial[myKeys[i]] = (mask >> i) & 1 ? [0, 1] : [1, 0];
    const v = valueOf(trial);
    const mine = br === 0 ? v : -v;
    if (mine > best) best = mine;
  }
  return best;
}

/**
 * 解析解：Kuhn 扑克均衡族与博弈值。
 * α 是玩家 0 拿 J 的诈唬频率，取值 [0, 1/3]，任意 α 都是均衡，博弈值恒为 −1/18。
 */
function solveKuhnExact(alpha = 1 / 6) {
  const a = Math.max(0, Math.min(1 / 3, alpha));
  const strategy = {
    J: [1 - a, a], Q: [1, 0], K: [1 - 3 * a, 3 * a],           // 玩家 0 首次行动
    Jp: [2 / 3, 1 / 3], Qp: [1, 0], Kp: [0, 1],                // 玩家 1 面对过牌
    Jb: [1, 0], Qb: [2 / 3, 1 / 3], Kb: [0, 1],                // 玩家 1 面对下注
    // 玩家 0 过牌后面对下注：Q 的跟注频率是 α + 1/3（不是常数 1/3），
    // 正是这一项把玩家 1 拿 J 的诈唬打到无差异，α 才能自由取值而不被剥削。
    Jpb: [1, 0], Qpb: [1 - (a + 1 / 3), a + 1 / 3], Kpb: [0, 1],
  };
  return { value: -1 / 18, exactValue: '−1/18', strategy, alpha: a };
}

exports.solveKuhnCFR = solveKuhnCFR;
exports.valueOf = valueOf;
exports.exploitabilityOf = exploitabilityOf;
exports.solveKuhnExact = solveKuhnExact;
});
