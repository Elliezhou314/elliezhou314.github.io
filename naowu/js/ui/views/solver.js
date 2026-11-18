__squidDefine('src/ui/views/solver.js', function (exports) {
'use strict';
// 「解算器」视图：配置局面、现场解算、策略网格、动作 EV、剥削模式。
const { parseCards, cardToPretty, cardToStr, cardsToStr, NOTATION_TO_COMBOS, comboToPretty, COMBO_COUNT, makeRng, remainingDeck } = __squidRequire('src/core/cards.js');
const { parseRange, rangeToText, rangeByNotation, rangeComboCount, PRESETS } = __squidRequire('src/core/range.js');
const { RemoteSolverAdapter, VILLAIN_MODELS } = __squidRequire('src/solver/squid.js');
const { STREET_NAMES, DEFAULT_SIZES } = __squidRequire('src/solver/tree.js');
const { cardsEl } = __squidRequire('src/ui/cards.js');
const { h, $, pct, f1, f2, toast, actionColors, renderGrid, legendEl } = __squidRequire('src/ui/dom.js');
const { refreshView } = __squidRequire('src/ui/router.js');
const { client, store } = __squidRequire('src/ui/services.js');

const solverState = { solution: null, node: null, evCache: new Map(), selectedNt: null, useCloud: false, cloudUrl: '' };

function sizesToText(s) { return `${(s.bet || []).join(',')}|${(s.raise || []).join(',')}`; }

function textToSizes(t) { const [b, r] = (t || '').split('|'); const parse = (x) => (x || '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => n > 0); return { bet: parse(b), raise: parse(r) }; }

function buildSolverView() {
  const v = $('#view-solver');
  v.innerHTML = '';
  const cfg = {
    players: 2, board: 'Ah7d2c', pot: 5.5, stack: 97, ranges: [PRESETS['大盲防守(vs BTN)'], PRESETS['按钮开池(BTN 45%)'], PRESETS['3bet范围(松)']],
    sizes: { flop: sizesToText(DEFAULT_SIZES.flop), turn: sizesToText(DEFAULT_SIZES.turn), river: sizesToText(DEFAULT_SIZES.river) }, raiseCap: 3, allin: true, allinThreshold: 0.75, riverLeaf: 'equity', turnLeaf: 'equity', engine: 'auto', seconds: 20, target: 0.5,
  };
  solverState.cfg = cfg;

  const rangeBoxes = [];
  const rangePanel = h('div');
  function renderRanges() {
    rangePanel.innerHTML = '';
    rangeBoxes.length = 0;
    const names = cfg.players === 2 ? ['玩家0 (OOP，先行动)', '玩家1 (IP，后行动)'] : ['玩家0 (最先行动)', '玩家1 (中间)', '玩家2 (最后行动/按钮)'];
    for (let p = 0; p < cfg.players; p++) {
      const ta = h('textarea', { placeholder: '例如 22+,A2s+,KTs+,AJo+' }, cfg.ranges[p]);
      const sel = h('select', { onchange: (e) => { if (e.target.value) { ta.value = PRESETS[e.target.value]; cfg.ranges[p] = ta.value; refreshRangeGrid(p); } } }, h('option', { value: '' }, '预设…'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k)));
      const count = h('span', { class: 'muted small' });
      const gridWrap = h('div', { class: 'hidden', style: { marginTop: '6px', maxWidth: '360px' } });
      const toggle = h('button', { class: 'small', onclick: () => { gridWrap.classList.toggle('hidden'); refreshRangeGrid(p); } }, '网格编辑');
      ta.addEventListener('input', () => { cfg.ranges[p] = ta.value; refreshRangeGrid(p); });
      const box = { ta, count, gridWrap, p };
      rangeBoxes.push(box);
      rangePanel.append(h('div', { class: 'field' }, h('label', {}, names[p], ' ', count), ta, h('div', { class: 'row' }, sel, toggle), gridWrap));
      refreshRangeGrid(p);
    }
  }
  function refreshRangeGrid(p) {
    const box = rangeBoxes[p];
    if (!box) return;
    let w;
    try { w = parseRange(box.ta.value); box.count.textContent = `${rangeComboCount(w).toFixed(0)} 组合 (${(rangeComboCount(w) / 13.26).toFixed(1)}%)`; box.ta.style.borderColor = ''; }
    catch (e) { box.count.textContent = e.message; box.ta.style.borderColor = 'var(--red)'; return; }
    if (box.gridWrap.classList.contains('hidden')) return;
    const byNt = rangeByNotation(w);
    box.gridWrap.innerHTML = '';
    box.gridWrap.append(renderGrid((nt) => ({ weight: byNt[nt] }), (nt, e) => {
      const cur = byNt[nt] || 0;
      const nv = e.shiftKey ? (cur > 0 ? 0 : 0.5) : cur >= 0.999 ? 0 : 1;
      for (const i of NOTATION_TO_COMBOS.get(nt)) w[i] = nv;
      box.ta.value = rangeToText(w); cfg.ranges[p] = box.ta.value; refreshRangeGrid(p);
    }), h('div', { class: 'muted small' }, '点击切换 0/1，Shift+点击 = 50% 权重'));
  }

  const boardInput = h('input', { value: cfg.board, style: { width: '120px' }, oninput: (e) => { cfg.board = e.target.value; } });
  const randomFlop = h('button', { onclick: () => { const rng = makeRng(); const d = remainingDeck([]); const b = []; for (let i = 0; i < 3; i++) b.push(d.splice((rng() * d.length) | 0, 1)[0]); boardInput.value = cardsToStr(b); cfg.board = boardInput.value; } }, '随机翻牌');
  const playersSel = h('select', { onchange: (e) => { cfg.players = Number(e.target.value); renderRanges(); } }, h('option', { value: 2 }, '2 人'), h('option', { value: 3 }, '3 人'));
  const potIn = h('input', { type: 'number', value: cfg.pot, step: '0.5', oninput: (e) => (cfg.pot = Number(e.target.value)) });
  const stackIn = h('input', { type: 'number', value: cfg.stack, oninput: (e) => (cfg.stack = Number(e.target.value)) });
  const sz = {};
  for (const k of ['flop', 'turn', 'river']) sz[k] = h('input', { value: cfg.sizes[k], style: { width: '110px' }, oninput: (e) => (cfg.sizes[k] = e.target.value) });
  const capIn = h('input', { type: 'number', value: cfg.raiseCap, min: 1, max: 6, oninput: (e) => (cfg.raiseCap = Number(e.target.value)) });
  const allinChk = h('input', { type: 'checkbox', checked: true, onchange: (e) => (cfg.allin = e.target.checked) });
  const thrIn = h('input', { type: 'number', value: cfg.allinThreshold, step: '0.05', min: 0.3, max: 1, oninput: (e) => (cfg.allinThreshold = Number(e.target.value)) });
  const turnLeaf = h('select', { onchange: (e) => (cfg.turnLeaf = e.target.value) }, h('option', { value: 'equity' }, '转牌截断(权益结算)'), h('option', { value: 'full' }, '转牌完整(宽范围时每轮要数秒)'));
  const riverLeaf = h('select', { onchange: (e) => { cfg.riverLeaf = e.target.value; cfg.riverLeafTouched = true; } }, h('option', { value: 'equity' }, '河牌截断(权益结算)'), h('option', { value: 'full' }, '河牌完整(从翻牌起会很慢)'));
  const engineSel = h('select', { onchange: (e) => (cfg.engine = e.target.value) }, h('option', { value: 'auto' }, '自动(2人向量CFR / 3人采样)'), h('option', { value: 'vector' }, '向量 DCFR (仅2人)'), h('option', { value: 'sampled' }, '采样 MCCFR'));
  const secIn = h('input', { type: 'number', value: cfg.seconds, min: 3, max: 600, oninput: (e) => (cfg.seconds = Number(e.target.value)) });
  const tgtIn = h('input', { type: 'number', value: cfg.target, step: '0.1', min: 0.05, oninput: (e) => (cfg.target = Number(e.target.value)) });
  const cloudUrl = h('input', { placeholder: 'http://你的解算服务器/solve', style: { width: '100%' }, oninput: (e) => (solverState.cloudUrl = e.target.value) });
  const cloudChk = h('input', { type: 'checkbox', onchange: (e) => (solverState.useCloud = e.target.checked) });

  const status = h('div', { class: 'small muted' }, '尚未解算');
  const prog = h('div', { class: 'progress' }, h('div'));
  const result = h('div');
  const solveBtn = h('button', { class: 'primary', onclick: () => doSolve() }, '开始解算');
  const cancelBtn = h('button', { class: 'danger', onclick: () => client.cancel() }, '取消');
  const saveScenarioBtn = h('button', { onclick: () => saveCustomScenario() }, '存为自定义训练场景');

  function currentSpec() {
    const board = parseCards(cfg.board);
    return {
      players: cfg.players, board, pot: cfg.pot, stack: cfg.stack, ranges: cfg.ranges.slice(0, cfg.players),
      sizes: { flop: textToSizes(cfg.sizes.flop), turn: textToSizes(cfg.sizes.turn), river: textToSizes(cfg.sizes.river) },
      raiseCap: cfg.raiseCap, allin: cfg.allin, allinThreshold: cfg.allinThreshold,
      // 从转牌开始解时，除非用户手动选过，否则河牌默认完整
      leafMode: { turn: cfg.turnLeaf, river: board.length === 4 && !cfg.riverLeafTouched ? 'full' : cfg.riverLeaf }, engine: cfg.engine,
    };
  }

  async function doSolve() {
    let spec;
    try { spec = currentSpec(); if (spec.board.length < 3) throw new Error('公共牌至少 3 张'); }
    catch (e) { toast(e.message); return; }
    solveBtn.disabled = true;
    result.innerHTML = '';
    solverState.evCache.clear();
    const t0 = performance.now();
    try {
      let sol;
      if (solverState.useCloud && solverState.cloudUrl) {
        status.textContent = '云端解算中…';
        sol = await new RemoteSolverAdapter(solverState.cloudUrl).solve({ ...spec, ranges: spec.ranges }, { ms: cfg.seconds * 1000, targetExploitPct: cfg.target });
      } else {
        sol = await client.solve(spec, { ms: cfg.seconds * 1000, targetExploitPct: cfg.target }, (m) => {
          if (m.type === 'tree') status.textContent = `树已建：${m.nodes} 节点 / ${m.decisionNodes} 决策节点，引擎 ${m.engine}`
            + (m.memory ? `，预计占用 ${m.memory.totalMB.toFixed(0)} MB（策略表 ${m.memory.strategyMB.toFixed(0)} + 权益矩阵 ${m.memory.equityMB.toFixed(0)}）` : '');
          else if (m.phase === 'precompute') { status.textContent = `预计算牌力表/权益矩阵 ${m.done}/${m.total}`; prog.firstChild.style.width = `${(m.done / m.total) * 30}%`; }
          else if (m.phase === 'solve') { const frac = Math.min(1, m.elapsed / (cfg.seconds * 1000)); prog.firstChild.style.width = `${30 + frac * 70}%`; status.textContent = `迭代 ${m.iter}，${(m.elapsed / 1000).toFixed(1)}s` + (m.exploit ? `，可利用度 ${m.exploit.pctPot.toFixed(2)}% 底池` : ''); }
        });
      }
      solverState.solution = sol;
      solverState.node = sol.root;
      prog.firstChild.style.width = '100%';
      const s = sol.summary;
      status.textContent = `完成：${s.engine}，${s.iterations} 次迭代，${(s.elapsedMs / 1000).toFixed(1)}s，${s.nodes} 节点` + (s.exploitPct != null ? `，可利用度 ${s.exploitPct.toFixed(2)}% 底池` : '') + (s.rootEV ? `，根节点 EV ${s.rootEV.map((x) => f2(x)).join(' / ')}` : '');
      renderSolution();
    } catch (e) { status.textContent = '失败：' + e.message; }
    solveBtn.disabled = false;
  }

  function saveCustomScenario() {
    if (!solverState.solution) { toast('先解算一次'); return; }
    const name = prompt('场景名称', `自定义 ${cfg.board}`);
    if (!name) return;
    const spec = currentSpec();
    const heroSeat = Number(prompt(`你在哪个座位？0~${cfg.players - 1}`, String(cfg.players - 1)));
    const sc = { id: 'custom-' + Date.now(), group: '自定义', name, players: spec.players, positions: spec.players === 2 ? ['OOP', 'IP'] : ['P0', 'P1', 'P2'], heroSeat, boards: [cfg.board], pot: spec.pot, stack: spec.stack, ranges: spec.ranges, sizes: spec.sizes, raiseCap: spec.raiseCap, leafMode: spec.leafMode, engine: spec.engine, desc: '来自解算器配置', goal: '' };
    store.data.customScenarios.push(sc); store.save();
    toast('已保存到特训地图 → 自定义');
    refreshView('drill');
  }

  // 剥削面板：均衡解回答「对手也最优时怎么打」，这里回答「对手会乱打时怎么打、以及代价」
  function buildExploitPanel() {
    const box = h('div', { class: 'panel', style: { marginTop: '10px' } }, h('h2', {}, '剥削模式：对手不会打的时候'));
    if (!solverState.solution || solverState.solution.summary.players !== 2) {
      box.append(h('div', { class: 'muted small' }, '剥削分析只支持 2 人局：3 人博弈没有纳什均衡保证，「最佳回应」也就没有基准可比。'));
      return box;
    }
    box.append(h('div', { class: 'note' },
      '上面那个解是',
      h('b', {}, '均衡'),
      '——它假设对手也在最优地打。真实牌桌上对手会犯错：跟注站什么都跟，疯狂型乱诈唬。',
      '对这种人打均衡是「不输」，不是「赚最多」。这里把「赚最多」也解出来，',
      '同时告诉你这么打会露出多大破绽。'));

    const sel = h('select', {}, Object.entries(VILLAIN_MODELS).map(([k, m]) =>
      h('option', { value: k, selected: k === 'station' }, m.cn)));
    const heroSel = h('select', {}, [h('option', { value: '0' }, '我是玩家 0（OOP）'), h('option', { value: '1' }, '我是玩家 1（IP）')]);
    const runBtn = h('button', { class: 'primary', onclick: () => run() }, '解剥削打法');
    const status = h('span', { class: 'muted small' });
    box.append(h('div', { class: 'row', style: { margin: '8px 0' } }, h('label', {}, '对手类型：'), sel, heroSel, runBtn, status));
    const modelNote = h('div', { class: 'small muted' });
    const out = h('div');
    box.append(modelNote, out);

    const describe = () => {
      const m = VILLAIN_MODELS[sel.value];
      modelNote.textContent = m.lambda === 0
        ? `${m.desc}。这是对照组：它按均衡打，所以剥削收益应当恰好是 0——这是这套算法的自检。`
        : `${m.desc}。模型：σ = (1 − ${m.lambda})·均衡策略 + ${m.lambda}·固定倾向，` +
          `倾向为 弃 ${(m.tendency.fold * 100).toFixed(0)}% / 过 ${(m.tendency.check * 100).toFixed(0)}% / ` +
          `跟 ${(m.tendency.call * 100).toFixed(0)}% / 下注加注 ${(m.tendency.aggro * 100).toFixed(0)}%。`;
    };
    sel.onchange = describe;
    describe();

    async function run() {
      runBtn.disabled = true; status.textContent = '解算中…'; out.innerHTML = '';
      try {
        const r = (await client.exploit(solverState.solution.solveId, Number(heroSel.value), sel.value)).analysis;
        status.textContent = '';
        renderResult(r);
      } catch (e) { status.textContent = '失败：' + e.message; }
      runBtn.disabled = false;
    }

    function renderResult(r) {
      const bb = (x) => f2(x);
      const tbl = h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, '你怎么打'), h('th', {}, '对手怎么打'), h('th', {}, '你的 EV（筹码）'), h('th', {}, '相对均衡')));
      const rows = [
        ['均衡', '均衡（基线）', r.evGtoVsGto],
        ['均衡', r.modelName, r.evGtoVsVillain],
        [h('b', {}, '最大剥削'), r.modelName, r.evExploit],
        [h('b', {}, '最大剥削'), h('b', {}, '醒过来后最佳回应你'), r.evPunished],
      ];
      for (const [a, b, v] of rows) {
        const d = v - r.evGtoVsGto;
        tbl.append(h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', { class: 'mono' }, bb(v)),
          h('td', { class: 'mono', style: { color: d > 1e-6 ? 'var(--green)' : d < -1e-6 ? 'var(--red)' : 'inherit' } },
            (d >= 0 ? '+' : '') + bb(d))));
      }
      out.append(h('div', { class: 'scroll-x' }, tbl));

      const gainPct = (r.gain / r.pot0) * 100, riskPct = (r.risk / r.pot0) * 100;
      out.append(h('div', { class: 'note', style: { marginTop: '8px' } },
        h('div', {}, h('b', {}, '剥削多赚：'), h('span', { class: 'mono' }, (r.gain >= 0 ? '+' : '') + bb(r.gain)),
          ` 筹码（底池的 ${gainPct.toFixed(1)}%）。`,
          '这是拿「打均衡对同一个漏洞对手」当分母算的增量——均衡本身已经能从对手的错误里赚一部分，',
          '只有超出那一部分的才算剥削的功劳。'),
        h('div', {}, h('b', {}, '暴露风险：'), h('span', { class: 'mono' }, bb(r.risk)),
          ` 筹码（底池的 ${riskPct.toFixed(1)}%）。`,
          '最佳回应是纯策略，本身极易被反打。如果对手突然开始最优地打你，你会从均衡值掉到 ',
          h('span', { class: 'mono' }, bb(r.evPunished)), '。'),
        h('div', { class: 'muted small' },
          '最佳回应通常不唯一：对手让你无差异的手牌，怎么打 EV 都一样，暴露程度却天差地别。',
          `所以这里挑的是「最不冒险」的那一份——EV 差不到底池 ${r.tieTolPct.toFixed(1)}%（`,
          h('span', { class: 'mono' }, bb(r.tieTol)),
          ' 筹码）的动作一律保持均衡比例，只在真有得赚的地方偏离。',
          '这个门槛和判分的三星线是同一个数：既然「损失不到底池 0.5% 算完美」，',
          '就不该为了不到 0.5% 的收益把自己变成靶子。'),
        r.gain > 1e-6 && r.risk > 0
          ? h('div', {}, h('b', {}, '性价比：'), `每冒 1 筹码的风险换 ${(r.gain / r.risk).toFixed(2)} 筹码的收益。`,
            r.gain / r.risk > 0.5 ? '值得。' : r.gain / r.risk > 0.2 ? '要看对手会不会调整——一次性牌局值，长期对局要收敛回均衡。' : '不划算，别为这点收益把自己打成靶子。')
          : h('div', { class: 'muted' }, '对手没有可剥削的漏洞：任何最佳回应的收益都等于均衡值，',
            '所以上面那个「暴露风险」纯粹是白冒的——同样是最佳回应，直接打均衡的风险是 0。')));

      if (!r.diffs.length) return;
      out.append(h('h3', { style: { marginTop: '10px' } }, '具体该怎么改（按「走到频率 × 换动作比例」排序）'));
      const dt = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '决策点'), h('th', {}, '底池'), h('th', {}, '走到频率'), h('th', {}, '换动作的范围占比'), h('th', {}, '均衡 → 剥削')));
      for (const d of r.diffs.slice(0, 8)) {
        const changed = d.actions.filter((a) => Math.abs(a.exploit - a.gto) > 3);
        dt.append(h('tr', {},
          h('td', { class: 'mono small' }, d.history || '（根节点）'),
          h('td', { class: 'mono' }, f1(d.pot)),
          h('td', { class: 'mono' }, d.reachPct.toFixed(1) + '%'),
          h('td', { class: 'mono' }, d.movedPct.toFixed(0) + '%'),
          h('td', { class: 'small' }, changed.length
            ? changed.map((a) => `${a.label} ${a.gto.toFixed(0)}%→${a.exploit.toFixed(0)}%`).join('，')
            : '各动作频率变化都不到 3 个百分点')));
      }
      out.append(h('div', { class: 'scroll-x' }, dt));
      out.append(h('div', { class: 'small muted', style: { marginTop: '6px' } },
        '「走到频率」= 双方都打均衡时，这一手会走到这个决策点的概率（已去掉牌面冲突）。',
        '「换动作的范围占比」= 在这个决策点上，剥削打法选的动作在均衡里本来有多不常打，',
        '按走到这里时的范围权重（不是根节点的范围权重）加权，和策略网格里那些频率同一口径。',
        '100% 表示整个范围都改打了均衡几乎不打的动作。',
        '只按后者排会把几乎走不到的节点顶到最前面，所以按两者的乘积排。'));
    }
    return box;
  }

  function renderSolution() {
    const sol = solverState.solution;
    result.innerHTML = '';
    if (!sol) return;
    const note = h('div', { class: 'note' }, sol.summary.note, sol.summary.leafMode && sol.spec.board.length < 5 ? ` 截断模式：转牌=${sol.summary.leafMode.turn === 'full' ? '完整' : '权益结算'}，河牌=${sol.summary.leafMode.river === 'full' ? '完整' : '权益结算'}。` : '');
    result.append(note);
    const nav = h('div');
    result.append(nav);
    renderNode(nav);
    result.append(buildExploitPanel());
  }

  function renderNode(nav) {
    const sol = solverState.solution;
    const node = solverState.node;
    nav.innerHTML = '';
    // 面包屑
    const path = [];
    for (let x = node; x; x = x.parent) path.push(x);
    path.reverse();
    const crumbs = h('div', { class: 'crumbs' });
    path.forEach((x, i) => {
      let label = i === 0 ? `根 ${cardsToStr(sol.spec.board)}` : x.parent.type === 'D' ? `P${x.parent.player}:${x.parent.actions[x.viaAction].label}` : `发牌 ${cardToStr(x.viaCard)}`;
      crumbs.append(h('button', { class: i === path.length - 1 ? 'primary' : '', onclick: () => { solverState.node = x; renderNode(nav); } }, label));
    });
    nav.append(crumbs);
    const info = h('div', { class: 'kv' }, h('b', {}, '街'), STREET_NAMES[node.street], h('b', {}, '公共牌'), cardsEl(node.board, true), h('b', {}, '底池'), f1(node.pot), h('b', {}, '已投入'), node.invested.join(' / '));
    nav.append(info);
    if (node.type === 'T' || node.type === 'E') { nav.append(h('p', { class: 'muted' }, node.type === 'T' ? (node.kind === 'fold' ? `终端：玩家${node.winner} 拿下底池` : '终端：摊牌') : `叶子：权益结算（${node.reason === 'allin' ? '全下' : '截断'}）`)); return; }
    if (node.type === 'C') {
      nav.append(h('h3', {}, '选择下一张牌'));
      const deckEl = h('div', { class: 'row' });
      for (const ch of node.children) deckEl.append(h('button', { style: { padding: '2px 6px' }, onclick: () => { solverState.node = sol.nodes[ch.next]; renderNode(nav); } }, cardToPretty(ch.card)));
      nav.append(deckEl);
      return;
    }
    const view = sol.strategyAt(node);
    const colors = actionColors(node.actions);
    nav.append(h('h3', {}, `玩家 ${node.player} 行动（需跟注 ${f1(node.toCall)}，后手 ${f1(node.stacks[node.player])}）— 范围整体频率`));
    node.actions.forEach((a, i) => {
      nav.append(h('div', { class: 'bar-row' }, h('button', { style: { width: '150px', textAlign: 'left', borderColor: colors[i] }, onclick: () => { solverState.node = sol.nodes[a.next]; renderNode(nav); } }, a.label), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: pct(view.rangeFreq[i], 1), background: colors[i] } })), h('span', { class: 'mono small', style: { width: '56px' } }, pct(view.rangeFreq[i], 1))));
    });
    nav.append(legendEl(node.actions, colors));
    const detail = h('div', { class: 'panel small', style: { marginTop: '8px' } }, '把鼠标移到网格上看该手牌的策略；点击查看各动作 EV。');
    const grid = renderGrid((nt) => { const x = view.byNotation[nt]; return x ? { weight: x.weight, probs: x.probs, colors } : { weight: 0 }; },
      (nt) => showEV(nt), (nt) => showDetail(nt));
    nav.append(h('div', { class: 'cols cols-even' }, h('div', { style: { maxWidth: '520px' } }, grid), detail));

    function showDetail(nt) {
      const x = view.byNotation[nt];
      detail.innerHTML = '';
      if (!x) { detail.append(`${nt}：不在范围内`); return; }
      detail.append(h('div', {}, h('b', {}, nt), ` 权重 ${pct(x.weight)}`));
      node.actions.forEach((a, i) => detail.append(h('div', { class: 'bar-row' }, h('span', { style: { width: '130px' } }, a.label), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: pct(x.probs[i], 1), background: colors[i] } })), h('span', { class: 'mono', style: { width: '56px' } }, pct(x.probs[i], 1)))));
      detail.append(h('div', { class: 'muted' }, '点击格子计算 EV'));
    }
    async function showEV(nt) {
      const x = view.byNotation[nt];
      if (!x) return;
      showDetail(nt);
      const combos = NOTATION_TO_COMBOS.get(nt).filter((c) => view.reach[node.player][c] > 0);
      if (!combos.length) return;
      detail.append(h('div', { class: 'muted' }, '计算中…'));
      try {
        let rows;
        if (sol.isVector) {
          const ck = `${sol.solveId}:${node.id}`;
          let r = solverState.evCache.get(ck);
          if (!r) { r = await client.actionEVs(sol.solveId, node.id); solverState.evCache.set(ck, r); }
          rows = combos.map((c) => ({ c, evs: node.actions.map((_, a) => r.evs[a * COMBO_COUNT + c]) }));
        } else {
          rows = [];
          for (const c of combos.slice(0, 2)) { const r = await client.actionEVs(sol.solveId, node.id, c, 3000); rows.push({ c, evs: r.evs, se: r.se }); }
        }
        detail.lastChild.remove();
        const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '组合'), node.actions.map((a) => h('th', {}, a.label))));
        for (const row of rows) {
          const best = row.evs.indexOf(Math.max(...row.evs.filter((v) => Number.isFinite(v))));
          tbl.append(h('tr', {}, h('td', { class: 'mono' }, comboToPretty(row.c)), row.evs.map((v, i) => h('td', { class: 'mono', style: { color: i === best ? 'var(--accent)' : '' } }, f2(v) + (row.se ? `±${f2(row.se[i])}` : '')))));
        }
        detail.append(h('div', { class: 'muted' }, 'EV 单位：筹码（相对于进入本树时，已投入的算沉没成本）'), h('div', { class: 'scroll-x' }, tbl));
      } catch (e) { detail.append(h('div', { class: 'muted' }, '失败：' + e.message)); }
    }
  }

  renderRanges();
  v.append(h('div', { class: 'cols' },
    h('div', { class: 'panel' },
      h('h2', {}, '场景设置'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '人数'), playersSel), h('div', { class: 'field' }, h('label', {}, '公共牌(3~5张)'), h('div', { class: 'row' }, boardInput, randomFlop)), h('div', { class: 'field' }, h('label', {}, '底池'), potIn), h('div', { class: 'field' }, h('label', {}, '有效后手'), stackIn)),
      h('h3', {}, '范围'), rangePanel,
      h('h3', {}, '下注尺度（底池%）：下注|加注'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '翻牌'), sz.flop), h('div', { class: 'field' }, h('label', {}, '转牌'), sz.turn), h('div', { class: 'field' }, h('label', {}, '河牌'), sz.river)),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '每街加注上限'), capIn), h('div', { class: 'field inline' }, allinChk, h('label', {}, '允许全下')), h('div', { class: 'field' }, h('label', {}, '全下阈值(×后手)'), thrIn)),
      h('h3', {}, '树的深度'), h('div', { class: 'row' }, turnLeaf, riverLeaf),
      h('div', { class: 'muted small' }, '从翻牌开始解时，默认只解翻牌这一街（之后按权益结算），几秒就能收敛；“转牌完整”会把 49 张转牌全部展开，范围一宽每轮就要好几秒，请把秒数调到 120 以上。从转牌/河牌开始解时可以全完整。'),
      h('h3', {}, '引擎与预算'), h('div', { class: 'row' }, engineSel, h('div', { class: 'field' }, h('label', {}, '秒数'), secIn), h('div', { class: 'field' }, h('label', {}, '目标可利用度%'), tgtIn)),
      h('h3', {}, '云端解算（可选）'), h('div', { class: 'field inline' }, cloudChk, h('label', {}, '使用云端')), cloudUrl,
      h('div', { class: 'muted small' }, '本机没有云端服务；这里接受任何返回 squid-solution-v1 格式的 HTTP 接口。'),
      h('div', { class: 'actions' }, solveBtn, cancelBtn, saveScenarioBtn),
    ),
    h('div', { class: 'panel' }, h('h2', {}, '解'), status, prog, result),
  ));
  solverState.applySpec = (s) => {
    cfg.players = s.players; playersSel.value = String(s.players);
    cfg.board = typeof s.board === 'string' ? s.board : cardsToStr(s.board); boardInput.value = cfg.board;
    cfg.pot = s.pot; potIn.value = s.pot; cfg.stack = s.stack; stackIn.value = s.stack;
    cfg.ranges = s.ranges.slice(); while (cfg.ranges.length < 3) cfg.ranges.push('');
    if (s.sizes) for (const k of ['flop', 'turn', 'river']) if (s.sizes[k]) { cfg.sizes[k] = sizesToText(s.sizes[k]); sz[k].value = cfg.sizes[k]; }
    if (s.raiseCap) { cfg.raiseCap = s.raiseCap; capIn.value = s.raiseCap; }
    if (s.leafMode) { if (s.leafMode.turn) { cfg.turnLeaf = s.leafMode.turn; turnLeaf.value = cfg.turnLeaf; } if (s.leafMode.river) { cfg.riverLeaf = s.leafMode.river; riverLeaf.value = cfg.riverLeaf; } }
    renderRanges();
  };
}

exports.buildSolverView = buildSolverView;
exports.solverState = solverState;
});
