__squidDefine('src/license/device.js', function (exports) {
'use strict';
// 这台设备的设备码和启动码存在哪：浏览器本地存储里单独的一项（键名 DEVICE_KEY），和玩家进度（squid.progress.v1）分开存。
// 所以「复制进度 / 粘贴导入 / 导出」从来不带这两样，导入进度也碰不到它们；清空记录也不清它们。不碰页面。
const { makeDeviceCode, normalizeDevice } = __squidRequire('src/license/code.js');

const DEVICE_KEY = 'naowukexing.device.v1';

function storage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }

function read() {
  try { const s = storage(); const v = s && JSON.parse(s.getItem(DEVICE_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}
function write(rec) { try { const s = storage(); if (s) s.setItem(DEVICE_KEY, JSON.stringify(rec)); return !!s; } catch (e) { return false; } }

/** 新的设备码：用浏览器的安全随机数（拿不到时退回 Math.random，只影响设备码好不好猜，不影响锁） */
function freshCode() {
  for (let k = 0; k < 20; k++) {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const code = makeDeviceCode(bytes);
    if (code) return code;
  }
  return null;
}

let memo = null;   // 本地存储用不了（隐私模式）时只在这次打开里记着
/**
 * 本机的记录 { code, act, saved }：code 是设备码，act 是存下来的启动码（可能没有），saved 表示能不能存进本地存储。
 * 第一次打开时生成设备码并存下来；之后一直用这一个。存下来的设备码坏了（被改过、校验位不对）就重新生成。
 */
function deviceRecord() {
  const r = read();
  if (r && typeof r.code === 'string' && !normalizeDevice(r.code).error) return { code: normalizeDevice(r.code).code, act: typeof r.act === 'string' ? r.act : '', saved: true };
  if (memo) return memo;
  const code = freshCode();
  const saved = write({ code });
  memo = { code, act: '', saved };
  return memo;
}

/** 记下验过的启动码（只在验签通过后调用） */
function saveStartCode(code) {
  const r = deviceRecord();
  const rec = { code: r.code, act: code };
  if (!write(rec)) memo = { ...rec, saved: false };
}

exports.deviceRecord = deviceRecord;
exports.saveStartCode = saveStartCode;
exports.DEVICE_KEY = DEVICE_KEY;
});
