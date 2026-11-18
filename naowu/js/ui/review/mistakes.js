__squidDefine('src/ui/review/mistakes.js', function (exports) {
'use strict';
// 「复盘与漏洞」的「错题本」签（默认签）：训练里做错的决策、数学竞赛里没一次做对的题、限时速算里最弱的题型。
// 汇总全在 train/notebook.js，这里只画；每栏没有数据时写明「还没有」和去哪儿能产生数据。
const { STREET_NAMES } = __squidRequire('src/solver/tree.js');
const { mistakeBook, puzzleMisses, puzzleTotals, speedWeakTypes, SPEED_SMALL_N } = __squidRequire('src/train/notebook.js');
const { dayKey } = __squidRequire('src/train/season.js');
const { pctText } = __squidRequire('src/train/speed.js');
const { scenarioToSpec } = __squidRequire('src/train/training.js');
const { variantRows } = __squidRequire('src/train/variants/record.js');
const { cardsEl } = __squidRequire('src/ui/cards.js');
const { appendTo, h, toast } = __squidRequire('src/ui/dom.js');
const { allScenarios } = __squidRequire('src/ui/progress.js');
const { startScenario, switchView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');
const { contestState } = __squidRequire('src/ui/views/contest.js');
const { solverState } = __squidRequire('src/ui/views/solver.js');
const { startPractice } = __squidRequire('src/ui/views/speed.js');

const streetName = (s) => STREET_NAMES[s] || `第 ${s} 街`;

/** 记录的时间 → 「11-18 21:05」（本机时间） */
function shortTime(t) {
  if (!Number.isFinite(t)) return '时间不详';
  const d = new Date(t);
  return `${dayKey(t).slice(5)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const empty = (text) => h('div', { class: 'note rvempty' }, text);

// ---------------------------------------------------------------------------
// 训练里做错的决策
// ---------------------------------------------------------------------------
function exampleEl(ex) {
  const cardsOr = (cards, text) => (cards ? cardsEl(cards, true) : h('span', { class: 'mono' }, text || '—'));
  return h('div', { class: 'mbex' },
    h('div', { class: 'mbcards' },
      h('div', {}, h('label', {}, '公共牌'), cardsOr(ex.board, ex.boardText)),
      h('div', {}, h('label', {}, '手牌'), cardsOr(ex.hand, ex.handText))),
    h('div', { class: 'small' },
      h('div', {}, '你选：', h('b', {}, ex.chosen || '—'), '　EV 最高：', h('b', {}, ex.best || '—')),
      h('div', {}, `这一次损失 ${ex.loss.toFixed(2)}% 底池（`, h('span', { class: `grade ${ex.grade}` }, ex.grade), '）')));
}

function groupCard(g) {
  const sc = allScenarios().find((x) => x.id === g.scenarioId);
  const name = sc ? sc.name : g.scenarioName;
  const after = g.after.n
    ? `之后同一场景的${streetName(g.street)}又判了 ${g.after.n} 个决策，其中 ${g.after.good} 个是良好以上。`
    : '之后还没再练（同一场景的这条街一个决策都没再判过）。';
  const startBoard = sc ? sc.boards.find((b) => g.example.boardText.startsWith(b)) : null;
  const buttons = sc
    ? h('div', { class: 'actions' },
      h('button', { class: 'primary', 'data-act': 'drill', onclick: () => startScenario(sc) }, '再练这个局面'),
      h('button', { 'data-act': 'solver', onclick: () => {
        solverState.applySpec({ ...scenarioToSpec(sc, startBoard || undefined), ranges: sc.ranges });
        switchView('solver');
        toast('已载入这个局面，点「开始解算」可以逐点看策略');
      } }, '在解算器里看'))
    : h('div', { class: 'small muted' }, '这个场景已经不在了（多半是删掉的自定义场景），没法直接再练，也装不进解算器。');
  return h('div', { class: 'mbgroup', 'data-key': g.key, 'data-n': String(g.n), 'data-loss': String(g.totalLoss), 'data-scenario': g.scenarioId },
    h('div', { class: 'mbhead' }, h('b', {}, name), h('span', { class: 'tag' }, streetName(g.street)), h('span', { class: 'tag' }, g.type)),
    h('div', { class: 'small' }, `错了 ${g.n} 次，累计损失 ${g.totalLoss.toFixed(2)}% 底池，最近一次 ${shortTime(g.lastTime)}。`),
    exampleEl(g.example),
    h('div', { class: 'small mbafter' + (g.after.n ? '' : ' muted') }, after),
    buttons);
}

function drillPanel() {
  const book = mistakeBook(store.data.attempts);
  const panel = h('div', { class: 'panel rvmb' }, h('h2', {}, '训练里做错的决策'));
  if (!book.groups.length) {
    panel.append(empty('还没有。训练里被判为「小错」「大错」的决策会按局面归到这里——到「闯关」的训练关或「特训地图」里练几手就有了。'));
  } else {
    panel.append(h('div', { class: 'note' },
      `和「漏洞报告」同一批记录：算过 EV、被判为小错或大错的决策共 ${book.leaks} 个，按「场景 + 哪条街 + 错误类型」归成 ${book.groups.length} 组，`,
      '按累计损失从大到小排。损失是这个决策比 EV 最高的动作少拿的筹码占当时底池的百分比，累计 = 每次相加。',
      '「之后」按记录先后算，只数同一场景、同一条街上判过分的决策（良好以上 = 完美或良好）。'));
    panel.append(h('div', { class: 'mblist' }, book.groups.map(groupCard)));
  }
  if (book.preflop.total) {
    panel.append(h('div', { class: 'small muted rvpf', 'data-total': String(book.preflop.total), 'data-wrong': String(book.preflop.wrong) },
      `翻前闪卡：答了 ${book.preflop.total} 次，其中 ${book.preflop.wrong} 次偏离了翻前图的策略（选了频率不到 30% 的动作）。`,
      '翻前图只给策略频率、没有动作 EV，所以这里只报次数，不算损失，也不进上面的分组。'));
  }
  if (book.noEv) panel.append(h('div', { class: 'small muted' }, `另有 ${book.noEv} 个训练决策没取到 EV（无法判分），不进错题本。`));
  return panel;
}

// ---------------------------------------------------------------------------
// 数学竞赛里没一次做对的题
// ---------------------------------------------------------------------------
/** 变式练习各题型「第一次就答对」的比例，一行字；一道都没做过就不写（行由 train/variants/record.js 现数） */
function variantLine() {
  const rows = variantRows(store.data.variants);
  if (!rows.length) return null;
  return h('div', { class: 'small muted rvvx', 'data-types': String(rows.length) }, '变式练习（不计星级）第一次就答对：',
    rows.map((r) => `${r.name} ${r.firstTry}/${r.done}（${pctText(r.rate)}）`).join('；'), '。');
}

function puzzlePanel() {
  const recs = store.data.puzzles || {};
  const rows = puzzleMisses(recs);
  const tot = puzzleTotals(recs);
  const panel = h('div', { class: 'panel rvpz' }, h('h2', {}, '数学竞赛里没一次做对的题'));
  if (!rows.length) {
    panel.append(empty(tot.touched
      ? `还没有。你答过的 ${tot.touched} 道题都是没看提示、第一次就答对的。`
      : '还没有。到「数学竞赛」做几道题：答了不止一次的、看过提示的、答过还没解出来的，都会列在这里。'));
    appendTo(panel, variantLine());
    return panel;
  }
  panel.append(h('div', { class: 'note' }, '「没一次做对」= 不是没看提示、第一次就答对：答了不止一次的、看过提示的、答过还没解出来的。星级照竞赛的规则（看过提示或答了多次 1 星）。重置一道题请到题目页里自己点。'));
  const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '题号'), h('th', {}, '题名'), h('th', {}, '答了'), h('th', {}, '提示'), h('th', {}, '解出'), h('th', {}, '星'), h('th', {}, '')));
  for (const r of rows) {
    tbl.append(h('tr', { 'data-pid': r.id },
      h('td', { class: 'mono' }, r.id), h('td', {}, r.title), h('td', {}, `${r.attempts} 次`), h('td', {}, `${r.hints} 条`),
      h('td', {}, r.solved ? '是' : '没有'), h('td', {}, `${r.stars} 星`),
      h('td', {}, h('button', { class: 'small', 'data-act': 'puzzle', onclick: () => { contestState.open = r.id; contestState.fromCampaign = false; switchView('contest'); } }, '去做这道题'))));
  }
  panel.append(h('div', { class: 'scroll-x' }, tbl));
  appendTo(panel, variantLine());
  return panel;
}

// ---------------------------------------------------------------------------
// 限时速算里最弱的题型
// ---------------------------------------------------------------------------
function speedPanel() {
  const { rows, untouched } = speedWeakTypes(store.data.speed);
  const panel = h('div', { class: 'panel rvsp' }, h('h2', {}, '限时速算里最弱的题型'));
  if (!rows.length) {
    panel.append(empty('还没有。到「限时速算」打一局 60 秒挑战或做做不限时练习，各题型的对错会累计在这里。'));
    return panel;
  }
  panel.append(h('div', { class: 'note' }, `按累计正确率从低到高排（60 秒挑战和练习里答过的题都算）；累计不到 ${SPEED_SMALL_N} 题的标「样本少」，排在后面。`));
  const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '题型'), h('th', {}, '对'), h('th', {}, '错'), h('th', {}, '正确率'), h('th', {}, '')));
  for (const r of rows) {
    tbl.append(h('tr', { 'data-type': r.type },
      h('td', {}, r.name, r.small ? h('span', { class: 'tag rvsmall' }, '样本少') : null),
      h('td', { class: 'mono' }, r.right), h('td', { class: 'mono' }, r.wrong), h('td', { class: 'mono' }, pctText(r.rate)),
      h('td', {}, h('button', { class: 'small', 'data-act': 'speed', onclick: () => { switchView('speed'); startPractice([r.type]); } }, '去练这一类'))));
  }
  panel.append(h('div', { class: 'scroll-x' }, tbl));
  if (untouched.length) panel.append(h('div', { class: 'small muted' }, `还没答过：${untouched.join('、')}。`));
  return panel;
}

function mistakesTab() {
  return [drillPanel(), puzzlePanel(), speedPanel()];
}

exports.shortTime = shortTime;
exports.mistakesTab = mistakesTab;
});
