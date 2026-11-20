__squidDefine('src/ui/views/campaign.js', function (exports) {
'use strict';
// 「闯关」视图：章节、关卡、每日挑战、成就。
const { adviceHeadline, adviceReport } = __squidRequire('src/train/advice/index.js');
const { getPuzzle } = __squidRequire('src/train/puzzles.js');
const { CHAPTERS, ALL_LEVELS, getLevel, rankOf, ACHIEVEMENTS, dayKey } = __squidRequire('src/train/season.js');
const { SCENARIOS } = __squidRequire('src/train/training.js');
const { appendTo, h, $, toast } = __squidRequire('src/ui/dom.js');
const { starRow } = __squidRequire('src/ui/fx.js');
const { allScenarios, levelRec, seasonData, levelStars, levelCleared, DEMO, levelUnlocked, achievementState, syncPuzzleLevelScores, todayChallenge, dailyRec, markDailyDone } = __squidRequire('src/ui/progress.js');
const { goButton } = __squidRequire('src/ui/review/advicego.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');
const { contestState } = __squidRequire('src/ui/views/contest.js');
const { reviewState } = __squidRequire('src/ui/views/review.js');
const { startDrill } = __squidRequire('src/ui/views/drill.js');
const { showTour } = __squidRequire('src/ui/views/tour.js');

const campaignState = { openChapter: null };

function buildCampaignView() {
  const v = $('#view-campaign');
  v.innerHTML = '';
  syncPuzzleLevelScores();   // 谜题关的星换算成赛季分
  checkDailyDone();          // 状态判定放在渲染之前，别在渲染过程中改数据
  if (DEMO) v.append(h('div', { class: 'note' }, h('b', {}, '演示模式'), '：全部关卡已解锁（URL 里带了 #demo）。这只影响解锁判定，星级与判分口径完全不变。'));
  v.append(adviceLine());
  // 限时速算的入口：热身用，不进赛季分和星级
  const sp = store.data.speed || { best: 0 };
  v.append(h('div', { class: 'panel spentry' },
    h('div', {}, h('b', {}, '限时速算'), h('span', { class: 'small muted' }, `　60 秒连续心算，四选一。${sp.best ? `个人最好 ${sp.best} 题。` : '先热个身再闯关。'}`)),
    h('button', { class: 'primary', onclick: () => switchView('speed') }, '去速算')));
  const s = seasonData();
  const rk = rankOf(s.score);

  // ---- 赛季头 ----
  const bar = h('div', { class: 'rankbar' }, h('div', { style: { width: `${Math.round(rk.progress * 100)}%` } }));
  v.append(h('div', { class: 'panel' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
      h('div', {}, h('h2', { style: { margin: 0 } }, '赛季进度'),
        h('div', { class: 'scoreline' },
          h('span', {}, '段位 ', h('b', {}, rk.name)),
          h('span', {}, '总分 ', h('b', {}, s.score)),
          h('span', {}, '最长连击 ', h('b', {}, s.bestCombo)),
          h('span', {}, '通关 ', h('b', {}, `${ALL_LEVELS.filter(levelCleared).length}/${ALL_LEVELS.length}`)))),
      h('div', {},
        h('div', { class: 'small muted', style: { textAlign: 'right' } }, rk.next ? `距 ${rk.next.name} 还差 ${rk.toNext} 分` : '已是最高段位'),
        h('button', { class: 'small', style: { marginTop: '4px' }, onclick: () => showTour(0) }, '看新手引导'))),
    bar,
    h('div', { class: 'note' },
      h('b', {}, '训练关的星级只看 EV 损失'), '：≤0.5% 底池三星、≤2% 两星、≤6% 一星。',
      h('b', {}, '　谜题关的星级看作答过程'), '：没看提示、第一次就答对 3 星，用过提示或答了多次 1 星（答案保留一位小数即可）。',
      '两者尺子不同，章节星数是把它们直接相加，只当进度看。',
      '连击只放大分数、不影响任何星级。',
      '3 人局判分落在采样噪声里时既不加连击也不断连击，但仍按实测 EV 损失等权计入星级——',
      '「落在噪声里」只说明这个差距在统计上看不出来，算出的损失本身并不偏高也不偏低；给它打折反而会把星级算偏。',
      'EV 完全取不到的决策（解算失败）则既不计星级也不计分数。'),
  ));

  v.append(buildDailyCard());

  // ---- 章节 ----
  for (const c of CHAPTERS) {
    const got = c.levels.reduce((a, l) => a + levelStars(l), 0);
    const box = h('div', { class: 'panel' });
    box.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('h2', { style: { margin: 0 } }, c.name),
      h('span', { class: 'stars' }, `${got}/${c.levels.length * 3} ★`)));
    box.append(h('div', { class: 'small muted', style: { marginBottom: '8px' } }, c.intro));
    const grid = h('div', { class: 'map' });
    for (const l of c.levels) {
      const unlocked = levelUnlocked(l);
      const st = levelStars(l);
      const rec = levelRec(l.id);
      const node = h('div', { class: 'node' + (unlocked ? '' : ' locked') + (st === 3 ? ' mastered' : ''), 'data-level': l.id });
      node.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('b', {}, l.name),
        starRow(st, { total: 3, size: 'sm', animate: false })));
      // 用 appendTo 不用原生 append：后面那个条件元素为空时，原生 append 会把 null 写成文字（v0.9 起每个关卡格子里都印着「null」）
      appendTo(node, h('div', { class: 'small muted' },
        l.kind === 'puzzle'
          // 谜题关显示「解了几道」：整关星级要全部解出才给，中途看不到进度会以为白做了
          ? `${l.puzzles.filter((q) => ((store.data.puzzles || {})[q] || {}).solved).length}/${l.puzzles.length} 道题已解：${l.puzzles.join('、')}`
          : `${l.decisions || 12} 个决策 · ${(SCENARIOS.find((x) => x.id === l.scenario) || {}).name || l.scenario}`),
      l.kind === 'puzzle' && st === 0 && l.puzzles.some((q) => ((store.data.puzzles || {})[q] || {}).solved)
        ? h('div', { class: 'small muted' }, '（整关的星级要这一关的题全部解出才给）') : null);
      if (rec && rec.runs) node.append(h('div', { class: 'small muted' }, `打过 ${rec.runs} 次，最好平均损失 ${rec.bestLossPct != null ? rec.bestLossPct.toFixed(2) + '%' : '—'}，最高分 ${rec.bestScore}`));
      if (!unlocked) node.append(h('div', { class: 'small muted' }, '未解锁：先完成 ' + l.requires.map((r) => (getLevel(r) || {}).name || r).join('、')));
      else node.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => startLevel(l) }, st ? '再打一次' : '开始')));
      grid.append(node);
    }
    box.append(grid);
    v.append(box);
  }

  // ---- 成就 ----
  const ast = achievementState();
  const ach = h('div', { class: 'panel' }, h('h2', {}, '成就'));
  const wrap = h('div', { class: 'achgrid' });
  for (const a of ACHIEVEMENTS) {
    const done = a.check(ast);
    wrap.append(h('div', { class: 'ach' + (done ? ' done' : '') },
      h('b', {}, done ? '✓ ' : '○ ', a.name),
      h('div', { class: 'small muted' }, a.desc)));
  }
  ach.append(wrap);
  v.append(ach);
}

