__squidDefine('src/ui/sfx.js', function (exports) {
'use strict';
// 音效：全部用 Web Audio 现场合成，不带任何音频文件（成品要完全离线，也不想为几声「嗒」多背几十 KB）。
// v0.16 起声音换成用户在试听页里选定的两套（牌桌 A「实木牌桌」、答题 B「钢琴厅」），合成在 sfxsynth.js；这里只管开关、解锁和出声。
// 默认关。开关在页面顶栏（手机上在「更多」面板），状态存进进度对象的 settings.sfx（见 settings.js），这里只记当前是开是关。
// 没有 Web Audio、或者浏览器不让出声（自动播放策略），一律静音，不抛异常。

// iPhone（以及新一些的安卓 Chrome）上，不是在点按里建出来的音频上下文是「挂起」的，出不了声；
// 切到后台再回来、来电打断之后也会被挂起。所以：音效开着时，每次点按都顺手把它建好、恢复（见 installAudioUnlock），
// 出声前也先试着恢复一次。iPhone 的静音拨片打开时网页音效一律不响，这是系统行为，代码管不了。
const { makeRig, playOn } = __squidRequire('src/ui/sfxsynth.js');

const VOLUME = 0.8;   // 总音量：和试听页默认的一样
const state = { on: false, ctx: null, unlocked: false, rig: null };

function audioCtx() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  state.ctx = state.ctx || new AC();
  return state.ctx;
}

/** 在点按里调用：建好音频上下文、恢复挂起，第一次再放一段无声的缓冲（老 iPhone 要靠它「解锁」） */
function unlockAudio() {
  if (!state.on) return;
  try {
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state !== 'running' && ac.resume) ac.resume().catch(() => { /* 恢复不了就静音 */ });
    if (!state.unlocked) {
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, 22050);
      src.connect(ac.destination);
      src.start(0);
      state.unlocked = true;
    }
  } catch (e) { /* 出不了声就静音 */ }
}

/** app.js 启动时调用一次：在整页的点按、按键上挂解锁（捕获阶段、被动监听，不影响任何按钮自己的处理） */
function installAudioUnlock() {
  if (typeof document === 'undefined') return;
  for (const t of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(t, unlockAudio, { capture: true, passive: true });
}

function setSoundOn(on) { state.on = !!on; }

function soundOn() { return state.on; }

/**
 * 放一个声音。整套声音共用一个通路（一个压缩器、一个总音量、一个混响）：第一次出声时建一次（混响的冲激响应、噪声缓冲也只在这时生成），之后一直用它。
 * 时刻比「现在」晚 0.02 秒（和试听页一样），免得开头被截掉。出不了声一律静音。
 */
function play(name) {
  if (!state.on) return;
  try {
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => { /* 恢复不了就静音 */ });
    if (!state.rig) state.rig = makeRig(ac, VOLUME);
    playOn(state.rig, name, ac.currentTime + 0.02);
  } catch (e) { /* 出不了声就静音 */ }
}

/** 发牌、筹码、赢、输（牌桌，A 套），答对、连击、过关、答错（答题，B 套）。名字和以前一样，调用的地方不用改 */
const sfx = {
  card: () => play('card'),
  chip: () => play('chip'),
  win: () => play('win'),
  lose: () => play('lose'),
  right: () => play('right'),
  // 过关：B 套的三声上行，间隔 0.22 秒，和星星逐个弹出的间隔对齐
  clear: () => play('clear'),
  combo: () => play('combo'),
  wrong: () => play('wrong'),
};

exports.installAudioUnlock = installAudioUnlock;
exports.setSoundOn = setSoundOn;
exports.soundOn = soundOn;
exports.sfx = sfx;
});
