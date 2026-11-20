__squidDefine('src/train/season.js', function (exports) {
'use strict';
// 赛季与闯关：把训练包成有目标、有反馈、有进度的游戏循环。
//
// 口径纪律（很重要，别让游戏化污染数学）：
//   - 星级只由 EV 损失决定，跟连击、时间、运气都无关。
//   - 连击只放大"分数"，不影响星级，也不影响任何解算或判分结果。
//   - 3 人局判分落在采样噪声内（gradeDecision 的 noisy）时：不加连击、也不断连击。
//   - 解本身没达到判分精度（可利用度 ≥ 三星门槛 0.5% 底池）时：gradeDecision 直接返回
//     unusable，这里跟其他 unusable 一样排除在星级与分数之外。不能把它当「完美」：
//     那会变成「解得越糙分数越高」，实测同一批 4% 损失的决策能从 300 分变成 1000 分。
//     星级仍按实测 EV 损失等权计入——noisy 只说明「这个差距不显著」，
//     lossPct 本身还是无偏的点估计。早先给 noisy 决策打 0.5 权重是错的：
//     gradeDecision 只在选错时才标 noisy，减半永远只作用于有损失的样本，
//     系统性把平均损失往下拉（实测能拉低 0.5 个百分点）。
//   - 每日挑战用日期做种子，同一天同一台机器题目相同，换天才换；不引入任何随机奖励。

const { SCENARIOS } = __squidRequire('src/train/training.js');
const { PUZZLES } = __squidRequire('src/train/puzzles.js');

// ---------------------------------------------------------------------------
// 章节与关卡
// ---------------------------------------------------------------------------
// 顺序刻意从河牌往前推：河牌树小、几秒就能解完，定理也最干净，第一关几乎不用等；
// 翻牌要跑转牌完整树，放到后面，进章节时后台预热。
const CHAPTERS = [
  {
    id: 'ch1', name: '第一章 · 先把算术算对', intro: '扑克里绝大多数钱不是被读牌读走的，是被算错的。这一章全是有唯一答案的题。',
    levels: [
      { id: 'l1-1', name: '底池赔率与补牌', kind: 'puzzle', puzzles: ['P03', 'P08'], requires: [] },
      { id: 'l1-2', name: '数清楚有多少种', kind: 'puzzle', puzzles: ['P01', 'P02'], requires: ['l1-1'] },
      { id: 'l1-3', name: '你手里的牌会挡住什么', kind: 'puzzle', puzzles: ['P04', 'P05'], requires: ['l1-2'] },
    ],
  },
  {
    id: 'ch2', name: '第二章 · 河牌的均衡', intro: '牌发完了，没有下一街。这时候"最优"是有闭式解的，解算器会当场跑给你看。',
    levels: [
      { id: 'l2-1', name: '诈唬该占多少', kind: 'puzzle', puzzles: ['P06', 'P07'], requires: ['l1-3'] },
      { id: 'l2-2', name: '河牌价值下注', kind: 'drill', scenario: 'river-polar', decisions: 10, hands: 30, requires: ['l2-1'] },
      { id: 'l2-3', name: '河牌抓诈', kind: 'drill', scenario: 'river-bluffcatch', decisions: 10, hands: 30, requires: ['l2-2'] },
    ],
  },
  {
    id: 'ch3', name: '第三章 · 往前推一街', intro: '转牌开始有"下一街"了，权益不再等于胜率。',
    levels: [
      { id: 'l3-1', name: '抓诈先看挡掉了什么', kind: 'puzzle', puzzles: ['P11'], requires: ['l2-3'] },
      { id: 'l3-2', name: '转牌二次开火', kind: 'drill', scenario: 'turn-barrel', decisions: 12, hands: 30, requires: ['l3-1'] },
      { id: 'l3-3', name: '几何下注', kind: 'puzzle', puzzles: ['P10'], requires: ['l3-2'] },
    ],
  },
  {
    id: 'ch4', name: '第四章 · 翻牌', intro: '树最大的一章。进来时解算器会在后台先把局面解好。',
    levels: [
      { id: 'l4-1', name: '干燥面持续下注', kind: 'drill', scenario: 'srp-btn-bb-dry', decisions: 12, hands: 30, requires: ['l3-3'] },
      { id: 'l4-2', name: '湿润面持续下注', kind: 'drill', scenario: 'srp-btn-bb-wet', decisions: 12, hands: 30, requires: ['l4-1'] },
      { id: 'l4-3', name: '大盲防守', kind: 'drill', scenario: 'srp-bb-defend', decisions: 12, hands: 30, requires: ['l4-2'] },
      { id: 'l4-4', name: '3bet 底池', kind: 'drill', scenario: '3bp-btn-vs-co', decisions: 12, hands: 30, requires: ['l4-3'] },
    ],
  },
  {
    id: 'ch5', name: '第五章 · 三个人', intro: '多人底池的权益稀释得比直觉快得多。这一章的解是采样近似，判分会标出噪声。',
    levels: [
      { id: 'l5-1', name: '权益被稀释多少', kind: 'puzzle', puzzles: ['P12'], requires: ['l4-4'] },
      { id: 'l5-2', name: '三人翻牌', kind: 'drill', scenario: '3way-srp-flop', decisions: 12, hands: 30, requires: ['l5-1'] },
      { id: 'l5-3', name: '三人河牌', kind: 'drill', scenario: '3way-river', decisions: 12, hands: 30, requires: ['l5-2'] },
      { id: 'l5-4', name: '博弈值 −1/18', kind: 'puzzle', puzzles: ['P09'], requires: ['l5-3'] },
    ],
  },
];

const ALL_LEVELS = CHAPTERS.flatMap((c) => c.levels.map((l) => ({ ...l, chapter: c.id, chapterName: c.name })));
const getLevel = (id) => ALL_LEVELS.find((l) => l.id === id);

// ---------------------------------------------------------------------------
// 判分：星级只看 EV 损失
// ---------------------------------------------------------------------------
/** 单个决策的基础分（0~100），只由评级决定 */
function decisionBase(grade) {
  // 「无法判分」不在这里给分——summarizeRun 会把这类决策整个排除，
  // 免得「解算失败」变成一种比犯错更划算的结果。
  return grade === '完美' ? 100 : grade === '良好' ? 70 : grade === '小错' ? 30 : 0;
}

/**
 * 连击：连续"完美或良好"才累加。落在采样噪声里的决策既不加也不断——
 * 我们本来就分不清对错，不该拿它奖惩。
 */
function nextCombo(combo, fb) {
  if (fb.noisy || fb.grade === '无法判分') return combo;
  return (fb.grade === '完美' || fb.grade === '良好') ? combo + 1 : 0;
}
const comboMultiplier = (combo) => 1 + 0.1 * Math.min(combo, 10); // 上限 ×2.0

/**
 * 训练关星级的三道门槛（平均 EV 损失占底池的百分比），从严到宽排。全仓只有这一份：
 * starsFromLoss 按它判星，界面上的刻度条（ui/fx.js）、过关卡片的「星数由来」、结算建议都从这里取。
 * v0.9 时界面那边另登记过一份（当时这一轮不许动 src/train/），v0.10 收回到这里。
 */
const STAR_GATES = Object.freeze([
  Object.freeze({ pct: 0.5, stars: 3, name: '三星' }),
  Object.freeze({ pct: 2, stars: 2, name: '两星' }),
  Object.freeze({ pct: 6, stars: 1, name: '一星' }),
]);

/** 关卡星级：只看平均 EV 损失（等权，见文件头），落在哪道门槛以内就是几星，超过最宽的门槛没有星 */
function starsFromLoss(avgLossPct) {
  if (!Number.isFinite(avgLossPct)) return 0;
  for (const g of STAR_GATES) if (avgLossPct <= g.pct) return g.stars;
  return 0;
}

/**
 * 训练关打完后的那条「下一步建议」。按这一局的实际成绩说话（数全部来自 summarizeRun 的结果）。
 * 原来写在 ui/views/drill.js 里，最后一个分支无条件返回「离三星只差一点」，平均损失 9.10%（零星）也这么说。
 */
function nextStepAdvice(run) {
  const g = run.grades || {};
  const big = g['大错'] || 0, small = g['小错'] || 0;
  if (!Number.isFinite(run.avgLossPct)) return '这一关没拿到任何可判分的决策。先回到闯关重新进一次，让解算器重新解这个局面。';
  if (run.stars === 3) return '三星了。可以去下一关，或者到「复盘与漏洞」看看这一关里还有哪类决策拖后腿。';
  if (big >= 2) return `有 ${big} 个大错（EV 损失 > 6% 底池）。到「复盘与漏洞」按错误类型看一眼，多半集中在同一类；再回来打一次。`;
  if (small >= 3) return `有 ${small} 个小错，都是 2%~6% 底池的偏差——通常是尺度或频率没跟上解算器。点「在解算器里看这个局面」，找到你犯错那几手，看它给的频率。`;
  // 兜底：写出这次的平均损失，和离「下一档」门槛还差多少个百分点。只有真的是两星时才说离三星差一点。
  const avg = run.avgLossPct;
  const next = [...STAR_GATES].reverse().find((gate) => gate.stars === run.stars + 1);
  const gap = `${(avg - next.pct).toFixed(2)} 个百分点`;
  if (run.stars === 2) return `离三星只差一点：这次平均 EV 损失 ${avg.toFixed(2)}% 底池，再降 ${gap}（到 ${next.pct}% 以内）就是三星。同一个局面再打一次，注意那几个被判「良好」的决策——它们就是剩下的损失。`;
  return `这次平均 EV 损失 ${avg.toFixed(2)}% 底池，离${next.name}（${next.pct}% 以内）还差 ${gap}。`
    + '点「在解算器里看这个局面」，找到损失最大的那几手，看解算器怎么打，再回来打一次。';
}

/**
 * 汇总一段训练的结果。
 *
 * 三条口径：
 *   1. 「无法判分」的决策（EV 全不可用）既不进星级也不进分数——它没有 EV 损失可言，
 *      早先按 lossPct=0 计入，等于把「分不清对错」当成「打得完美」。
 *   2. 「差距在采样噪声内」的决策等权计入星级，只单独计数报给用户，不打折。
 *   3. 分数按**平均质量**算，不按决策条数累加。累加会让「多点几下」比「打得好」更值钱。
 */
function summarizeRun(decisions) {
  let wsum = 0, wloss = 0, baseSum = 0, graded = 0, combo = 0, best = 0, unusable = 0, noisy = 0;
  const grades = {};
  for (const d of decisions) {
    grades[d.grade] = (grades[d.grade] || 0) + 1;
    combo = nextCombo(combo, d);
    best = Math.max(best, combo);
    if (d.unusable || !Number.isFinite(d.lossPct)) { unusable++; continue; }
    if (d.noisy) noisy++;
    wsum += 1; wloss += d.lossPct;      // 等权：不给 noisy 打折，见文件头的说明
    baseSum += decisionBase(d.grade); graded++;
  }
  const avgLossPct = wsum > 0 ? wloss / wsum : NaN;
  const avgBase = graded > 0 ? baseSum / graded : 0;
  // 连击只给一个温和的加成（最多 +50%），且乘在平均质量上，不随决策条数增长
  const score = Math.round(avgBase * 10 * (1 + 0.05 * Math.min(best, 10)));
  return { decisions: decisions.length, graded, unusable, noisy, avgLossPct, stars: starsFromLoss(avgLossPct), score, bestCombo: best, grades };
}

/**
 * 谜题星级：没看提示、第一次就答对 3 星；看过提示或答了多次 1 星。
 * 早先还分「完全精确」3 星和「在容差内」2 星；现在答案只要求保留一位小数，答对就是答对，
 * 这一档没有了——旧存档里第一次就答对、当时记了 2 星的题，现在也按 3 星算。
 * bestStars 在首次解出时落盘，之后只取最大值——否则回去把一道已解出的题再答一遍，
 * attempts 增加，星级就从 3 掉到 1，连带把成就取消掉。
 * （v0.11 从 ui/progress.js 挪到这里：错题本的汇总在 train/notebook.js，要用同一把尺子，又不能反过来引用界面代码。）
 */
function puzzleStarsNow(rec) {
  if (!rec || !rec.solved) return 0;
  return rec.attempts === 1 && !rec.usedHints ? 3 : 1;
}

function puzzleStars(rec) {
  if (!rec || !rec.solved) return 0;
  return Math.max(rec.bestStars || 0, puzzleStarsNow(rec));
}

/** 谜题关也要给赛季分，否则打穿一整章总分还是 0 */
function puzzleRunScore(stars, puzzleCount) {
  return Math.round(stars / 3 * 400 * Math.max(1, puzzleCount) / 2);
}

// ---------------------------------------------------------------------------
// 赛季段位
// ---------------------------------------------------------------------------
const RANKS = [
  { name: '入门', min: 0 },
  { name: '青铜', min: 800 },
  { name: '白银', min: 2000 },
  { name: '黄金', min: 4500 },
  { name: '铂金', min: 8000 },
  { name: '钻石', min: 13000 },
  { name: '大师', min: 20000 },
];
function rankOf(score) {
  let cur = RANKS[0], next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (score >= RANKS[i].min) { cur = RANKS[i]; next = RANKS[i + 1] || null; }
  }
  return { name: cur.name, min: cur.min, next, toNext: next ? next.min - score : 0, progress: next ? (score - cur.min) / (next.min - cur.min) : 1 };
}

// ---------------------------------------------------------------------------
// 成就
// ---------------------------------------------------------------------------
const ACHIEVEMENTS = [
  { id: 'a-first', name: '开张', desc: '完成第一个关卡', check: (st) => st.levelsCleared >= 1 },
  { id: 'a-ch1', name: '算术过关', desc: '第一章全部三星', check: (st) => st.chapterStars.ch1 === 9 },
  { id: 'a-combo10', name: '十连', desc: '一次训练里连续 10 个决策达到良好以上', check: (st) => st.bestCombo >= 10 },
  { id: 'a-perfect', name: '零损失', desc: '完成一个平均 EV 损失 ≤ 0.5% 底池的关卡', check: (st) => st.hasPerfectLevel },
  // id 沿用旧名：存档里已点亮的成就按 id 记
  { id: 'a-exact', name: '一次就答对', desc: '有 5 道题没看提示、第一次作答就答对', check: (st) => st.firstTryNoHints >= 5 },
  { id: 'a-imo', name: 'IMO 级', desc: '解出全部 4 道 IMO 难度的题', check: (st) => st.imoSolved >= 4 },
  { id: 'a-daily3', name: '连续三天', desc: '连续 3 天完成每日挑战', check: (st) => st.dailyStreak >= 3 },
  { id: 'a-solver', name: '眼见为实', desc: '在定理实验室里跑过一次解算', check: (st) => st.labRuns >= 1 },
  { id: 'a-leak', name: '直面漏洞', desc: '累计 100 个已判分决策', check: (st) => st.gradedDecisions >= 100 },
  { id: 'a-rank', name: '上黄金', desc: '赛季总分达到 4500', check: (st) => st.score >= 4500 },
];

// ---------------------------------------------------------------------------
// 每日挑战：用日期做种子，同一天题目固定
// ---------------------------------------------------------------------------
function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/**
 * 当天的挑战内容：2 道题 + 1 个训练场景。用日期做种子，同一天固定。
 *
 * 会跟着进度走：opts.unlockedScenarios 给出玩家已经解锁的场景，opts.maxTier 给出
 * 允许出到的最高难度。否则新号第一天就会被派一道 IMO 题加一个第四章的翻牌场景，
 * 既做不出来也解锁不了。
 */
function dailyChallenge(now, opts = {}) {
  const key = dayKey(now);
  const h = hashStr(key);
  const tierRank = { 省赛: 0, 国赛: 1, IMO: 2 };
  const maxTier = tierRank[opts.maxTier] ?? 0;
  const easy = PUZZLES.filter((p) => p.tier === '省赛');
  const harder = PUZZLES.filter((p) => (tierRank[p.tier] ?? 0) > 0 && (tierRank[p.tier] ?? 0) <= maxTier);
  const pool2 = harder.length ? harder : easy;
  // 两道题不重复
  const first = easy[h % easy.length];
  let second = pool2[(h >>> 8) % pool2.length];
  if (second.id === first.id && pool2.length > 1) second = pool2[((h >>> 8) + 1) % pool2.length];

  const unlocked = Array.isArray(opts.unlockedScenarios) && opts.unlockedScenarios.length ? opts.unlockedScenarios : null;
  const cand = SCENARIOS.filter((s) => s.players === 2 && (!unlocked || unlocked.includes(s.id)));
  const pool3 = cand.length ? cand : SCENARIOS.filter((s) => s.players === 2);
  return {
    key,
    puzzles: [first.id, second.id],
    scenario: pool3[(h >>> 16) % pool3.length].id,
    decisions: 8,
  };
}

exports.decisionBase = decisionBase;
exports.nextCombo = nextCombo;
exports.starsFromLoss = starsFromLoss;
exports.nextStepAdvice = nextStepAdvice;
exports.summarizeRun = summarizeRun;
exports.puzzleStarsNow = puzzleStarsNow;
exports.puzzleStars = puzzleStars;
exports.puzzleRunScore = puzzleRunScore;
exports.rankOf = rankOf;
exports.dayKey = dayKey;
exports.dailyChallenge = dailyChallenge;
exports.CHAPTERS = CHAPTERS;
exports.ALL_LEVELS = ALL_LEVELS;
exports.getLevel = getLevel;
exports.comboMultiplier = comboMultiplier;
exports.STAR_GATES = STAR_GATES;
exports.RANKS = RANKS;
exports.ACHIEVEMENTS = ACHIEVEMENTS;
});
