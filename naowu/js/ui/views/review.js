__squidDefine('src/ui/views/review.js', function (exports) {
'use strict';
// 「复盘与漏洞」视图：顶部五个分页签，这个文件只做编排；每个签的内容各在 src/ui/review/ 里一个模块，
// 所有汇总计算在 train/advice/（提高建议）、train/notebook.js（错题本、成长曲线）和 train/training.js（漏洞报告），界面里不放统计。
//   提高建议（默认，v0.17）review/advice.js：最该练的 3 项、数据还不够的、上次最弱那项的对比
//   错题本          review/mistakes.js：训练里做错的决策、数学竞赛没一次做对的题、限时速算最弱的题型
//   成长曲线        review/growth.js：训练决策 EV 损失按天走势、速算逐局走势、数学竞赛现况
//   漏洞报告        review/leaks.js：按错误类型、街、场景汇总（v0.11 前就有，原样搬过去）
//   历史与数据      review/history.js：问题手牌记录、自由牌局历史、导出 / 导入 / 清空（同上）
const { appendTo, h, $ } = __squidRequire('src/ui/dom.js');
const { adviceTab } = __squidRequire('src/ui/review/advice.js');
const { growthTab } = __squidRequire('src/ui/review/growth.js');
const { historyTab } = __squidRequire('src/ui/review/history.js');
const { leaksTab } = __squidRequire('src/ui/review/leaks.js');
const { mistakesTab } = __squidRequire('src/ui/review/mistakes.js');
const { store } = __squidRequire('src/ui/services.js');

const TABS = [
  { id: 'advice', name: '提高建议', build: adviceTab },
  { id: 'mistakes', name: '错题本', build: mistakesTab },
  { id: 'growth', name: '成长曲线', build: growthTab },
  { id: 'leaks', name: '漏洞报告', build: leaksTab },
  { id: 'history', name: '历史与数据', build: historyTab },
];

/** 当前停在哪个签。别的页面想直接打开某个签（如训练结算的「看漏洞报告」），先改它再切过来 */
const reviewState = { tab: 'advice' };

function buildReviewView() {
  const v = $('#view-review');
  v.innerHTML = '';
  if (!TABS.some((t) => t.id === reviewState.tab)) reviewState.tab = TABS[0].id;
  const storeWarn = store.loadError || store.saveError
    ? h('div', { class: 'note' }, '⚠ ', store.loadError || store.saveError, '　你仍可正常使用，但建议先"导出进度"备份。')
    : null;
  const bar = h('div', { class: 'rvtabs', role: 'tablist' });
  const body = h('div', { class: 'rvbody', role: 'tabpanel' });
  const show = (id) => {
    reviewState.tab = id;
    bar.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    body.innerHTML = '';
    body.dataset.tab = id;
    appendTo(body, TABS.find((t) => t.id === id).build());
  };
  for (const t of TABS) bar.append(h('button', { role: 'tab', 'data-tab': t.id, onclick: () => show(t.id) }, t.name));
  appendTo(v, storeWarn, bar, body);
  show(reviewState.tab);
}

exports.buildReviewView = buildReviewView;
exports.reviewState = reviewState;
});
