// 脑雾克星 · 网页应用专用的一小段脚本：注册离线缓存、提示新版本、第一次打开时提示「添加到主屏幕」。
// 只在 dist/pwa/ 里有（tools/build_pwa.mjs 把它挂在页面最后），其余三种成品里不出现。
// 游戏本身（src/）完全不知道它的存在；它也不碰游戏的进度（squid.progress.v1），自己只用一个键记「安装提示关掉了」。
(function () {
  'use strict';
  var TIP_KEY = 'naowukexing.pwa.installTipClosed';
  var accepted = false;   // 玩家点了「更新」才刷新；新版本装好了也只是提示，绝不自己刷新

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- 新版本提示
  function showUpdate(worker) {
    if (document.querySelector('.pwaupdate')) return;
    var bar = el('button', 'pwaupdate', '有新版本，点这里更新');
    bar.type = 'button';
    bar.setAttribute('role', 'status');
    bar.addEventListener('click', function () {
      accepted = true;
      bar.textContent = '正在更新……';
      bar.disabled = true;
      worker.postMessage({ type: 'skipWaiting' });
    });
    document.body.appendChild(bar);
  }

  function watch(reg) {
    // 已经有一个装好在等的新版本（比如上次打开时就下好了）
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        // 有 controller 才是「更新」；第一次安装没有旧版本可换，不提示
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    // iPhone 上添加到主屏幕的应用切回前台时不会重新载入页面，这时顺手查一次新版本（最多一小时一次）
    var last = Date.now();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || Date.now() - last < 3600000) return;
      last = Date.now();
      reg.update().catch(function () { /* 断网时查不到，下次再说 */ });
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (accepted) location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(watch).catch(function () { /* 注册不了就当普通网页用 */ });
    });
  }

  // ---------------------------------------------------------------- 安装提示
  function standalone() {
    return window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  }
  // 提示文字按「在哪儿打开的」换（只用来换文字，版面一律按屏幕尺寸，v0.16）：
  //   微信、QQ 的内置浏览器（标识里有 MicroMessenger、QQ/）不能添加到主屏幕，先劝换到 Safari（安卓是「在浏览器打开」）；
  //   iPhone、iPad 上的 Chrome 和 Edge 也能添加到主屏幕（iOS 16.4 起），入口在分享菜单里，和 Safari 不在同一个地方；Firefox 劝用 Safari。
  //   iPad 上的 Safari 标识成 Mac（MacIntel），要结合触点数认出来。
  function tipText() {
    var ua = navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var tail = '，以后可以像应用一样全屏、断网使用。';
    if (/MicroMessenger|QQ\//.test(ua)) {
      return ios ? '你是在微信或 QQ 里打开的，这里不能添加到主屏幕：点右上角的「…」，选「在 Safari 中打开」，再在 Safari 里点分享按钮，选「添加到主屏幕」' + tail
        : '你是在微信或 QQ 里打开的：点右上角的「…」，选「在浏览器打开」，再在浏览器的菜单里选「添加到主屏幕」或「安装应用」' + tail;
    }
    if (ios) {
      if (/FxiOS/.test(ua)) return '用 Safari 打开这个网址，点分享按钮，选「添加到主屏幕」' + tail;
      if (/CriOS/.test(ua)) return '点地址栏右边的分享按钮，选「添加到主屏幕」' + tail;
      if (/EdgiOS/.test(ua)) return '点底部的「…」菜单，选「分享」，再选「添加到主屏幕」' + tail;
      if (/iPad/.test(ua) || navigator.platform === 'MacIntel') return '点地址栏旁边的分享按钮，选「添加到主屏幕」' + tail;
      return '点底部的分享按钮（地址栏放在顶上时点顶部的），选「添加到主屏幕」' + tail;
    }
    if (/Android/.test(ua)) return '点浏览器的菜单（右上角的三个点），选「添加到主屏幕」或「安装应用」' + tail;
    return '';
  }
  function closed() { try { return localStorage.getItem(TIP_KEY) === '1'; } catch (e) { return false; } }
  function showTip() {
    var text = tipText();
    if (!text || standalone() || closed()) return;
    var tip = el('div', 'pwatip');
    tip.setAttribute('role', 'note');
    tip.appendChild(el('span', 'pwatiptext', text));
    var x = el('button', 'pwatipclose', '×');
    x.type = 'button';
    x.setAttribute('aria-label', '关掉这条提示，以后不再出现');
    x.addEventListener('click', function () {
      try { localStorage.setItem(TIP_KEY, '1'); } catch (e) { /* 存不住就只关这一次 */ }
      tip.parentNode && tip.parentNode.removeChild(tip);
    });
    tip.appendChild(x);
    var header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(tip, header.nextSibling);
    else document.body.insertBefore(tip, document.body.firstChild);
    liftOverTour(tip);
  }

  // 第一次打开时游戏还会弹新手引导：一层全屏半透明遮罩（.tourmask，z-index 50）中间一张卡片。
  // 提示原本在页面里，会被压在遮罩下面发暗、点不到。引导开着的时候：提示改成贴在屏幕顶上、浮在遮罩之上（pwatip-over），
  // 遮罩上沿让出提示的高度（引导卡片在剩下的地方居中，放不下就在遮罩里滚动），两者不叠在一起；
  // 引导关掉或提示关掉，一切回到原样。游戏代码（src/）不知道这件事，只在这里看遮罩在不在。
  function liftOverTour(tip) {
    function sync() {
      var mask = document.querySelector('.tourmask');
      var on = !!mask && !!tip.parentNode;
      tip.classList.toggle('pwatip-over', on);
      if (!mask) return;
      mask.classList.toggle('pwatour-tip', on);
      mask.style.paddingTop = on ? Math.ceil(tip.getBoundingClientRect().height + 12) + 'px' : '';
    }
    var mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true });
    window.addEventListener('resize', sync);
    tip.querySelector('.pwatipclose').addEventListener('click', function () {
      mo.disconnect();
      window.removeEventListener('resize', sync);
      sync();
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showTip);
  else showTip();
})();
