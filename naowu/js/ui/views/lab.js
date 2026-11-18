__squidDefine('src/ui/views/lab.js', function (exports) {
'use strict';
// 「定理实验室」视图：现场解算 → 与理论值对照。
const { solveKuhnCFR } = __squidRequire('src/train/kuhn.js');
const { h, $, toast } = __squidRequire('src/ui/dom.js');
const { seasonData } = __squidRequire('src/ui/progress.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');
const { solverState } = __squidRequire('src/ui/views/solver.js');

function buildLabView() {
  const v = $('#view-lab');
  v.innerHTML = '';
  v.append(h('div', { class: 'panel' }, h('h2', {}, '定理实验室'),
    h('div', { class: 'note' }, '这里每个数字都是你点下按钮那一刻算出来的。左边是教科书的解析解，右边是本机内核跑出来的结果；参数可以改，两边一起变。')));
  const grid = h('div', { class: 'labgrid' });
  v.append(grid);
  grid.append(labKuhn(), labPolarized(), labGeometric());
}

function labKuhn() {
  const box = h('div', { class: 'panel' });
  const out = h('div', {});
  const iterInput = h('input', { type: 'number', value: '30000', min: '1000', step: '1000', style: { width: '110px' } });
  function run(byUser) {
    out.innerHTML = '';
    out.append(h('div', { class: 'muted small' }, '正在自博弈…'));
    setTimeout(() => {
      const n = Math.max(1000, Math.min(500000, Number(iterInput.value) || 30000));
      const t0 = performance.now();
      const cfr = solveKuhnCFR(n);
      if (byUser) { seasonData().labRuns++; store.save(); }   // 成就「眼见为实」只认手动跑的那次
      const ms = performance.now() - t0;
      const alpha = cfr.strategy.J[1];
      out.innerHTML = '';
      out.append(h('div', { class: 'cmp' },
        h('div', { class: 'box' }, h('div', { class: 'lbl' }, '解析解（Kuhn 1950）'), h('b', {}, (-1 / 18).toFixed(6)), h('div', { class: 'lbl' }, '−1/18')),
        h('div', { class: 'eq' }, '≈'),
        h('div', { class: 'box' }, h('div', { class: 'lbl' }, '本机 CFR+ ' + n.toLocaleString() + ' 轮'), h('b', {}, cfr.value.toFixed(6)), h('div', { class: 'lbl' }, ms.toFixed(0) + ' ms'))));
      out.append(h('div', { class: 'evidence' },
        h('div', {}, '可利用度 ' + cfr.exploitability.toExponential(3) + '（均衡时为 0），与 −1/18 的误差 ' + Math.abs(cfr.value + 1 / 18).toExponential(2)),
        h('div', { style: { marginTop: '6px' } }, '解出的诈唬频率 α = ' + alpha.toFixed(4) + '；理论要求拿 K 的下注频率恰好是 3α = ' + (3 * alpha).toFixed(4) + '，实测 ' + cfr.strategy.K[1].toFixed(4) + '。'),
        h('div', { style: { marginTop: '6px' } }, '拿 Q 主动下注 ' + cfr.strategy.Q[1].toFixed(4) + '（理论 0）；后手拿 J 面对过牌下注 ' + cfr.strategy.Jp[1].toFixed(4) + '、拿 Q 面对下注跟注 ' + cfr.strategy.Qb[1].toFixed(4) + '（理论都是 1/3 ≈ 0.3333）。'),
        h('div', { class: 'muted', style: { marginTop: '6px' } }, '注意博弈值与 α 无关：把轮数调大，α 会变，−1/18 不会。')));
    }, 10);
  }
  box.append(h('h2', {}, 'Kuhn 扑克的博弈值 = −1/18'),
    h('div', { class: 'small muted' }, '三张牌 J<Q<K、每人一张、各下 1 个底注的最小不完全信息博弈。Kuhn 1950 证明先手的均衡收益恰好是 −1/18，且与诈唬频率无关。'),
    h('div', { class: 'row', style: { margin: '8px 0' } }, h('label', {}, 'CFR 迭代轮数'), iterInput,
      h('button', { class: 'primary', onclick: () => run(true) }, '重新求解')),
    out);
  run(false); // 一进来就跑一次，30000 轮只要几十毫秒；这次不算成就
  return box;
}

function labPolarized() {
  const box = h('div', { class: 'panel' });
  const out = h('div', {});
  const potIn = h('input', { type: 'number', value: '10', min: '1', style: { width: '80px' } });
  const betIn = h('input', { type: 'number', value: '10', min: '1', style: { width: '80px' } });
  function run() {
    const p = Math.max(0.01, Number(potIn.value) || 10);
    const b = Math.max(0.01, Number(betIn.value) || 10);
    const bluffToValue = b / (p + b);
    const bluffShare = b / (p + 2 * b);
    const callFreq = p / (p + b);
    const valueCombos = 6;
    out.innerHTML = '';
    out.append(h('div', { class: 'kv' },
      h('b', {}, '诈唬:价值'), h('span', { class: 'mono' }, 'b/(p+b) = ' + bluffToValue.toFixed(4)),
      h('b', {}, '诈唬占下注范围'), h('span', { class: 'mono' }, 'b/(p+2b) = ' + bluffShare.toFixed(4) + '（' + (bluffShare * 100).toFixed(2) + '%）'),
      h('b', {}, '抓诈手跟注频率'), h('span', { class: 'mono' }, 'p/(p+b) = ' + callFreq.toFixed(4)),
      h('b', {}, 'MDF（防守方）'), h('span', { class: 'mono' }, 'p/(p+b) = ' + callFreq.toFixed(4)),
      h('b', {}, '诈唬盈亏平衡弃牌率'), h('span', { class: 'mono' }, 'b/(p+b) = ' + bluffToValue.toFixed(4))));
    out.append(h('div', { class: 'evidence' },
      '若价值部分有 ' + valueCombos + ' 个组合，均衡诈唬应有 ' + (valueCombos * bluffToValue).toFixed(2) + ' 个组合。',
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', {
          onclick: () => {
            solverState.applySpec({
              players: 2, board: '2s7d9cJhQs', pot: p, stack: Math.max(b * 3, 30),
              ranges: ['KK,54o', 'TT'],
              sizes: { river: { bet: [Math.round((b / p) * 100)], raise: [] } },
              raiseCap: 1, allin: false,
            });
            switchView('solver');
            toast('已载入这个局面，点"开始解算"看 54o 的诈唬频率');
          },
        }, '把这个局面装进解算器，让它自己跑出来 →'))));
  }
  box.append(h('h2', {}, '河牌极化：诈唬占比与最小防守频率'),
    h('div', { class: 'small muted' }, '范围两极化（坚果 + 空气）对抗纯抓诈手时均衡有闭式解：诈唬:价值 = b/(p+b)，诈唬占下注范围 = b/(p+2b)，抓诈手跟注频率与 MDF 都是 p/(p+b)。'),
    h('div', { class: 'row', style: { margin: '8px 0' } },
      h('label', {}, '底池 p'), potIn, h('label', {}, '下注 b'), betIn,
      h('button', { class: 'primary', onclick: run }, '算并对照')),
    out);
  run();
  return box;
}

