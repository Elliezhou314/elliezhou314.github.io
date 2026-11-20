__squidDefine('src/ui/review/growth.js', function (exports) {
'use strict';
// 「复盘与漏洞」的「成长曲线」签：训练决策的 EV 损失按天走势、限时速算逐局走势、数学竞赛现况。
// 每张图和它下面的「看数据表」用的是同一份汇总结果（train/notebook.js 的 evTrend / speedTrend）。
const { evTrend, compareSentence, speedTrend, puzzleTotals, TREND_CAP_PCT, SMALL_DAY_N } = __squidRequire('src/train/notebook.js');
const { STAR_GATES } = __squidRequire('src/train/season.js');
const { pctText } = __squidRequire('src/train/speed.js');
const { lineChart, dataTable } = __squidRequire('src/ui/chart.js');
const { h } = __squidRequire('src/ui/dom.js');
const { store } = __squidRequire('src/ui/services.js');
const { shortTime } = __squidRequire('src/ui/review/mistakes.js');

const empty = (text) => h('div', { class: 'note rvempty' }, text);

/** 第几天（从 1970-01-01 起）→ 「11-18」 */
function dayLabel(x) {
  const d = new Date(x * 86400000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 纵轴上限：8、10、12 里第一个盖得住最高的点（留一点头）；有点被封顶就是 12 */
function evYMax(points) {
  const top = Math.max(...points.map((p) => p.shown));
  return [8, 10].find((v) => v >= top + 0.3) || TREND_CAP_PCT;
}

/** 速算纵轴：每格 1、2、5、10… 题，最多五格，盖得住最好成绩和每一局 */
function countAxis(maxV) {
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((s) => Math.ceil((maxV + 0.5) / s) <= 5) || 2000;
  return { step, yMax: Math.max(step, Math.ceil((maxV + 0.5) / step) * step) };
}

function evPanel() {
  const t = evTrend(store.data.attempts);
  const panel = h('div', { class: 'panel rvev', 'data-days': String(t.points.length), 'data-graded': String(t.graded) },
    h('h2', {}, '训练决策的 EV 损失走势'));
  const excludedNote = (t.excluded.noEv || t.excluded.coarse)
    ? h('div', { class: 'small muted' }, `不在图上的记录：${t.excluded.noEv} 条没有 EV（翻前闪卡、取不到 EV 的决策），${t.excluded.coarse} 个「无法判分」的决策（解得太糙）。`) : null;
  if (!t.points.length) {
    panel.append(empty('还没有数据。训练关或「特训地图」里每判一个决策，这里就按天记下当天的平均 EV 损失。'), excludedNote || '');
    return panel;
  }
  if (t.compare) panel.append(h('div', { class: 'rvclaim', 'data-w': String(t.compare.W) }, compareSentence(t.compare)));
  if (t.points.length === 1) panel.append(h('div', { class: 'note' }, `只有 ${t.points[0].day} 这一天的数据，还看不出走势。`));
  const points = t.points.map((p) => ({
    x: p.dayNum, shown: p.shown, value: p.mean, hollow: p.small, capped: p.capped, capLabel: p.mean.toFixed(1) + '%', key: p.day,
    detail: [p.day, `判了 ${p.n} 个决策`, `平均 ${p.mean.toFixed(2)}%`, `中位数 ${p.median.toFixed(2)}%`, p.small ? `样本少（不到 ${SMALL_DAY_N} 个）` : '']
      .filter(Boolean),
  }));
  panel.append(lineChart({
    cls: 'evchart', points, xLabel: dayLabel, xTitle: '日期（本机日期）', yMax: evYMax(t.points), yStep: 2, yUnit: '%',
    yTitle: '当天平均 EV 损失（% 底池）', ariaLabel: '训练决策的 EV 损失按天走势',
    hlines: STAR_GATES.map((g) => ({ value: g.pct, label: `${g.name}线 ${g.pct}%`, cls: 'g' + g.stars })),
  }));
  panel.append(h('div', { class: 'chartlegend small' },
    h('span', {}, h('i', { class: 'lg dot' }), `当天平均（当天至少 ${SMALL_DAY_N} 个决策）`),
    t.points.some((p) => p.small) ? h('span', {}, h('i', { class: 'lg dot hollow' }), `空心：样本少（不到 ${SMALL_DAY_N} 个）`) : null,
    t.points.some((p) => p.capped) ? h('span', {}, h('i', { class: 'lg tri' }), `超过 ${TREND_CAP_PCT}% 画在顶上，旁边写真实数值`) : null,
    h('span', {}, h('i', { class: 'lg gate' }), '虚线：训练关星级门槛')));
  panel.append(h('div', { class: 'note' },
    '每个点 = 那一天（本机日期）全部已判分训练决策的 EV 损失平均值（% 底池），和闯关里算星级用的是同一个算法：',
    '取不到 EV 的、「无法判分」的（包括这份解的可利用度达到三星门槛 0.5%、不够格判分的）不算；落在采样噪声里的照常等权计入。',
    `纵轴从 0 起、按真实比例，最高 ${TREND_CAP_PCT}%。图上方那句比较按记录先后取最近 W 个决策和再之前 W 个（W 默认 50，不够时取总数的一半，至少 10；总数不到 20 不比）。`),
    excludedNote || '');
  panel.append(dataTable(['日期', '平均 EV 损失（% 底池）', '中位数', '决策数'],
    t.points.map((p) => [p.day, p.mean.toFixed(2), p.median.toFixed(2), String(p.n)]), 'evtbl'));
  return panel;
}

function speedPanel() {
  const s = speedTrend(store.data.speed);
  const panel = h('div', { class: 'panel rvspt', 'data-runs': String(s.points.length) }, h('h2', {}, '限时速算 60 秒挑战走势'));
  if (!s.points.length) {
    panel.append(empty(s.runs
      ? `还没有逐局数据。你挑战过 ${s.runs} 局，都是在加上逐局记录这个功能之前打的，那时还不记每一局，图从下一局开始画。个人最好 ${s.best} 题。`
      : '还没有数据。到「限时速算」打一局 60 秒挑战，每一局的答对数都会画在这里。'));
    return panel;
  }
  const { step, yMax } = countAxis(Math.max(s.best, ...s.points.map((p) => p.correct)));
  const points = s.points.map((p) => ({
    x: s.withoutHistory + p.i, shown: p.correct, value: p.correct, key: String(s.withoutHistory + p.i),
    detail: [`第 ${s.withoutHistory + p.i} 局`, shortTime(p.time), `答对 ${p.correct} 题 / 答了 ${p.answered} 题`, `正确率 ${p.rate == null ? '—' : pctText(p.rate)}`],
  }));
  panel.append(lineChart({
    cls: 'spchart', points, xLabel: (x) => String(x), xTitle: '第几局', yMax, yStep: step, yUnit: '', yTitle: '这一局答对（题）',
    ariaLabel: '限时速算每局答对数', hlines: s.best ? [{ value: s.best, label: `个人最好 ${s.best} 题`, cls: 'best' }] : [],
  }));
  panel.append(h('div', { class: 'chartlegend small' },
    h('span', {}, h('i', { class: 'lg dot' }), '每局答对的题数'), h('span', {}, h('i', { class: 'lg gate best' }), '虚线：个人最好')));
  panel.append(h('div', { class: 'note' }, s.withoutHistory
    ? `你一共挑战了 ${s.runs} 局，前 ${s.withoutHistory} 局没有逐局明细（是在加上逐局记录这个功能之前打的，或超出了只留最近 200 局的上限），图从有记录的第 ${s.withoutHistory + 1} 局画起；个人最好算的是全部 ${s.runs} 局。`
    : `共 ${s.runs} 局，每局都有记录。个人最好那条线取的是记录里的最好成绩。`));
  panel.append(dataTable(['局次', '日期', '答对', '答题', '正确率'],
    s.points.map((p) => [String(s.withoutHistory + p.i), shortTime(p.time), String(p.correct), String(p.answered), p.rate == null ? '—' : pctText(p.rate)]), 'sptbl2'));
  return panel;
}

function contestPanel() {
  const t = puzzleTotals(store.data.puzzles || {});
  return h('div', { class: 'panel rvct' }, h('h2', {}, '数学竞赛'),
    t.touched
      ? h('div', {}, h('div', { class: 'scoreline' }, h('span', {}, '已解 ', h('b', {}, `${t.solved}/${t.total}`)), h('span', {}, '星级 ', h('b', {}, `${t.stars}/${t.maxStars}`))),
        h('div', { class: 'small muted' }, '作答记录里没有时间，画不出走势，这里只写现在的情况。'))
      : empty('还没有作答记录。到「数学竞赛」做几道题，这里会写解出几题、共几星（作答记录里没有时间，不画走势）。'));
}

function growthTab() {
  return [evPanel(), speedPanel(), contestPanel()];
}

exports.growthTab = growthTab;
});
