__squidDefine('src/ui/mobilenav.js', function (exports) {
'use strict';
// 手机布局的底部导航（屏幕宽度不超过 700 像素时由 style.css 显示；电脑宽度下整块不出现）。
//
// 页面清单只有一个来源：index.html 里顶栏的导航按钮（data-view 和文字）。这里不再抄一份页面列表，
// 只配「哪四个放在底栏、短名字叫什么、图标长什么样」，其余页面自动收进「更多」面板。
// 切页面一律走 router.js 的 switchView，和点顶栏按钮是同一条路径（关卡打到一半切走的确认也照常弹）。
const { h } = __squidRequire('src/ui/dom.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { soundButton } = __squidRequire('src/ui/settings.js');

// 底栏上的四个主格（顺序即显示顺序）；第五格固定是「更多」
const PRIMARY = [
  { view: 'campaign', short: '闯关' },
  { view: 'contest', short: '竞赛' },
  { view: 'drill', short: '特训' },
  { view: 'play', short: '牌局' },
];

// 线条图标（24×24，描边，不填充），前五个照效果图
const ICONS = {
  campaign: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  contest: '<path d="M17 5H7l6 7-6 7h10"/>',
  drill: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  play: '<rect x="4" y="6" width="10" height="14" rx="2"/><path d="M10 4h8a2 2 0 0 1 2 2v12"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  lab: '<path d="M9 3h6M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>',
  solver: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  review: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 12.5l2-2 1.5 1.5 2-2.5"/>',
  preflop: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  help: '<path d="M15.5 4c-2 0-2.6 1.4-3 4l-1.4 8.5c-.4 2.4-1 3.5-3 3.5"/><path d="M8.5 11h7"/>',
  speed: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 3h4M12 3v3M18.5 6.5l1.5-1.5"/>',
};

const icon = (name) => {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.more}</svg>`;
  return s;
};

const state = { tabs: [], moreBtn: null, sheet: null, mask: null, moreViews: new Set() };

function openSheet(open) {
  state.sheet.classList.toggle('open', open);
  state.mask.classList.toggle('open', open);
  state.moreBtn.setAttribute('aria-expanded', String(open));
}

function go(view) {
  openSheet(false);
  switchView(view);
}

/** 当前页面在底栏上高亮；当前页面收在「更多」里时，「更多」高亮 */
function markMobileNav(name) {
  for (const b of state.tabs) b.classList.toggle('on', b.dataset.view === name);
  if (state.moreBtn) state.moreBtn.classList.toggle('on', state.moreViews.has(name));
  if (state.sheet) for (const b of state.sheet.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === name);
}

/** 读顶栏导航，造出底栏和「更多」面板，挂到 body 上 */
function mountMobileNav(current) {
  const pages = [...document.querySelectorAll('#nav button[data-view]')].map((b) => ({ view: b.dataset.view, name: b.textContent.trim() }));
  const known = new Set(pages.map((p) => p.view));
  const bar = h('nav', { class: 'tabbar', 'aria-label': '页面导航' });
  for (const p of PRIMARY) {
    if (!known.has(p.view)) continue;   // 配置表里写了、顶栏上没有的页面不画
    const full = pages.find((x) => x.view === p.view).name;
    const b = h('button', { 'data-view': p.view, 'aria-label': full, onclick: () => go(p.view) }, icon(p.view), h('span', {}, p.short));
    state.tabs.push(b);
    bar.append(b);
  }
  const primary = new Set(PRIMARY.map((p) => p.view));
  const rest = pages.filter((p) => !primary.has(p.view));
  rest.forEach((p) => state.moreViews.add(p.view));
  state.moreBtn = h('button', { class: 'more', 'aria-expanded': 'false', 'aria-haspopup': 'true',
    onclick: () => openSheet(!state.sheet.classList.contains('open')) }, icon('more'), h('span', {}, '更多'));
  bar.append(state.moreBtn);

  state.mask = h('div', { class: 'sheetmask', onclick: () => openSheet(false) });
  state.sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': '更多页面' },
    h('div', { class: 'grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheetgrid' }, rest.map((p) => h('button', { 'data-view': p.view, onclick: () => go(p.view) }, icon(p.view), h('span', {}, p.name)))),
    h('div', { class: 'sheetfoot' }, soundButton()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
  document.body.append(state.mask, state.sheet, bar);
  markMobileNav(current);
}

exports.markMobileNav = markMobileNav;
exports.mountMobileNav = mountMobileNav;
});
