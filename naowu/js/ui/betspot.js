__squidDefine('src/ui/betspot.js', function (exports) {
'use strict';
// 下注筹码摆在哪：纯几何，不碰页面（牌桌组件 table.js 量好各块的矩形交给它）。
//
// 原来的摆法（v0.14.2 及以前）：从桌心朝这一家的方向顺时针偏 22 度，横向走毡面宽度的 25%（窄桌）/ 27%，纵向走高度的 24% / 25%。
// 电脑宽度下这个点从来不压东西；手机 375 宽 5、6 人桌上，右下、左下那几家的点正好落在名牌上。
// 现在的办法：先照原来的算法得到「想摆的点」，标签按实际会出现的最长一档（筹码 5 枚 +「599.5」）算大小——
//   - 这个点上谁都不压（名牌按后手最长一档留宽、手牌、公共牌五张的位置、底池按最长一档、庄家按钮、别家的下注），
//     而且在这一家和桌心之间、整个在毡面圆角以内：原样不动；
//   - 否则从这个点往外一圈一圈找（每圈 2 像素），找离原来的点最近、同样谁都不压、仍在这一家和桌心之间的位置，
//     同一圈里先试朝桌心的方向。先摆不用动的，再按座位顺序摆要挪的，后摆的让开先摆的。
// 这样没问题的座位一个像素都不动，有问题的只挪到刚好不压为止。
// 矩形一律是 { l, t, r, b }，坐标原点是毡面左上角。

const GAP = 2;          // 和别的东西之间至少留的缝
const STEP = 2;         // 往外找时每圈多走的像素
const MAX_ANGLE = 50;   // 下注方向和这一家方向最多差多少度（看得出是谁下的）

const hits = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0;
const grow = (a, d) => ({ l: a.l - d, t: a.t - d, r: a.r + d, b: a.b + d });

/** 点 (x, y) 在不在圆角矩形 W×H（圆角半径 R）里面 */
function inRounded(x, y, W, H, R) {
  const cx = x < R ? R : x > W - R ? W - R : x;
  const cy = y < R ? R : y > H - R ? H - R : y;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R + 0.5;
}

/**
 * 算每一家下注标签的中心点。
 *   W, H, R, edge  毡面的宽高、圆角半径，离毡面边缘至少留的像素
 *   cx, cy         桌心
 *   box            标签按最长一档算的宽高 { w, h }
 *   want           每一家原来的摆法算出的点 [{ x, y }]
 *   seats          每一家座位（名牌加手牌）的中心 [{ x, y }]
 *   hard           不能压的东西（矩形数组）
 * 返回 [{ x, y, moved, box }]：moved 为真表示离开了原来的点；box 是这一家下注标签占的矩形。
 */
function placeBets({ W, H, R, edge, cx, cy, box, want, seats, hard }) {
  const hw = box.w / 2, hh = box.h / 2;
  const rectAt = (p) => ({ l: p.x - hw, t: p.y - hh, r: p.x + hw, b: p.y + hh });
  const clampIn = (p) => ({ x: Math.max(hw + edge, Math.min(W - hw - edge, p.x)), y: Math.max(hh + edge, Math.min(H - hh - edge, p.y)) });
  const blocks = hard.map((r) => grow(r, GAP));
  const rr = Math.max(0, R - edge);
  const inside = (r) => [[r.l, r.t], [r.r, r.t], [r.l, r.b], [r.r, r.b]].every(([x, y]) => x >= edge && x <= W - edge && y >= edge && y <= H - edge && inRounded(x, y, W, H, rr));
  /** 在这一家和桌心之间：离桌心比这一家近，方向差不到 MAX_ANGLE 度 */
  const between = (p, i) => {
    const sx = seats[i].x - cx, sy = seats[i].y - cy, bx = p.x - cx, by = p.y - cy;
    const ds = Math.hypot(sx, sy), db = Math.hypot(bx, by);
    if (!(db < ds)) return false;
    return db < 1 || (sx * bx + sy * by) / (ds * db) >= Math.cos((MAX_ANGLE * Math.PI) / 180);
  };
  const free = (p, i, taken) => {
    const r = rectAt(p);
    return inside(r) && between(p, i) && !blocks.some((o) => hits(r, o)) && !taken.some((o) => hits(r, grow(o, GAP)));
  };
  const n = want.length;
  const base = want.map(clampIn);
  const out = new Array(n);
  const taken = [];
  // 1) 原来的点就没问题的，原样不动
  for (let i = 0; i < n; i++) {
    if (free(base[i], i, taken)) { out[i] = { x: base[i].x, y: base[i].y, moved: false }; taken.push(rectAt(base[i])); }
  }
  // 2) 有问题的：从原来的点往外一圈一圈找最近的空位，同一圈里先试朝桌心的方向
  const maxR = Math.hypot(W, H) / 2;
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    const b = base[i];
    const a0 = Math.atan2(cy - b.y, cx - b.x);
    let pick = null;
    for (let r = STEP; r <= maxR && !pick; r += STEP) {
      const k = Math.max(12, Math.ceil((2 * Math.PI * r) / 2));
      for (let j = 0; j < k && !pick; j++) {
        // 0, +1, -1, +2, -2 …：从朝桌心的方向往两边摆开
        const step = j % 2 ? (j + 1) / 2 : -j / 2;
        const a = a0 + (step * 2 * Math.PI) / k;
        const p = { x: b.x + r * Math.cos(a), y: b.y + r * Math.sin(a) };
        if (free(p, i, taken)) pick = p;
      }
    }
    const p = pick || b;   // 实在找不到就留在原处（几何检查会报出来）
    out[i] = { x: p.x, y: p.y, moved: !!pick };
    taken.push(rectAt(p));
  }
  return out.map((p) => ({ ...p, box: rectAt(p) }));
}

exports.placeBets = placeBets;
});
