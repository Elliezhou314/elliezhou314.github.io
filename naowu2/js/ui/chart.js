__squidDefine('src/ui/chart.js', function (exports) {
'use strict';
// 小型 SVG 折线图：一把纵向比例尺、一把横向比例尺，点、刻度、水平参考线（星级门槛、个人最好）和标签全部按它们放。
//
// 不算任何数：点的数值、明细文字、参考线的位置全由调用方从汇总结果（train/notebook.js）传进来，
// 图下面的「看数据表」用的是同一份结果。这里只负责摆放：
//   - 纵轴从 0 起、按真实比例；调用方给出 yMax（封顶），超出的点由调用方标 capped，画在顶上并写出真实数值。
//   - 横轴刻度标签按像素宽度估算后抽稀，互不压住；靠两头的标签改锚点，不出画布。
//   - 参考线的标签放在右端线的上方，挨得太近时往上让开。
//   - 每个点可以悬停或点按看明细（明细显示在图下方的一行里，也写进 <title>）。
// 宽度按容器实际宽度画（ResizeObserver 量，和牌桌同一个做法），375 像素宽的手机上照样缩得下，不靠整体缩放把字缩小。
// 颜色只用 style.css 里的变量（类名在 .chart 下定义）；动效只是淡入，系统要求减少动态效果时由样式表关掉。
// 测试用的数据属性：svg 上 data-y0 / data-ytop / data-ymax（纵向比例尺），每个点 data-value / data-shown，
// 每条参考线 data-value，每个纵轴刻度 data-v。tools/uicheck.mjs 从刻度反推比例尺，再核对点和参考线的位置。
const { h } = __squidRequire('src/ui/dom.js');

const NS = 'http://www.w3.org/2000/svg';
const DEFAULT_W = 640;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

/** 估一段标签的像素宽度：中文按一个字宽，数字和符号按 0.6 个字宽 */
function textWidth(s, fontPx) {
  let w = 0;
  for (const ch of String(s)) w += /[\u0000-ÿ]/.test(ch) ? fontPx * 0.62 : fontPx;
  return w;
}

const STEPS = [1, 2, 3, 5, 7, 10, 14, 20, 30, 50, 100, 200, 500, 1000];

/**
 * 画一张折线图，返回容器元素。
 * opts:
 *   points  [{ x, shown, value, hollow, capped, capLabel, detail: [行], key }]，x 是整数（第几天 / 第几局），按 x 排好
 *   xLabel  (x) => 刻度文字；xTitle 横轴说明（含单位）
 *   yMax、yStep、yUnit（刻度后缀，如 '%'）、yTitle 纵轴说明（含单位）
 *   hlines  [{ value, label, cls }]：水平参考线
 *   vlines  [{ x, label }]：竖线，画在 x 和 x−1 两个点正中间（牌局回放用它标换街）
 *   onPick  (p) => …：点按一个点时额外做的事（牌局回放里跳到那一步）
 *   cls     容器的附加类名；height 画布高度
 */
function lineChart(opts) {
  const wrap = h('div', { class: 'chart ' + (opts.cls || '') });
  const holder = h('div', { class: 'chartsvg' });
  const detail = h('div', { class: 'chartdetail small', 'aria-live': 'polite' }, opts.hint || '悬停或点按一个点看明细。');
  wrap.append(holder, detail);
  let drawnW = 0;
  const draw = (w) => {
    const W = Math.max(260, Math.round(w || DEFAULT_W));
    if (Math.abs(W - drawnW) < 1) return;
    drawnW = W;
    holder.innerHTML = '';
    holder.append(render(opts, W, detail));
  };
  draw(DEFAULT_W);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (holder.clientWidth > 0) draw(holder.clientWidth); });
    ro.observe(holder);
  }
  return wrap;
}

