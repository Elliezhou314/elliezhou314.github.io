// 顶栏时钟：按访客本地时间每秒刷新。
(function () {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); };
  tick();
  setInterval(tick, 1000);
})();
