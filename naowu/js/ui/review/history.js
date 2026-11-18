__squidDefine('src/ui/review/history.js', function (exports) {
'use strict';
// 「复盘与漏洞」的「历史与数据」签：问题手牌记录（最近 60 条）、自由牌局历史、数据面板。
// 数据面板（复制进度、粘贴导入、文件导出导入、清空）在 transfer.js；导入、清空之后经 router.js 重画相关页面（直接引用 review.js 会成环）。
const { cardsToStr } = __squidRequire('src/core/cards.js');
const { analyzeHand } = __squidRequire('src/review/review.js');
const { h, f1 } = __squidRequire('src/ui/dom.js');
const { store } = __squidRequire('src/ui/services.js');
const { scenarioName } = __squidRequire('src/ui/review/leaks.js');
const { dataPanel } = __squidRequire('src/ui/review/transfer.js');

function recentTable() {
  const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '时间'), h('th', {}, '场景'), h('th', {}, '牌面'), h('th', {}, '手牌'), h('th', {}, '你的动作'),
    h('th', {}, '最高EV'), h('th', {}, '损失%'), h('th', {}, '评级'), h('th', {}, '类型')));
  for (const a of store.data.attempts.slice(-60).reverse()) {
    tbl.append(h('tr', {},
      h('td', { class: 'small' }, new Date(a.time).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)),
      h('td', { class: 'small' }, a.scenarioName || scenarioName(a.scenarioId)),
      h('td', { class: 'mono' }, a.board), h('td', { class: 'mono' }, a.hand),
      h('td', {}, a.chosen), h('td', {}, a.best),
      h('td', { class: 'mono' }, Number.isFinite(a.evLossPct) ? a.evLossPct.toFixed(2) : '—'),
      h('td', {}, h('span', { class: `grade ${a.grade}` }, a.grade), a.noisy ? h('span', { class: 'muted small' }, ' 噪声') : null),
      h('td', { class: 'small' }, a.mistake)));
  }
  return tbl;
}

function handsList() {
  const hands = store.data.hands.slice(-20).reverse();
  const el = h('div', { class: 'rvhands' });
  if (!hands.length) { el.append(h('span', { class: 'muted' }, '自由牌局还没有记录。')); return el; }
  for (const rec of hands) {
    el.append(h('div', { class: 'hand-log-item' },
      `第 ${rec.handNo} 手 ${cardsToStr(rec.board)} 你 ${cardsToStr(rec.seats[rec.heroSeat].hole)} 净 ${rec.result ? f1(rec.result.net[rec.heroSeat]) : '?'} `,
      h('button', { class: 'small', onclick: () => { const an = analyzeHand(rec); el.prepend(h('pre', { class: 'review' }, an.text)); } }, '复盘')));
  }
  return el;
}

function historyTab() {
  return [
    h('div', { class: 'panel' }, h('h2', {}, '问题手牌记录（最近 60）'), h('div', { class: 'scroll-x' }, recentTable())),
    h('div', { class: 'panel' }, h('h2', {}, '自由牌局历史'), handsList()),
    dataPanel(),
  ];
}

exports.historyTab = historyTab;
});
