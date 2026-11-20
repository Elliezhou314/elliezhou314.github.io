__squidDefine('src/ui/replay/equitypanel.js', function (exports) {
'use strict';
// 牌局回放的「事后视角」：向后台线程要每一步的胜率（口径在 review/hindsight.js），
// 在回放下方写一句话、画一条胜率随步骤变化的折线（ui/chart.js，竖虚线标换街）。
// 这里不算任何数：胜率由后台线程算，这里只把它写成玩家看得懂的话、交给画图模块摆放。
const { STREET_CN } = __squidRequire('src/engine/game.js');
const { hindsightPlan, hindsightSeries, equityText, HINDSIGHT_SAMPLES } = __squidRequire('src/review/hindsight.js');
const { STEP } = __squidRequire('src/review/replay.js');
const { lineChart } = __squidRequire('src/ui/chart.js');
const { h } = __squidRequire('src/ui/dom.js');
const { client } = __squidRequire('src/ui/services.js');

const cache = new WeakMap();   // 同一次回放里开关来回切，不重算

/** 这一手要算几个局面、翻前的几个要抽样：等待时照实写出来 */
function planNote(rep) {
  const plan = hindsightPlan(rep);
  const pre = plan.jobs.filter((j) => j.board.length === 0).length;
  const post = plan.jobs.length - pre;
  const parts = [];
  if (pre) parts.push(`翻前 ${pre} 个局面各抽样 ${HINDSIGHT_SAMPLES} 次`);
  if (post) parts.push(`翻牌以后 ${post} 个局面把剩下的公共牌全部枚举`);
  return { total: plan.jobs.length, text: parts.join('，') };
}

/** 每一步的胜率（Promise）。后台线程逐个局面回报进度 */
function loadSeries(rep, onProgress) {
  if (cache.has(rep)) return cache.get(rep);
  const plan = hindsightPlan(rep);
  const p = (plan.jobs.length ? client.hindsight(plan.jobs, onProgress).then((m) => m.results) : Promise.resolve([]))
    .then((results) => hindsightSeries(rep, plan, results));
  p.catch(() => cache.delete(rep));
  cache.set(rep, p);
  return p;
}

const pct = (x) => (x * 100).toFixed(1) + '%';

/** 第 i 步的那段话：你的胜率一行（data-* 写着原值，测试拿它和 Node 算的对），还在局里的各家一行 */
function equityLines(rep, s) {
  const name = (seat) => rep.players[seat].name;
  const box = h('div', { class: 'rpeq', 'data-hero': String(s.hero), 'data-exact': s.exact ? '1' : '0', 'data-se': String(s.heroSe || 0), 'data-folded': s.heroFolded ? '1' : '0' });
  if (s.heroFolded) box.append(h('div', {}, h('b', {}, '你已弃牌'), '：这一步起你的胜率记 0。'));
  else box.append(h('div', {}, '你当时的胜率（事后才知道）：', h('b', {}, equityText(s.hero, s.exact, s.heroSe)), '。'));
  if (s.live.length > 1) {
    box.append(h('div', { class: 'small muted' }, '还在局里的各家：' + s.live.map((seat) => `${name(seat)} ${s.exact ? '' : '约 '}${pct(s.bySeat[seat])}`).join('，')
      + (s.exact ? '（剩下的公共牌全部枚举，精确值）' : '（抽样估计）') + '。'));
  } else box.append(h('div', { class: 'small muted' }, `只剩 ${name(s.live[0])} 一家没弃牌（胜率 100%）。`));
  return box;
}

/** 胜率随步骤变化的折线：点数 = 步骤数，空心点是抽样估计，竖虚线标换街和摊牌 */
function equityChart(rep, series, onPick) {
  const vlines = [];
  rep.steps.forEach((st, i) => {
    if (st.type === STEP.STREET) vlines.push({ x: i + 1, label: STREET_CN[st.street] });
    if (st.type === STEP.SHOWDOWN) vlines.push({ x: i + 1, label: '摊牌' });
  });
  const points = series.map((s, i) => ({
    x: i + 1, shown: s.hero * 100, value: s.hero * 100, hollow: !s.exact, key: i,
    detail: [`第 ${i + 1} 步`, rep.steps[i].text, s.heroFolded ? '你已弃牌（记 0）' : '你的胜率 ' + equityText(s.hero, s.exact, s.heroSe)],
  }));
  const chart = lineChart({
    points, vlines, onPick: (p) => onPick(p.key), cls: 'rpchart',
    xLabel: (x) => String(x), xTitle: '第几步', yMax: 100, yStep: 25, yUnit: '%', yTitle: '你的胜率（事后视角）',
    hint: '点一个点跳到那一步。实心点是精确值（剩下的公共牌全部枚举），空心点是抽样估计（翻前）；竖虚线是换街和摊牌。',
    ariaLabel: '每一步你的胜率',
  });
  return chart;
}

exports.planNote = planNote;
exports.loadSeries = loadSeries;
exports.equityLines = equityLines;
exports.equityChart = equityChart;
});
