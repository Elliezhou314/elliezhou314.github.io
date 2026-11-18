// 模块注册表：js/ 下每个文件用 __squidDefine 登记自己，data/ 下每个文件用 __squidData 登记数据。
// 主线程和 Worker 共用这一套（Worker 的源码由 src/ui/services.js 从这里的函数原样拼出来）。
var __squidModules = {}, __squidCache = {}, __squidDataStore = {};
function __squidDefine(name, fn) { __squidModules[name] = fn; }
function __squidData(name, value) { __squidDataStore[name] = value; }
function __squidRequire(name) {
  if (__squidCache[name]) return __squidCache[name];
  var fn = __squidModules[name];
  if (!fn) throw new Error('模块不存在: ' + name);
  var exports = {}; __squidCache[name] = exports; fn(exports); return exports;
}
