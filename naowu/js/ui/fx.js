__squidDefine('src/ui/fx.js', function (exports) {
'use strict';
// 答题与训练的反馈动效：星星逐个弹出、评级标签、连击标签跳一下、EV 损失刻度条。
//
// 原则：动效只是把已经算好的结果演出来，这里不算任何新数。
// 星数来自 progress.js 的 starsFor / levelStars 或 season.js 的 summarizeRun，
// 评级与 EV 损失来自 gradeDecision，连击来自 nextCombo——全部由调用方传进来。
// 动画全写在 style.css 里（.go 类触发），系统要求减少动态效果时那边一律关掉动画，元素直接停在终态。
// 刻度条上的三道门槛就是判星用的那一份 STAR_GATES（train/season.js），这里不再另登记。
const { starsFromLoss, STAR_GATES } = __squidRequire('src/train/season.js');
const { h } = __squidRequire('src/ui/dom.js');

/** 刻度条的满格：8% 底池。只是画图的量程，不是任何门槛 */
const EV_SCALE_MAX = 8;

// 星形，和效果图同一个路径
const STAR_PATH = 'M12 1.800l3.100 6.500 7.100.9-5.200 4.900 1.400 7-6.400-3.500-6.400 3.500 1.400-7L1.800 9.200l7.100-.9z';

/**
 * 一排星。on 颗实心（会逐个弹出），total − on 颗空心占位（不动）。
 * total 省略时只画实心的那几颗。根元素带 data-stars，测试拿它和页面别处记录的星数对账。
 */
function starRow(on, { total = on, size = '', animate = true } = {}) {
  const el = h('span', { class: ('stars3 ' + size).trim(), 'data-stars': String(on), role: 'img', 'aria-label': `${on} 星` });
  let html = '';
  for (let i = 0; i < total; i++) {
    html += `<svg class="star ${i < on ? 'on' : 'off'}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
  }
  el.innerHTML = html;
  if (animate && on > 0) play(el);
  return el;
}

/** 重新触发一次 .go 动画（同一个元素再播一遍也行） */
function play(el) {
  el.classList.remove('go');
  void el.offsetWidth;   // 强制回流，动画才会从头播
  el.classList.add('go');
  return el;
}

/** 圆角标签：评级（class 用评级名，配色沿用 .grade）或连击 */
function pill(text, cls, animate = true) {
  const el = h('span', { class: 'pill ' + cls }, text);
  if (animate) play(el);
  return el;
}

/**
 * EV 损失刻度条。横轴 = EV 损失占底池的百分比，0 到 EV_SCALE_MAX，按真实比例画；
 * 三道竖线是关卡星级门槛。填充长度 = 这次的损失，越长越差，颜色按它落在哪一档。
 * drawFill 为 false（无法判分、差距落在噪声里）时只画刻度、不画填充，原因写在说明里。
 */
function evScale(lossPct, { drawFill = true, why = '' } = {}) {
  const ok = drawFill && Number.isFinite(lossPct);
  const fillPct = ok ? Math.min(100, Math.max(0, lossPct) / EV_SCALE_MAX * 100) : 0;
  const bar = h('div', { class: 'evbar' });
  if (ok) bar.append(h('div', { class: 'fill s' + starsFromLoss(lossPct), style: { width: fillPct + '%' } }));
  const ticks = h('div', { class: 'evticks' });
  for (const g of STAR_GATES) {
    const left = g.pct / EV_SCALE_MAX * 100 + '%';
    bar.append(h('i', { class: 'gate', style: { left } }));
    ticks.append(h('span', { style: { left } }, g.pct + '%'));
  }
  ticks.append(h('span', { class: 'end' }, EV_SCALE_MAX + '%'));
  const over = ok && lossPct > EV_SCALE_MAX;
  const cap = !ok ? why
    : `刻度按真实比例：0~${EV_SCALE_MAX}% 底池，竖线是关卡星级的三道门槛（平均损失 ≤${STAR_GATES.map((g) => g.pct + '% ' + g.name).join('、≤')}）。`
      + (over ? `这次损失超过 ${EV_SCALE_MAX}%，条画满了。` : '');
  const root = h('div', { class: 'evscale', 'data-loss-pct': ok ? String(lossPct) : '', 'data-fill-pct': String(fillPct) },
    bar, ticks, cap ? h('div', { class: 'small muted' }, cap) : null);
  if (ok) play(root);
  return root;
}

exports.starRow = starRow;
exports.play = play;
exports.pill = pill;
exports.evScale = evScale;
exports.EV_SCALE_MAX = EV_SCALE_MAX;
});
