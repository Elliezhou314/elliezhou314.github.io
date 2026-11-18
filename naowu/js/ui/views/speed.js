__squidDefine('src/ui/views/speed.js', function (exports) {
'use strict';
// 「限时速算」视图：60 秒挑战与不限时练习。这里只管显示、计时和记账，出题、判分、统计全在 train/speed.js。
//
// 计时挑战：倒计时条；答对闪一下绿立刻下一题；答错标出正确选项和一行「怎么算的」，停 1.5 秒再下一题（计时不停）。
// 时间到了就结算：答对几题、正确率、最长连对、各题型对错、是否刷新个人最好。
// 不限时练习：可以只选几种题型；每题答完都给「怎么算的」，自己点「下一题」；不计入最好成绩。
//
// 测试钩子：window.__squidSpeedTest = { seconds, seed } 在开局时读一次，把时长缩短、把种子定下来，
// tools/uicheck.mjs 靠它在 Node 里用同一个种子重放出同一串题，知道哪个选项是对的。界面上没有任何入口能设它。
const { SPEED_TYPES, SPEED_TYPE_IDS, SPEED_SECONDS, SPEED_REVEAL_MS, createSpeedDeck, isCorrect, summarizeSpeed, recordAnswer, recordTimedRun, coerceSpeedRecord, pctText } = __squidRequire('src/train/speed.js');
const { makeRng } = __squidRequire('src/core/cards.js');
const { cardsEl } = __squidRequire('src/ui/cards.js');
const { appendTo, h, $ } = __squidRequire('src/ui/dom.js');
const { pill, play } = __squidRequire('src/ui/fx.js');
const { store } = __squidRequire('src/ui/services.js');
const { sfx } = __squidRequire('src/ui/sfx.js');

const RIGHT_FLASH_MS = 260;   // 答对后闪绿的时长
const typeName = (id) => (SPEED_TYPES.find((t) => t.id === id) || {}).name || id;

// game：当前这一局（null = 在开始页）；practiceTypes：练习时勾选的题型
const state = { game: null, practiceTypes: new Set(SPEED_TYPE_IDS) };

const record = () => coerceSpeedRecord(store.data.speed);

/** 离开页面或重开时调用：停掉计时器和待办的翻页，这一局作废（不记成绩） */
function stopSpeed() {
  const g = state.game;
  if (!g) return;
  g.over = true;
  cancelAnimationFrame(g.raf);
  clearTimeout(g.pending);
  clearTimeout(g.endTimer);
  state.game = null;
}

function buildSpeedView() {
  stopSpeed();
  const v = $('#view-speed');
  v.innerHTML = '';
  v.append(startPage());
}

// ---------------------------------------------------------------------------
// 开始页
// ---------------------------------------------------------------------------
function startPage() {
  const rec = record();
  const root = h('div', { class: 'spstart', 'data-best': String(rec.best), 'data-runs': String(rec.runs) });
  root.append(h('div', { class: 'panel' },
    h('h2', {}, '限时速算'),
    h('div', { class: 'scoreline' },
      h('span', {}, '个人最好 ', h('b', { class: 'spbest' }, rec.best), ' 题'),
      h('span', {}, '挑战过 ', h('b', {}, rec.runs), ' 局')),
    h('div', { class: 'note' },
      `${SPEED_SECONDS} 秒内连续心算，每题四个选项点一个，答完立刻下一题。题目是牌桌上要在几秒钟里算出来的那几种数：`,
      '跟注要多少胜率、最少要防守多少、补牌命中率、跟注的期望值、对手还剩几种组合、你有几张补牌。'),
    h('div', { class: 'note' },
      '每道题都由随机参数当场出、答案当场算；三个错误选项来自真实的常见算错（比如忘了算上自己的跟注、两张的命中率直接相加）。',
      '概率写成百分数保留一位小数，筹码保留一位小数，个数是整数，和数学竞赛同一个口径。速算不计入赛季分、星级、段位和成就。'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary big', 'data-act': 'timed', onclick: () => startGame('timed') }, `开始 ${SPEED_SECONDS} 秒挑战`),
      h('button', { class: 'big', 'data-act': 'practice', onclick: () => startGame('practice') }, '不限时练习'))));

  // 练习时练哪几种
  const chips = h('div', { class: 'sptypes' });
  const syncChips = () => chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', state.practiceTypes.has(b.dataset.type)));
  for (const t of SPEED_TYPES) {
    chips.append(h('button', { 'data-type': t.id, 'aria-pressed': 'true', onclick: (e) => {
      const id = e.currentTarget.dataset.type;
      if (state.practiceTypes.has(id) && state.practiceTypes.size > 1) state.practiceTypes.delete(id); else state.practiceTypes.add(id);
      chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(state.practiceTypes.has(b.dataset.type))));
      syncChips();
    } }, t.name));
  }
  syncChips();
  root.append(h('div', { class: 'panel' }, h('h2', {}, '不限时练习练哪几种'),
    h('div', { class: 'small muted' }, '点一下去掉、再点一下加回来，至少留一种。60 秒挑战总是七种都出。'), chips));

  // 各题型累计（两种模式都记）
  const tbl = h('table', { class: 'tbl sptbl' }, h('tr', {}, h('th', {}, '题型'), h('th', {}, '对'), h('th', {}, '错'), h('th', {}, '正确率')));
  for (const t of SPEED_TYPES) {
    const x = rec.byType[t.id], n = x.right + x.wrong;
    tbl.append(h('tr', {}, h('td', {}, t.name), h('td', { class: 'mono' }, x.right), h('td', { class: 'mono' }, x.wrong), h('td', { class: 'mono' }, n ? pctText(x.right / n) : '—')));
  }
  root.append(h('div', { class: 'panel' }, h('h2', {}, '各题型累计'), h('div', { class: 'small muted' }, '60 秒挑战和练习里答过的题都算。'), h('div', { class: 'scroll-x' }, tbl)));
  return root;
}

