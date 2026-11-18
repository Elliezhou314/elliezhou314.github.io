__squidDefine('src/ui/sfx.js', function (exports) {
'use strict';
// 音效：全部用 Web Audio 现场合成，不带任何音频文件（成品要完全离线，也不想为几声「嗒」多背几十 KB）。
// 默认关。开关在页面顶栏（手机上在「更多」面板），状态存进进度对象的 settings.sfx（见 settings.js），这里只记当前是开是关。
// 没有 Web Audio、或者浏览器不让出声（自动播放策略），一律静音，不抛异常。

// iPhone（以及新一些的安卓 Chrome）上，不是在点按里建出来的音频上下文是「挂起」的，出不了声；
// 切到后台再回来、来电打断之后也会被挂起。所以：音效开着时，每次点按都顺手把它建好、恢复（见 installAudioUnlock），
// 出声前也先试着恢复一次。iPhone 的静音拨片打开时网页音效一律不响，这是系统行为，代码管不了。
const state = { on: false, ctx: null, unlocked: false };

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

/** 一声短音：频率、时长（秒）、波形、音量、延后（秒） */
function blip(freq, dur, type, gain, delay) {
  if (!state.on) return;
  try {
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => { /* 恢复不了就静音 */ });
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) { /* 出不了声就静音 */ }
}

/** 发牌、筹码、赢、输，加上答对、过关、连击（音高与时值照效果图），以及速算答错 */
const sfx = {
  card: () => blip(430, 0.07, 'square', 0.025),
  chip: () => { blip(2100, 0.04, 'triangle', 0.05); blip(1700, 0.05, 'triangle', 0.04, 0.05); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.22, 'triangle', 0.06, i * 0.09)),
  lose: () => { blip(300, 0.25, 'sine', 0.06); blip(220, 0.35, 'sine', 0.06, 0.15); },
  right: () => { blip(659, 0.12, 'triangle', 0.05); blip(988, 0.2, 'triangle', 0.05, 0.1); },
  // 过关：三声上行，和星星逐个弹出的间隔（0.22 秒）对齐
  clear: () => [784, 988, 1175].forEach((f, i) => blip(f, 0.25, 'triangle', 0.06, i * 0.22)),
  combo: () => blip(1320, 0.09, 'square', 0.03),
  // 限时速算答错：一声短的低音，比牌局输了那两声短，不打断节奏
  wrong: () => blip(196, 0.16, 'sine', 0.05),
};

exports.installAudioUnlock = installAudioUnlock;
exports.setSoundOn = setSoundOn;
exports.soundOn = soundOn;
exports.sfx = sfx;
});
