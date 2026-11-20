__squidDefine('src/ui/feltrect.js', function (exports) {
'use strict';
// 牌桌组件（table.js）量位置用的几个小函数：坐标原点一律是毡面左上角，矩形是 { l, t, r, b }。
// 从 table.js 拆出来（v0.14.3，table.js 快到 450 行上限了）；只读页面上的位置，不改任何东西。

/** 元素中心相对毡面左上角的坐标 */
function centerIn(e, felt) {
  const r = e.getBoundingClientRect(), f = felt.getBoundingClientRect();
  return { x: r.left + r.width / 2 - f.left, y: r.top + r.height / 2 - f.top };
}

/** 元素相对毡面左上角的矩形（f 是毡面的 getBoundingClientRect()） */
function rectOf(e, f) {
  const r = e.getBoundingClientRect();
  return { l: r.left - f.left, t: r.top - f.top, r: r.right - f.left, b: r.bottom - f.top };
}

/** 手牌那一块：手牌容器和里面每张牌（自己的两张是斜着放的，会探出容器一点）合起来 */
function holeRect(hole, f) {
  let u = rectOf(hole, f);
  for (const c of hole.children) { const r = rectOf(c, f); u = { l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) }; }
  return u;
}

exports.centerIn = centerIn;
exports.rectOf = rectOf;
exports.holeRect = holeRect;
});
