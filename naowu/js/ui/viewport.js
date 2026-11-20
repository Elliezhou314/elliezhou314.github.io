__squidDefine('src/ui/viewport.js', function (exports) {
'use strict';
// 屏幕能用多高（v0.16）：自由牌局要「一屏放下、页面不上下滚」，牌桌按剩下的高度缩放，所以要知道页面里还剩多少高度。
//
// 不靠浏览器标识判断设备，只量：窗口内高（innerHeight，Safari 收起、展开工具栏时会变）、牌局区域顶边离页面顶多远（顶栏、网页应用的安装提示都算在里面）、
// 底栏（手机布局）占了下面多少。量出来写成像素 CSS 变量 --playh，样式表里牌局区域的高度就用它；没量到之前样式表有 100vh 的后备。
// 不用 dvh：iOS 15.4 以下没有它，而量出来的数在所有浏览器上都一样可靠。
//
// 什么时候重量：窗口大小变了、转屏、可视区变了（iPhone 上工具栏收起展开）、顶栏高度变了、页面上多了或少了一条提示、切页面。
const root = typeof document !== 'undefined' ? document.documentElement : null;
const fit = { on: false, raf: 0, installed: false };

/** 现在量一次（下一帧做，同一帧里叫多次只量一次） */
function remeasure() {
  if (!root || fit.raf) return;
  fit.raf = requestAnimationFrame(measure);
}

function measure() {
  fit.raf = 0;
  const H = window.innerHeight;
  root.style.setProperty('--apph', H + 'px');
  const wrap = fit.on ? document.querySelector('#view-play .playwrap') : null;
  if (!wrap || !wrap.offsetParent) return;
  // 底栏在下面时（手机竖屏）让出它占的高度；手机横屏时底栏改成竖在左边，不占高度
  const bar = document.querySelector('.tabbar');
  let reserve = 0;
  if (bar && getComputedStyle(bar).display !== 'none') {
    const r = bar.getBoundingClientRect();
    if (r.top > H / 2) reserve = H - r.top;
  }
  const top = wrap.getBoundingClientRect().top + (window.pageYOffset || 0);
  const mb = parseFloat(getComputedStyle(wrap).marginBottom) || 0;
  const h = Math.max(160, Math.floor(H - reserve - top - mb));
  if (root.style.getPropertyValue('--playh') !== h + 'px') root.style.setProperty('--playh', h + 'px');
}

/** 切页面时由 app.js 叫：牌局页打开时整页进入「一屏」模式（body.playfit），别的页面照常上下滚 */
function setFitView(name) {
  fit.on = name === 'play';
  document.body.classList.toggle('playfit', fit.on);
  if (fit.on) window.scrollTo(0, 0);
  remeasure();
}

/** 启动时挂一次：各种会改变可用高度的事件都重量 */
function installViewport() {
  if (!root || fit.installed) return;
  fit.installed = true;
  for (const t of ['resize', 'orientationchange', 'pageshow']) window.addEventListener(t, remeasure);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', remeasure);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(remeasure);
    const hd = document.querySelector('header'), bar = document.querySelector('.tabbar');
    if (hd) ro.observe(hd);
    if (bar) ro.observe(bar);   // 底栏的高度含底部安全区：转屏后安全区变了，底栏跟着变高变矮
    ro.observe(document.body);
  }
  // 页面上多了、少了一条东西（例如网页应用版插在顶栏下面的那条提示）：牌局区域的顶边会变
  if (typeof MutationObserver !== 'undefined') new MutationObserver(remeasure).observe(document.body, { childList: true });
  remeasure();
}

exports.remeasure = remeasure;
exports.setFitView = setFitView;
exports.installViewport = installViewport;
});
