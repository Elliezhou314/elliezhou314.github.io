__squidDefine('src/train/variants/record.js', function (exports) {
'use strict';
// 变式练习的记录：存在进度对象的 variants 字段，由 train/training.js 的 coerceProgress 用这里的 coerceVariantRecord 校验。
//
// 每个题型记两个数：做了几道（答对或看了答案，一道题只记一次）、其中第一次就答对的几道（没看提示、第一次提交就对）。
// 变式练习不计入赛季分、星级、段位、成就，也不碰 12 道固定题的任何记录。
const { VARIANT_TYPES, VARIANT_TYPE_IDS } = __squidRequire('src/train/variants/types.js');

const CAP = 1e6;

/** 空记录：{ byType: { P01: { done: 0, firstTry: 0 }, … } } */
function emptyVariantRecord() {
  const byType = {};
  for (const id of VARIANT_TYPE_IDS) byType[id] = { done: 0, firstTry: 0 };
  return { byType };
}

/**
 * 整形读到的记录：只认非负整数（上限一百万），第一次就答对的道数不超过做了的道数，不认识的题型丢掉，缺的补零；
 * 整个不是对象（旧存档没有这个字段、或者是 null、字符串、数组）就给空记录。
 */
function coerceVariantRecord(raw) {
  const d = emptyVariantRecord();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const bt = raw.byType;
  if (!bt || typeof bt !== 'object' || Array.isArray(bt)) return d;
  const int = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, CAP) : 0);
  for (const id of VARIANT_TYPE_IDS) {
    const t = bt[id];
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const done = int(t.done);
    d.byType[id] = { done, firstTry: Math.min(int(t.firstTry), done) };
  }
  return d;
}

/** 做完一道（答对或看了答案）：这个题型做了的道数加一，第一次就答对再加一。返回新记录，不改传进来的 */
function recordVariant(rec, type, firstTry) {
  const d = coerceVariantRecord(rec);
  if (!d.byType[type]) return d;
  const t = d.byType[type];
  d.byType[type] = { done: Math.min(t.done + 1, CAP), firstTry: Math.min(t.firstTry + (firstTry ? 1 : 0), CAP) };
  return d;
}

/** 合计：做了几道、第一次就答对几道 */
function variantTotals(rec) {
  const d = coerceVariantRecord(rec);
  let done = 0, firstTry = 0;
  for (const id of VARIANT_TYPE_IDS) { done += d.byType[id].done; firstTry += d.byType[id].firstTry; }
  return { done, firstTry };
}

/** 做过的题型逐行列出（按题型清单的顺序）：名字、做了几道、第一次就答对几道、第一次就答对的比例 */
function variantRows(rec) {
  const d = coerceVariantRecord(rec);
  return VARIANT_TYPES.filter((t) => d.byType[t.id].done > 0)
    .map((t) => ({ type: t.id, name: t.name, done: d.byType[t.id].done, firstTry: d.byType[t.id].firstTry, rate: d.byType[t.id].firstTry / d.byType[t.id].done }));
}

exports.emptyVariantRecord = emptyVariantRecord;
exports.coerceVariantRecord = coerceVariantRecord;
exports.recordVariant = recordVariant;
exports.variantTotals = variantTotals;
exports.variantRows = variantRows;
});
