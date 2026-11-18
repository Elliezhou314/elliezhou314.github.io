__squidDefine('src/ui/router.js', function (exports) {
'use strict';
// 视图之间的跳转与重画。
//
// 视图互相引用是常态：闯关页的按钮跳到训练页、训练页打完一关要回闯关页、
// 解算器保存了自定义场景要让特训地图重画……直接互相 import 就会成环。
// 开发版（浏览器原生 ES 模块）对环很宽容，但打包后的模块注册表在工厂函数开头解构 import、
// 末尾才挂 exports，环上的一方拿到的是 undefined——成品白屏，开发版却一切正常。
// 所以视图之间只认这个中介：真正的 switchView 和各视图的 build 函数由 app.js 启动时登记进来。
// tools/build.mjs 会检查整张模块图，出现环就拒绝打包。

let navigate = null;
const builders = {};
const actions = { startLevel: null, startScenario: null, replayHand: null };

/**
 * app.js 在渲染任何视图之前调用一次。levelStarter 是闯关页的「开始某一关」（过关卡片的「下一关」要用）；
 * scenarioStarter 是「切到特训页、开始某个场景的训练」（错题本的「再练这个局面」要用）；
 * handReplayer 是「切到自由牌局、回放某一手」（历史与数据里每手牌的「回放」要用）。
 */
function registerNavigation(switchViewImpl, viewBuilders, levelStarter, scenarioStarter, handReplayer) {
  navigate = switchViewImpl;
  Object.assign(builders, viewBuilders);
  actions.startLevel = levelStarter || null;
  actions.startScenario = scenarioStarter || null;
  actions.replayHand = handReplayer || null;
}

/** 切到自由牌局页面并回放一手打完的牌（正在打的一手没结束时，那边会先问打完还是放弃） */
function replayHand(rec) {
  if (!actions.replayHand) throw new Error('「回放一手牌」还没登记：app.js 应在 registerNavigation 里传进来');
  return actions.replayHand(rec);
}

/** 切到特训页并开始某个场景的训练（不是关卡），和特训地图上点场景走同一条路径 */
function startScenario(sc) {
  if (!actions.startScenario) throw new Error('「开始场景训练」还没登记：app.js 应在 registerNavigation 里传进来');
  return actions.startScenario(sc);
}

/** 开始闯关里的某一关（谜题关跳到题目，训练关进特训页），和闯关页上点「开始」走同一条路径 */
function startLevel(level) {
  if (!actions.startLevel) throw new Error('「开始关卡」还没登记：app.js 应在 registerNavigation 里传进来');
  return actions.startLevel(level);
}

/** 切换到某个视图（与点导航栏按钮走同一条路径） */
function switchView(name) {
  if (!navigate) throw new Error('导航还没登记：app.js 应在渲染任何视图之前调用 registerNavigation');
  return navigate(name);
}

/** 让某个视图按最新数据重画，但不切换过去 */
function refreshView(name) {
  const build = builders[name];
  if (!build) throw new Error('没有登记这个视图：' + name);
  build();
}

exports.registerNavigation = registerNavigation;
exports.replayHand = replayHand;
exports.startScenario = startScenario;
exports.startLevel = startLevel;
exports.switchView = switchView;
exports.refreshView = refreshView;
});
