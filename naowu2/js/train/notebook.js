__squidDefine('src/train/notebook.js', function (exports) {
'use strict';
// 「复盘与漏洞」页面的全部汇总：错题本（训练里做错的决策、数学竞赛没一次做对的题、限时速算最弱的题型）
// 和成长曲线（训练决策的 EV 损失按天走势、速算逐局走势）。纯函数，只吃存档里的原始记录，不碰 DOM。
// 界面（src/ui/review/）只负责把这里的结果画出来，图和「看数据表」用的是同一份结果。
//
// 口径纪律：
//   - 错题本里「训练里做错的决策」的范围与漏洞报告完全一致：同一条判据 isLeak（training.js），
//     算过 EV 且被判为小错或大错。tools/notebooktest.mjs 用 leakReport 对账：各组次数之和 = 漏洞数，累计损失之和相等。
//   - 翻前闪卡没有动作 EV，不进错题本的分组，也不给它编损失；它的记录里有明确的对错（小错 = 偏离图上的策略），只报次数。
//   - 成长曲线的平均 EV 损失与关卡星级同一个口径（season.js 的 summarizeRun）：取不到 EV 的、
//     「无法判分」的（包括解得太糙、可利用度达到三星门槛的）排除；落在采样噪声里的照常等权计入。
//   - 所有「最近」「之后」都按记录写入的先后（数组顺序），日期按本机的本地日期（season.js 的 dayKey）。
const { RANKS } = __squidRequire('src/core/cards.js');
const { PUZZLES } = __squidRequire('src/train/puzzles.js');
const { dayKey, puzzleStars } = __squidRequire('src/train/season.js');
const { SPEED_TYPES } = __squidRequire('src/train/speed.js');
const { isLeak, median } = __squidRequire('src/train/training.js');

/** 成长曲线纵轴封顶（% 底池）：某天平均损失特别大时不把其他天压成一条线，超出的点画在顶上并标出真实数值 */
const TREND_CAP_PCT = 12;
/** 一天的已判分决策少于这个数，点画成空心、明细里注明「样本少」 */
const SMALL_DAY_N = 5;
/** 「最近 W 个对之前 W 个」的 W：默认 50，不够时取总数的一半，至少 10（总数不到 20 不比） */
const COMPARE_W = 50;
const COMPARE_MIN_W = 10;
/** 速算某题型累计答题数少于这个数，标「样本少」并排在后面 */
const SPEED_SMALL_N = 10;

const GOOD_GRADES = new Set(['完美', '良好']);

/** 成长曲线与「之后的表现」认的「已判分决策」：与 summarizeRun 同口径（取得到 EV、不是「无法判分」） */
function isGradedDecision(a) {
  return !!a && Number.isFinite(a.evLossPct) && a.grade !== '无法判分' && !a.solverTooCoarse;
}

/** 翻前闪卡的记录：没有 EV（evLossPct 为 null），场景号以 preflop- 开头 */
function isPreflopCard(a) {
  return !!a && !Number.isFinite(a.evLossPct) && (a.kind === 'preflop' || String(a.scenarioId || '').startsWith('preflop-'));
}

/** 'YYYY-MM-DD' → 从 1970-01-01 起的第几天（只用来在横轴上按真实间隔排点） */
function dayNumber(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

const SUIT_OF = { '♣': 0, c: 0, '♦': 1, d: 1, '♥': 2, h: 2, '♠': 3, s: 3 };
/** 训练记录里的手牌是给人看的写法（如 A♠K♦），这里解析回牌的编码；解析不出两张就给 null，界面照原文显示 */
function parseHandText(s) {
  const m = [...String(s || '').matchAll(/([2-9TJQKA])([♣♦♥♠cdhs])/g)];
  if (m.length !== 2) return null;
  return m.map(([, r, u]) => (RANKS.indexOf(r) << 2) | SUIT_OF[u]);
}

/** 训练记录里的牌面写法（如 Ah7d2c）→ 牌的编码；不是牌就给 null */
function parseBoardText(s) {
  const m = [...String(s || '').matchAll(/([2-9TJQKA])([cdhs])/g)];
  if (!m.length) return null;
  return m.map(([, r, u]) => (RANKS.indexOf(r) << 2) | SUIT_OF[u]);
}

// ---------------------------------------------------------------------------
// 错题本一：训练里做错的决策
// ---------------------------------------------------------------------------
/**
 * 把漏洞（isLeak）按「场景 + 哪条街 + 错误类型」归组，按累计损失从大到小排。
 * 每组：次数、累计损失（% 底池）、最近一次（时间与具体例子）、之后的表现
 * （最近一次出错之后，同一场景同一条街又判了几个决策、其中几个是良好以上）。
 */
function mistakeBook(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const groups = new Map();
  list.forEach((a, i) => {
    if (!isLeak(a)) return;
    const type = a.mistake || '未分类';   // 与 leakReport 的 byType 同一个兜底名
    const key = `${a.scenarioId}|${a.street}|${type}`;
    let g = groups.get(key);
    if (!g) { g = { key, scenarioId: a.scenarioId, street: a.street, type, n: 0, totalLoss: 0, lastIndex: -1 }; groups.set(key, g); }
    g.n++;
    g.totalLoss += a.evLossPct;
    if (i > g.lastIndex) g.lastIndex = i;
  });
  const out = [...groups.values()].map((g) => {
    const last = list[g.lastIndex];
    let after = 0, good = 0;
    for (let j = g.lastIndex + 1; j < list.length; j++) {
      const b = list[j];
      if (!b || b.scenarioId !== g.scenarioId || b.street !== g.street || !isGradedDecision(b)) continue;
      after++;
      if (GOOD_GRADES.has(b.grade)) good++;
    }
    return {
      key: g.key, scenarioId: g.scenarioId, scenarioName: last.scenarioName || String(g.scenarioId), street: g.street, type: g.type,
      n: g.n, totalLoss: g.totalLoss, lastIndex: g.lastIndex, lastTime: Number.isFinite(last.time) ? last.time : null,
      example: {
        boardText: String(last.board || ''), handText: String(last.hand || ''),
        board: parseBoardText(last.board), hand: parseHandText(last.hand),
        chosen: String(last.chosen || ''), best: String(last.best || ''), loss: last.evLossPct, grade: last.grade,
      },
      after: { n: after, good },
    };
  });
  out.sort((x, y) => (y.totalLoss - x.totalLoss) || (y.n - x.n) || (y.lastIndex - x.lastIndex));
  const preflop = list.filter(isPreflopCard);
  return {
    groups: out,
    leaks: out.reduce((s, g) => s + g.n, 0),
    totalLoss: out.reduce((s, g) => s + g.totalLoss, 0),
    // 翻前闪卡：只报次数（判为小错 = 偏离了图上的策略），不给损失数字
    preflop: { total: preflop.length, wrong: preflop.filter((a) => a.grade === '小错' || a.grade === '大错').length },
    // 训练里取不到 EV 的决策（不是翻前闪卡）：不进错题本，界面如实说一句有几个
    noEv: list.filter((a) => a && !Number.isFinite(a.evLossPct) && !isPreflopCard(a)).length,
  };
}

// ---------------------------------------------------------------------------
// 错题本二：数学竞赛里没一次做对的题
// ---------------------------------------------------------------------------
/**
 * 「没一次做对」= 有作答或看提示的记录，但不是「没看提示、第一次就答对」（星级不到 3）：
 * 答了不止一次的、看过提示的、答过还没解出来的。没解出来的排前面，再按作答次数从多到少。
 */
function puzzleMisses(records, puzzles = PUZZLES) {
  const recs = records && typeof records === 'object' ? records : {};
  const rows = [];
  for (const p of puzzles) {
    const r = recs[p.id];
    if (!r || typeof r !== 'object') continue;
    const attempts = Number.isInteger(r.attempts) ? r.attempts : 0, hints = Number.isInteger(r.usedHints) ? r.usedHints : 0;
    if (attempts <= 0 && hints <= 0) continue;
    const stars = puzzleStars(r);
    if (stars >= 3) continue;
    rows.push({ id: p.id, title: p.title, attempts, hints, solved: !!r.solved, stars });
  }
  rows.sort((a, b) => (Number(a.solved) - Number(b.solved)) || (b.attempts - a.attempts) || (a.id < b.id ? -1 : 1));
  return rows;
}

/** 数学竞赛的总况：解出几题、共几星（作答记录里没有时间，画不出走势，只给这两个数） */
function puzzleTotals(records, puzzles = PUZZLES) {
  const recs = records && typeof records === 'object' ? records : {};
  let solved = 0, stars = 0, touched = 0;
  for (const p of puzzles) {
    const r = recs[p.id];
    if (r && typeof r === 'object' && ((r.attempts || 0) > 0 || (r.usedHints || 0) > 0)) touched++;
    if (r && r.solved) { solved++; stars += puzzleStars(r); }
  }
  return { solved, stars, touched, total: puzzles.length, maxStars: puzzles.length * 3 };
}

// ---------------------------------------------------------------------------
// 错题本三：限时速算里最弱的题型
// ---------------------------------------------------------------------------
/** 各题型按累计正确率从低到高；累计不到 SPEED_SMALL_N 题的标「样本少」、排在后面；一题没答过的单列名字 */
function speedWeakTypes(rec) {
  const byType = (rec && rec.byType) || {};
  const rows = [], untouched = [];
  for (const t of SPEED_TYPES) {
    const x = byType[t.id] || { right: 0, wrong: 0 };
    const n = x.right + x.wrong;
    if (!n) { untouched.push(t.name); continue; }
    rows.push({ type: t.id, name: t.name, right: x.right, wrong: x.wrong, n, rate: x.right / n, small: n < SPEED_SMALL_N });
  }
  rows.sort((a, b) => (Number(a.small) - Number(b.small)) || (a.rate - b.rate) || (b.wrong - a.wrong) || (b.n - a.n));
  return { rows, untouched };
}

// ---------------------------------------------------------------------------
// 成长曲线一：训练决策的 EV 损失按天走势
// ---------------------------------------------------------------------------
/** 最近 W 个对再之前 W 个的 W（总数不到 2 × COMPARE_MIN_W 给 0，表示不比） */
function compareWindow(total) {
  if (!(total >= 2 * COMPARE_MIN_W)) return 0;
  return total >= 2 * COMPARE_W ? COMPARE_W : Math.floor(total / 2);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * 按本地日期分天：每天的已判分决策数、平均损失、中位数；纵轴封顶在 TREND_CAP_PCT，超出的点保留真实数值。
 * compare：按记录先后取最近 W 个和再之前 W 个的平均损失（数据不够时为 null）。
 */
function evTrend(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const graded = list.map((a, i) => ({ a, i })).filter(({ a }) => isGradedDecision(a) && Number.isFinite(a.time))
    .sort((x, y) => (x.a.time - y.a.time) || (x.i - y.i)).map(({ a }) => a);
  const byDay = new Map();
  for (const a of graded) {
    const d = dayKey(a.time);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(a.evLossPct);
  }
  const points = [...byDay.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([day, losses]) => {
    const m = mean(losses);
    return { day, dayNum: dayNumber(day), n: losses.length, mean: m, median: median(losses), small: losses.length < SMALL_DAY_N,
      shown: Math.min(m, TREND_CAP_PCT), capped: m > TREND_CAP_PCT };
  });
  const W = compareWindow(graded.length);
  let compare = null;
  if (W) {
    const losses = graded.map((a) => a.evLossPct);
    const recent = mean(losses.slice(-W)), prior = mean(losses.slice(-2 * W, -W));
    compare = { W, recent, prior, diff: recent - prior };
  }
  const coarse = list.filter((a) => a && Number.isFinite(a.evLossPct) && !isGradedDecision(a)).length;
  const noEv = list.filter((a) => a && !Number.isFinite(a.evLossPct)).length;
  return { points, graded: graded.length, compare, excluded: { coarse, noEv } };
}

/** 图上方那句结论：只陈述两个平均数和差了多少个百分点，不加评价。差值按两个显示出来的数相减，读者自己算得对上 */
function compareSentence(c) {
  if (!c) return '';
  const r = c.recent.toFixed(2), p = c.prior.toFixed(2);
  const d = Math.round((Number(r) - Number(p)) * 100) / 100;
  const head = `最近 ${c.W} 个决策平均损失 ${r}% 底池，再之前 ${c.W} 个 ${p}%`;
  if (d === 0) return `${head}，两者相同。`;
  return `${head}，${d < 0 ? '降了' : '升了'} ${Math.abs(d).toFixed(2)} 个百分点。`;
}

// ---------------------------------------------------------------------------
// 成长曲线二：限时速算逐局走势
// ---------------------------------------------------------------------------
/** 60 秒挑战逐局：第几局、答对数、答题数、正确率、日期；best 是记录里的个人最好（可能来自加逐局历史之前的局） */
function speedTrend(rec) {
  const hist = rec && Array.isArray(rec.history) ? rec.history : [];
  const points = hist.map((r, i) => ({ i: i + 1, correct: r.correct, answered: r.answered, time: r.time, day: dayKey(r.time),
    rate: r.answered ? r.correct / r.answered : null }));
  const runs = rec && Number.isInteger(rec.runs) ? rec.runs : 0;
  return { points, best: rec && Number.isInteger(rec.best) ? rec.best : 0, runs, withoutHistory: Math.max(0, runs - points.length) };
}

exports.isGradedDecision = isGradedDecision;
exports.isPreflopCard = isPreflopCard;
exports.dayNumber = dayNumber;
exports.parseHandText = parseHandText;
exports.parseBoardText = parseBoardText;
exports.mistakeBook = mistakeBook;
exports.puzzleMisses = puzzleMisses;
exports.puzzleTotals = puzzleTotals;
exports.speedWeakTypes = speedWeakTypes;
exports.compareWindow = compareWindow;
exports.evTrend = evTrend;
exports.compareSentence = compareSentence;
exports.speedTrend = speedTrend;
exports.TREND_CAP_PCT = TREND_CAP_PCT;
exports.SMALL_DAY_N = SMALL_DAY_N;
exports.COMPARE_W = COMPARE_W;
exports.COMPARE_MIN_W = COMPARE_MIN_W;
exports.SPEED_SMALL_N = SPEED_SMALL_N;
});
