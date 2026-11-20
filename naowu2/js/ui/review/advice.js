__squidDefine('src/ui/review/advice.js', function (exports) {
'use strict';
// 「复盘与漏洞」的「提高建议」签（v0.17，第一个签、默认签）：根据这台设备存的记录，给出最该练的 3 项、数据还不够的项目、上次最弱那项的对比。
// 判断、排序、文字全在 train/advice/（纯逻辑），这里只画；每条建议一句结论、一行依据数字、一个直达按钮，推导收进「怎么算的」。
// 打开这个签（复盘页在前台时）记一份快照：当时最弱的那一项和它的数，下次打开拿来对比。
const { adviceReport } = __squidRequire('src/train/advice/index.js');
const { recordSnap } = __squidRequire('src/train/advice/snapshot.js');
const { KIND_NAME, RULE_LINES } = __squidRequire('src/train/advice/text.js');
const { h, $ } = __squidRequire('src/ui/dom.js');
const { store } = __squidRequire('src/ui/services.js');
const { goButton } = __squidRequire('src/ui/review/advicego.js');

/** 折叠的「怎么算的」：summary 做成 44 像素高，手指点得到 */
const fold = (title, lines, cls = '') => h('details', { class: 'advhow ' + cls }, h('summary', {}, title), ...lines.filter(Boolean).map((t) => h('div', { class: 'small' }, t)));

/** 一条建议：一句结论、一行依据、一个按钮；推导收进折叠 */
function itemCard(it, i) {
  const t = it.text;
  return h('div', { class: 'advitem', 'data-kind': it.kind, 'data-key': it.key, 'data-rank': String(i + 1), 'data-n': String(it.n), 'data-ok': String(it.ok) },
    h('div', { class: 'advhead' }, h('span', { class: 'advno' }, String(i + 1)), h('b', { class: 'advtitle' }, t.title), h('span', { class: 'tag' }, KIND_NAME[it.kind])),
    h('div', { class: 'small advbasis' }, t.basis),
    h('div', { class: 'actions' }, goButton(t.action, true)),
    fold('怎么算的', [t.why, ...t.how, t.note]));
}

/** 一行字 + 一个按钮（数据还不够、保持建议） */
const lineRow = (cls, x, extra = {}) => h('div', { class: 'advrow ' + cls, ...extra }, h('div', { class: 'small' }, x.text.line), goButton(x.text.action));

const PENDING_SHOWN = 4;

function mainPanel(rep) {
  const panel = h('div', { class: 'panel advpanel', 'data-status': rep.status }, h('h2', {}, '我的提高建议'));
  panel.append(h('div', { class: 'small muted' }, '只看这台设备上存的记录，当场算的，不联网、不上传。'));
  if (rep.compare) panel.append(h('div', { class: 'note advcmp', 'data-state': rep.compare.state, 'data-kind': rep.compare.kind, 'data-key': rep.compare.key }, rep.compare.text));
  if (rep.status === 'weak') {
    panel.append(h('h3', {}, `最该练的 ${rep.top.length} 项`), h('div', { class: 'advlist' }, rep.top.map(itemCard)));
  } else if (rep.status === 'start') {
    panel.append(h('h3', {}, '刚开始，先做这三件'),
      h('div', { class: 'note advgeneric' }, '这是通用的入门路径，不是根据你的记录算的（你还没有可以判断的记录）。做完这些，这里就按你自己的记录给建议。'),
      h('div', { class: 'advlist' }, rep.starter.map((s, i) => h('div', { class: 'advitem', 'data-kind': 'start', 'data-rank': String(i + 1) },
        h('div', { class: 'advhead' }, h('span', { class: 'advno' }, String(i + 1)), h('b', { class: 'advtitle' }, s.title)),
        h('div', { class: 'small advbasis' }, s.basis),
        h('div', { class: 'actions' }, goButton(s.action, true))))));
  } else if (rep.status === 'none') {
    panel.append(h('div', { class: 'advnone' }, h('b', {}, '没有明显的弱项。'), ' 下过结论的项目都过了门槛。'));
    if (rep.keep.length) panel.append(h('h3', {}, '保持：离门槛最近的几项'), ...rep.keep.map((x) => lineRow('advkeep', x, { 'data-kind': x.kind, 'data-key': x.key })));
  } else {
    panel.append(h('div', { class: 'advnone' }, h('b', {}, '数据还不够，还不能下结论。'), ' 下面写着每一项再做多少就能判断。'));
  }
  return panel;
}

function pendingPanel(rep) {
  if (!rep.pending.length && !rep.empty.length) return null;
  const panel = h('div', { class: 'panel advpending' }, h('h2', {}, '数据还不够的'));
  const shown = rep.pending.slice(0, PENDING_SHOWN), rest = rep.pending.slice(PENDING_SHOWN);
  if (shown.length) panel.append(h('div', { class: 'small muted' }, '按「再做多少就能判断」从少到多排。'), ...shown.map((x) => lineRow('advpend', x, { 'data-kind': x.kind, 'data-key': x.key })));
  if (rest.length) panel.append(h('details', { class: 'advhow' }, h('summary', {}, `其余 ${rest.length} 项`), ...rest.map((x) => lineRow('advpend', x, { 'data-kind': x.kind, 'data-key': x.key }))));
  for (const e of rep.empty) panel.append(h('div', { class: 'small muted advempty', 'data-kind': e.kind }, e.line));
  return panel;
}

function notesPanel(rep) {
  return h('div', { class: 'panel advnotes' },
    h('div', { class: 'small muted advhands', 'data-hands': String(rep.hands) },
      rep.hands ? `自由牌局：这台设备记了 ${rep.hands} 手（最多留最近 300 手）。` : '自由牌局：还没有记录。',
      '牌局没有标准答案，输赢里有运气，所以不参与排名；想看某一手，到「历史与数据」里回放或复盘。'),
    rep.preflop ? h('div', { class: 'small muted' }, `翻前闪卡答了 ${rep.preflop} 次：翻前图只给策略频率、没有动作 EV，也不参与。`) : null,
    fold('判断规则（怎么算弱、怎么排）', RULE_LINES, 'advrules'));
}

function adviceTab() {
  const rep = adviceReport(store.data);
  // 复盘页在前台时才记快照（启动时各页面在后台先画一遍，那不算「打开」）
  const view = $('#view-review');
  if (rep.snap && view && view.classList.contains('active')) {
    const r = recordSnap(store.data.advice, rep.snap);
    if (r.changed) { store.data.advice = r.rec; store.save(); }
  }
  return [mainPanel(rep), pendingPanel(rep), notesPanel(rep)];
}

exports.adviceTab = adviceTab;
});
