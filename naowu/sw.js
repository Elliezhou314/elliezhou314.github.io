// 脑雾克星 · 网页应用的离线缓存（Service Worker）。只在 dist/pwa/ 里有，其余成品里不出现、不注册。
// 由 node tools/build_pwa.mjs 从 tools/pwa/sw.js 生成：下面那一行 BUILD 是打包脚本写进去的
// （版本指纹 + 成品里每个文件的相对路径和内容指纹），改这个文件请改 tools/pwa/sw.js 再重新打包，别手改成品。
//
// 行为：
//   安装：把清单里的文件全部取一遍（绕过浏览器的 HTTP 缓存），逐个核对内容指纹，对不上就整次安装作废、下次再来，
//         全部对上才算装好——缓存里不会混进新旧两个版本的文件。
//   取用：作用域内的请求一律先查缓存，查到就用（断网照样能玩）；查不到才走网络。打开目录（…/naowu/）给 index.html。
//   新版本：浏览器发现 sw.js 变了就在后台装新版，装好后**等着**，由页面上的「有新版本，点这里更新」发消息过来才接管
//         （绝不自己刷新页面：玩家可能正在打一手牌或答题）。接管时删掉本作用域的旧缓存。
//   缓存名 = 前缀 + 作用域 + 版本指纹：同一个域名下别的网页（比如个人主页）的缓存、
//         同一个游戏放在别的子目录下的缓存，名字都不一样，一个都不碰。
//   进度存在本地存储（localStorage，键名 squid.progress.v1），和这里的缓存是两回事，换版本不受影响。
'use strict';
const BUILD = {"version":"bc66550847cbbd99","files":[["css/pwa.css","27cef13b5b4ac5df"],["css/style.css","5394a1294158c166"],["data/3max-100bb.js","09b6f074499e31e8"],["data/eq169.js","71449ae02fd7363d"],["data/hu-100bb.js","7c572fcc64eade08"],["data/realization.js","b57914193e725fc3"],["data/solutions-drills.js","6cd9c7e80e38de30"],["icons/apple-touch-icon.png","bd055645444f9d48"],["icons/icon-192.png","21270c72d69dc5a1"],["icons/icon-512.png","d83dfabf1ae2282c"],["icons/maskable-192.png","423e7c539f5b07f9"],["icons/maskable-512.png","c2df88bfd6f346ff"],["index.html","06fb2a814e485af4"],["js/core/cards.js","19b8b4446cbbc976"],["js/core/equity.js","3ce092c563db0bfe"],["js/core/evaluator.js","3a22725d2e5fa7e6"],["js/core/range.js","549241601b59d971"],["js/engine/bot.js","4acd37d34dcfbd37"],["js/engine/game.js","2c2b55a06dd92000"],["js/license/code.js","fc96982e0e80edad"],["js/license/device.js","2a1959fdf051bcf3"],["js/license/pubkey.js","757399532e61c261"],["js/license/verify.js","049186e89bac1f88"],["js/review/hindsight.js","9cd74db2ccf7c6af"],["js/review/replay.js","4ac4a38414806436"],["js/review/review.js","bb2c3908f111674e"],["js/runtime.js","442b1e81a8ddc21a"],["js/solver/cfr.js","aa58d56f42256d28"],["js/solver/preflop.js","5019b0af8e4dafb8"],["js/solver/squid.js","384c5deb38068a55"],["js/solver/tree.js","78e4b7025f617f6e"],["js/solver/worker.js","fba52a5f37293e2f"],["js/start.js","7aead1597b3bc15d"],["js/train/advice/index.js","4b85914cafc4d2b0"],["js/train/advice/rules.js","8d3bae9ae8b86547"],["js/train/advice/snapshot.js","f6691bb8363dc306"],["js/train/advice/text.js","6ec6a17749c17d52"],["js/train/kuhn.js","fe908942bab35e59"],["js/train/notebook.js","819f2f3a70f19799"],["js/train/puzzles.js","9a2ff42203939e16"],["js/train/season.js","22e59aa0ec205aca"],["js/train/speed.js","f2f2fc65086d87e4"],["js/train/training.js","d065c31a0335de42"],["js/train/variants/betting.js","68f534fd05fd518a"],["js/train/variants/common.js","235dc867c5e79344"],["js/train/variants/counting.js","3ad7234a254dbcc1"],["js/train/variants/draws.js","1402300736455ca8"],["js/train/variants/index.js","7622a3073c21ff6b"],["js/train/variants/ranges.js","2da339b7a4fa571a"],["js/train/variants/record.js","938cebe33ec04359"],["js/train/variants/showdown.js","87d7de2b4c3936dc"],["js/train/variants/types.js","6289d66761c20c65"],["js/ui/app.js","90ef4c9e47c7d095"],["js/ui/betspot.js","d17324db5f27bd67"],["js/ui/boot.js","08c9d1d58b9e5102"],["js/ui/bubble.js","982e4089e66c4c9f"],["js/ui/cards.js","aedc0815f672c8db"],["js/ui/chart.js","984942a57111538f"],["js/ui/clearcard.js","516ef629bce9531a"],["js/ui/contest/variant.js","51481b45a2dcceef"],["js/ui/contest/verify.js","11bed33e2d737353"],["js/ui/data.js","18a684ad05715847"],["js/ui/dom.js","ec3936c3b2e215f7"],["js/ui/feltrect.js","83bb1dee49042720"],["js/ui/fx.js","233f5cc944dc49a1"],["js/ui/leaveguard.js","c9cf39e30615bc7d"],["js/ui/lock.js","af5cb8d19d05e04a"],["js/ui/mobilenav.js","84abc53b65354665"],["js/ui/play/heroact.js","2c3413b83b459463"],["js/ui/play/shell.js","39ed27981fb1aff8"],["js/ui/progress.js","6294cd407a03885d"],["js/ui/replay/equitypanel.js","e97e40dc36ccca6a"],["js/ui/replay/replay.js","fba9f80cdab1d8e3"],["js/ui/review/advice.js","7994aad8f2917e0e"],["js/ui/review/advicego.js","488978fc6882d1d9"],["js/ui/review/growth.js","bd319a38c8cf1f11"],["js/ui/review/history.js","09994d2b07f05744"],["js/ui/review/leaks.js","aebbe1b6e0e02e71"],["js/ui/review/mistakes.js","fb0023dafb9348bd"],["js/ui/review/transfer.js","3a5ac125c9fe5f65"],["js/ui/router.js","2db4fe6d10887b79"],["js/ui/selftest.js","8d388b503bf5a848"],["js/ui/services.js","79cb998223eb2e60"],["js/ui/settings.js","b7805c702fd6b928"],["js/ui/sfx.js","ec785703df03d636"],["js/ui/sfxsynth.js","35ead996693136e3"],["js/ui/table.js","0c592deec7131af8"],["js/ui/tablelayout.js","f468d0c1e3ed1392"],["js/ui/viewport.js","97adcf5378d4cdf7"],["js/ui/views/campaign.js","bd0fc390d380f546"],["js/ui/views/contest.js","50fdf87a9f0b8ee7"],["js/ui/views/drill.js","22e5781b3fb5bef3"],["js/ui/views/help.js","acdafeedc596d6c9"],["js/ui/views/lab.js","c0130ea1fa52a24f"],["js/ui/views/play.js","8eb6a6709e74ab06"],["js/ui/views/preflop.js","1a1881f9c999df65"],["js/ui/views/review.js","686ae72a9f1f5db4"],["js/ui/views/solver.js","94c43401c881ce5e"],["js/ui/views/speed.js","40ea18439592d960"],["js/ui/views/tour.js","ad60e77fa3e29423"],["manifest.webmanifest","ff01d33d381a6fe2"],["pwa.js","0edb86336d1859dc"],["sw.js",null]]};
const PREFIX = 'naowukexing-pwa|' + self.registration.scope + '|';
const CACHE = PREFIX + BUILD.version;
const SCOPE = self.registration.scope;

async function shortHash(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < 8; i++) s += (d[i] < 16 ? '0' : '') + d[i].toString(16);
  return s;
}

async function precache() {
  const cache = await caches.open(CACHE);
  for (const [file, hash] of BUILD.files) {
    const url = new URL(file, SCOPE).href;
    const res = await fetch(new Request(url, { cache: 'reload' }));
    if (!res.ok) throw new Error('取不到 ' + file + '（' + res.status + '）');
    const buf = await res.arrayBuffer();
    // sw.js 自己的指纹写不进自己（写进去内容就变了），它的版本由 BUILD.version 体现，这里不核对
    if (hash && (await shortHash(buf)) !== hash) throw new Error(file + ' 的内容和清单对不上（服务器上可能还是旧版本），这次不装');
    await cache.put(url, new Response(buf, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.indexOf(PREFIX) === 0 && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.url.indexOf(SCOPE) !== 0) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let url = req.url.split('#')[0].split('?')[0];
    if (url === SCOPE || url.slice(-1) === '/') url = new URL('index.html', url).href;
    const hit = await cache.match(url);
    return hit || fetch(req);
  })());
});
