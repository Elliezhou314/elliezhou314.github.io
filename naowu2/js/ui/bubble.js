__squidDefine('src/ui/bubble.js', function (exports) {
'use strict';
// 动作气泡放在哪：纯几何，不碰页面（牌桌组件 table.js 量好各块的矩形交给它）。
//
// 气泡要挨着说话的那一家，但不能压住任何人的手牌、名牌（名字和后手），也不能压住公共牌、底池、任何一家面前的下注。
// 办法：围着这一家的名牌和手牌列出一串候选位置（按「看上去自然」的顺序：名牌外侧、名牌内侧、手牌外侧、手牌内侧、
// 整块上方、整块下方、再往斜角上找），先推进毡面以内，再挑第一个谁都不碰的。
// 「谁都不碰」分两档：hard 是此刻摆在桌上的东西（名牌、手牌、公共牌、底池、亮着的下注），绝对不能压；
// soft 是「待会儿可能出现的东西」（还没下注的那几家面前的下注位置、庄家按钮、别家还亮着的气泡），尽量也让开。
// 一个都找不到时退一步：只让开 hard；再找不到就挑和 hard 重叠面积最小的那个（实测的人数、视口组合里都没有走到这一步）。
// 矩形一律是 { l, t, r, b }，坐标原点是毡面左上角。

const GAP = 3;     // 气泡和这一家的名牌、手牌之间留的缝
const CLEAR = 2;   // 和别的东西之间至少留的缝

const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const grow = (a, d) => ({ l: a.l - d, t: a.t - d, r: a.r + d, b: a.b + d });
const union = (a, b) => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });

/** 点 (x, y) 在不在圆角矩形 W×H（圆角半径 R）里面 */
function inRounded(x, y, W, H, R) {
  const cx = x < R ? R : x > W - R ? W - R : x;
  const cy = y < R ? R : y > H - R ? H - R : y;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R + 0.5;
}

/**
 * 算气泡的中心点。
 *   w, h        气泡的宽高（不含缩放动画）
 *   W, H, R     毡面的宽高和圆角半径；edge 是离毡面边缘至少留的像素
 *   plate, hole 说话这一家的名牌、手牌矩形；cx 是毡面中线（判断这一家在左边还是右边）
 *   hard, soft  见文件开头
 * 返回 { x, y, level }：level 0 = 谁都不碰，1 = 只让开了 hard，2 = 实在放不下、挑了重叠最小的
 */
function placeBubble({ w, h, W, H, R, edge, plate, hole, cx, hard, soft }) {
  const u = union(plate, hole);
  const mid = (u.l + u.r) / 2;
  // 外侧 = 远离毡面中线的那一边；正上、正下的两家（自己、对面）外侧算右边
  const outer = mid < cx - 1 ? -1 : 1;
  const beside = (a, dir) => ({ x: dir > 0 ? a.r + GAP + w / 2 : a.l - GAP - w / 2, y: (a.t + a.b) / 2 });
  const above = (dx) => ({ x: dx === 0 ? mid : dx > 0 ? u.r - w / 2 : u.l + w / 2, y: u.t - GAP - h / 2 });
  const below = (dx) => ({ x: dx === 0 ? mid : dx > 0 ? u.r - w / 2 : u.l + w / 2, y: u.b + GAP + h / 2 });
  const corner = (dx, dy) => ({ x: dx > 0 ? u.r + GAP + w / 2 : u.l - GAP - w / 2, y: dy > 0 ? u.b - h / 2 : u.t + h / 2 });
  const cands = [
    beside(plate, outer), beside(plate, -outer), beside(hole, outer), beside(hole, -outer),
    above(0), below(0), above(outer), above(-outer), below(outer), below(-outer),
    corner(outer, -1), corner(outer, 1), corner(-outer, -1), corner(-outer, 1),
  ];
  const lo = (s) => s / 2 + edge;
  const boxes = cands.map((c) => {
    const x = Math.max(lo(w), Math.min(W - lo(w), c.x)), y = Math.max(lo(h), Math.min(H - lo(h), c.y));
    return { x, y, r: { l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 } };
  });
  const inside = (b) => [[b.r.l, b.r.t], [b.r.r, b.r.t], [b.r.l, b.r.b], [b.r.r, b.r.b]].every(([x, y]) => inRounded(x, y, W, H, Math.max(0, R - edge)));
  const hits = (b, list) => list.some((o) => overlap(b.r, grow(o, CLEAR)) > 0);
  const both = hard.concat(soft);
  let pick = boxes.find((b) => inside(b) && !hits(b, both));
  if (pick) return { x: pick.x, y: pick.y, level: 0 };
  pick = boxes.find((b) => inside(b) && !hits(b, hard)) || boxes.find((b) => !hits(b, hard));
  if (pick) return { x: pick.x, y: pick.y, level: 1 };
  let best = boxes[0], bestA = Infinity;
  for (const b of boxes) { const a = hard.reduce((s, o) => s + overlap(b.r, o), 0); if (a < bestA) { bestA = a; best = b; } }
  return { x: best.x, y: best.y, level: 2 };
}

exports.placeBubble = placeBubble;
});