/**
 * 从别的页面直接开一局不限时练习、只练给定的几种题型（错题本的「去练这一类」用）。
 * 调用方先切到本页（switchView('speed')），再调这里；开始页上「练哪几种」的勾选也改成这几种。
 */
function startPractice(types) {
  const ids = (types || []).filter((t) => SPEED_TYPE_IDS.includes(t));
  if (!ids.length) return;
  state.practiceTypes = new Set(ids);
  startGame('practice', ids);
}

// ---------------------------------------------------------------------------
// 一局
// ---------------------------------------------------------------------------
function startGame(mode, types) {
  stopSpeed();
  const hook = typeof window !== 'undefined' && window.__squidSpeedTest ? window.__squidSpeedTest : {};
  const seconds = Number.isFinite(hook.seconds) && hook.seconds > 0 && hook.seconds <= SPEED_SECONDS ? hook.seconds : SPEED_SECONDS;
  const seed = Number.isInteger(hook.seed) ? hook.seed : (Date.now() >>> 0);
  const useTypes = mode === 'timed' ? SPEED_TYPE_IDS : [...(types || state.practiceTypes)];
  const g = {
    mode, seconds, deck: createSpeedDeck(makeRng(seed), useTypes), log: [], q: null, locked: false, over: false,
    startedAt: performance.now(), raf: 0, pending: 0, endTimer: 0, els: {},
  };
  state.game = g;
  const v = $('#view-speed');
  v.innerHTML = '';
  const top = h('div', { class: 'sptop' });
  if (mode === 'timed') {
    g.els.fill = h('div');
    g.els.left = h('b', { class: 'spleft' }, String(seconds));
    g.els.score = h('b', { class: 'spscore' }, '0');
    top.append(h('div', { class: 'sptimer', role: 'timer', 'aria-label': '剩余时间' }, g.els.fill),
      h('div', { class: 'row spstat' }, h('span', {}, '剩 ', g.els.left, ' 秒'), h('span', {}, '答对 ', g.els.score, ' 题')));
  } else {
    g.els.score = h('b', { class: 'spscore' }, '0');
    g.els.count = h('span', {}, '第 1 题');
    top.append(h('div', { class: 'row spstat' }, g.els.count, h('span', {}, '答对 ', g.els.score),
      h('button', { class: 'small', onclick: () => buildSpeedView() }, '结束练习')));
  }
  g.els.body = h('div', { class: 'spbody' });
  v.append(h('div', { class: 'panel spgame', 'data-mode': mode }, top, g.els.body));
  nextQuestion(g);
  if (mode === 'timed') {
    tick(g);
    // 倒计时条靠 requestAnimationFrame 刷新；页面切到后台时它会停，所以「时间到」另用一个定时器兜底
    g.endTimer = setTimeout(() => finishTimed(g), seconds * 1000 + 50);
  }
}

function tick(g) {
  if (g.over) return;
  const left = Math.max(0, g.seconds - (performance.now() - g.startedAt) / 1000);
  g.els.fill.style.width = (left / g.seconds) * 100 + '%';
  g.els.fill.className = left <= 10 ? 'low' : '';
  g.els.left.textContent = String(Math.ceil(left));
  if (left <= 0) { finishTimed(g); return; }
  g.raf = requestAnimationFrame(() => tick(g));
}

function nextQuestion(g) {
  if (g.over) return;
  g.q = g.deck.next();
  g.locked = false;
  const q = g.q;
  if (g.els.count) g.els.count.textContent = `第 ${g.log.length + 1} 题`;
  const body = g.els.body;
  body.innerHTML = '';
  const cards = q.cards ? h('div', { class: 'spcards' },
    h('div', {}, h('label', {}, '你的手牌'), cardsEl(q.cards.hole)),
    q.cards.board.length ? h('div', {}, h('label', {}, '公共牌'), cardsEl(q.cards.board)) : null) : null;
  const opts = h('div', { class: 'spopts' });
  q.options.forEach((o, i) => opts.append(h('button', { class: 'spopt', 'data-i': String(i), onclick: () => answer(g, i) }, o.text)));
  g.els.opts = opts;
  g.els.how = h('div', { class: 'sphow', 'aria-live': 'polite' });
  body.append(h('div', { class: 'spq', 'data-type': q.type },
    h('div', { class: 'small muted' }, q.typeName), h('div', { class: 'sptext' }, q.text), cards), opts, g.els.how);
}

