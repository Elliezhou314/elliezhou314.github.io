__squidDefine('src/license/code.js', function (exports) {
'use strict';
// 设备码与启动码的格式：纯逻辑，不碰页面、不碰存储、不做密码学运算（验签在 verify.js）。
// 作者那边的发码工具（仓库外的「授权码生成器.html」）内嵌的就是这个文件的原文，两边的格式只有这一份。
//
// 设备码：10 个字符，取自去掉 0/O/1/I/L 的 31 个字母数字；前 9 个随机，第 10 个是校验位
//   （按位加权求和 mod 31，权重 1~9：31 是质数，抄错任何一位、相邻两位对调都能查出来）。显示成 XXXXX-XXXXX。
// 启动码：NW1.<设备码 10 位>.<到期日 YYYYMMDD，永久写 00000000>.<签名>
//   签名是作者私钥对「naowukexing|v1|<设备码>|<到期日>」做的 ECDSA P-256（SHA-256）签名，64 字节（r‖s），写成 base64url（86 个字符）。
//   设备码和到期日都在签名覆盖的内容里：改了哪一个，签名都对不上。

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const FOREVER = '00000000';
const SIG_LEN = 86;

/** 前 9 位的校验位 */
function checkChar(body9) {
  let s = 0;
  for (let i = 0; i < 9; i++) s += (i + 1) * ALPHABET.indexOf(body9[i]);
  return ALPHABET[s % 31];
}

/** 用 9 个随机字节（0~255）生成设备码（不带横杠） */
function makeDeviceCode(bytes) {
  let body = '';
  // 248 = 31 × 8：只用 0~247 的字节，避免取模偏差；不够就由调用方再给
  for (const b of bytes) { if (b < 248 && body.length < 9) body += ALPHABET[b % 31]; }
  if (body.length < 9) return null;
  return body + checkChar(body);
}

/** 玩家或作者粘贴来的设备码 → 标准写法（去空格、横杠，转大写）；不合法时返回 { error } */
function normalizeDevice(text) {
  const s = String(text == null ? '' : text).toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 10) return { error: '设备码应该是 10 个字母或数字（显示时中间有一条横杠），这里是 ' + s.length + ' 个' };
  for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return { error: '设备码里不会有「' + ch + '」（设备码里没有 0、O、1、I、L）' };
  if (checkChar(s.slice(0, 9)) !== s[9]) return { error: '设备码有一位抄错了（校验位对不上），请对方重新复制一次' };
  return { code: s };
}

const showDevice = (code) => code.slice(0, 5) + '-' + code.slice(5);

/** 签名覆盖的内容 */
const signedText = (device, expiry) => 'naowukexing|v1|' + device + '|' + expiry;

/** YYYYMMDD → 「2027-02-18」；永久返回「永久」 */
function showExpiry(expiry) {
  if (expiry === FOREVER) return '永久';
  return expiry.slice(0, 4) + '-' + expiry.slice(4, 6) + '-' + expiry.slice(6, 8);
}

/** 到期日的最后一刻（当地时间那一天结束）之后才算过期；永久返回 Infinity */
function expiryEnd(expiry) {
  if (expiry === FOREVER) return Infinity;
  return new Date(Number(expiry.slice(0, 4)), Number(expiry.slice(4, 6)) - 1, Number(expiry.slice(6, 8)) + 1).getTime();
}

/** 合法的日期吗（20260230 这种不算） */
function validDate(expiry) {
  if (expiry === FOREVER) return true;
  if (!/^\d{8}$/.test(expiry)) return false;
  const y = Number(expiry.slice(0, 4)), m = Number(expiry.slice(4, 6)), d = Number(expiry.slice(6, 8));
  const t = new Date(y, m - 1, d);
  return y >= 2020 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** Date → YYYYMMDD（当地时间） */
function dateKey(t) {
  const d = new Date(t);
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

/** 拆开启动码。格式不对时返回 { error }；对时返回 { device, expiry, sig }（签名还没验） */
function parseStartCode(text) {
  const s = String(text == null ? '' : text).replace(/\s/g, '');
  const p = s.split('.');
  if (p.length !== 4 || p[0] !== 'NW1') return { error: '格式不对：启动码以「NW1.」开头，中间有三个点。请把作者发来的整段完整复制过来' };
  const dev = normalizeDevice(p[1]);
  if (dev.error) return { error: '格式不对：启动码里的设备码部分不完整，可能没复制全' };
  if (!validDate(p[2])) return { error: '格式不对：启动码里的日期部分不完整，可能没复制全' };
  if (p[3].length !== SIG_LEN || !/^[A-Za-z0-9_-]+$/.test(p[3])) return { error: '格式不对：启动码的最后一段长度不对，可能没复制全' };
  return { device: dev.code, expiry: p[2], sig: p[3] };
}

const buildStartCode = (device, expiry, sigB64url) => 'NW1.' + device + '.' + expiry + '.' + sigB64url;

/** base64url ↔ 字节 */
function b64urlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

exports.checkChar = checkChar;
exports.makeDeviceCode = makeDeviceCode;
exports.normalizeDevice = normalizeDevice;
exports.showExpiry = showExpiry;
exports.expiryEnd = expiryEnd;
exports.dateKey = dateKey;
exports.parseStartCode = parseStartCode;
exports.b64urlToBytes = b64urlToBytes;
exports.bytesToB64url = bytesToB64url;
exports.ALPHABET = ALPHABET;
exports.FOREVER = FOREVER;
exports.showDevice = showDevice;
exports.signedText = signedText;
exports.buildStartCode = buildStartCode;
});
