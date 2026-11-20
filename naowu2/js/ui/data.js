__squidDefine('src/ui/data.js', function (exports) {
'use strict';
// 随成品一起分发的预解算数据（翻前图、169 类权益表、实现差表、特训均衡解）的读取入口。
//
// 成品里每份数据是 data/ 下的一个脚本，加载时用 __squidData(名字, 内容) 登记（见 tools/build.mjs），
// 分文件版和单文件版走的是同一条路。开发版（index.html + 本地服务器）没有这些脚本，
// 这里返回 null，调用方自己去 fetch data/ 下的 JSON。
//
// 名字与源文件的对应：data/preflop/eq169.json → 'eq169'，data/preflop/hu-100bb.json → 'hu-100bb'，
// data/solutions/drills.json → 'solutions-drills'。

/** 取一份随成品分发的数据；没有（开发版，或这份数据没打进包）就返回 null */
function embeddedData(name) {
  if (typeof __squidDataStore === 'undefined') return null;
  const v = __squidDataStore[name];
  return v === undefined ? null : v;
}

/**
 * 内置的特训均衡解（打包时内嵌）。只有 2 人局有：
 * 3 人博弈不存在纳什均衡保证，把 MCCFR 的输出当均衡内置是不诚实的。
 */
function embeddedSolution(scenarioId, boardStr) {
  const all = embeddedData('solutions-drills');
  if (!all) return null;
  return all.spots[scenarioId + '|' + boardStr] || null;
}

exports.embeddedData = embeddedData;
exports.embeddedSolution = embeddedSolution;
});
