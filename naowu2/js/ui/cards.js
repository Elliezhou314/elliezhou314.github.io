__squidDefine('src/ui/cards.js', function (exports) {
'use strict';
// 牌面：点数 + 左侧小花色 + 右下大花色，花色是内联 SVG（不靠字体里的 ♠♥♦♣，各系统字形不一，
// 安卓旧机上还可能显示成彩色表情）。牌背是琥珀色菱格。
//
// 每张牌都是「正反两面」的结构：.pc > .in > (.f 正面, .b 背面)。.in 绕 Y 轴转 180° 就是翻牌，
// 所以牌桌上发下来的暗牌、摊牌时翻开、公共牌翻面，都只是给 .pc 加减一个 down 类。
// 尺寸全部由 CSS 变量 --cw（牌宽，像素）推出来，高 = 1.4 倍宽；不用 aspect-ratio，旧安卓内核不认。
//
// 牌的整数编码见 src/core/cards.js：点数 c>>2，花色 c&3（SUITS = 'cdhs'）。
// 这个模块不 import dom.js：dom.js 是更底层的工具，反过来引用会让两者成环。
const { RANKS, SUITS, rankOf, suitOf } = __squidRequire('src/core/cards.js');

const SUIT_CN = { s: '黑桃', h: '红心', d: '方块', c: '梅花' };

/** 四种花色的矢量形状（24×24 画布） */
const SUIT_SVG = {
  s: '<path d="M12 2C8 7 3 10 3 14.2c0 2.6 2 4.3 4.3 4.3 1.5 0 2.8-.6 3.7-1.8-.2 2.2-1 3.8-2.5 5.3h7c-1.5-1.5-2.3-3.1-2.5-5.3.9 1.2 2.2 1.8 3.7 1.8 2.3 0 4.3-1.7 4.3-4.3C21 10 16 7 12 2z"/>',
  h: '<path d="M12 21.5C5 15.5 2 11.8 2 8.1 2 5.2 4.2 3 6.9 3c2 0 3.8 1.1 5.1 3 1.3-1.9 3.1-3 5.1-3C19.8 3 22 5.2 22 8.1c0 3.7-3 7.4-10 13.4z"/>',
  d: '<path d="M12 1.5 20.5 12 12 22.5 3.5 12z"/>',
  c: '<circle cx="12" cy="6.8" r="4.5"/><circle cx="6.6" cy="13.8" r="4.5"/><circle cx="17.4" cy="13.8" r="4.5"/><path d="M12 11c-.2 5-1 8-2.6 11h5.2c-1.6-3-2.4-6-2.6-11z"/>',
};

const rankText = (c) => { const r = RANKS[rankOf(c)]; return r === 'T' ? '10' : r; };

const svg = (s, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${SUIT_SVG[s]}</svg>`;

/** 把正面画成牌 c（c 为 null 时正面留白：对手的暗牌在摊牌前不往页面里放真牌） */
function setCardFace(el, c) {
  for (const s of SUITS) el.classList.remove(s);
  const face = el.querySelector('.f');
  if (c === null || c === undefined) { face.innerHTML = ''; el.removeAttribute('aria-label'); return el; }
  const s = SUITS[suitOf(c)];
  el.classList.add(s);
  face.innerHTML = `<span class="r">${rankText(c)}</span>${svg(s, 'su')}${svg(s, 'big')}`;
  el.setAttribute('aria-label', SUIT_CN[s] + ' ' + rankText(c));
  return el;
}

/** 一张牌。down 为真时背面朝上；c 可以是 null（只有牌背） */
function cardEl(c, down = false) {
  const el = document.createElement('span');
  el.className = 'pc' + (down ? ' down' : '');
  el.setAttribute('role', 'img');
  el.innerHTML = '<span class="in"><span class="f"></span><span class="b"></span></span>';
  return setCardFace(el, c);
}

/** 一排正面朝上的牌（特训、解算器、牌桌之外的地方用）。small 是小一号 */
function cardsEl(cards, small = false) {
  const wrap = document.createElement('span');
  wrap.className = 'cards' + (small ? ' small' : '');
  for (const c of cards) wrap.append(cardEl(c));
  return wrap;
}

exports.setCardFace = setCardFace;
exports.cardEl = cardEl;
exports.cardsEl = cardsEl;
});
