__squidDefine('src/ui/lock.js', function (exports) {
'use strict';
// 锁屏：这台设备还没有有效的启动码时盖在整个页面上。只管画和收集输入，验签在 license/verify.js，存储在 license/device.js。
const { showDevice } = __squidRequire('src/license/code.js');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 锁屏上额外的一句提示（没有就返回空）。这里是整个游戏唯一看浏览器标识的地方，而且只用来换提示文字，不影响锁本身。
 * 判断 iPhone / iPad 照 tools/pwa/pwa.js 的写法：iPad 上的 Safari 标识成 Mac，要结合触点数。
 * 微信、QQ 的内置浏览器：存储和 Safari、主屏幕图标都是分开的，也不能添加到主屏幕，所以先劝换浏览器。
 */
function lockHint(ua, platform, touchPoints, standalone) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  // v0.16：锁屏要一屏放下，屏幕上只留一句「怎么做」（text），为什么要这样做（more）收进「怎么用」里
  const where = '微信或 QQ 里、浏览器里、主屏幕的图标里这几处的存储是分开的，在这里解锁了，换个地方打开还要再解锁一次（设备码也不一样）。想就在这里玩也行，照上面的步骤解锁。';
  if (/MicroMessenger|QQ\//.test(ua)) {
    return ios ? { kind: 'inapp-ios', text: '你是在微信或 QQ 里打开的。<b>点右上角「…」→「在 Safari 中打开」→ 添加到主屏幕 → 在主屏幕的图标里解锁。</b>', more: where }
      : { kind: 'inapp-android', text: '你是在微信或 QQ 里打开的。<b>点右上角「…」→「在浏览器打开」，在浏览器里解锁。</b>', more: where };
  }
  if (!ios || standalone) return null;
  const tail = '浏览器里和主屏幕上的应用是分开存的：在浏览器里解锁了，加到主屏幕后还会再锁一次（那边的设备码也不一样）。';
  if (/FxiOS/.test(ua)) return { kind: 'ios-firefox', text: '<b>建议用 Safari 打开这个网址，点分享按钮 →「添加到主屏幕」，再在主屏幕的图标里解锁。</b>', more: tail };
  if (/CriOS/.test(ua)) return { kind: 'ios-other', text: '<b>建议先添加到主屏幕（点地址栏右边的分享按钮 →「添加到主屏幕」），再在主屏幕的图标里解锁。</b>', more: tail };
  if (/EdgiOS/.test(ua)) return { kind: 'ios-other', text: '<b>建议先添加到主屏幕（点底部的「…」→「分享」→「添加到主屏幕」），再在主屏幕的图标里解锁。</b>', more: tail };
  return { kind: 'ios-safari', text: '<b>建议先添加到主屏幕（点分享按钮 →「添加到主屏幕」），再在主屏幕的图标里解锁。</b>', more: tail };
}
const hintHere = () => lockHint(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints || 0,
  navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

/** 复制文字：先用剪贴板接口，不行就选中一个文本框里的文字让玩家自己复制 */
async function copyText(text, box) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return '已复制'; } } catch (e) { /* 被拒绝 */ }
  box.hidden = false; box.value = text; box.focus(); box.select();
  return '没能自动复制，已经选中，请长按或按 Ctrl+C 复制';
}

/**
 * 盖上锁屏。opts:
 *   device   本机设备码；message 一打开就要说的话（例如存着的码过期了）
 *   preset   激活链接带来的启动码（自动填好并马上试）
 *   tryCode  async (启动码) => { ok, reason }：验签并在通过时解锁，由 boot.js 给
 */
function showLock({ device, message = '', preset = '', tryCode }) {
  const hint = hintHere();
  const root = document.createElement('div');
  root.className = 'lockscr';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '这台设备还没有解锁');
  // 一屏放下（v0.16）：设备码、复制、粘贴框、解锁同时看得见；次要的说明收进「怎么用」。手机横屏时左右两栏（样式表）
  root.innerHTML = '<div class="lockcard">'
    + '<div class="lockleft">'
    + '<h2>这台设备还没有解锁</h2>'
    + '<p class="lockwhy"><b>把下面的设备码发给作者，换一个启动码填在下面。</b></p>'
    + '<div class="lockdevlbl">本机设备码</div>'
    + '<div class="lockdevrow"><div class="lockdev" data-code="' + esc(device) + '">' + esc(showDevice(device)) + '</div>'
    + '<button type="button" class="primary" data-act="copy">复制设备码</button></div>'
    + '<span class="lockcopied muted small" aria-live="polite"></span>'
    + '<input class="lockcopybox" readonly hidden aria-label="设备码">'
    + (hint ? '<div class="lockhint" data-hint="' + hint.kind + '">' + hint.text + '</div>' : '')
    + '</div><div class="lockright">'
    + '<label class="lockdevlbl" for="lockinput">启动码</label>'
    + '<textarea id="lockinput" class="lockinput" rows="2" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="把作者发来的启动码粘贴在这里（以 NW1. 开头）"></textarea>'
    + '<div class="lockrow"><button type="button" class="primary" data-act="unlock">解锁</button><p class="lockmsg" role="alert"></p></div>'
    + '<details class="lockmore"><summary>怎么用</summary>'
    + '<p>每台设备第一次打开脑雾克星都要一个启动码：复制上面的设备码发给作者，作者回你一个启动码，粘贴在框里点「解锁」。</p>'
    + (hint && hint.more ? '<p class="lockhintmore">' + hint.more + '</p>' : '')
    + '<p>你的进度存在这台设备上：上锁、过期、解锁都不会动它。</p></details>'
    + '</div></div>';
  document.body.append(root);
  document.body.classList.add('locked');
  const msg = root.querySelector('.lockmsg'), input = root.querySelector('.lockinput'), copied = root.querySelector('.lockcopied');
  const say = (text, kind) => { msg.textContent = text; msg.dataset.kind = kind || ''; };
  if (message) say(message.reason, message.kind);
  root.querySelector('[data-act=copy]').addEventListener('click', async () => { copied.textContent = await copyText(showDevice(device), root.querySelector('.lockcopybox')); });
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const text = input.value.trim();
    if (!text) { say('还没有粘贴启动码', 'empty'); return; }
    busy = true; say('正在验证……', 'busy');
    let r;
    try { r = await tryCode(text); } catch (e) { r = { ok: false, kind: 'error', reason: '验证时出错了，请再试一次' }; }
    busy = false;
    if (r.ok) { root.remove(); document.body.classList.remove('locked'); return; }
    say(r.reason, r.kind);
  };
  root.querySelector('[data-act=unlock]').addEventListener('click', submit);
  if (preset) { input.value = preset; submit(); }
  return root;
}

exports.lockHint = lockHint;
exports.showLock = showLock;
});
