__squidDefine('src/ui/review/advicego.js', function (exports) {
'use strict';
// 「我的提高建议」的直达按钮：点了直接到对应的练习，不用玩家自己找。提高建议签和闯关页顶上那一行共用。
//   speed    限时速算的不限时练习，只出这一类（和错题本的「去练这一类」同一条路）
//   variant  数学竞赛的变式签，马上出一道这个题型的题
//   puzzle   打开这道固定题
//   drill    特训页开始这个场景的训练（和错题本的「再练这个局面」同一条路）
//   view     切到某个页面（入门路径的「去速算」、删掉的场景退回特训地图）
const { h } = __squidRequire('src/ui/dom.js');
const { allScenarios } = __squidRequire('src/ui/progress.js');
const { startScenario, switchView } = __squidRequire('src/ui/router.js');
const { contestState } = __squidRequire('src/ui/views/contest.js');
const { startPractice } = __squidRequire('src/ui/views/speed.js');
const { queueVariantType } = __squidRequire('src/ui/contest/variant.js');

function goAdvice(target) {
  if (!target) return;
  if (target.kind === 'speed') { switchView('speed'); startPractice([target.type]); return; }
  if (target.kind === 'variant') {
    queueVariantType(target.type);
    Object.assign(contestState, { open: null, variant: true, fromCampaign: false });
    switchView('contest');
    return;
  }
  if (target.kind === 'puzzle') { Object.assign(contestState, { open: target.id, variant: false, fromCampaign: false }); switchView('contest'); return; }
  if (target.kind === 'drill') {
    const sc = allScenarios().find((x) => x.id === target.id);
    if (sc) startScenario(sc); else switchView('drill');
    return;
  }
  if (target.kind === 'view') switchView(target.view);
}

/** 直达按钮：data-go 记下去哪（测试拿它和 Node 算的对） */
function goButton(action, primary = false) {
  if (!action) return null;
  return h('button', { class: (primary ? 'primary ' : '') + 'advgo', 'data-act': 'advice-go', 'data-go': JSON.stringify(action.target), onclick: () => goAdvice(action.target) }, action.label);
}

exports.goAdvice = goAdvice;
exports.goButton = goButton;
});
