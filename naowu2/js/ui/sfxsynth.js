__squidDefine('src/ui/sfxsynth.js', function (exports) {
'use strict';
// 音效的合成部分（v0.16）：照搬用户在试听页里选定的两套——牌桌上的发牌、下筹码、赢下底池、输掉这手用 A「实木牌桌」，
// 答题的答对、连击、过关、答错用 B「钢琴厅」。下面的函数和参数逐字取自试听页（tools/sfx/audition.html，存在仓库里当对照），一个数都没改；
// 混响按各自那一套的份量送（A 0.10、B 0.28）。tools/sfxtest.mjs 在无头浏览器里离线渲染八个声音，和试听页同一个声音逐点比对。
// 这里只管「怎么合成」：开关、什么时候出声、出不了声时静音在 sfx.js。
// 整套声音共用一个通路（makeRig：一个压缩器、一个总音量、一个混响），由 sfx.js 在第一次出声时建一次、之后一直用它，
// 混响的冲激响应和噪声缓冲也就只生成一次。
// 固定种子的伪随机：噪声和混响每次生成都一样，离线渲染核对时结果可复现
function lcg(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function noiseBuf(ac) {
  var b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0), r = lcg(7);
  for (var i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}
function impulse(ac, dur, decay) {
  var n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(2, n, ac.sampleRate);
  for (var c = 0; c < 2; c++) {
    var d = b.getChannelData(c), r = lcg(11 + c * 97);
    for (var i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}
function makeRig(ac, vol) {
  var master = ac.createGain(); master.gain.value = vol;
  var comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  var dry = ac.createGain(), send = ac.createGain(), conv = ac.createConvolver(), wet = ac.createGain();
  conv.buffer = impulse(ac, 1.8, 2.6);
  dry.connect(comp); send.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(master); master.connect(ac.destination);
  return { ac: ac, master: master, dry: dry, send: send, noise: noiseBuf(ac) };
}
// 每个声音自己的一条通路：直达声 + 按这一套的份量送进混响
function bus(r, wetAmt) {
  var g = r.ac.createGain(); g.connect(r.dry);
  if (wetAmt > 0) { var s = r.ac.createGain(); s.gain.value = wetAmt; g.connect(s); s.connect(r.send); }
  return g;
}
function envelope(ac, t, a, d, peak) {
  var g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  return g;
}
// 一个音：f 起始频率，f2 滑到的频率，a 起音，d 衰减，g 音量，lp 低通截止
function tone(r, out, t, o) {
  var ac = r.ac, osc = ac.createOscillator(), a = o.a || 0.004, d = o.d || 0.2;
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
  var g = envelope(ac, t, a, d, o.g || 0.2), node = osc;
  if (o.lp) { var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + a + d + 0.05);
}
// 一段滤过的噪声：纸牌的摩擦、筹码相碰的那一下「嚓」
function hiss(r, out, t, o) {
  var ac = r.ac, src = ac.createBufferSource(), f = ac.createBiquadFilter(), a = o.a || 0.002, d = o.d || 0.05;
  src.buffer = r.noise;
  f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
  f.frequency.setValueAtTime(o.f, t);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
  var g = envelope(ac, t, a, d, o.g || 0.2);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, o.off || 0); src.stop(t + a + d + 0.05);
}
// 调频合成的电钢琴音：调制深度随时间收小，起音亮、尾音圆
function keys(r, out, t, o) {
  var ac = r.ac, car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), a = 0.005, d = o.d || 0.5;
  car.frequency.setValueAtTime(o.f, t); mod.frequency.setValueAtTime(o.f * (o.ratio || 1), t);
  var idx = (o.index == null ? 1.1 : o.index) * o.f;
  mg.gain.setValueAtTime(idx, t); mg.gain.exponentialRampToValueAtTime(Math.max(idx * 0.08, 0.01), t + d * 0.5);
  mod.connect(mg); mg.connect(car.frequency);
  var g = envelope(ac, t, a, d, o.g || 0.12), node = car;
  if (o.lp) { var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  car.start(t); mod.start(t); car.stop(t + a + d + 0.05); mod.stop(t + a + d + 0.05);
  if (!o.dull) tone(r, out, t, { f: o.f * 7, d: 0.03, g: (o.g || 0.12) * 0.18 });   // 音叉敲下去的那一点金属声
}
// 木琴 / 木鱼：基音加四倍频，衰减很快，前面带一点敲击声
function wood(r, out, t, o) {
  tone(r, out, t, { f: o.f, d: o.d || 0.22, g: o.g || 0.22 });
  tone(r, out, t, { f: o.f * 4, d: (o.d || 0.22) * 0.25, g: (o.g || 0.22) * 0.22 });
  hiss(r, out, t, { f: 3200, q: 1.2, d: 0.012, g: (o.g || 0.22) * 0.35 });
}
// 一枚筹码落在另一枚上：很短的一下「嚓」，加两个高而短的共鸣
function clay(r, out, t, k) {
  k = k || 1;
  hiss(r, out, t, { f: 3300 * k, q: 3, d: 0.016, g: 0.42 });
  tone(r, out, t, { f: 2350 * k, d: 0.04, g: 0.13 });
  tone(r, out, t, { f: 3900 * k, d: 0.028, g: 0.07 });
  tone(r, out, t, { f: 430 * k, d: 0.03, g: 0.09 });
}

/** 八个声音：wet 是送进混响的份量（A 套 0.10、B 套 0.28），fn(r, o, t) 是试听页里那一套的原函数 */
const SOUNDS = {
  card: { set: 'A', wet: 0.10, fn: function (r, o, t) { hiss(r, o, t, { f: 5200, f2: 1700, q: 0.9, a: 0.004, d: 0.085, g: 0.5 }); tone(r, o, t + 0.05, { f: 150, f2: 90, d: 0.05, g: 0.14 }); } },
  chip: { set: 'A', wet: 0.10, fn: function (r, o, t) { clay(r, o, t, 1); clay(r, o, t + 0.055, 1.12); } },
  win: { set: 'A', wet: 0.10, fn: function (r, o, t) { [0, 0.05, 0.09, 0.15, 0.2, 0.27, 0.33].forEach(function (dt, i) { clay(r, o, t + dt, 0.9 + (i % 4) * 0.08); }); wood(r, o, t + 0.12, { f: 392, d: 0.5, g: 0.16 }); wood(r, o, t + 0.2, { f: 587, d: 0.6, g: 0.16 }); } },
  lose: { set: 'A', wet: 0.10, fn: function (r, o, t) { tone(r, o, t, { f: 112, f2: 70, d: 0.24, g: 0.42 }); hiss(r, o, t, { type: 'lowpass', f: 420, q: 0.7, d: 0.12, g: 0.3 }); } },
  right: { set: 'B', wet: 0.28, fn: function (r, o, t) { keys(r, o, t, { f: 659, d: 0.5, g: 0.13 }); keys(r, o, t + 0.03, { f: 988, d: 0.55, g: 0.12 }); } },
  combo: { set: 'B', wet: 0.28, fn: function (r, o, t) { keys(r, o, t, { f: 1319, d: 0.13, g: 0.09, index: 0.6 }); } },
  clear: { set: 'B', wet: 0.28, fn: function (r, o, t) { keys(r, o, t, { f: 523, d: 0.9, g: 0.13 }); keys(r, o, t + 0.22, { f: 659, d: 0.9, g: 0.13 }); keys(r, o, t + 0.44, { f: 784, d: 1.3, g: 0.13 }); keys(r, o, t + 0.44, { f: 1047, d: 1.3, g: 0.11 }); } },
  wrong: { set: 'B', wet: 0.28, fn: function (r, o, t) { keys(r, o, t, { f: 220, d: 0.26, g: 0.18, lp: 900, dull: true, index: 0.5 }); } },
};

/** 在通路 r 上、时刻 t（秒，音频上下文的时间）放一个声音；和试听页的 play() 一样：每个声音一条自己的通路，按那一套的份量送混响 */
function playOn(r, name, t) {
  var s = SOUNDS[name];
  if (!s) return;
  s.fn(r, bus(r, s.wet), t);
}

exports.makeRig = makeRig;
exports.playOn = playOn;
exports.SOUNDS = SOUNDS;
});
