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
  function tipText() {
    var ua = navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      if (/CriOS|FxiOS|EdgiOS/.test(ua)) return '用 Safari 打开这个网址，点分享按钮，选「添加到主屏幕」，以后可以像应用一样全屏、断网使用。';
      if (/iPad/.test(ua) || navigator.platform === 'MacIntel') return '点地址栏旁边的分享按钮，选「添加到主屏幕」，以后可以像应用一样全屏、断网使用。';
      return '点底部的分享按钮，选「添加到主屏幕」，以后可以像应用一样全屏、断网使用。';
    }
    if (/Android/.test(ua)) return '点浏览器的菜单（右上角的三个点），选「添加到主屏幕」或「安装应用」，以后可以像应用一样全屏、断网使用。';
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showTip);
  else showTip();
})();