function answer(g, i) {
  if (g.locked || g.over || state.game !== g) return;
  g.locked = true;
  const q = g.q, ok = isCorrect(q, i);
  g.log.push({ type: q.type, ok });
  store.data.speed = recordAnswer(store.data.speed, q.type, ok);
  store.save();
  g.els.score.textContent = String(g.log.filter((a) => a.ok).length);
  const btns = [...g.els.opts.querySelectorAll('button')];
  btns.forEach((b) => (b.disabled = true));
  play(btns[q.answer]).classList.add('right');
  if (ok) sfx.right(); else { btns[i].classList.add('wrong'); sfx.wrong(); }
  if (g.mode === 'timed') {
    if (!ok) showHow(g, q, null);
    g.pending = setTimeout(() => nextQuestion(g), ok ? RIGHT_FLASH_MS : SPEED_REVEAL_MS);
    return;
  }
  // 练习：每题都给「怎么算的」，答错再说一句你选的那个错在哪，自己点下一题
  showHow(g, q, ok ? null : q.options[i]);
  const next = h('button', { class: 'primary', onclick: () => nextQuestion(g) }, '下一题');
  g.els.how.append(h('div', { class: 'actions' }, next));
  next.focus({ preventScroll: true });
}

function showHow(g, q, wrongPick) {
  g.els.how.innerHTML = '';
  // 「口算：…；精确：…」分两行显示：先看估算，再看精确值（窄屏上一整串挤在一起不好读）
  const [mental, exact] = q.how.includes('；精确：') ? q.how.split('；精确：') : [null, q.how];
  appendTo(g.els.how, h('div', { class: 'sphowline' }, h('b', {}, '怎么算的：'),
    mental ? [h('span', { class: 'spmental' }, mental + '；'), h('br'), '精确：' + exact] : q.how),
    wrongPick ? h('div', { class: 'small muted spwhy' }, `你选的 ${wrongPick.text}：${wrongPick.why}。`) : null);
}

// ---------------------------------------------------------------------------
// 结束页
// ---------------------------------------------------------------------------
function finishTimed(g) {
  if (g.over || state.game !== g) return;
  g.over = true;
  clearTimeout(g.pending);
  clearTimeout(g.endTimer);
  cancelAnimationFrame(g.raf);
  const sum = summarizeSpeed(g.log);
  const { rec, newBest, prevBest } = recordTimedRun(store.data.speed, sum);
  store.data.speed = rec;
  store.save();
  sfx.clear();
  const v = $('#view-speed');
  v.innerHTML = '';
  const rows = SPEED_TYPES.filter((t) => sum.byType[t.id].right + sum.byType[t.id].wrong > 0);
  const tbl = h('table', { class: 'tbl sptbl' }, h('tr', {}, h('th', {}, '题型'), h('th', {}, '对'), h('th', {}, '错')));
  for (const t of rows) {
    const x = sum.byType[t.id];
    tbl.append(h('tr', { class: t.id === sum.weakest ? 'weak' : '' }, h('td', {}, t.name, t.id === sum.weakest ? '（这局最弱）' : ''),
      h('td', { class: 'mono' }, x.right), h('td', { class: 'mono' }, x.wrong)));
  }
  const weakBtn = sum.weakest
    ? h('button', { 'data-act': 'weak', onclick: () => startGame('practice', [sum.weakest]) }, `去练最弱的那一类：${typeName(sum.weakest)}`)
    : h('button', { 'data-act': 'weak', onclick: () => startGame('practice', SPEED_TYPE_IDS) }, '这局没答错，去不限时练习');
  const card = h('div', { class: 'clear spend', 'data-correct': String(sum.correct), 'data-answered': String(sum.answered),
    'data-best': String(rec.best), 'data-newbest': String(newBest) },
  h('div', { class: 'eb' }, '时间到'),
  h('div', { class: 'spbig' }, '答对 ', h('b', {}, sum.correct), ' 题'),
  newBest ? pill(prevBest ? `刷新个人最好（原来 ${prevBest} 题）` : '第一次记下个人最好', 'grade 完美')
    : h('div', { class: 'small muted' }, `个人最好 ${rec.best} 题`),
  h('div', { class: 'why' }, sum.answered
    ? `答了 ${sum.answered} 题，正确率 ${pctText(sum.accuracy)}，最长连对 ${sum.bestStreak} 题。`
    : '这局一题都没答。'),
  rows.length ? h('div', { class: 'scroll-x' }, tbl) : null,
  h('div', { class: 'actions' },
    h('button', { class: 'primary', 'data-act': 'again', onclick: () => startGame('timed') }, '再来一局'),
    weakBtn,
    h('button', { onclick: () => buildSpeedView() }, '回到开始页')));
  v.append(card);
}

exports.stopSpeed = stopSpeed;
exports.buildSpeedView = buildSpeedView;
exports.startPractice = startPractice;
});
