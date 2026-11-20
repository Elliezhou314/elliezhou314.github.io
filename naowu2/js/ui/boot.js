__squidDefine('src/ui/boot.js', function (exports) {
'use strict';
// 入口（v0.15 起）：先验这台设备的启动码，验过了才启动游戏（app.js 的 startApp），否则盖上锁屏。
// 每次启动都重新验签，到期就重新上锁；进度存储（squid.progress.v1）这里一个字节都不碰。
// 激活链接：地址后面带 #act=<启动码> 时先试这个码，不管成不成都把它从地址栏里清掉（不留在历史记录、书签、截图里）。
const { deviceRecord, saveStartCode } = __squidRequire('src/license/device.js');
const { checkStartCode } = __squidRequire('src/license/verify.js');
const { startApp } = __squidRequire('src/ui/app.js');
const { showLock } = __squidRequire('src/ui/lock.js');

// 模块都加载上了的旗标：成品页面里「没能加载完整」的说明靠它判断（验签是异步的，游戏还没启动时也不能误报）
window.__SQUID_BOOTED__ = true;

function takeLinkCode() {
  const m = /^#act=([^&]*)/.exec(location.hash || '');
  if (!m) return '';
  let code = m[1];
  try { code = decodeURIComponent(code); } catch (e) { /* 原样用 */ }
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  return code;
}

async function boot() {
  const rec = deviceRecord();
  const link = takeLinkCode();
  let started = false;
  const start = () => { if (!started) { started = true; startApp(); } };
  const tryCode = async (code) => {
    const r = await checkStartCode(rec.code, code, Date.now());
    if (r.ok) { saveStartCode(code); start(); }
    return r;
  };
  // 激活链接带来的码先试（可能是续期的新码），再试存着的
  if (link) { const r = await checkStartCode(rec.code, link, Date.now()); if (r.ok) { saveStartCode(link); start(); return; } showLock({ device: rec.code, preset: '', message: r, tryCode }).querySelector('.lockinput').value = link; return; }
  let message = null;
  if (rec.act) {
    const r = await checkStartCode(rec.code, rec.act, Date.now());
    if (r.ok) { start(); return; }
    message = r;
  }
  showLock({ device: rec.code, message, tryCode });
}

boot();


});
