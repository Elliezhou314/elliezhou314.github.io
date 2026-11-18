__squidDefine('src/ui/app.js', function (exports) {
'use strict';
// 入口：登记导航、第一次渲染各视图、按地址栏的 #selftest / #demo 分派。
const { toast } = __squidRequire('src/ui/dom.js');
const { leaveBlocked } = __squidRequire('src/ui/leaveguard.js');
const { markMobileNav, mountMobileNav } = __squidRequire('src/ui/mobilenav.js');
const { DEMO } = __squidRequire('src/ui/progress.js');
const { registerNavigation } = __squidRequire('src/ui/router.js');
const { runSelfTest } = __squidRequire('src/ui/selftest.js');
const { applySettings, soundButton } = __squidRequire('src/ui/settings.js');
const { installAudioUnlock } = __squidRequire('src/ui/sfx.js');
const { buildCampaignView, startLevel } = __squidRequire('src/ui/views/campaign.js');
const { buildContestView } = __squidRequire('src/ui/views/contest.js');
const { flushSrs, buildDrillView, startDrill } = __squidRequire('src/ui/views/drill.js');
const { buildHelpView } = __squidRequire('src/ui/views/help.js');
const { buildLabView } = __squidRequire('src/ui/views/lab.js');
const { buildPlayView, openReplay } = __squidRequire('src/ui/views/play.js');
const { buildPreflopView } = __squidRequire('src/ui/views/preflop.js');
const { buildReviewView } = __squidRequire('src/ui/views/review.js');
const { buildSolverView } = __squidRequire('src/ui/views/solver.js');
const { buildSpeedView, stopSpeed } = __squidRequire('src/ui/views/speed.js');
const { maybeShowTour } = __squidRequire('src/ui/views/tour.js');

function switchView(name) {
  // 关卡打到一半切走会丢掉本关进度（星级要整关算完才结算）：页面里两步确认，确定离开后再回到这里切
  if (leaveBlocked(name, switchView)) return;
  if (name !== 'drill') flushSrs(); // 离开训练视图时结算这一段的间隔重复
  if (name !== 'speed') stopSpeed(); // 离开限时速算：这一局作废、计时器停掉（不记成绩）
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  markMobileNav(name);
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + name));
  if (name === 'review') buildReviewView();
  if (name === 'drill') buildDrillView();
  if (name === 'contest') buildContestView();
  if (name === 'lab') buildLabView();
  if (name === 'campaign') buildCampaignView();
  if (name === 'speed') buildSpeedView();   // 每次进来都是开始页
}

// 视图之间的跳转与重画都经过 router.js（视图互相 import 会成环），这里把真正的实现登记进去。
// 必须在下面第一次渲染各视图之前：渲染过程中就可能有视图要跳转或重画别的视图。
registerNavigation(switchView, {
  campaign: buildCampaignView, contest: buildContestView, lab: buildLabView,
  solver: buildSolverView, drill: buildDrillView, play: buildPlayView,
  review: buildReviewView, preflop: buildPreflopView, help: buildHelpView, speed: buildSpeedView,
}, startLevel, (sc) => { switchView('drill'); return startDrill(sc); },
(rec) => { switchView('play'); if (document.getElementById('view-play').classList.contains('active')) openReplay(rec); });

document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
window.addEventListener('pagehide', flushSrs);
// 音效开关：电脑上在顶栏右侧，手机上收进底部导航的「更多」面板（顶栏那个由 style.css 藏起来）
applySettings();
installAudioUnlock();   // iPhone 上音频要在点按里才能出声
document.querySelector('header').append(soundButton('hdrsound'));
mountMobileNav('campaign');
window.__squidSwitchView = switchView; // 给端到端测试截图用

buildCampaignView();
buildContestView();
buildLabView();
buildSolverView();
buildDrillView();
buildPlayView();
buildReviewView();
buildPreflopView();
buildHelpView();
buildSpeedView();

// 启动成功的旗标。index.html（开发版）靠它判断模块是不是被 file:// 的跨源策略拦了，
// 拦了就把原因写到页面上，而不是留一个只有导航的空壳让人猜。
window.__SQUID_READY__ = true;
if (location.hash === '#selftest') runSelfTest();
else if (DEMO) { switchView('lab'); toast('演示模式：全部关卡已解锁，引导已跳过', 3500); }
else maybeShowTour();


});
