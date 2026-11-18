__squidDefine('src/ui/views/drill.js', function (exports) {
'use strict';
// 「特训地图」视图：技能节点、发牌训练、逐决策判分、间隔重复。
const { cardToPretty, cardsToPretty, cardsToStr, COMBOS, COMBO_COUNT } = __squidRequire('src/core/cards.js');
const { evaluate, describeValue } = __squidRequire('src/core/evaluator.js');
const { MAX_CACHED_SOLVERS } = __squidRequire('src/solver/squid.js');
const { STREET_NAMES } = __squidRequire('src/solver/tree.js');
const { summarizeRun, nextCombo, nextStepAdvice, STAR_GATES } = __squidRequire('src/train/season.js');
const { DRILL_MAP, DrillSession, scenarioToSpec } = __squidRequire('src/train/training.js');
const { embeddedSolution } = __squidRequire('src/ui/data.js');
const { cardsEl } = __squidRequire('src/ui/cards.js');
const { clearCard, rankNow } = __squidRequire('src/ui/clearcard.js');
const { appendTo, h, $, pct, f1, f2, toast, actionColors } = __squidRequire('src/ui/dom.js');
const { evScale, pill } = __squidRequire('src/ui/fx.js');
const { allScenarios, saveLevelRun, dailyRec } = __squidRequire('src/ui/progress.js');
const { switchView, refreshView } = __squidRequire('src/ui/router.js');
const { client, drillClient, store } = __squidRequire('src/ui/services.js');
const { sfx } = __squidRequire('src/ui/sfx.js');
const { reviewState } = __squidRequire('src/ui/views/review.js');
const { solverState } = __squidRequire('src/ui/views/solver.js');

const drillState = { solutions: new Map(), session: null, scenario: null, stats: null, levelCtx: null };

// 主线程缓存的解不能比 Worker 里的 solver 多（MAX_CACHED_SOLVERS 在 squid.js，两处同源）。
// 取动作 EV 要靠 solveId 回 Worker 索引，主线程留得更多就会出现
// 「主线程还有这个场景、Worker 已经淘汰了」→ 一判分就报错。
// 内置均衡解有 16 个局面，一路练过去正好会踩到这个坑——所以装内置解那条分支也必须走这里。
const MAX_DRILL_SOLUTIONS = MAX_CACHED_SOLVERS - 1;

function rememberSolution(key, sol) {
  drillState.solutions.set(key, sol);
  while (drillState.solutions.size > MAX_DRILL_SOLUTIONS) {
    drillState.solutions.delete(drillState.solutions.keys().next().value);
  }
}

/**
 * 结算上一段训练的间隔重复。一次"复习"= 一整段训练（离开场景、切换视图、关页面时结算），
 * 质量取本段所有决策的平均，并对"错得多"额外惩罚；不足 3 个决策不算一次复习。
 */
function flushSrs() {
  const st = drillState.stats, sc = drillState.scenario;
  if (!st || !sc || !st.qs) return;
  const qs = st.qs.filter((q) => q != null);
  // 不足 3 个决策就先留着：切个视图再回来接着练，这些计数还应该算数。
  // 早先无条件清空 qs，短片段直接蒸发，短时训练的用户 SM-2 永远推不动。
  if (qs.length < 3) return;
  st.qs = [];
  const avg = qs.reduce((a, b) => a + b, 0) / qs.length;
  const bad = qs.filter((q) => q <= 2).length / qs.length;
  const q = Math.max(0, Math.min(5, Math.round(bad > 0.3 ? Math.min(avg, 2) : avg)));
  store.reviewScenario(sc.id, q);
}

function buildDrillView() {
  const v = $('#view-drill');
  v.innerHTML = '';
  const mapEl = h('div', { class: 'map' });
  const modules = [...DRILL_MAP];
  if (store.data.customScenarios.length) modules.push({ id: 'custom', name: '自定义场景', scenarios: store.data.customScenarios.map((s) => s.id), desc: '你从解算器里保存的场景。', requires: [] });
  for (const m of modules) {
    const st = store.moduleStats(m, allScenarios());
    const unlocked = m.kind === 'preflop' ? true : st.unlocked;
    const node = h('div', { class: 'node' + (unlocked ? '' : ' locked') + (st.mastered ? ' mastered' : '') },
      h('div', {}, h('b', {}, m.name), ' ', st.mastered ? h('span', { class: 'tag' }, '已掌握') : unlocked ? '' : h('span', { class: 'tag' }, '🔒 先完成前置')),
      h('div', { class: 'muted small' }, m.desc),
      h('div', { class: 'small', style: { margin: '6px 0' } }, st.attempts ? `最近 ${st.attempts} 次：正确率 ${pct(st.accuracy)}，平均 EV 损失 ${st.avgLossPct.toFixed(2)}% 底池` : '尚未训练'),
      m.kind === 'preflop' ? h('button', { onclick: () => switchView('preflop') }, '去翻前图做闪卡')
        : h('div', { class: 'row' }, m.scenarios.map((id) => { const sc = allScenarios().find((x) => x.id === id); return sc ? h('button', { disabled: !unlocked, onclick: () => startDrill(sc) }, sc.name.length > 18 ? sc.name.slice(0, 18) + '…' : sc.name) : null; })),
    );
    mapEl.append(node);
  }
  const due = store.dueScenarios(allScenarios()).filter((sc) => store.data.srs[sc.id]); // 只列练过的
  const dueEl = h('div', { class: 'panel' }, h('h2', {}, '今日到期复习'), due.length ? h('div', { class: 'row' }, due.slice(0, 8).map((sc) => h('button', { onclick: () => startDrill(sc) }, sc.name))) : h('span', { class: 'muted' }, '没有到期项。'));
  const sessionEl = h('div', { class: 'panel', id: 'drill-session' }, h('span', { class: 'muted' }, '从地图里选一个场景开始。每个场景先由鱿鱼解算器现场解一次（10~30 秒），之后同一牌面复用。'));
  v.append(h('div', { class: 'note' }, '判分口径：EV 损失 = 该点最高 EV 动作 − 你的动作 EV。2 人局由向量 CFR 精确计算；3 人局为蒙特卡洛估计（带 ±SE，噪声大时会标注）。解锁规则：前置模块 ≥10 次且正确率 ≥60%。'),
    h('div', { class: 'cols cols-even' }, h('div', {}, h('div', { class: 'panel' }, h('h2', {}, '特训地图'), mapEl), dueEl), sessionEl));
}

/**
 * 取"某个节点上某手牌各动作的 EV"。训练判分与内置自检共用这一条路径——
 * 早先自检自己另写了一份正确的取值，恰好绕开了这里的引擎判定错误，
 * 于是 2 人局判分坏掉了却全程测试全绿。
 */
function makeEvProvider(sol, client) {
  return async (nodeId, combo) => {
    const node = sol.nodes[nodeId];
    if (sol.isVector) {
      const r = await client.actionEVs(sol.solveId, nodeId);
      return { evs: node.actions.map((_, a) => r.evs[a * COMBO_COUNT + combo]) };
    }
    const r = await client.actionEVs(sol.solveId, nodeId, combo, 3000);
    return { evs: r.evs, se: r.se };
  };
}

async function startDrill(sc, levelCtx = null) {
  flushSrs(); // 上一段训练先结算，再开新场景
  const el = $('#drill-session');
  el.innerHTML = '';
  const spec = scenarioToSpec(sc);
  const key = sc.id + ':' + cardsToStr(spec.board);
  const status = h('div', { class: 'small muted' }, '解算中…');
  const prog = h('div', { class: 'progress' }, h('div'));
  const levelBar = levelCtx ? h('div', { class: 'levelbar' }) : null;
  if (levelBar) el.append(levelBar);
  el.append(h('h2', {}, sc.name), h('div', { class: 'muted small' }, sc.desc), h('div', { class: 'small' }, '目标：', sc.goal), status, prog);
  const renderLevelBar = () => {
    if (!levelBar) return;
    levelBar.innerHTML = '';
    const done = levelCtx.decisions.length;
    const hands = drillState.stats ? drillState.stats.hands : 0;
    appendTo(levelBar,
      h('b', {}, '关卡：' + levelCtx.level.name),
      h('span', { class: 'small muted' }, `已判分 ${done}/${levelCtx.level.decisions || 12} 个决策（第 ${hands} 手）`),
      levelCtx.combo > 1 ? h('span', { class: 'combo' }, `连击 ×${levelCtx.combo}`) : null,
      h('button', { onclick: () => { switchView('campaign'); } }, '退出关卡'),
    );
  };
  if (levelCtx) { levelCtx.combo = 0; drillState.levelCtx = levelCtx; }
  let sol = drillState.solutions.get(key);
  if (!sol) {
    // 先看有没有内置的预解均衡：判分用的就是解出来的 EV，解得越糙判分越糙。
    // 内置的那 16 个局面是离线解的，装回后可利用度 0.0005%~0.048%，秒开。
    const emb = embeddedSolution(sc.id, cardsToStr(spec.board));
    if (emb) {
      try {
        status.textContent = '载入内置均衡解…';
        sol = await drillClient.loadSolution(spec, emb.dims, emb.strategies,
          { iterations: emb.iterations, solveSeconds: emb.solveSeconds, exploitPct: emb.exploitPct },
          (m) => { if (m.phase === 'precompute') { status.textContent = `预计算 ${m.done}/${m.total}`; prog.firstChild.style.width = `${(m.done / m.total) * 100}%`; } });
        rememberSolution(key, sol);
      } catch (e) {
        // 内置解装不上就现场解，但要说出来，不能静默降级
        toast('内置均衡解装载失败，改为现场解算：' + e.message);
        sol = null;
      }
    }
  }
  if (!sol) {
    try {
      // 判分不能比解本身更精细：三星门槛是 EV 损失 ≤0.5% 底池，
      // 而旧预算（18 秒 / 目标 0.8%）在转牌场景上根本到不了这个门槛（见 README 里的实测表）。
      // 目标定在 0.15%、上限给 75 秒；解不到 0.5% 的场景 gradeDecision 会直接记「无法判分」。
      // 16 个 2 人局面已经内置、秒开，现场解只剩转牌那三个，花得起。
      // 3 人局是采样引擎、没有可利用度可言，维持原预算。
      const budget = sc.players === 3 ? { ms: 12000 } : { ms: 75000, targetExploitPct: 0.15 };
      sol = await drillClient.solve(spec, budget, (m) => {
        if (m.phase === 'precompute') { status.textContent = `预计算 ${m.done}/${m.total}`; prog.firstChild.style.width = `${(m.done / m.total) * 30}%`; }
        else if (m.phase === 'solve') {
          prog.firstChild.style.width = `${30 + Math.min(1, m.elapsed / budget.ms) * 70}%`;
          status.textContent = `现场解算：迭代 ${m.iter}`
            + (m.exploit ? `，可利用度 ${m.exploit.pctPot.toFixed(2)}%` : '')
            + (budget.targetExploitPct ? `（解到 ${budget.targetExploitPct}% 以下才停，否则判分会比解本身还精细）` : '');
        }
      });
      rememberSolution(key, sol);
    } catch (e) { status.textContent = '解算失败：' + e.message; return; }
  }
  // 解没达到判分需要的精度时，开场就说清楚，别等用户练完一局才发现不计分
  if (sol.summary.exploitPct != null && sol.summary.exploitPct >= 0.5) {
    toast(`这个场景只解到 ${sol.summary.exploitPct.toFixed(2)}% 可利用度，比三星门槛（0.5%）还糙，本局不计分。`, 5000);
  }
  status.textContent = sol.summary.preloaded
    ? `内置均衡解（离线解 ${sol.summary.offlineSeconds}s、${sol.summary.iterations} 迭代），现场重算可利用度 ${sol.summary.exploitPct.toFixed(3)}% 底池`
    : `现场解算：${sol.summary.engine}，${sol.summary.iterations} 迭代` + (sol.summary.exploitPct != null ? `，可利用度 ${sol.summary.exploitPct.toFixed(2)}% 底池` : '');
  prog.remove();
  const evProvider = makeEvProvider(sol, drillClient);
  drillState.scenario = sc;
  drillState.session = new DrillSession(sol, sc.heroSeat, evProvider);
  drillState.stats = { hands: 0, decisions: 0, loss: 0, grades: {}, qs: [] };
  const area = h('div');
  el.append(area);
  nextHand();

  function nextHand() {
    if (levelCtx) {
      const target = levelCtx.level.decisions || 12;
      // 按决策数结算，手数只当兜底上限：不同场景一手能产生的决策数差 2~3 倍，
      // 按手数结算会让「刷哪一关」决定段位涨得快慢。
      if (levelCtx.decisions.length >= target) return finishLevel();
      if (drillState.stats.hands >= (levelCtx.level.hands || 30)) return finishLevel();
    }
    const s = drillState.session;
    let st = null;
    for (let tries = 0; tries < 20 && (!st || st.over); tries++) st = s.newHand();
    if (!st || st.over) { area.innerHTML = '这手牌没轮到你决策，再来。'; area.append(h('button', { onclick: nextHand }, '下一手')); return; }
    drillState.stats.hands++;
    renderLevelBar();
    renderDecision();
  }

  /** 过关卡片上那句「星数由来」：数全部取自 summarizeRun 的结果，门槛取 STAR_GATES（starsFromLoss 判星用的就是它，见 train/season.js） */
  function starsWhy(run) {
    if (!Number.isFinite(run.avgLossPct)) return '这一关没有任何可判分的决策，给不出星级。';
    const avg = `平均 EV 损失 ${run.avgLossPct.toFixed(2)}% 底池`;
    const gate = STAR_GATES.find((g) => g.stars === run.stars);
    if (gate) return `${avg}，在 ${gate.pct}% 以内 → ${gate.name}`;
    return `${avg}，超过一星门槛 ${STAR_GATES[STAR_GATES.length - 1].pct}%，没有星`;
  }

  function finishLevel() {
    levelCtx.finished = true;
    drillState.levelCtx = null;
    const rankBefore = rankNow();
    const run = summarizeRun(levelCtx.decisions);
    const rec = saveLevelRun(levelCtx.level, run);
    if (levelCtx.level.daily) { dailyRec(levelCtx.level.daily).drill = true; store.save(); refreshView('campaign'); }
    area.innerHTML = '';
    if (levelBar) levelBar.remove();   // 关卡条在打完后只剩一个空框，过关卡片已经写了关卡名
    const gradeLine = Object.entries(run.grades).map(([k, v]) => `${k}×${v}`).join('　');
    // 过关卡片在上，原来的结算文字原样放在卡片下面
    area.append(clearCard({
      level: levelCtx.level, stars: run.stars, graded: Number.isFinite(run.avgLossPct), why: starsWhy(run),
      extra: rec.stars > run.stars ? `这次 ${run.stars} 星；这一关历史最好 ${rec.stars} 星，闯关页上记的是历史最好` : '',
      rankBefore, rankAfter: rankNow(),
    }));
    area.append(h('div', { class: 'panel', style: { marginTop: '10px' } },
      h('h2', {}, `关卡结算：${levelCtx.level.name}`),
      h('div', { class: 'scoreline', style: { marginTop: '6px' } },
        h('span', {}, '平均 EV 损失 ', h('b', {}, Number.isFinite(run.avgLossPct) ? run.avgLossPct.toFixed(2) + '%' : '—')),
        h('span', { class: 'small muted' }, '最长连击 ', run.bestCombo,
          '　得分 ', run.score, rec.gained !== run.score ? `（计入赛季 +${rec.gained}）` : '')),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${run.decisions} 个决策：${gradeLine}`,
        run.unusable ? `　其中 ${run.unusable} 个没能判分（EV 取不到），既不计入星级也不计入分数。` : ''),
      h('div', { class: 'note' }, '训练关的星级只由平均 EV 损失决定：≤0.5% 三星、≤2% 两星、≤6% 一星。',
        !Number.isFinite(run.avgLossPct) ? '　这一关没有任何可判分的决策，所以给不出星级——多半是解算没跑够或范围冲突，建议重新解算再打。'
          : run.stars < 3 ? `　离三星还差 ${(run.avgLossPct - STAR_GATES[0].pct).toFixed(2)} 个百分点。` : '　已经是三星。',
        rec.stars > run.stars ? `（历史最好成绩是 ${rec.stars} 星，本次 ${run.stars} 星；显示的是历史最好）` : ''),
      run.noisy ? h('div', { class: 'small muted' }, `其中 ${run.noisy} 个决策的差距落在噪声内（3 人局的 EV 是估计值，或者差距比解自己的可利用度还小）。这些决策照常计入星级——noisy 只说明差距不显著，实测损失本身仍是无偏估计。`) : null,
      // 给一条可执行的下一步，别只丢一个分数
      h('div', { class: 'note' }, nextStepAdvice(run)),
      h('div', { class: 'actions' },
        h('button', { onclick: () => startDrill(sc, { level: levelCtx.level, decisions: [] }) }, '再打一次'),
        h('button', { onclick: () => { reviewState.tab = 'leaks'; switchView('review'); } }, '看漏洞报告'),
        h('button', { onclick: () => { solverState.applySpec({ ...scenarioToSpec(sc), ranges: sc.ranges }); switchView('solver'); toast('已载入这个局面，点「开始解算」可以逐点看策略'); } }, '在解算器里看这个局面'))));
  }

  function renderDecision() {
    const s = drillState.session, st = s.state, node = st.node;
    area.innerHTML = '';
    const hero = st.hands[s.hero];
    const posName = sc.positions ? sc.positions[s.hero] : `P${s.hero}`;
    area.append(h('div', { class: 'row' }, h('div', {}, h('label', {}, '公共牌'), h('div', {}, cardsEl(st.board))), h('div', {}, h('label', {}, `你的手牌（${posName}）`), h('div', {}, cardsEl(COMBOS[hero])))));
    if (st.board.length >= 5 || true) area.append(h('div', { class: 'small muted' }, `底池 ${f1(node.pot)}，已投入 ${node.invested.join('/')}` + (st.board.length >= 3 ? `，当前牌力：${describeValue(evaluate([...st.board, ...COMBOS[hero]].slice(0, 7)))}` : '')));
    const log = h('div', { class: 'log' });
    for (const e of st.log) log.append(e.type === 'card' ? `${STREET_NAMES[e.street]} 发牌 ${cardToPretty(e.card)}\n` : `${sc.positions ? sc.positions[e.player] : 'P' + e.player}：${e.action.label}${e.feedback ? `  [${e.feedback.grade}]` : ''}\n`);
    area.append(log);
    if (st.over) { area.append(h('div', { class: 'note' }, '本手结束。'), h('button', { class: 'primary', onclick: nextHand }, '下一手')); return; }
    area.append(h('h3', {}, `轮到你（需跟注 ${f1(node.toCall)}）`));
    const btns = h('div', { class: 'actions' });
    node.actions.forEach((a, i) => btns.append(h('button', { class: 'primary', onclick: () => choose(i, btns) }, a.label)));
    area.append(btns);
    const statsEl = h('div', { class: 'small muted' }, statsText());
    area.append(statsEl);
  }

  async function choose(i, btns) {
    btns.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const s = drillState.session;
    const node = s.state.node;
    const street = node.street;
    let fb;
    try { fb = await s.choose(i); } catch (e) {
      // 取 EV 失败（多半是这个解已经被 Worker 的缓存淘汰）。不能就这么把按钮留在禁用态，
      // 否则界面直接锁死；把按钮放回去，并给一个重新解算的入口。
      btns.querySelectorAll('button').forEach((b) => (b.disabled = false));
      toast('判分失败：' + e.message, 5000);
      const box = h('div', { class: 'note' }, '判分没拿到 EV：', e.message, ' ',
        h('button', { onclick: () => { drillState.solutions.delete(key); startDrill(sc, levelCtx ? { level: levelCtx.level, decisions: [] } : null); } },
          levelCtx ? '重新解算并重打这一关' : '重新解算这个场景'));
      btns.parentElement.append(box);
      return;
    }
    const stt = drillState.stats;
    stt.decisions++; stt.loss += fb.lossPct; stt.grades[fb.grade] = (stt.grades[fb.grade] || 0) + 1;
    const prevCombo = levelCtx ? levelCtx.combo : 0;
    if (levelCtx) {
      levelCtx.decisions.push({ grade: fb.grade, lossPct: fb.lossPct, noisy: !!fb.noisy, unusable: !!fb.unusable });
      levelCtx.combo = nextCombo(levelCtx.combo, fb);
      renderLevelBar();
    }
    store.addAttempt({
      time: Date.now(), kind: 'drill', scenarioId: sc.id, scenarioName: sc.name,
      board: cardsToStr(fb.board), hand: fb.comboStr, street, history: fb.history,
      chosen: fb.actions[fb.chosen], best: fb.actions[fb.best],
      evLossPct: Number.isFinite(fb.lossPct) ? fb.lossPct : null,
      lossBB: Number.isFinite(fb.loss) ? fb.loss : null, // 筹码=bb，用于 bb/100 口径
      grade: fb.grade, mistake: fb.mistake, freq: fb.freq, noisy: !!fb.noisy, solverTooCoarse: !!fb.solverTooCoarse,
    });
    renderFeedback(fb, prevCombo);
  }

  /**
   * 判分结果头上那一行：评级标签弹出、EV 损失、连击（只在连击数真的增加时跳一下、响一声），下面是刻度条。
   * 无法判分、差距落在噪声里的决策不画刻度条的填充；连击数这时由 nextCombo 保持不变，自然也不会跳。
   */
  function feedbackHead(fb, prevCombo) {
    const usable = !fb.unusable && Number.isFinite(fb.lossPct);
    const combo = levelCtx ? levelCtx.combo : 0;
    const grew = combo > prevCombo && combo > 1;
    if (grew) sfx.combo();
    const head = h('div', { class: 'drow' },
      pill(fb.grade, 'grade ' + fb.grade),
      h('span', { class: 'evloss' }, usable ? `EV 损失 ${fb.lossPct.toFixed(2)}% 底池` : 'EV 损失：无法判分'),
      combo > 1 ? pill(`连击 ×${combo}`, 'combo', grew) : null);
    const why = !usable ? '这个决策无法判分，刻度条不画损失（原因见下面的说明）。'
      : '这次差距落在采样噪声里，分不清对错，刻度条不画损失（见下面的说明）。';
    return [head, evScale(fb.lossPct, { drawFill: usable && !fb.noisy, why })];
  }

  function renderFeedback(fb, prevCombo) {
    const s = drillState.session;
    const colors = actionColors(fb.actions.map((l) => ({ kind: l.includes('弃') ? 'fold' : l.includes('过牌') ? 'check' : l.includes('跟') ? 'call' : l.includes('全下') ? 'allin' : 'bet' })));
    const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '动作'), h('th', {}, 'EV'), h('th', {}, '解算器频率'), h('th', {}, '')));
    fb.actions.forEach((label, a) => tbl.append(h('tr', {}, h('td', {}, h('i', { class: '', style: { display: 'inline-block', width: '10px', height: '10px', background: colors[a], marginRight: '6px', borderRadius: '2px' } }), label), h('td', { class: 'mono' }, f2(fb.evs[a]) + (fb.se ? ` ±${f2(fb.se[a])}` : '')), h('td', { class: 'mono' }, pct(fb.freqs[a], 1)), h('td', {}, a === fb.chosen ? '← 你的选择' : '', a === fb.best ? ' ★ 最高 EV' : ''))));
    const lines = [];
    lines.push(`解算器对 ${fb.notation} 的策略：${fb.actions.map((l, a) => `${l} ${pct(fb.freqs[a])}`).join('，')}。`);
    if (fb.chosen === fb.best) lines.push('你选了 EV 最高的动作。');
    else lines.push(`你的动作比最高 EV 动作少 ${f2(fb.loss)} 筹码（${fb.lossPct.toFixed(2)}% 底池）。${fb.mistake ? '错误类型：' + fb.mistake + '。' : ''}`);
    if (fb.freq != null && fb.freq >= 0.3 && fb.chosen !== fb.best) lines.push('不过这个动作也在解算器的混合策略里（频率 ≥30%），属于可接受的分支。');
    if (fb.solverTooCoarse) lines.push(`⚠ 这个场景只解到可利用度 ${fb.exploitPct.toFixed(2)}% 底池，而三星门槛是 EV 损失 ${fb.gradeFloor}%——`
      + `判分会比解本身还精细，所以本次**不计分**（你的实测损失 ${fb.lossPct.toFixed(2)}% 仅供参考）。`
      + '重新开一局、给解算更多时间就会正常计分。');
    else if (fb.mcNoisy) lines.push('⚠ 3 人局的 EV 是采样估计，本次差距小于 2 倍标准误，判分仅供参考。');
    const rf = fb.rangeFreq.map((f, a) => `${fb.actions[a]} ${pct(f)}`).join('，');
    lines.push(`整个范围在此处的频率：${rf}。`);
    const box = h('div', { class: 'panel fbpanel', style: { marginTop: '8px' } }, feedbackHead(fb, prevCombo), h('div', { class: 'small' }, h('b', {}, fb.comboStr), ' 于 ', cardsToPretty(fb.board)), h('div', { class: 'scroll-x' }, tbl), h('div', { class: 'small', style: { marginTop: '6px' } }, lines.map((l) => h('div', {}, l))), h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => (s.state.over ? nextHand() : renderDecision()) }, s.state.over ? '下一手' : '继续本手'), h('button', { onclick: () => { solverState.applySpec({ ...scenarioToSpec(sc, cardsToStr(s.sol.spec.board)), ranges: sc.ranges }); switchView('solver'); toast('已载入解算器，点“开始解算”后可浏览整棵树'); } }, '在解算器里看整棵树')));
    area.append(box);
    // 间隔重复只记录，不在这里结算：SM-2 的一次"复习"是一整段训练，
    // 每个决策都调一次会让间隔以 ease^n 指数膨胀，几十秒就把场景推到几年后。
    drillState.stats.qs.push(fb.grade === '完美' ? 5 : fb.grade === '良好' ? 4 : fb.grade === '小错' ? 2 : fb.grade === '无法判分' ? null : 1);
  }

  function statsText() { const s = drillState.stats; return s.decisions ? `本次：${s.hands} 手 / ${s.decisions} 个决策，平均 EV 损失 ${(s.loss / s.decisions).toFixed(2)}% 底池，${Object.entries(s.grades).map(([k, v]) => `${k}×${v}`).join(' ')}` : ''; }
}

exports.flushSrs = flushSrs;
exports.buildDrillView = buildDrillView;
exports.makeEvProvider = makeEvProvider;
exports.startDrill = startDrill;
exports.drillState = drillState;
});
