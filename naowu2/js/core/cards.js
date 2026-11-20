__squidDefine('src/core/cards.js', function (exports) {
'use strict';
// 牌的底层表示：0..51 的整数
//   rank = card >> 2   0='2' ... 12='A'
//   suit = card & 3    0='c' 1='d' 2='h' 3='s'
// 全仓统一用这个编码，任何地方不要再自造牌型表示。

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const SUIT_SYM = ['♣', '♦', '♥', '♠'];

const rankOf = (c) => c >> 2;
const suitOf = (c) => c & 3;
const makeCard = (r, s) => (r << 2) | s;

function cardToStr(c) {
  return RANKS[c >> 2] + SUITS[c & 3];
}

/** 给界面看的：A♠ */
function cardToPretty(c) {
  return RANKS[c >> 2] + SUIT_SYM[c & 3];
}

function strToCard(s) {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const u = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || u < 0) throw new Error(`无法解析的牌: ${s}`);
  return (r << 2) | u;
}

/** "AsKd7h" / "As Kd 7h" / "As,Kd,7h" -> [card,...] */
function parseCards(str) {
  if (!str) return [];
  const m = String(str).match(/[2-9TJQKAtjqka][cdhsCDHS]/g);
  if (!m) return [];
  return m.map(strToCard);
}

const cardsToStr = (arr) => arr.map(cardToStr).join('');
const cardsToPretty = (arr) => arr.map(cardToPretty).join(' ');

// ---------------------------------------------------------------------------
// 1326 个起手组合的规范索引。整个解算器都以这个索引为准，不要另建顺序。
// ---------------------------------------------------------------------------
const COMBO_COUNT = 1326;

/** COMBOS[i] = [cardHigh, cardLow]，cardHigh > cardLow */
const COMBOS = (() => {
  const out = [];
  for (let a = 1; a < 52; a++) for (let b = 0; b < a; b++) out.push([a, b]);
  return out;
})();

/** COMBO_INDEX[a*52+b] = 组合序号（a、b 顺序无关） */
const COMBO_INDEX = (() => {
  const idx = new Int16Array(52 * 52).fill(-1);
  for (let i = 0; i < COMBOS.length; i++) {
    const [a, b] = COMBOS[i];
    idx[a * 52 + b] = i;
    idx[b * 52 + a] = i;
  }
  return idx;
})();

const comboIndex = (a, b) => COMBO_INDEX[a * 52 + b];

/** 组合 -> "AsKd" */
const comboToStr = (i) => cardToStr(COMBOS[i][0]) + cardToStr(COMBOS[i][1]);
const comboToPretty = (i) => cardToPretty(COMBOS[i][0]) + cardToPretty(COMBOS[i][1]);

/** 组合 -> "AKs" / "AKo" / "AA" 这种 169 类记号 */
function comboToNotation(i) {
  const [a, b] = COMBOS[i];
  const r1 = rankOf(a), r2 = rankOf(b);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** 169 类记号 -> 该类的所有组合序号 */
const NOTATION_TO_COMBOS = (() => {
  const map = new Map();
  for (let i = 0; i < COMBO_COUNT; i++) {
    const n = comboToNotation(i);
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(i);
  }
  return map;
})();

/** 全部 169 个记号，按网格顺序（行=第一张牌 A→2，列=第二张牌 A→2） */
const NOTATIONS_GRID = (() => {
  const rows = [];
  for (let r = 0; r < 13; r++) {
    const row = [];
    for (let c = 0; c < 13; c++) row.push(gridNotation(r, c));
    rows.push(row);
  }
  return rows;
})();

/** 13x13 网格坐标 -> 记号。行=高牌(A在0行)，同花在右上，非同花在左下 */
function gridNotation(row, col) {
  const hi = 12 - Math.min(row, col);
  const lo = 12 - Math.max(row, col);
  if (row === col) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (col > row ? 's' : 'o');
}

// ---------------------------------------------------------------------------
// 牌堆 / 冲突检测
// ---------------------------------------------------------------------------

/** 返回长度 1326 的 Uint8Array：1 表示该组合与 dead 牌不冲突 */
function liveCombos(dead) {
  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;
  const out = new Uint8Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const [a, b] = COMBOS[i];
    out[i] = blocked[a] || blocked[b] ? 0 : 1;
  }
  return out;
}

function remainingDeck(dead) {
  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;
  const out = [];
  for (let c = 0; c < 52; c++) if (!blocked[c]) out.push(c);
  return out;
}

// sfc32 伪随机 + splitmix32 扩种，带种子方便复现某一局。
// 注意：这里不能用 32 位的 xorshift128+——那套移位常数是给 64 位状态的，
// 套到 32 位上周期会塌到几千（实测 4095），足以污染所有蒙特卡洛结果。
// sfc32 状态 128 位、保证周期 ≥ 2^32、通过 PractRand，tools/selftest.mjs 里有周期与卡方检验。
function makeRng(seed = Date.now() >>> 0) {
  let s = seed >>> 0;
  const splitmix = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  const rng = function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) rng(); // 丢掉预热样本，避免相邻种子开头相关
  return rng;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

exports.cardToStr = cardToStr;
exports.cardToPretty = cardToPretty;
exports.strToCard = strToCard;
exports.parseCards = parseCards;
exports.comboToNotation = comboToNotation;
exports.gridNotation = gridNotation;
exports.liveCombos = liveCombos;
exports.remainingDeck = remainingDeck;
exports.makeRng = makeRng;
exports.shuffle = shuffle;
exports.RANKS = RANKS;
exports.SUITS = SUITS;
exports.SUIT_SYM = SUIT_SYM;
exports.rankOf = rankOf;
exports.suitOf = suitOf;
exports.makeCard = makeCard;
exports.cardsToStr = cardsToStr;
exports.cardsToPretty = cardsToPretty;
exports.COMBO_COUNT = COMBO_COUNT;
exports.COMBOS = COMBOS;
exports.COMBO_INDEX = COMBO_INDEX;
exports.comboIndex = comboIndex;
exports.comboToStr = comboToStr;
exports.comboToPretty = comboToPretty;
exports.NOTATION_TO_COMBOS = NOTATION_TO_COMBOS;
exports.NOTATIONS_GRID = NOTATIONS_GRID;
});
