__squidDefine('src/review/hindsight.js', function (exports) {
'use strict';
// 牌局回放的「事后视角」胜率（纯逻辑，后台线程和测试共用）。
//
// 口径：每一步，拿还没弃牌的那些人实际拿的牌，在当时的公共牌上算各家的胜率（权益）：
//   - 翻牌以后：把剩下的公共牌全部枚举（core/equity.js 的 equityMultiway），是精确值；
//   - 翻前：全部枚举太慢，同一个函数抽样 HINDSIGHT_SAMPLES 次，报标准误；种子由这几手牌和公共牌决定，
//     所以同一手牌的同一步重复看，数字一模一样；
//   - 平分底池按现有权益函数的口径：几人并列最好就各分 1/几，所以还在局里的人的胜率加起来是 100%。
// 这是事后才知道的数：当时你并不知道对手的牌，它只用来回看，不是当时该用的决策依据。
const { equityMultiway } = __squidRequire('src/core/equity.js');

const HINDSIGHT_SAMPLES = 40000;

/** 由牌决定的种子（同样的牌、同样的公共牌永远同一个种子） */
function hindsightSeed(hands, board) {
  let x = 2166136261;
  for (const c of [...hands.flat(), 99, ...board]) { x ^= c + 1; x = Math.imul(x, 16777619) >>> 0; }
  return x >>> 0;
}

/** 一个局面上各家的胜率：{ equities, exact, stderrs?, samples? }（顺序和 hands 一样） */
function hindsightEquity(hands, board) {
  if (hands.length === 1) return { equities: [1], exact: true };
  return equityMultiway(hands, board, { samples: HINDSIGHT_SAMPLES, seed: hindsightSeed(hands, board) });
}

/**
 * 把一手回放里要算的局面列出来（同样的人、同样的公共牌只算一次）。
 * 返回 { jobs: [{ hands, board, seats }], per: [{ live, job }] }，per 与步骤一一对应；只剩一人时 job = -1。
 */
function hindsightPlan(rep) {
  const jobs = [], index = new Map(), per = [];
  for (const s of rep.steps) {
    const live = [];
    for (let i = 0; i < rep.n; i++) if (!s.folded[i]) live.push(i);
    if (live.length < 2) { per.push({ live, job: -1 }); continue; }
    const key = live.join(',') + '|' + s.board.join(',');
    if (!index.has(key)) { index.set(key, jobs.length); jobs.push({ hands: live.map((i) => rep.players[i].hole.slice()), board: s.board.slice(), seats: live }); }
    per.push({ live, job: index.get(key) });
  }
  return { jobs, per };
}

/**
 * 每一步：各家胜率、你的胜率（你已弃牌时是 0）、是不是精确值、你的标准误。
 * results 与 plan.jobs 一一对应（后台线程算回来的 hindsightEquity 结果）。
 */
function hindsightSeries(rep, plan, results) {
  return plan.per.map((p) => {
    const bySeat = {}, seBySeat = {};
    let exact = true, samples = 0;
    if (p.job < 0) bySeat[p.live[0]] = 1;
    else {
      const r = results[p.job];
      p.live.forEach((seat, j) => { bySeat[seat] = r.equities[j]; if (!r.exact) seBySeat[seat] = r.stderrs[j]; });
      exact = !!r.exact; samples = r.samples || 0;
    }
    const heroIn = p.live.includes(rep.hero);
    return { live: p.live, bySeat, seBySeat, exact, samples, heroFolded: !heroIn, hero: heroIn ? bySeat[rep.hero] : 0, heroSe: heroIn && !exact ? seBySeat[rep.hero] : 0 };
  });
}

/** 抽样误差的说法：两倍标准误（约 95% 的把握），按百分点向上取到一位小数，至少 0.1 */
function errorPoints(se) { return Math.max(0.1, Math.ceil(se * 2 * 1000 - 1e-9) / 10); }

/** 一个胜率的写法：精确值「62.3%」；抽样估计「约 62.3%（抽样估计，误差 ±0.5 个百分点）」 */
function equityText(eq, exact, se) {
  const p = (eq * 100).toFixed(1) + '%';
  return exact ? p : `约 ${p}（抽样估计，误差 ±${errorPoints(se).toFixed(1)} 个百分点）`;
}

exports.hindsightSeed = hindsightSeed;
exports.hindsightEquity = hindsightEquity;
exports.hindsightPlan = hindsightPlan;
exports.hindsightSeries = hindsightSeries;
exports.errorPoints = errorPoints;
exports.equityText = equityText;
exports.HINDSIGHT_SAMPLES = HINDSIGHT_SAMPLES;
});