function labGeometric() {
  const box = h('div', { class: 'panel' });
  const out = h('div', {});
  const potIn = h('input', { type: 'number', value: '10', min: '1', style: { width: '80px' } });
  const stackIn = h('input', { type: 'number', value: '100', min: '1', style: { width: '80px' } });
  const nIn = h('input', { type: 'number', value: '3', min: '1', max: '3', style: { width: '60px' } });
  function run() {
    const p0 = Math.max(0.01, Number(potIn.value) || 10);
    const stack = Math.max(0.01, Number(stackIn.value) || 100);
    const n = Math.max(1, Math.min(3, Number(nIn.value) || 3));
    const target = p0 + 2 * stack;
    const f = (Math.pow(target / p0, 1 / n) - 1) / 2;
    let pot = p0, spent = 0;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const bet = f * pot;
      rows.push({ street: i + 1, potBefore: pot, bet, potAfter: pot + 2 * bet });
      spent += bet; pot += 2 * bet;
    }
    out.innerHTML = '';
    out.append(h('div', { class: 'cmp' },
      h('div', { class: 'box' }, h('div', { class: 'lbl' }, '闭式解 f'), h('b', {}, (f * 100).toFixed(2) + '%'), h('div', { class: 'lbl' }, '((p₀+2s)/p₀)^(1/' + n + ') − 1，再除以 2')),
      h('div', { class: 'eq' }, '→'),
      h('div', { class: 'box' }, h('div', { class: 'lbl' }, '逐街模拟的最终底池'), h('b', {}, pot.toFixed(2)), h('div', { class: 'lbl' }, '目标 ' + target))));
    const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '街'), h('th', {}, '下注前底池'), h('th', {}, '下注'), h('th', {}, '下注后底池')));
    for (const r of rows) tbl.append(h('tr', {}, h('td', {}, String(r.street)), h('td', { class: 'mono' }, r.potBefore.toFixed(2)), h('td', { class: 'mono' }, r.bet.toFixed(2)), h('td', { class: 'mono' }, r.potAfter.toFixed(2))));
    out.append(tbl);
    out.append(h('div', { class: 'evidence' }, '每人共投入 ' + spent.toFixed(4) + '，后手 ' + stack + '，误差 ' + Math.abs(spent - stack).toExponential(2) + '。'));
  }
  box.append(h('h2', {}, '几何下注：n 街等比例打光后手'),
    h('div', { class: 'small muted' }, '每街下注占当时底池的比例 f 并被跟注，底池就乘以 (1+2f)。要在 n 街之后恰好把后手打光，f 有闭式解。'),
    h('div', { class: 'row', style: { margin: '8px 0' } },
      h('label', {}, '起始底池'), potIn, h('label', {}, '后手'), stackIn, h('label', {}, '街数'), nIn,
      h('button', { class: 'primary', onclick: run }, '求解')),
    out);
  run();
  return box;
}

exports.buildLabView = buildLabView;
});
