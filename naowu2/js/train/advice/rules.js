__squidDefine('src/train/advice/rules.js', function (exports) {
'use strict';
// 「我的提高建议」的判断规则：门槛、样本数下限、正确率的区间上限，以及四类记录各自怎么判「弱」。纯函数，不碰 DOM。
//
// 给玩家的那句话（界面原样显示，见 RULE_LINES）：
//   - 速算、变式按题型算正确率：速算一类答够 10 道、变式一类做够 5 道才判断；
//     题数少时运气影响大，所以按题数留出余量（统计上 90% 把握的区间），往好里估的上限还不到 70%，才算「确实弱」。
//   - 训练按场景算：同一个场景判过 8 个决策才判断；平均每个决策的 EV 损失超过 2% 底池（关卡两星线，和星级同一把尺子）就算弱。
//   - 固定题：做过但没拿满三星的（没解出、看过提示、答了不止一次），还差几道就写几道。
//   - 自由牌局没有标准答案，不参与。
// 门槛的数都在这里（训练的门槛从 season.js 的 STAR_GATES 取，不另写一个 2）。
const { isGradedDecision, puzzleMisses } = __squidRequire('src/train/notebook.js');
const { STAR_GATES } = __squidRequire('src/train/season.js');
const { SPEED_TYPES } = __squidRequire('src/train/speed.js');
const { VARIANT_TYPES } = __squidRequire('src/train/variants/types.js');

/** 正确率的门槛：区间上限低于它才算弱 */
const RATE_BAR = 0.7;
/** 区间的把握：90%（双侧），对应正态分位数 1.645 */
const CONF_Z = 1.645;
const CONF_PCT = 90;
/** 起算的样本数：速算一个题型 10 道、变式一个题型 5 道、训练一个场景 8 个已判分决策 */
const MIN_SPEED = 10;
const MIN_VARIANT = 5;
const MIN_DRILL = 8;
/** 训练的门槛 = 关卡两星线（平均 EV 损失占底池的百分比） */
const DRILL_BAR = STAR_GATES.find((g) => g.stars === 2).pct;
/** 「照现在的正确率再做多少道才能确定」最多算到这么多，再多就说「差得不多」 */
const NEED_CAP = 1000;

/**
 * 正确率的区间上限（威尔逊区间）：答 n 道对 ok 道，按 z 的把握，真实正确率最高大约是多少。
 * 题数少时这个上限离答对的比例很远（运气的余量大），题数多了就贴近。n 为 0 时给 1（什么都说不了）。
 */
function rateUpper(ok, n, z = CONF_Z) {
  if (!(n > 0)) return 1;
  const p = ok / n, z2 = z * z;
  const center = p + z2 / (2 * n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return Math.min(1, (center + half) / (1 + z2 / n));
}

/**
 * 照现在的正确率（ok/n）再做多少道，区间上限才会低于门槛。正确率已经不低于门槛时给 null（再做多少都不会判成弱）；
 * 超过 NEED_CAP 给 NEED_CAP + 1（界面上说「差得不多，要很多道才分得清」）。
 */
function moreToDecide(ok, n, bar = RATE_BAR, z = CONF_Z) {
  if (!(n > 0)) return null;
  const p = ok / n;
  if (p >= bar) return null;
  for (let m = 1; m <= NEED_CAP; m++) if (rateUpper(p * (n + m), n + m, z) < bar) return m;
  return NEED_CAP + 1;
}

/**
 * 一个正确率类的项目（速算一个题型、变式一个题型）判成什么：
 *   none    一道都没做
 *   few     不到起算线：need = 还差几道
 *   ok      正确率不低于门槛（点估计就够了，不用区间）
 *   weak    区间上限也低于门槛：gap = 门槛 − 上限（越大越弱）
 *   unsure  正确率低于门槛，但区间上限够得着门槛：need = 照现在的正确率再做几道能确定
 */
function judgeRate(ok, n, min) {
  if (!n) return { status: 'none', n: 0, ok: 0 };
  const rate = ok / n, upper = rateUpper(ok, n);
  const base = { n, ok, rate, upper };
  if (n < min) return { ...base, status: 'few', need: min - n };
  if (rate >= RATE_BAR) return { ...base, status: 'ok', margin: rate - RATE_BAR };
  if (upper < RATE_BAR) return { ...base, status: 'weak', gap: RATE_BAR - upper };
  return { ...base, status: 'unsure', need: moreToDecide(ok, n) };
}

/** 限时速算：各题型的累计对错（speed.byType），按题型清单的顺序 */
function speedItems(rec) {
  const byType = (rec && rec.byType) || {};
  return SPEED_TYPES.map((t) => {
    const x = byType[t.id] || { right: 0, wrong: 0 };
    return { kind: 'speed', key: t.id, name: t.name, ...judgeRate(x.right, x.right + x.wrong, MIN_SPEED), wrong: x.wrong };
  });
}

/** 变式练习：各题型做了几道、第一次就答对几道（variants.byType） */
function variantItems(rec) {
  const byType = (rec && rec.byType) || {};
  return VARIANT_TYPES.map((t) => {
    const x = byType[t.id] || { done: 0, firstTry: 0 };
    return { kind: 'variant', key: t.id, name: t.name, ...judgeRate(x.firstTry, x.done, MIN_VARIANT) };
  });
}

/**
 * 训练决策：按场景归组（和漏洞报告 byScenario 同一个分组键 scenarioId），只数已判分的决策（和关卡星级同口径：
 * 取得到 EV、不是「无法判分」）。每组：判了几个、累计损失、平均、其中几个是小错或大错（漏洞）。
 * scenarios 用来给名字和判断场景还在不在（删掉的自定义场景照样参与，只是没法直达，退回特训地图）。
 */
function drillItems(attempts, scenarios = []) {
  const list = Array.isArray(attempts) ? attempts : [];
  const groups = new Map();
  for (const a of list) {
    if (!isGradedDecision(a)) continue;
    const id = a.scenarioId;
    if (id === undefined || id === null) continue;
    let g = groups.get(id);
    if (!g) { g = { id: String(id), n: 0, sum: 0, leaks: 0, leakLoss: 0, lastName: '' }; groups.set(id, g); }
    g.n++; g.sum += a.evLossPct;
    if (a.grade === '小错' || a.grade === '大错') { g.leaks++; g.leakLoss += a.evLossPct; }
    if (typeof a.scenarioName === 'string' && a.scenarioName) g.lastName = a.scenarioName;
  }
  return [...groups.values()].map((g) => {
    const sc = scenarios.find((s) => s && s.id === g.id);
    const avg = g.sum / g.n;
    const base = { kind: 'drill', key: g.id, name: sc ? sc.name : (g.lastName || g.id), exists: !!sc, n: g.n, sum: g.sum, avg, leaks: g.leaks, leakLoss: g.leakLoss };
    if (g.n < MIN_DRILL) return { ...base, status: 'few', need: MIN_DRILL - g.n };
    if (avg > DRILL_BAR) return { ...base, status: 'weak', gap: avg - DRILL_BAR };
    return { ...base, status: 'ok', margin: DRILL_BAR - avg };
  });
}

/**
 * 固定题：错题本「没一次做对」的那些题（notebook.js 的 puzzleMisses，同一份筛选和排序）合成一项。
 * 有这样的题就是 weak；做过的都满星是 ok；一道都没碰过是 none。
 */
function puzzleItem(records, puzzles) {
  const rows = puzzleMisses(records, puzzles);
  const recs = records && typeof records === 'object' ? records : {};
  const touched = puzzles.filter((p) => { const r = recs[p.id]; return r && typeof r === 'object' && ((r.attempts || 0) > 0 || (r.usedHints || 0) > 0); }).length;
  const base = { kind: 'puzzle', key: 'all', name: '固定题', rows, touched, unsolved: rows.filter((r) => !r.solved), partial: rows.filter((r) => r.solved) };
  if (rows.length) return { ...base, status: 'weak', gap: rows.length, n: rows.length, ok: base.unsolved.length };
  return { ...base, status: touched ? 'ok' : 'none', n: 0, ok: 0 };
}

/** 弱项在同一类里的排法：离门槛差得多的在前；一样时样本多的在前（更有把握），再按名字固定下来 */
function byGap(a, b) {
  return (b.gap - a.gap) || ((b.n || 0) - (a.n || 0)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

exports.rateUpper = rateUpper;
exports.moreToDecide = moreToDecide;
exports.judgeRate = judgeRate;
exports.speedItems = speedItems;
exports.variantItems = variantItems;
exports.drillItems = drillItems;
exports.puzzleItem = puzzleItem;
exports.byGap = byGap;
exports.RATE_BAR = RATE_BAR;
exports.CONF_Z = CONF_Z;
exports.CONF_PCT = CONF_PCT;
exports.MIN_SPEED = MIN_SPEED;
exports.MIN_VARIANT = MIN_VARIANT;
exports.MIN_DRILL = MIN_DRILL;
exports.DRILL_BAR = DRILL_BAR;
exports.NEED_CAP = NEED_CAP;
});