/** 顶上一行：「我的提高建议」里最弱的一项和一个直达按钮（判断全在 train/advice/，这里不记快照，只在复盘页打开时记） */
function adviceLine() {
  const hl = adviceHeadline(adviceReport(store.data));
  return h('div', { class: 'panel advline' },
    h('div', { class: 'small advlinetext' }, hl.line),
    h('div', { class: 'advlinebtns' }, goButton(hl.action, true),
      h('button', { 'data-act': 'advice-all', onclick: () => { reviewState.tab = 'advice'; switchView('review'); } }, '看全部建议')));
}

function buildDailyCard() {
  const s = seasonData();
  const d = todayChallenge();
  const rec = dailyRec(d.key);
  const done = rec.p[0] && rec.p[1] && rec.drill;
  const box = h('div', { class: 'panel daily' + (done ? ' done' : '') });
  box.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
    h('h2', { style: { margin: 0 } }, '每日挑战 · ' + d.key),
    h('span', { class: 'small muted' }, s.dailyStreak > 0 ? `已连续 ${s.dailyStreak} 天` : '还没开始连续')));
  box.append(h('div', { class: 'small muted' }, '题目由当天日期决定，同一天固定，换天才换。没有随机奖励。'));
  const puzNames = d.puzzles.map((id) => { const p = getPuzzle(id); return p ? `${p.id} ${p.title}` : id; });
  const scName = (SCENARIOS.find((x) => x.id === d.scenario) || {}).name || d.scenario;
  box.append(h('div', { class: 'small', style: { marginTop: '6px' } },
    h('div', {}, '① ' + puzNames[0]),
    h('div', {}, '② ' + puzNames[1]),
    h('div', {}, `③ ${d.decisions} 个决策：${scName}`)));
  if (done) box.append(h('div', { class: 'note' }, '今天的挑战已完成，明天再来。'));
  else {
    box.append(h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => { contestState.open = d.puzzles[0]; contestState.fromCampaign = true; switchView('contest'); toast('做完点右上角「回到闯关」继续'); } }, '做第 1 道题'),
      h('button', { onclick: () => { contestState.open = d.puzzles[1]; contestState.fromCampaign = true; switchView('contest'); } }, '做第 2 道题'),
      h('button', {
        onclick: () => {
          const sc = SCENARIOS.find((x) => x.id === d.scenario);
          if (!sc) { toast('场景不存在'); return; }
          startLevel({ id: 'daily-' + d.key, name: '每日挑战 · ' + scName, kind: 'drill', scenario: d.scenario, decisions: d.decisions, hands: 30, requires: [], daily: d.key });
        },
      }, `打 ${d.decisions} 个决策`)));
    box.append(h('div', { class: 'small muted', style: { marginTop: '6px' } },
      `今天的进度：题目 ${rec.p.filter(Boolean).length}/2，训练 ${rec.drill ? '已完成' : '未完成'}`,
      '　（按「今天有没有作答」算，不看这道题以前解没解过）'));
  }
  return box;
}

