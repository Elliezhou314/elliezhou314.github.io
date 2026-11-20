__squidDefine('src/train/advice/snapshot.js', function (exports) {
'use strict';
// 「我的提高建议」的快照：每次生成建议时记下当时最弱的那一项（是什么、当时的数、日期），下次打开拿来对比
// 「上次最弱的那项现在怎么样了」。存在进度对象的 advice 字段，由 train/training.js 的 coerceProgress 用这里的 coerceAdviceRecord 校验，
// 导出、导入跟着进度走。
//
// 这个文件不引用别的训练模块：training.js 要引用它，反过来引用就成环了。
//
// 形状：{ snaps: [ { day, time, kind, key, name, n, ok, loss }, … ] }，按时间先后，一天最多一份（同一天再生成就换成新的），最多 SNAP_MAX 份。
//   kind  'speed' 速算题型 / 'variant' 变式题型 / 'drill' 训练场景 / 'puzzle' 固定题（key 是 'all'）
//   n、ok 速算：答了几道、对了几道；变式：做了几道、第一次就答对几道；训练：判了几个决策、其中几个小错或大错；
//         固定题：还差几道没拿满星、其中几道还没解出
//   loss  只有训练有：那时这个场景的累计 EV 损失（% 底池），平均 = loss / n；别的类是 null
const SNAP_MAX = 10;
const SNAP_KINDS = Object.freeze(['speed', 'variant', 'drill', 'puzzle']);

function emptyAdviceRecord() { return { snaps: [] }; }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const okInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

/** 一份快照：任何一项不合法就整份丢掉（当时的数没法「纠正」出真值，编一个比丢掉更糟） */
function coerceSnap(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (typeof s.day !== 'string' || !DAY_RE.test(s.day)) return null;
  if (!Number.isFinite(s.time) || s.time <= 0 || s.time > 8.64e15) return null;
  if (!SNAP_KINDS.includes(s.kind)) return null;
  if (typeof s.key !== 'string' || !s.key || s.key.length > 80) return null;
  if (typeof s.name !== 'string' || s.name.length > 80) return null;
  if (!okInt(s.n, 1e7) || !okInt(s.ok, 1e7) || s.ok > s.n) return null;
  let loss = null;
  if (s.kind === 'drill') {
    if (!Number.isFinite(s.loss) || s.loss < 0 || s.loss > 1e9 || s.n === 0) return null;
    loss = s.loss;
  }
  return { day: s.day, time: s.time, kind: s.kind, key: s.key, name: s.name, n: s.n, ok: s.ok, loss };
}

/** 整形读到的记录：不是对象、snaps 不是数组都给空记录；不合法的快照丢掉；同一天留时间最晚的一份；只留最近 SNAP_MAX 份 */
function coerceAdviceRecord(raw) {
  const d = emptyAdviceRecord();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.snaps)) return d;
  const byDay = new Map();
  for (const s of raw.snaps.slice(-5 * SNAP_MAX).map(coerceSnap)) {
    if (!s) continue;
    const old = byDay.get(s.day);
    if (!old || s.time >= old.time) byDay.set(s.day, s);
  }
  d.snaps = [...byDay.values()].sort((a, b) => a.time - b.time).slice(-SNAP_MAX);
  return d;
}

/**
 * 记一份快照（snap 已经是合法形状）：同一天的那份换成它，别的不动。返回 { rec 新记录, changed 有没有变 }；不改传进来的。
 * 和同一天已有的那份一字不差时 changed 为假（界面就不用再存一次）。
 */
function recordSnap(rec, snap) {
  const d = coerceAdviceRecord(rec);
  const s = coerceSnap(snap);
  if (!s) return { rec: d, changed: false };
  const same = d.snaps.find((x) => x.day === s.day);
  if (same && JSON.stringify({ ...same, time: 0 }) === JSON.stringify({ ...s, time: 0 })) return { rec: d, changed: false };
  d.snaps = [...d.snaps.filter((x) => x.day !== s.day), s].sort((a, b) => a.time - b.time).slice(-SNAP_MAX);
  return { rec: d, changed: true };
}

/** 对比用的「上次」：今天之前最近的一份（今天记的那份要留到明天才拿来比，免得同一天打开两次就把对比冲掉） */
function baselineSnap(rec, today) {
  const d = coerceAdviceRecord(rec);
  const before = d.snaps.filter((s) => s.day < today);
  return before.length ? before[before.length - 1] : null;
}

exports.emptyAdviceRecord = emptyAdviceRecord;
exports.coerceSnap = coerceSnap;
exports.coerceAdviceRecord = coerceAdviceRecord;
exports.recordSnap = recordSnap;
exports.baselineSnap = baselineSnap;
exports.SNAP_MAX = SNAP_MAX;
exports.SNAP_KINDS = SNAP_KINDS;
});
