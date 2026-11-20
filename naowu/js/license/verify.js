__squidDefine('src/license/verify.js', function (exports) {
'use strict';
// 验启动码：用浏览器自带的 Web Crypto（crypto.subtle）按内置的作者公钥做 ECDSA P-256 验签。不碰页面。
// 每次启动都重新验一遍（存下来的是启动码本身，不是「已解锁」标记）。
//
// 这是纯前端的锁：普通玩家改网址、改本地设置项绕不过去（存下来的启动码每次都要验签，签名只有作者的私钥做得出来）；
// 懂技术的人用开发者工具改页面里的代码、或者把别人的设备码连同启动码一起抄进自己的本地存储，是能绕过去的。
const { parseStartCode, signedText, expiryEnd, showExpiry, showDevice, b64urlToBytes } = __squidRequire('src/license/code.js');
const { PUBLIC_KEY } = __squidRequire('src/license/pubkey.js');

let keyPromise = null;
function importKey(jwk) {
  return crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/** 这台设备的浏览器能不能验签（极旧的系统浏览器可能没有 crypto.subtle） */
function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.verify === 'function' && typeof TextEncoder !== 'undefined';
}

/**
 * 验一个启动码是不是给这台设备 device 的、签名对不对、过没过期。
 * 返回 { ok: true, expiry } 或 { ok: false, kind, reason }；kind 是 format / device / signature / expired / nocrypto，reason 是给玩家看的话。
 * pub 只给 Node 里的测试传测试公钥；页面里一律用内置的作者公钥。
 */
async function checkStartCode(device, text, now, pub) {
  const p = parseStartCode(text);
  if (p.error) return { ok: false, kind: 'format', reason: p.error };
  if (p.device !== device) return { ok: false, kind: 'device', reason: '这个启动码不是给这台设备的（它是给设备 ' + showDevice(p.device) + ' 的）。请把本机的设备码 ' + showDevice(device) + ' 发给作者，换一个新码' };
  if (!cryptoAvailable()) return { ok: false, kind: 'nocrypto', reason: '这台设备的浏览器太旧，验证不了启动码。请换用较新的浏览器（或更新系统浏览器）后再打开' };
  let good = false;
  try {
    const key = pub ? await importKey(pub) : await (keyPromise || (keyPromise = importKey(PUBLIC_KEY)));
    good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(p.sig), new TextEncoder().encode(signedText(p.device, p.expiry)));
  } catch (e) { good = false; }
  if (!good) return { ok: false, kind: 'signature', reason: '启动码不对：可能有字抄错了，或者被改过（包括改过有效期）。请把作者发来的整段原样复制过来' };
  if (now >= expiryEnd(p.expiry)) return { ok: false, kind: 'expired', reason: '这个启动码已经过期了（有效期到 ' + showExpiry(p.expiry) + '）。请找作者换一个新码' };
  return { ok: true, expiry: p.expiry };
}

exports.cryptoAvailable = cryptoAvailable;
exports.checkStartCode = checkStartCode;
});