/** 当天三件事都做完就记一次完成；顺便让断掉的连续天数归零 */
function checkDailyDone() {
  const s = seasonData();
  const today = dayKey(Date.now());
  const y = dayKey(Date.now() - 86400000);
  // 连续天数会断：最后一次完成既不是今天也不是昨天，就清零，别一直挂着「已连续 N 天」
  if (s.lastDaily && s.lastDaily !== today && s.lastDaily !== y && s.dailyStreak > 0) { s.dailyStreak = 0; store.save(); }
  const d = todayChallenge();
  const rec = dailyRec(d.key);
  if (rec.done) return;
  if (rec.p[0] && rec.p[1] && rec.drill) markDailyDone(d.key);
}

/** 开始一个关卡：谜题关跳到题目，训练关进训练视图跑固定手数（过关卡片的「下一关」经 router.js 也走这里） */
function startLevel(level) {
  if (level.kind === 'puzzle') {
    const unsolved = level.puzzles.find((id) => !((store.data.puzzles || {})[id] || {}).solved);
    contestState.open = unsolved || level.puzzles[0];
    contestState.fromCampaign = true;
    switchView('contest');
    toast(unsolved ? `这一关有 ${level.puzzles.length} 道题，做完回闯关看星级` : '这一关的题都做过了，想重新挑战可以点「重置这道题」');
    return;
  }
  const sc = allScenarios().find((x) => x.id === level.scenario);
  if (!sc) { toast('场景不存在：' + level.scenario); return; }
  switchView('drill');
  startDrill(sc, { level, decisions: [] });
}

exports.buildCampaignView = buildCampaignView;
exports.startLevel = startLevel;
});
