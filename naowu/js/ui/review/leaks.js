__squidDefine('src/ui/review/leaks.js', function (exports) {
'use strict';
// 「复盘与漏洞」的「漏洞报告」签：按错误类型、街、场景汇总训练记录，给出每类漏洞的修正规则。
// v0.11 从 views/review.js 原样搬过来，数全部来自 train/training.js 的 leakReport。
const { STREET_NAMES } = __squidRequire('src/solver/tree.js');
const { leakReport } = __squidRequire('src/train/training.js');
const { h, pct } = __squidRequire('src/ui/dom.js');
const { allScenarios } = __squidRequire('src/ui/progress.js');
const { store } = __squidRequire('src/ui/services.js');

// 下面这些是经验规则，不是算出来的：阈值（如「权益 > 65%」）来自常见教学口径，
// 界面上会标明它们是经验值，真正的判断请以解算器给的频率与 EV 为准。
const LEAK_ADVICE = {
  '过度弃牌': '面对下注先算所需权益 = 跟注额/(底池+跟注额)；对手诈唬的盈亏平衡点是 下注/(底池+下注)，你至少要防守 MDF = 底池/(底池+下注)。把“弃牌”当成有成本的动作。',
  '太被动/错失价值': '拿到权益 > 65% 的牌时，下注让更差的牌跟注是最直接的盈利来源；被动跟注会把价值留给对手。',
  '错失下注': '范围优势/坚果优势在你时，小尺度高频率的持续下注长期 EV 为正；过牌等于放弃对手弃牌的那部分。',
  '过度激进': '诈唬需要对手弃牌率 ≥ 下注/(底池+下注)；面对 MDF 防守得当的对手，高频诈唬是纯亏损。',
  '加注过多': '加注要么打价值（被更差牌跟），要么打弃牌率；两者都没有的加注只是在放大方差。',
  '跟注过松': '权益低于底池赔率的跟注，靠隐含赔率补的前提是对手后手够深且你能兑现。',
  '尺度偏小': '极化范围应配大尺度：尺度越大，允许的诈唬比例越高（诈唬/价值 = 下注/(下注+底池)）。',
  '尺度偏大': '合并型范围（中等牌居多）应用小尺度，让更多更差牌跟注、控制被加注风险。',
};

/** 场景号 → 名字（自定义场景删掉了就照原样显示场景号） */
function scenarioName(id) {
  const sc = allScenarios().find((x) => x.id === id);
  if (sc) return sc.name;
  return String(id).startsWith('preflop-') ? '翻前图闪卡' : String(id);
}

function leaksTab() {
  const rep = leakReport(store.data.attempts);
  const summary = h('div', { class: 'small' },
    h('div', {}, `已判分 ${rep.graded} 个决策，其中 ${rep.mistakes} 个是漏洞（正确率 ${pct(rep.accuracy, 1)}）。`),
    h('div', {}, `平均每个决策损失 ${rep.avgLossPct.toFixed(2)}% 底池，中位数 ${rep.medianLossPct != null ? rep.medianLossPct.toFixed(2) + '%' : '—'}`,
      h('span', { class: 'muted' }, '（中位数不受个别大错影响，更能代表常态）')),
    rep.bbPer100 != null ? h('div', {}, h('b', {}, `折合每 100 个决策损失 ${rep.bbPer100.toFixed(1)} bb`), h('span', { class: 'muted' }, `（基于 ${rep.bbSamples} 个有 EV 的决策）`)) : null,
    rep.ungraded ? h('div', { class: 'muted' }, `另有 ${rep.ungraded} 条翻前闪卡记录：翻前图只给策略频率、没有动作 EV，因此不计入任何筹码口径。`) : null,
  );
  const typeTable = rep.byType.length
    ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, '错误类型'), h('th', {}, '次数'), h('th', {}, '累计(底池%)'), h('th', {}, '中位'), h('th', {}, '怎么变成优势（经验规则，非算出）')),
      rep.byType.map((t) => h('tr', {}, h('td', {}, t.key), h('td', {}, t.n), h('td', { class: 'mono' }, t.totalLoss.toFixed(1)),
        h('td', { class: 'mono' }, t.medianLoss.toFixed(1)), h('td', { class: 'small' }, LEAK_ADVICE[t.key] || '')))))
    : h('div', { class: 'note' }, '目前没有被判为小错/大错的决策 —— 继续练更难的模块。');
  return h('div', { class: 'panel rvleaks' }, h('h2', {}, '漏洞报告 → 盈利优势'),
    rep.graded ? h('div', {}, summary, typeTable,
      rep.byStreet.length ? h('div', {}, h('h3', {}, '按街'), h('div', { class: 'small' }, rep.byStreet.map((s) => `${STREET_NAMES[s.key] || s.key}：${s.n} 次，平均 ${s.avgLoss.toFixed(2)}%`).join('　'))) : null,
      rep.byScenario.length ? h('div', {}, h('h3', {}, '按场景'), h('div', { class: 'small' }, rep.byScenario.map((s) => `${scenarioName(s.key)}：${s.n} 次，平均 ${s.avgLoss.toFixed(2)}%`).join('　'))) : null,
    ) : h('span', { class: 'muted' }, '还没有训练记录。到"特训地图"里练几手，这里会告诉你钱漏在哪。'));
}

exports.scenarioName = scenarioName;
exports.leaksTab = leaksTab;
});
