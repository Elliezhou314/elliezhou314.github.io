__squidDefine('src/ui/leaveguard.js', function (exports) {
'use strict';
// 关卡打到一半切走：先在页面里问一句，两步确认。
//
// 星级要整关打完才结算，中途离开会丢掉本关进度。早先这里用浏览器的 confirm() 弹窗，
// 有些全屏环境（iPhone 的全屏网页应用、安卓安装包）里它不弹，等于直接放行或直接拦死；
// 「历史与数据」页的覆盖、清空已经换成了页面里的两步按钮，这里照同一个做法：
//   第一步：留在特训页，顶上出一块「确定离开 / 留在这一关」，什么都不动；
//   确定离开：丢掉这一关的进度，再切到原本要去的页面；留下：收起来，接着打。
const { h } = __squidRequire('src/ui/dom.js');
const { drillState } = __squidRequire('src/ui/views/drill.js');

/**
 * 切到 name 之前调用。关卡打到一半时拦下来、摆出两步确认并返回 true（调用方这次不切）；
 * 不用拦就返回 false。go(name) 是确认离开后真正去切页面的函数。
 */
function leaveBlocked(name, go) {
  const ctx = drillState.levelCtx;
  if (name === 'drill' || !ctx || !ctx.decisions.length || ctx.finished) return false;
  const view = document.querySelector('#view-drill');
  if (!view) return false;
  const old = view.querySelector('.leaveask');
  if (old) old.remove();
  const n = ctx.decisions.length;
  const box = h('div', { class: 'panel leaveask', role: 'alertdialog', 'data-to': name },
    h('div', {}, h('b', {}, `这一关已经打了 ${n} 个决策。`), '现在离开会丢掉本关进度（星级要整关打完才结算）。'),
    h('div', { class: 'actions' },
      h('button', { class: 'danger', 'data-act': 'leave-confirm', onclick: () => { box.remove(); drillState.levelCtx = null; go(name); } }, '确定离开'),
      h('button', { class: 'primary', 'data-act': 'leave-cancel', onclick: () => box.remove() }, '留在这一关')));
  view.prepend(box);
  if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  return true;
}

exports.leaveBlocked = leaveBlocked;
});
