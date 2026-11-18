__squidDefine('src/ui/services.js', function (exports) {
'use strict';
// 后台服务：解算 Worker 客户端（主解算器与训练各一个）和本地进度存储。
const { Solution } = __squidRequire('src/solver/squid.js');
const { ProgressStore } = __squidRequire('src/train/training.js');
const { toast } = __squidRequire('src/ui/dom.js');

/**
 * 起一个解算 Worker。
 *
 * 开发版：原生 ES 模块 Worker。
 * 成品（分文件或单文件）：file:// 下浏览器会拦掉 new Worker('xxx.js') 和模块 Worker，只能用 Blob。
 * 模块注册表里存着每个模块的工厂函数，而 Function.prototype.toString 按规范返回函数的源码原文
 * （ES2019 起），于是把注册表和非界面模块原样拼成一段脚本，就是 Worker 的全部代码——
 * 不用把同一份代码再分发一遍，也不依赖页面里某个 <script> 的文本。
 */
function createWorker() {
  if (typeof __squidModules !== 'undefined') {
    const parts = ['var __squidModules = {}, __squidCache = {}, __squidDataStore = {};',
      __squidDefine.toString(), __squidData.toString(), __squidRequire.toString()];
    for (const name of Object.keys(__squidModules)) {
      if (name.startsWith('src/ui/')) continue;   // 界面模块在 Worker 里用不上，也碰不到 DOM
      parts.push('__squidDefine(' + JSON.stringify(name) + ', ' + __squidModules[name].toString() + ');');
    }
    parts.push("__squidRequire('src/solver/worker.js');");
    return new Worker(URL.createObjectURL(new Blob([parts.join('\n')], { type: 'text/javascript' })));
  }
  return new Worker(new URL('../solver/worker.js', 'bundled://'), { type: 'module' });
}

class SolverClient {
  // Worker 起不来不能把整个应用拖死。这个类在模块顶层 new，
  // 构造函数一抛异常整个 app.js 就停在那里，页面变成没有任何报错的死壳（导航都不响应）。
  // 所以这里接住，把失败原因记下来，等谁真去用解算时再报。
  constructor() {
    this.pending = new Map(); this.seq = 0; this.deadReason = null;
    try { this.worker = createWorker(); } catch (e) { this.worker = null; this.deadReason = e && e.message ? e.message : String(e); return; }
    this._bind();
  }
  _bind() {
    this.worker.onmessage = (e) => this._on(e.data);
    this.worker.onerror = (e) => {
      const msg = 'Worker 错误：' + (e && e.message ? e.message : '未知');
      this.deadReason = msg;
      toast(msg);
      // 不把在飞的请求 reject 掉的话，按钮会永远卡在禁用态
      for (const [, p] of this.pending) p.reject(new Error(msg));
      this.pending.clear();
      // 光 reject 在飞的还不够：onerror 之后这个 Worker 可能已经装载失败、
      // 再 postMessage 就是石沉大海——**之后**发的请求既不会 resolve 也不会 reject，
      // 按钮永久卡死，比报错还难查。丢掉它，下次 _send 时重建。
      try { this.worker.terminate(); } catch (err) { /* 已经死了 */ }
      this.worker = null;
    };
  }
  /** Worker 挂过一次就重建；建不出来就如实报错，不再往黑洞里发消息 */
  _revive() {
    if (this.worker) return true;
    try { this.worker = createWorker(); } catch (e) {
      this.deadReason = e && e.message ? e.message : String(e);
      return false;
    }
    this._bind();
    // 重建的 Worker 没有旧的 solver 缓存，取动作 EV 时会明确报「请重新解算」，
    // 这比静默用错的树算 EV 好，也比永久卡死好。
    toast('后台解算线程已重启，之前解过的场景需要重新解算。');
    return true;
  }
  _on(m) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress' || m.type === 'tree') { p.onProgress && p.onProgress(m); return; }
    this.pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message));
    else if (m.type === 'cancelled') p.reject(new Error('已取消'));
    else p.resolve(m);
  }
  _send(msg, onProgress) {
    if (!this.worker && !this._revive()) return Promise.reject(new Error('后台解算线程起不来（' + (this.deadReason || '未知原因') + '）。这一页的解算功能不可用，其他页面不受影响。'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, onProgress }); this.worker.postMessage({ ...msg, id }); });
  }
  async solve(spec, budget, onProgress) { const m = await this._send({ type: 'solve', spec, budget }, onProgress); return new Solution(m.data); }
  cancel() { if (this.worker) this.worker.postMessage({ type: 'cancel', id: 0 }); }
  actionEVs(solveId, nodeId, combo, samples) { return this._send({ type: 'actionEVs', solveId, nodeId, combo, samples }); }
  exploit(solveId, hero, model) { return this._send({ type: 'exploit', solveId, hero, model }); }
  async loadSolution(spec, dims, strategies, meta, onProgress) { const m = await this._send({ type: 'loadSolution', spec, dims, strategies, meta }, onProgress); return new Solution(m.data); }
  puzzle(puzzleId) { return this._send({ type: 'puzzle', puzzleId }); }
  variant(variantType, seed) { return this._send({ type: 'variant', variantType, seed }); }
  equity(params) { return this._send({ type: 'equity', ...params }); }
  preflop(params, onProgress) { return this._send({ type: 'preflop', ...params }, onProgress); }
}

const client = new SolverClient();

const drillClient = new SolverClient(); // 训练用独立 Worker，避免和解算器互相打断

const store = new ProgressStore();

exports.client = client;
exports.drillClient = drillClient;
exports.store = store;
});
