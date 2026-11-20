__squidDefine('src/ui/play/shell.js', function (exports) {
'use strict';
// 自由牌局页面的骨架（v0.16「一屏放下」）：只搭架子、管几块的开关，不碰牌局。
//
//   .playwrap   占满一屏剩下的高度（--playh，viewport.js 量出来的），页面本身不上下滚
//     .playstage  牌桌（按剩下的高度缩放）；左上角「桌子」、右上角「记录」两个小按钮；
//                 「桌子设置」弹层（人数、起始后手、机器人类型、开新桌）盖在牌桌上；开桌之前它就摊开在这里
//     .playdock   操作区：弃牌 / 过牌 / 下注、一手打完的结果和「下一手」、回放的控制条。高度固定（样式表的 --dockh），牌桌不会随状态一跳一跳
//     .playside   本手记录、文字复盘、回放的胜率折线。宽屏时是牌桌右边的一栏，一直看得见；手机上点「记录」才盖在牌桌上弹出来，里面自己滚
// 各种屏幕下怎么排全在 layout.css，这里只给类名。
const { h } = __squidRequire('src/ui/dom.js');
const { remeasure } = __squidRequire('src/ui/viewport.js');

/**
 * fields：桌子设置里的那些输入（人数、起始后手、机器人）；newBtn：「开新桌」。
 * 返回 { wrap, stage, dock, side, log, review, chart, settings(open), panel(open, mode), sideWide() }。
 */
function buildShell({ tableEl, fields, newBtn }) {
  const closeSet = h('button', { class: 'sheetx', 'aria-label': '收起桌子设置', onclick: () => settings(false) }, '×');
  const sheet = h('div', { class: 'playsheet', role: 'dialog', 'aria-label': '桌子设置' },
    h('div', { class: 'sheethead' }, h('h2', {}, '桌子设置'), closeSet),
    h('div', { class: 'sheetbody' }, fields),
    h('div', { class: 'sheetfoot' }, h('span', { class: 'muted small' }, '开新桌会从头开始（筹码按起始后手重新发）。'), newBtn));
  const setBtn = h('button', { class: 'tblbtn tbset', 'aria-label': '桌子设置（人数、起始后手、机器人类型）', onclick: () => settings(!wrap.classList.contains('setopen')) }, '桌子');
  const logBtn = h('button', { class: 'tblbtn tblog', 'aria-label': '本手记录、文字复盘、胜率折线', onclick: () => panel(!wrap.classList.contains('sideopen')) }, '记录');
  const stage = h('div', { class: 'playstage' }, tableEl, setBtn, logBtn, sheet);
  const dock = h('div', { class: 'playdock' });
  const log = h('div', { class: 'log' });
  const review = h('div', { class: 'playreview' });
  const chart = h('div', { class: 'playchart' });
  const closeSide = h('button', { class: 'sheetx', 'aria-label': '收起记录', onclick: () => panel(false) }, '×');
  const sideTitle = h('h2', {}, '本手记录');
  const side = h('div', { class: 'playside', 'aria-label': '本手记录与复盘' },
    h('div', { class: 'sidehead' }, sideTitle, closeSide),
    h('div', { class: 'sidebody' }, h('div', { class: 'sidelog' }, log), review, chart));
  const wrap = h('div', { class: 'playwrap setopen' }, stage, dock, side);

  /** 桌子设置弹层：开桌之前一直摊开（没有 ×），开桌之后收成左上角的「桌子」按钮 */
  function settings(open) {
    wrap.classList.toggle('setopen', !!open);
    if (open) wrap.classList.remove('sideopen');
  }
  /** 记录面板。mode：'log'（本手记录 + 文字复盘）或 'replay'（胜率折线 + 去看文字复盘） */
  function panel(open, mode) {
    if (mode) { wrap.dataset.side = mode; sideTitle.textContent = mode === 'replay' ? '这手牌的回放' : '本手记录'; }
    wrap.classList.toggle('sideopen', !!open);
    if (open) wrap.classList.remove('setopen');
  }
  /** 宽屏时记录一栏是并排一直看得见的（不用点开） */
  const sideWide = () => getComputedStyle(logBtn).display === 'none';
  wrap.dataset.side = 'log';
  remeasure();
  return { wrap, stage, dock, side, log, review, chart, settings, panel, sideWide, started: () => wrap.classList.add('started'), logLabel: (t) => { logBtn.textContent = t; } };
}

exports.buildShell = buildShell;
});
