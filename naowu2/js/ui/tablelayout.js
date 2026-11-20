__squidDefine('src/ui/tablelayout.js', function (exports) {
'use strict';
// 牌桌组件（table.js）的「位置」那一块：量牌桌能用多大，算出毡面大小、牌的尺寸和每个元素的位置（全部是像素）。
// 从 table.js 拆出来（v0.16，table.js 到 450 行上限了）。只写尺寸和 left/top，不碰牌局数据。
//
// 尺寸（v0.16 起）：牌桌放在自由牌局的「舞台」里，舞台的宽和高都是定的（页面一屏放下，见 viewport.js）。
// 毡面先按人数取设计比例（竖着的窄桌 / 横着的宽桌），宽度放不下就按宽度，高度放不下就按高度缩；
// 窄桌（手机）高度不够时不再等比缩小——名牌和字不能跟着缩到看不清，所以宽度照用满、毡面变扁一些，座位的椭圆跟着变扁。
// 宽桌（电脑、平板横屏）最多比设计比例扁 20%，再扁就整张桌子等比缩小，两边留出来的地方给本手记录。
const { placeBets } = __squidRequire('src/ui/betspot.js');
const { centerIn, holeRect, rectOf } = __squidRequire('src/ui/feltrect.js');

const NARROW = 560;   // 毡面宽度低于这个像素就换竖椭圆布局、收起位置名
const EDGE = 4;       // 座位、筹码离毡面边缘至少留这么多像素
const SQUAT = 0.8;           // 宽桌高度不够时最多压扁到设计比例的几成
const MAXW = 1080;           // 电脑大屏上毡面最宽这么多像素（再宽牌和字也不会再大，只会更空）

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const px = (v) => Math.round(v) + 'px';

/** 毡面要多大：W0、H0 是牌桌这块能用的宽高（H0 为 0 表示高度不限，按宽度定） */
function feltSize(W0, H0, n) {
  // tall：竖椭圆的摆法（手机竖屏、平板竖屏）——牌桌能用的地方比宽高 0.9 还高，或者本来就窄
  let tall = W0 < NARROW || (H0 > 0 && H0 >= W0 * 0.9);
  const pad = Math.round(clamp(W0 * (W0 < NARROW ? 0.026 : 0.021), 6, 18));
  let W = Math.min(W0 - 2 * pad, MAXW);
  const ratio = () => (tall ? (n >= 5 ? 1.3 : 1.12) : (n >= 5 ? 0.62 : 0.5625));
  let H = W * ratio();
  if (H0 > 0 && H + 2 * pad > H0) {
    const Hmax = H0 - 2 * pad;
    if (!tall) {
      W = Math.min(W, Hmax / (ratio() * SQUAT));
      tall = W + 2 * pad < NARROW;
      H = Math.min(W * ratio(), Hmax);
    } else H = Hmax;
  }
  // 牌和字的大小按「没压扁时的等效宽度」算：毡面变扁了，牌也跟着小一点，免得上下挤在一起
  const Weff = Math.min(W, H / ratio());
  return { W: Math.round(W), H: Math.round(H), pad, tall, narrow: W + 2 * pad < NARROW, Weff, squash: H / (W * ratio()) };
}

/**
 * 量一次、摆一次。c 是 table.js 里的那几块：root、rail、felt、mark、boardEl、potEl、dbtn、probe，T（座位、上一画面），placeSay(i)。
 */
function layoutTable(c) {
  const { root, rail, felt, mark, boardEl, potEl, dbtn, probe, T } = c;
  const W0 = root.clientWidth;
  if (!W0) return;   // 视图没显示（display:none）时量不到，等显示出来 ResizeObserver 会再叫一次
  const n = T.seats.length || 3;
  const fitH = root.classList.contains('fit') ? root.clientHeight : 0;
  const { W, H, pad, tall, narrow, Weff, squash } = feltSize(W0, fitH, n);
  root.classList.toggle('narrow', narrow);
  root.dataset.shape = tall ? 'tall' : 'wide';
  root.dataset.squash = squash.toFixed(2);
  rail.style.padding = pad + 'px';
  rail.style.width = px(W + 2 * pad);
  // 圆角照原来的比例（窄桌宽的 30%、宽桌 24%），毡面压扁了就不超过高度的 45%，免得变成两头尖的橄榄
  const radius = Math.round(Math.min(W * (tall ? 0.3 : 0.24), H * 0.45));
  rail.style.borderRadius = (radius + pad) + 'px';
  felt.style.height = H + 'px';
  felt.style.borderRadius = radius + 'px';
  // 牌宽：公共牌 --cw、对手 --cwo、自己 --cwh（自己的最大）。窄桌上按比例放大一点，不然手机上自己的牌只有指甲盖大
  root.style.setProperty('--cw', px(clamp(Weff * (tall ? 0.072 : 0.06), 22, 54)));
  root.style.setProperty('--cwo', px(clamp(Weff * (tall ? 0.056 : 0.046), 18, 42)));
  root.style.setProperty('--cwh', px(clamp(Weff * (tall ? 0.1 : 0.07), 26, 62)));
  // 字号：电脑上照旧（宽的 1.5%，11～14 像素）；平板竖着放（竖椭圆、毡面又宽）时按比例放大一点，不然名牌小得和手机一样
  felt.style.fontSize = px(tall && !narrow ? clamp(Weff * 0.022, 11, 15) : clamp(W * 0.015, 11, 14));
  // 后手数字的格子按最长一档「599.5」留宽（--stkw，量尺是 probe 里的样板）：名牌宽度不随后手数字变，座位和下注的位置也就不随后手变（v0.14.4）
  root.style.setProperty('--stkw', probe.children[2].getBoundingClientRect().width + 'px');

  const place = (e, x, y) => {
    const w = e.offsetWidth, h = e.offsetHeight;
    e.style.left = px(clamp(x, w / 2 + EDGE, W - w / 2 - EDGE));
    e.style.top = px(clamp(y, h / 2 + EDGE, H - h / 2 - EDGE));
  };
  const cx = W / 2, cy = H / 2;
  const resized = T.size !== W + 'x' + H;
  T.size = W + 'x' + H;
  place(mark, cx, H * 0.29);
  place(boardEl, cx, H * (tall ? 0.44 : 0.46));
  place(potEl, cx, H * (tall ? 0.57 : 0.62));
  const last = T.last;
  if (!last) return;
  const hero = last.hero || 0;
  // 座位：自己在正下方；其余按座位号顺时针等分椭圆（屏幕坐标 y 朝下，角度增大即顺时针）
  // 竖着的窄桌 4 人时，左右两家正好在桌心那一排，名牌会压到公共牌（v0.15 在 375 宽就是这样，v0.16 的检查查出来的）：这两家往下挪 30 度
  const ang = (i) => { const k = (i - hero + n) % n; const deg = tall && n === 4 && k % 2 === 1 ? (k === 1 ? 150 : 30) : 90 + k * 360 / n; return (deg * Math.PI) / 180; };
  const rx = W * (tall ? 0.36 : 0.4), ry = H * (tall ? 0.4 : 0.37);
  const bx = W * (tall ? 0.25 : 0.27), by = H * (tall ? 0.24 : 0.25);
  const f = felt.getBoundingClientRect();
  const [pb, pp] = probe.children;
  const pc = centerIn(potEl, felt);
  // v0.16：毡面压扁以后（一屏放下），椭圆上的点可能让名牌压到公共牌、底池（按最长一档「本手底池 599.5」算），
  // 或者压到牌桌两角的「桌子」「记录」按钮（它们在毡面圆角外的空处，但牌桌很扁时座位会探过去）。
  // 压到了就沿椭圆左右挪几度、或者往里往外一点点试，挑第一个谁都不压的；不压东西的座位原样不动。只用尺寸算，不读页面，不会来回重排
  const grow2 = (r) => ({ l: r.l - 2, t: r.t - 2, r: r.r + 2, b: r.b + 2 });
  const block = [grow2(rectOf(boardEl, f)), grow2({ l: pc.x - pp.offsetWidth / 2, t: pc.y - pp.offsetHeight / 2, r: pc.x + pp.offsetWidth / 2, b: pc.y + pp.offsetHeight / 2 })];
  const host = root.parentElement;
  if (host) for (const b of host.querySelectorAll(':scope > .tblbtn')) { const r = b.getBoundingClientRect(); if (r.width) block.push(grow2({ l: r.left - f.left, t: r.top - f.top, r: r.right - f.left, b: r.bottom - f.top })); }
  const boxAt = (s, x, y) => { const w = s.el.offsetWidth, h = s.el.offsetHeight;
    const X = clamp(x, w / 2 + EDGE, W - w / 2 - EDGE), Y = clamp(y, h / 2 + EDGE, H - h / 2 - EDGE); return { x: X, y: Y, r: { l: X - w / 2, t: Y - h / 2, r: X + w / 2, b: Y + h / 2 } }; };
  const ovl = (r, list) => list.reduce((a, o) => a + Math.max(0, Math.min(r.r, o.r) - Math.max(r.l, o.l)) * Math.max(0, Math.min(r.b, o.b) - Math.max(r.t, o.t)), 0);
  const clash = (r, list) => ovl(r, list) > 0;
  const seatAng = T.seats.map((s, i) => ang(i));
  const taken = [];
  // 空桌（回放完、之前没开过桌或放弃了这一手）没有座位：什么都不摆（v0.16 第一次全量回归时这里在空桌上抛过异常，uicheck「全程无运行时异常」抓到的）
  const heroBox = T.seats[hero] ? boxAt(T.seats[hero], cx, H - T.seats[hero].el.offsetHeight / 2 - EDGE) : null;
  if (heroBox) { place(T.seats[hero].el, heroBox.x, heroBox.y); taken.push(heroBox.r); }
  for (let k = 1; k < T.seats.length; k++) {
    const i = (hero + k) % n, s = T.seats[i], a0 = seatAng[i];
    let pick = boxAt(s, cx + rx * Math.cos(a0), cy + ry * Math.sin(a0));
    if (clash(pick.r, block) || clash(pick.r, taken)) {
      // 找不到完全不压的就挑压得最少的（再挤也比原地压着强）
      let best = { o: ovl(pick.r, block) + ovl(pick.r, taken), b: pick, a: a0 };
      outer: for (const sc of [1, 0.94, 1.06, 0.88, 1.12, 0.82]) for (const dd of [6, -6, 12, -12, 18, -18, 24, -24, 30, -30, 36, -36]) {
        const a = a0 + (dd * Math.PI) / 180, b = boxAt(s, cx + rx * sc * Math.cos(a), cy + ry * sc * Math.sin(a));
        const o = ovl(b.r, block) + ovl(b.r, taken);
        if (o < best.o) best = { o, b, a };
        if (o === 0) break outer;
      }
      pick = best.b; seatAng[i] = best.a;
    }
    place(s.el, pick.x, pick.y); taken.push(pick.r);
  }
  // 庄家按钮在座位朝桌心那一侧、偏前一点。v0.16：毡面压扁以后（手机一屏放下）这个点可能压到名牌、手牌、公共牌，
  // 压到了就在附近换几个角度和远近试，挑第一个谁都不压的；原来的点不压东西时原样不动
  if (last.button >= 0 && last.button < n) {
    dbtn.hidden = false;
    const block = [rectOf(boardEl, f), { l: pc.x - pp.offsetWidth / 2, t: pc.y - pp.offsetHeight / 2, r: pc.x + pp.offsetWidth / 2, b: pc.y + pp.offsetHeight / 2 }];
    T.seats.forEach((s) => block.push(rectOf(s.plate, f), holeRect(s.hole, f)));
    const dw = dbtn.offsetWidth, dh = dbtn.offsetHeight;
    const at = (da, k) => { const a = seatAng[last.button] - (da * Math.PI) / 180;
      return { x: clamp(cx + bx * 1.05 * k * Math.cos(a), dw / 2 + EDGE, W - dw / 2 - EDGE), y: clamp(cy + by * 1.1 * k * Math.sin(a), dh / 2 + EDGE, H - dh / 2 - EDGE) }; };
    const free = (p) => block.every((r) => Math.min(r.r, p.x + dw / 2 + 2) - Math.max(r.l, p.x - dw / 2 - 2) <= 0 || Math.min(r.b, p.y + dh / 2 + 2) - Math.max(r.t, p.y - dh / 2 - 2) <= 0);
    let spot = at(24, 1);
    if (!free(spot)) {
      outer: for (const k of [1, 0.85, 1.15, 0.7, 1.3, 0.55]) for (const da of [24, 12, 36, 0, 48, -12, 60, -24]) { const p = at(da, k); if (free(p)) { spot = p; break outer; } }
    }
    dbtn.style.left = px(spot.x); dbtn.style.top = px(spot.y);
  } else dbtn.hidden = true;
  // 下注：先照原来的算法得到想摆的点（座位和桌心之间、偏后一点），再交给 betspot.js 让开名牌、手牌、公共牌五张的位置、底池、庄家按钮
  // 和别家的下注（标签、底池、后手都按最长一档「599.5」量，量尺是 probe 里那几块看不见的样板）。没问题的座位原样不动
  const hard = [rectOf(boardEl, f), { l: pc.x - pp.offsetWidth / 2, t: pc.y - pp.offsetHeight / 2, r: pc.x + pp.offsetWidth / 2, b: pc.y + pp.offsetHeight / 2 }];
  if (!dbtn.hidden) hard.push(rectOf(dbtn, f));
  const seatsC = T.seats.map((s) => {
    hard.push(rectOf(s.plate, f), holeRect(s.hole, f));
    return centerIn(s.el, felt);
  });
  const want = T.seats.map((s, i) => { const ab = seatAng[i] + (22 * Math.PI) / 180; return { x: cx + bx * Math.cos(ab), y: cy + by * Math.sin(ab) }; });
  const spots = placeBets({ W, H, R: parseFloat(felt.style.borderRadius) || 0, edge: EDGE, cx, cy, box: { w: pb.offsetWidth, h: pb.offsetHeight }, want, seats: seatsC, hard });
  T.seats.forEach((s, i) => {
    s.betAt = { x: Math.round(spots[i].x), y: Math.round(spots[i].y) };
    s.betBox = spots[i].box;
    s.bet.style.left = s.betAt.x + 'px'; s.bet.style.top = s.betAt.y + 'px';
  });
  // 牌桌大小变了（转屏、拉窗口）：亮着的气泡跟着重新找位置。大小没变就不动它，免得气泡亮着的时候跳一下
  // 收着的气泡（透明）也挪回左上角：它们还停在旧尺寸下的位置的话，牌桌变窄后会伸出页面右边、让手机上整页能横向滚动
  if (resized) T.seats.forEach((s, i) => { if (s.say.classList.contains('on')) c.placeSay(i); else { s.say.style.left = '0px'; s.say.style.top = '0px'; } });
}

exports.feltSize = feltSize;
exports.layoutTable = layoutTable;
exports.NARROW = NARROW;
exports.EDGE = EDGE;
});
