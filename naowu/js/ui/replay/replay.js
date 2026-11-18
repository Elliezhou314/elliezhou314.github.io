__squidDefine('src/ui/replay/replay.js', function (exports) {
'use strict';
// 牌局回放的界面：把一手打完的牌在自由牌局的牌桌上一步一步重放。
//
// 步骤全部来自 review/replay.js 的 buildReplay（只凭手牌记录还原、逐步和记录里引擎当时写下的数核对）；
// 牌桌就是自由牌局那一个组件（ui/table.js），这里只决定给它看第几步、要不要动画：
//   - 往前走一步：用牌桌现有的动画（下注、筹码进池、翻牌、派彩）；
//   - 往回走、拖进度条、点折线上的点：直接到位，不播动画；
//   - 系统要求减少动态效果时，牌桌组件自己就一律直接到位。
// 连续快点、自动播放中途手动操作、切走再回来：牌桌组件每次 show() 都会作废上一段还没演完的动画，画面总是停在最后要的那一步。
// 每一步的数学：轮到你、面前有下注时写「跟 X 去争 Y，至少要 Z% 的胜率才不亏」；
// 打开「事后视角」后所有人的牌翻开，写出你当时对上还没弃牌的对手实际手牌的胜率，并画胜率折线（equitypanel.js）。
// 不给任何一步打好坏：自由牌局的对手是经验规则的机器人，没有解算器的期望值可以判分，这里只摆数字。
const { STREET_CN } = __squidRequire('src/engine/game.js');
const { buildReplay, stepView, callNeedText, STEP } = __squidRequire('src/review/replay.js');
const { h } = __squidRequire('src/ui/dom.js');
const { equityChart, equityLines, loadSeries, planNote } = __squidRequire('src/ui/replay/equitypanel.js');

const SPEEDS = [{ label: '1×', hold: 1100 }, { label: '2×', hold: 420 }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

/**
 * 在 host 里装一个回放。table 是自由牌局的牌桌组件；onExit 是「回到牌局」；onReview(rec) 去看文字复盘。
 * 返回 { destroy }。记录还原不了时只写明原因，不画任何牌局画面。
 */
function mountReplay({ host, table, rec, onExit, onReview }) {
  const rep = buildReplay(rec);
  host.innerHTML = '';
  const root = h('div', { class: 'panel replay', 'data-ok': rep.ok ? '1' : '0' });
  host.append(root);
  const back = h('button', { class: 'rpback', onclick: () => onExit() }, '回到牌局');
  if (!rep.ok) {
    root.append(h('h2', {}, `回放 · 第 ${rec && rec.handNo != null ? rec.handNo : '?'} 手`), h('div', { class: 'note rpcant' }, rep.reason + '。这手的文字记录和复盘照常能看。'), h('div', { class: 'row' }, back));
    return { destroy: () => {}, rep };
  }
  const key = 'rp' + (++seq);
  const last = rep.steps.length - 1;
  const st = { cur: 0, reveal: false, playing: false, speed: 0, gen: 0, playGen: 0, dead: false, series: null };

  const sayEl = h('div', { class: 'rpsay', 'aria-live': 'polite' });
  const callEl = h('div', { class: 'rpcall' });
  const eqEl = h('div', { class: 'rpeqbox' });
  const chartEl = h('div', { class: 'rpchartbox' });
  const countEl = h('span', { class: 'rpcount mono' });
  const prev = h('button', { class: 'rpbtn', 'data-act': 'prev', onclick: () => { pause(); go(st.cur - 1, false); } }, '上一步');
  const next = h('button', { class: 'rpbtn', 'data-act': 'next', onclick: () => { pause(); go(st.cur + 1, true); } }, '下一步');
  const playBtn = h('button', { class: 'rpbtn primary', 'data-act': 'play', onclick: () => (st.playing ? pause() : play()) }, '自动播放');
  const speedBtn = h('button', { class: 'rpbtn', 'data-act': 'speed', onclick: () => { st.speed = (st.speed + 1) % SPEEDS.length; speedBtn.textContent = '速度 ' + SPEEDS[st.speed].label; } }, '速度 ' + SPEEDS[0].label);
  const seek = h('input', { type: 'range', class: 'rpseek', min: 0, max: last, step: 1, value: 0, 'aria-label': '拖到第几步' });
  seek.addEventListener('input', () => { pause(); go(Number(seek.value), false); });
  const revealBox = h('input', { type: 'checkbox', class: 'rpreveal' });
  revealBox.addEventListener('change', () => setReveal(revealBox.checked));
  const toReview = onReview ? h('button', { onclick: () => onReview(rec) }, '看文字复盘（可从那里用解算器解决策点）') : null;

  root.append(
    h('div', { class: 'rphead' }, h('h2', {}, `回放 · 第 ${rec.handNo} 手`), countEl),
    sayEl, callEl,
    h('div', { class: 'rpctl' }, prev, playBtn, next, speedBtn),
    h('div', { class: 'rpseekrow' }, seek),
    h('label', { class: 'rptoggle' }, revealBox, h('span', {}, '亮出所有人的牌（事后视角）')),
    eqEl, chartEl,
    h('div', { class: 'row rpfoot' }, back, toReview),
  );

  /** 画第 i 步。anim 为真且正好是往前一步时用动画，否则直接到位 */
  function go(i, anim) {
    if (st.dead) return Promise.resolve(false);
    i = Math.max(0, Math.min(last, i));
    const forward = anim && i === st.cur + 1;
    if (i === st.cur && anim) return Promise.resolve(true);
    st.cur = i;
    renderText();
    const g = ++st.gen;
    root.dataset.busy = '1';
    const p = table.show(stepView(rep, i, { reveal: st.reveal, key }), { instant: !forward });
    p.then(() => { if (g === st.gen && !st.dead) root.dataset.busy = '0'; });
    return p;
  }

  function renderText() {
    const s = rep.steps[st.cur];
    root.dataset.step = String(st.cur);
    root.dataset.steps = String(rep.steps.length);
    countEl.textContent = `第 ${st.cur + 1} / ${rep.steps.length} 步 · ${s.type === STEP.SHOWDOWN ? '摊牌' : s.type === STEP.AWARD ? '派彩' : STREET_CN[s.street]}`;
    sayEl.textContent = s.text;
    callEl.textContent = s.heroCall ? '轮到你：' + callNeedText(s.heroCall) : '';
    callEl.hidden = !s.heroCall;
    seek.value = String(st.cur);
    prev.disabled = st.cur === 0;
    next.disabled = st.cur === last;
    renderEquity();
  }

  function renderEquity() {
    eqEl.innerHTML = '';
    if (!st.reveal) return;
    eqEl.append(h('div', { class: 'note small' }, '这是事后才知道的数：当时你并不知道对手的牌，它用来回看这手牌的走势，不是当时该用的决策依据。'));
    if (!st.series) {
      const pn = planNote(rep);
      eqEl.append(h('div', { class: 'muted small rpwait' }, `正在算每一步的胜率：${pn.text}……`));
      return;
    }
    eqEl.append(equityLines(rep, st.series[st.cur]));
    for (const g of chartEl.querySelectorAll('.pt')) g.classList.toggle('on', g.dataset.key === String(st.cur));
  }

  function setReveal(on) {
    st.reveal = on;
    root.dataset.reveal = on ? '1' : '0';
    chartEl.innerHTML = '';
    if (on && !st.series) {
      const pn = planNote(rep);
      loadSeries(rep, (m) => { const w = eqEl.querySelector('.rpwait'); if (w) w.textContent = `正在算每一步的胜率：${pn.text}……（已算 ${m.done} / ${m.total}）`; })
        .then((series) => {
          if (st.dead) return;
          st.series = series;
          root.dataset.ready = '1';
          if (st.reveal) { chartEl.append(equityChart(rep, series, (i) => { pause(); go(i, false); })); renderEquity(); }
        })
        .catch((e) => { if (!st.dead && st.reveal) { eqEl.innerHTML = ''; eqEl.append(h('div', { class: 'note' }, '胜率没算出来：' + e.message)); } });
    } else if (on) chartEl.append(equityChart(rep, st.series, (i) => { pause(); go(i, false); }));
    renderEquity();
    table.show(stepView(rep, st.cur, { reveal: on, key }), { instant: true });
  }

  async function play() {
    if (st.cur === last) await go(0, false);
    st.playing = true;
    playBtn.textContent = '暂停';
    root.dataset.playing = '1';
    const my = ++st.playGen;
    const alive = () => st.playing && my === st.playGen && !st.dead;
    while (alive() && st.cur < last) {
      if (!host.isConnected || host.offsetParent === null) { pause(); return; }   // 切到别的页面就停下，回来接着手动点
      await go(st.cur + 1, true);
      if (!alive()) return;
      await sleep(SPEEDS[st.speed].hold);
    }
    if (alive()) pause();
  }
  function pause() {
    st.playing = false; st.playGen++;
    playBtn.textContent = '自动播放';
    root.dataset.playing = '0';
  }

  // 电脑上：左右方向键上一步、下一步（输入框和下拉框里按方向键不抢；进度条自己会响应方向键）
  function onKey(e) {
    if (st.dead || host.offsetParent === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); go(st.cur - 1, false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); go(st.cur + 1, true); }
  }
  document.addEventListener('keydown', onKey);

  root.dataset.reveal = '0';
  root.dataset.playing = '0';
  go(0, false);
  return {
    rep,
    destroy() { st.dead = true; pause(); st.gen++; document.removeEventListener('keydown', onKey); },
  };
}

exports.mountReplay = mountReplay;
});
