__squidDefine('src/train/variants/common.js', function (exports) {
'use strict';
// 变式练习各题型共用的小工具：组合数、牌的写法、百分数与一位小数、随机取数。只放纯函数。
//
// 口径照数学竞赛：给玩家看的小数一律保留一位（共用 puzzles.js 的 oneDecimal），概率写百分数，
// 整数不带小数点、不加千分位；牌写成 A♠、10♥（10 不写成 T，免得多一个没解释过的字母）。
const { RANKS, SUIT_SYM, rankOf, suitOf } = __squidRequire('src/core/cards.js');
const { oneDecimal } = __squidRequire('src/train/puzzles.js');

/** 组合数：n 个里挑 k 个 */
function C(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

const FACT = [1, 1, 2, 6, 24, 120];
/** 「n 个里挑 k 个」写成算式：48×47×46÷6 = 17296（k = 1 时就是 n；k = 0 时是 1） */
function chooseText(n, k) {
  if (k === 0) return '1';
  if (k === 1) return String(n);
  const top = Array.from({ length: k }, (_, i) => n - i).join('×');
  return `${top}÷${FACT[k]} = ${C(n, k)}`;
}

const SUIT_CN = ['梅花', '方块', '红心', '黑桃'];
/** 点数写法：10 不写成 T */
const rankName = (r) => (RANKS[r] === 'T' ? '10' : RANKS[r]);
/** 一张牌：A♠、10♥ */
const cardText = (c) => rankName(rankOf(c)) + SUIT_SYM[suitOf(c)];
/** 几张牌连写：A♠K♠ */
const cardsText = (cs) => cs.map(cardText).join('');

/** 概率 → 百分数一位小数：35.0% */
const pct = (x) => oneDecimal(x * 100) + '%';
/** 恰好是一位小数（0.8、12、2.5）的数：浮点误差（4 × 0.2 = 0.8000000000000002）不算多出来的位数 */
const exactTenths = (x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-7;
const tenthsText = (x) => { const t = Math.round(x * 10); return t % 10 === 0 ? String(t / 10) : oneDecimal(t / 10); };
/** 整数原样，非整数保留一位小数（负号仍是 -，要给玩家看负数时用 signed1） */
const num1 = (x) => (exactTenths(x) ? tenthsText(x) : oneDecimal(x));
/** 恰好一位小数以内的数原样写；更长的保留一位、前面加「约」：2.25 → 约 2.3；0.8 → 0.8；3 → 3 */
const about = (x) => (exactTenths(x) ? tenthsText(x) : '约 ' + oneDecimal(x));
/** 带符号的一位小数，负号用 −：−2.2、0.0、3.5 */
const signed1 = (x) => oneDecimal(x).replace('-', '−');

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
/** lo ~ hi 之间的整数（含两端） */
const randInt = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));

/** 还没出现的牌（按编号从小到大） */
function remaining(dead) {
  const used = new Uint8Array(52);
  for (const c of dead) used[c] = 1;
  const out = [];
  for (let c = 0; c < 52; c++) if (!used[c]) out.push(c);
  return out;
}

/** 从还没出现的牌里随机发 n 张（洗牌取前 n 张） */
function dealFrom(rng, dead, n) {
  const deck = remaining(dead);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck.slice(0, n);
}

/** 点数的中文列举：「8、9、10、J」 */
const ranksList = (ranks) => ranks.map(rankName).join('、');

/** 「翻牌 3 张」「翻牌和转牌共 4 张」「翻牌、转牌、河牌共 5 张」 */
const STREET_CARDS = { 3: '翻牌 3 张', 4: '翻牌和转牌共 4 张公共牌', 5: '翻牌、转牌、河牌共 5 张公共牌' };

exports.C = C;
exports.chooseText = chooseText;
exports.remaining = remaining;
exports.dealFrom = dealFrom;
exports.SUIT_CN = SUIT_CN;
exports.rankName = rankName;
exports.cardText = cardText;
exports.cardsText = cardsText;
exports.pct = pct;
exports.num1 = num1;
exports.about = about;
exports.signed1 = signed1;
exports.pick = pick;
exports.randInt = randInt;
exports.ranksList = ranksList;
exports.STREET_CARDS = STREET_CARDS;
});
