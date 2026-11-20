__squidDefine('src/core/evaluator.js', function (exports) {
'use strict';
// 5~7 张牌的牌力评估器。返回一个整数，越大越强，可直接比较。
// 编码：category<<20 | k1<<16 | k2<<12 | k3<<8 | k4<<4 | k5
// category: 0高牌 1一对 2两对 3三条 4顺子 5同花 6葫芦 7四条 8同花顺

const { COMBOS, COMBO_COUNT, RANKS } = __squidRequire('src/core/cards.js');

const CATEGORY_CN = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

// 13 位 rank 掩码 -> 顺子最高牌（-1 表示不是顺子）
const STRAIGHT_HI = new Int8Array(8192).fill(-1);
for (let m = 0; m < 8192; m++) {
  let hi = -1;
  for (let h = 12; h >= 4; h--) {
    const need = 0x1f << (h - 4);
    if ((m & need) === need) { hi = h; break; }
  }
  if (hi < 0 && (m & 0x100f) === 0x100f) hi = 3; // A2345 轮子
  STRAIGHT_HI[m] = hi;
}

const rc = new Uint8Array(13);
const sc = new Uint8Array(4);
const sm = new Uint16Array(4);

/** cards: 5~7 张牌的数组（长度任意，只看前 n 个） */
function evaluate(cards, n = cards.length) {
  rc.fill(0); sc.fill(0); sm.fill(0);
  let rmask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    rc[r]++; sc[s]++; sm[s] |= 1 << r; rmask |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      const fm = sm[s];
      const sh = STRAIGHT_HI[fm];
      if (sh >= 0) return (8 << 20) | (sh << 16);
      let v = 5 << 20, k = 0;
      for (let r = 12; r >= 0 && k < 5; r--) if ((fm >> r) & 1) { v |= r << (16 - 4 * k); k++; }
      return v;
    }
  }
  let quad = -1, trips = -1, trips2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = rc[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (trips < 0) trips = r; else if (trips2 < 0) trips2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (quad >= 0) {
    let kick = 0;
    for (let r = 12; r >= 0; r--) if (r !== quad && rc[r] > 0) { kick = r; break; }
    return (7 << 20) | (quad << 16) | (kick << 12);
  }
  if (trips >= 0 && (trips2 >= 0 || p1 >= 0)) {
    const pr = Math.max(trips2, p1);
    return (6 << 20) | (trips << 16) | (pr << 12);
  }
  const sh = STRAIGHT_HI[rmask];
  if (sh >= 0) return (4 << 20) | (sh << 16);
  if (trips >= 0) {
    let v = (3 << 20) | (trips << 16), k = 0;
    for (let r = 12; r >= 0 && k < 2; r--) if (r !== trips && rc[r] > 0) { v |= r << (12 - 4 * k); k++; }
    return v;
  }
  if (p1 >= 0 && p2 >= 0) {
    let kick = 0;
    for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r] > 0) { kick = r; break; }
    return (2 << 20) | (p1 << 16) | (p2 << 12) | (kick << 8);
  }
  if (p1 >= 0) {
    let v = (1 << 20) | (p1 << 16), k = 0;
    for (let r = 12; r >= 0 && k < 3; r--) if (r !== p1 && rc[r] > 0) { v |= r << (12 - 4 * k); k++; }
    return v;
  }
  let v = 0, k = 0;
  for (let r = 12; r >= 0 && k < 5; r--) if (rc[r] > 0) { v |= r << (16 - 4 * k); k++; }
  return v;
}

const categoryOf = (v) => v >> 20;

/** 牌力 -> 中文描述，例如“两对 A和K 踢脚Q” */
function describeValue(v) {
  const cat = v >> 20;
  const k = [(v >> 16) & 15, (v >> 12) & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15];
  const R = (r) => RANKS[r];
  switch (cat) {
    case 8: return k[0] === 12 ? '皇家同花顺' : `同花顺 ${R(k[0])}高`;
    case 7: return `四条${R(k[0])} 踢脚${R(k[1])}`;
    case 6: return `葫芦 ${R(k[0])}带${R(k[1])}`;
    case 5: return `同花 ${R(k[0])}${R(k[1])}${R(k[2])}${R(k[3])}${R(k[4])}`;
    case 4: return `顺子 ${R(k[0])}高`;
    case 3: return `三条${R(k[0])} 踢脚${R(k[1])}${R(k[2])}`;
    case 2: return `两对 ${R(k[0])}和${R(k[1])} 踢脚${R(k[2])}`;
    case 1: return `一对${R(k[0])} 踢脚${R(k[1])}${R(k[2])}${R(k[3])}`;
    default: return `高牌 ${R(k[0])}${R(k[1])}${R(k[2])}${R(k[3])}${R(k[4])}`;
  }
}

const buf7 = new Int32Array(7);

/**
 * 给定完整 5 张公共牌，算出 1326 个组合的牌力表。
 * 与公共牌冲突的组合记 -1。解算器摊牌用这个表排序。
 */
function boardStrengths(board) {
  if (board.length !== 5) throw new Error('boardStrengths 需要 5 张公共牌');
  const out = new Int32Array(COMBO_COUNT);
  const dead = new Uint8Array(52);
  for (let i = 0; i < 5; i++) { buf7[i] = board[i]; dead[board[i]] = 1; }
  for (let i = 0; i < COMBO_COUNT; i++) {
    const a = COMBOS[i][0], b = COMBOS[i][1];
    if (dead[a] || dead[b]) { out[i] = -1; continue; }
    buf7[5] = a; buf7[6] = b;
    out[i] = evaluate(buf7, 7);
  }
  return out;
}

/** 单个手牌 + 公共牌（5张）的牌力 */
function handStrength(hole, board) {
  for (let i = 0; i < 5; i++) buf7[i] = board[i];
  buf7[5] = hole[0]; buf7[6] = hole[1];
  return evaluate(buf7, 7);
}

exports.evaluate = evaluate;
exports.describeValue = describeValue;
exports.boardStrengths = boardStrengths;
exports.handStrength = handStrength;
exports.CATEGORY_CN = CATEGORY_CN;
exports.categoryOf = categoryOf;
});