function render(opts, W, detailEl) {
  const narrow = W < 480;
  const font = narrow ? 10 : 11;
  const H = opts.height || (narrow ? 230 : 260);
  const yLabels = [];
  for (let v = 0; v <= opts.yMax + 1e-9; v += opts.yStep) yLabels.push(Math.round(v * 1000) / 1000);
  const padL = Math.ceil(Math.max(...yLabels.map((v) => textWidth(v + (opts.yUnit || ''), font)))) + 10;
  const padR = 10, padT = 24, padB = 38;
  const x0 = padL, x1 = W - padR, yTop = padT, yBot = H - padB;
  const pts = opts.points || [];
  const xs = pts.map((p) => p.x);
  const dMin = (xs.length ? Math.min(...xs) : 0) - 0.5, dMax = (xs.length ? Math.max(...xs) : 1) + 0.5;
  // 比例尺：整张图只有这两把，点、刻度、参考线都经过它们
  const sx = (x) => x0 + ((x - dMin) / (dMax - dMin)) * (x1 - x0);
  const sy = (v) => yBot - (v / opts.yMax) * (yBot - yTop);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel || opts.yTitle || '',
    'data-y0': sy(0), 'data-ytop': sy(opts.yMax), 'data-ymax': opts.yMax, 'font-size': font });

  // 纵轴：网格线与刻度
  for (const v of yLabels) {
    const y = sy(v);
    svg.append(el('line', { class: 'ygrid', x1: x0, x2: x1, y1: y, y2: y, 'data-v': v }));
    svg.append(el('text', { class: 'ytick', x: x0 - 6, y: y + font * 0.35, 'text-anchor': 'end', 'data-v': v }, v + (opts.yUnit || '')));
  }
  svg.append(el('text', { class: 'atitle', x: 2, y: font + 2 }, opts.yTitle || ''));

  // 横轴：刻度按像素宽度抽稀，标签不互相压住
  const cand = [];
  for (let x = Math.ceil(dMin); x <= Math.floor(dMax); x++) cand.push(x);
  const maxLabelW = Math.max(10, ...cand.map((x) => textWidth(opts.xLabel(x), font)));
  const unit = (x1 - x0) / (dMax - dMin);
  const step = STEPS.find((k) => k * unit >= maxLabelW + 8) || STEPS[STEPS.length - 1];
  const first = cand.length ? cand[0] : 0;
  let lastRight = -Infinity;
  for (const x of cand) {
    if ((x - first) % step) continue;
    const px = sx(x), label = opts.xLabel(x), w = textWidth(label, font);
    let anchor = 'middle', left = px - w / 2;
    if (left < 0) { anchor = 'start'; left = px - 2; }
    if (left + w > W) { anchor = 'end'; left = px - w; }
    if (left < lastRight + 4) continue;   // 兜底：真挨上了就跳过这一个
    lastRight = left + w;
    svg.append(el('line', { class: 'xtickmark', x1: px, x2: px, y1: yBot, y2: yBot + 4 }));
    svg.append(el('text', { class: 'xtick', x: anchor === 'start' ? px - 2 : px, y: yBot + 6 + font, 'text-anchor': anchor }, label));
  }
  svg.append(el('line', { class: 'axis', x1: x0, x2: x1, y1: yBot, y2: yBot }));
  // 竖线（牌局回放里标换街）：画在这个点和前一个点的正中间，标签写在图顶上，挨上了就跳过标签（线照画）
  let vRight = -Infinity;
  for (const v of opts.vlines || []) {
    const px = sx(v.x - 0.5);
    svg.append(el('line', { class: 'vline', x1: px, x2: px, y1: yTop, y2: yBot, 'data-x': v.x }));
    const w = textWidth(v.label, font);
    if (px + 2 > vRight + 4 && px + 2 + w <= W) { svg.append(el('text', { class: 'vlabel', x: px + 2, y: yTop - 4 }, v.label)); vRight = px + 2 + w; }
  }
  svg.append(el('text', { class: 'atitle', x: (x0 + x1) / 2, y: H - 4, 'text-anchor': 'middle' }, opts.xTitle || ''));

  // 参考线：标签在线的上方，挨得太近时往上让开（从下往上排）；默认放右端，右端压住了数据点就挪到左端
  const hl = (opts.hlines || []).filter((l) => l.value >= 0 && l.value <= opts.yMax).sort((a, b) => a.value - b.value);
  const ptXY = pts.map((p) => [sx(p.x), sy(p.shown)]);
  const hitsPoint = (left, right, top, bottom) => ptXY.some(([px, py]) => px > left - 6 && px < right + 6 && py > top - 6 && py < bottom + 6);
  let lastLabelY = Infinity;
  for (const l of hl) {
    const y = sy(l.value);
    svg.append(el('line', { class: 'hline ' + (l.cls || ''), x1: x0, x2: x1, y1: y, y2: y, 'data-value': l.value }));
    let ty = y - 3;
    if (ty > lastLabelY - font - 1) ty = lastLabelY - font - 1;
    lastLabelY = ty;
    const w = textWidth(l.label, font);
    const atLeft = hitsPoint(x1 - 2 - w, x1 - 2, ty - font, ty) && !hitsPoint(x0 + 2, x0 + 2 + w, ty - font, ty);
    svg.append(el('text', { class: 'hlabel ' + (l.cls || ''), x: atLeft ? x0 + 2 : x1 - 2, y: ty, 'text-anchor': atLeft ? 'start' : 'end' }, l.label));
  }

  // 折线与点
  if (pts.length > 1) svg.append(el('polyline', { class: 'trend', points: pts.map((p) => `${sx(p.x)},${sy(p.shown)}`).join(' ') }));
  const show = (g, p) => {
    svg.querySelectorAll('.pt.on').forEach((e) => e.classList.remove('on'));
    g.classList.add('on');
    detailEl.textContent = p.detail.join('　');
  };
  for (const p of pts) {
    const cx = sx(p.x), cy = sy(p.shown);
    const g = el('g', { class: 'pt' + (p.hollow ? ' hollow' : '') + (p.capped ? ' capped' : ''), tabindex: 0, 'data-x': p.x, 'data-value': p.value, 'data-shown': p.shown, 'data-key': p.key });
    g.append(el('title', {}, p.detail.join('；')));
    if (p.capped) g.append(el('path', { class: 'mark', d: `M${cx - 6} ${cy + 5}L${cx} ${cy - 6}L${cx + 6} ${cy + 5}Z`, 'data-cy': cy }));
    g.append(el('circle', { class: 'dot', cx, cy, r: p.capped ? 2 : 4.5 }));
    g.append(el('circle', { class: 'hit', cx, cy, r: 13 }));
    if (p.capped && p.capLabel) {
      const right = cx + 8 + textWidth(p.capLabel, font) < W;
      g.append(el('text', { class: 'caplabel', x: right ? cx + 8 : cx - 8, y: cy + font + 4, 'text-anchor': right ? 'start' : 'end' }, p.capLabel));
    }
    g.addEventListener('mouseenter', () => show(g, p));
    g.addEventListener('click', () => { show(g, p); if (opts.onPick) opts.onPick(p); });
    g.addEventListener('focus', () => show(g, p));
    svg.append(g);
  }
  return svg;
}

/** 「看数据表」：把图上每个点列成表。rows 与图用的是同一份汇总结果 */
function dataTable(head, rows, cls = '') {
  return h('details', { class: 'charttbl ' + cls },
    h('summary', {}, '看数据表'),
    h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('tr', {}, head.map((t) => h('th', {}, t))),
      rows.map((r) => h('tr', {}, r.map((c) => h('td', { class: 'mono' }, c)))))));
}

exports.lineChart = lineChart;
exports.dataTable = dataTable;
});
