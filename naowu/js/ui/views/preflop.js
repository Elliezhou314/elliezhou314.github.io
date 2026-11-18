__squidDefine('src/ui/views/preflop.js', function (exports) {
'use strict';
// 「翻前图」视图：预解算的翻前策略网格、闪卡、模型自检面板。
const { NOTATION_TO_COMBOS } = __squidRequire('src/core/cards.js');
const { NOTATION_LIST, EQ_NOISE, preflopModelAudit } = __squidRequire('src/solver/preflop.js');
const { embeddedData } = __squidRequire('src/ui/data.js');
const { h, $, pct, actionColors, renderGrid, legendEl } = __squidRequire('src/ui/dom.js');
const { client, store } = __squidRequire('src/ui/services.js');

const pfState = { charts: {}, current: null, path: [], quiz: null, eqTable: null, realization: null };

/** 权益实现差表（打包时内嵌）——自检面板要用它按模型自己的口径再判一次矛盾 */
function loadRealizationTable() {
  if (pfState.realization !== null) return pfState.realization;
  pfState.realization = embeddedData('realization') || false;
  // 打包产物里是内嵌的；开发版 / 局域网版直接开 index.html 时没有内嵌数据，
  // 不去请求文件的话整列 Δ 会静默丢掉，自检面板就只剩裸权益那一个口径。
  if (pfState.realization === false) {
    fetch('data/preflop/realization.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.spots) { pfState.realization = j; refreshAuditIfOpen(); } })
      .catch(() => { /* file:// 下拿不到就算了 */ });
  }
  return pfState.realization;
}

// Δ 表是异步兵底拿到的，拿到后要把已经渲染的自检面板重画一次
let refreshAuditIfOpen = () => {};

async function loadPreflopData(name) {
  if (pfState.charts[name]) return pfState.charts[name];
  const embedded = embeddedData(`${name}-100bb`);
  if (embedded) { pfState.charts[name] = embedded; return embedded; }
  try { const r = await fetch(`data/preflop/${name}-100bb.json`); if (r.ok) { pfState.charts[name] = await r.json(); return pfState.charts[name]; } } catch (e) { /* 没有预解算文件 */ }
  return null;
}

function buildPreflopAudit(chart, candIdx = 0) {
  // 只有这张图本身就是带 Δ 解出来的，才能拿 Δ 去判它自洽不自洽；
  // 纯权益模型的图套上 Δ 会把模型本来正确的地方判成矛盾。
  const a = preflopModelAudit(chart, pfState.eqTable, candIdx, chart && chart.hasRealization ? pfState.realization : null);
  const box = h('div', { class: 'panel' }, h('h2', {}, '这张图错在哪（模型自检）'));
  box.append(h('div', { class: 'note' },
    '这不是免责声明，是可以自己核对的诊断。下面的权益是打开这个页面时用 169×169 权益表现算的。',
    chart && chart.players ? '　当前这张图：' + chart.players + ' 人 ' + chart.stack + 'bb。' : ''));
  const hasReal = !!(chart && chart.hasRealization);
  box.append(h('div', { class: 'small', style: { lineHeight: '1.9' } },
    hasReal
      ? h('div', {}, h('b', {}, '模型是什么：'), '翻前行动树 + 权益结算叶子 + ',
        h('b', {}, '权益实现差修正'),
        '。最初的版本只有前两项，后果是每手牌恰好实现它的全下权益、一分不多一分不少 —— ',
        '靠翻后赚钱的牌（小对子摸暗三条、同花连牌的隐含赔率）价值全部丢失，实测 22 只开 1.9%。',
        '现在的叶子改成 ', h('span', { class: 'mono' }, '底池 × 权益 + （Δ自己 − 在场各家 Δ 的均值）'),
        '（两人时就是 (Δ自己 − Δ对手)/2）',
        '，其中 Δ 是用解算器在全部 1755 个同构翻牌上解出来的「实际 EV − 裸权益份额」',
        '（按出现频次加权，等价于全部 22100 个翻牌，牌面这一项没有抽样误差）',
        '（跑 ', h('span', { class: 'mono' }, 'node tools/precompute_realization.mjs'), ' 可复现）。',
        '这个式子对任意两手牌都满足两边之和 = 底池，零和守恒不受影响（自测里有这一项）。')
      : h('div', {}, h('b', {}, '模型是什么：'), '翻前行动树 + 权益结算叶子，中间没有任何翻后博弈。',
        '这张图没有带权益实现差修正（跑 ', h('span', { class: 'mono' }, 'node tools/precompute_realization.mjs'), ' 生成后重算即可）。'),
    h('div', {}, h('b', {}, '仍然要知道的：'), '牌面是全枚举的（全部 1755 个同构翻牌），169 类也都有实测 Δ，',
      '但 Δ 仍然是在固定的代表性范围与两档 SPR 上测的，用到别的范围或别的 SPR 上会有偏差；',
      '范围外的手牌是抬到 2% 地板权重才测到的，代价是参照范围里混进了边缘牌',
      '（实测对原来测过的类影响：单加注底池 0.5% 底池、3bet 1.1% 底池）；',
      '转牌截断已经用配对差分修正过，但河牌仍然是权益结算，还有一层同向的截断没修；结算叶子仍然只在「底池」这一个量级里再分配，',
      '而真实的翻后会从对手的剩余后手里继续拿钱。所以这张图比原来准得多，但仍然不是完整翻前解。'),
    h('div', {}, h('b', {}, '下面这张表是干什么的：'), '把每手牌「对跟注范围的裸权益」和「图里的开池频率」并排放，',
      '看这张图还有没有「权益明显更高却开得明显更少」的自相矛盾。')));
  if (!a) { box.append(h('div', { class: 'muted small' }, '需要先载入权益表和这张图才能自检。')); return box; }

  if (a.cands.length > 1) {
    const sel = h('select', {
      onchange: () => {
        const parent = box.parentElement;
        if (parent) parent.replaceChild(buildPreflopAudit(chart, Number(sel.value)), box);
      },
    });
    a.cands.forEach((c, i) => {
      const o = h('option', { value: String(i) }, c.label);
      if (i === a.useIdx) o.selected = true;
      sel.append(o);
    });
    box.append(h('div', { class: 'row', style: { margin: '8px 0' } }, h('label', {}, '参照哪个跟注范围：'), sel));
    box.append(h('div', { class: 'note' },
      '这张图里有 ' + a.cands.length + ' 个玩家都能跟开池，选谁作参照结论差很多（',
      a.cands.map((c) => c.node.pos + ' 跟 ' + (c.pct * 100).toFixed(1) + '%').join('、'),
      '）。这本身就说明了问题：一个「开池与否由权益阈值决定」的模型，连阈值该参照什么都不唯一。'));
  } else {
    box.append(h('div', { class: 'small', style: { margin: '8px 0' } },
      '参照的跟注范围：' + a.callNode.pos + ' 面对 ' + a.rootPos + ' 开池时的跟注范围，约占 ' + (a.callPct * 100).toFixed(1) + '% 的起手牌。'));
  }

  const lo = Math.min(a.highFold, a.lowOpen), hi = Math.max(a.highFold, a.lowOpen);
  box.append(h('div', { class: 'small', style: { margin: '8px 0' } },
    '开池与弃牌的分界大致落在权益 ' + (lo * 100).toFixed(1) + '% ~ ' + (hi * 100).toFixed(1) + '% 这一段',
    a.highFold > a.lowOpen ? '（两段有重叠，说明还有权益之外的因素在起作用，主要是弃牌率）。' : '（几乎不重叠，也就是说开池与否基本就是权益的一个阈值）。'));

  const show = ['AA', 'KK', 'AKs', 'TT', '99', '77', '55', '22', 'AQo', 'KTo', 'QJo', 'A5s', 'J9s', 'T9s', '76s', '54s'];
  const tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '手牌'), h('th', {}, '对跟注范围的权益'), h('th', {}, '实现差 Δ（筹码）'), h('th', {}, '模型实现份额'), h('th', {}, '图里的开池频率')));
  for (const n of show) {
    const r = a.rows.find((x) => x.n === n);
    if (!r) continue;
    tbl.append(h('tr', {}, h('td', { class: 'mono' }, n), h('td', { class: 'mono' }, (r.eq * 100).toFixed(1) + '%'),
      h('td', { class: 'mono' }, Number.isFinite(r.delta) ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(2) : '—'),
      h('td', { class: 'mono' }, (r.eqAdj * 100).toFixed(1) + '%'),
      h('td', { class: 'mono' }, (r.open * 100).toFixed(0) + '%')));
  }
  box.append(h('div', { class: 'scroll-x' }, tbl));
  box.append(h('div', { class: 'small muted' },
    '注：这些权益有两层误差 —— 权益表本身是蒙特卡洛（标准误约 0.22 个百分点），',
    '而且没有扣除牌张移除（你拿着某张牌会改变对手范围的构成，实测系统性偏差最大约 0.9 个百分点）。',
    '所以小于 ' + (EQ_NOISE * 100).toFixed(1) + ' 个百分点的权益差在这里不作数。'));

  if (a.worst) {
    box.append(h('div', { class: 'note' },
      h('b', {}, '这张图里最明显的一处矛盾：'),
      a.worst.hi.n + ' 对跟注范围有 ' + (a.worst.hi.eq * 100).toFixed(1) + '% 权益，只开 ' + (a.worst.hi.open * 100).toFixed(0) + '%；',
      '而 ' + a.worst.lo.n + ' 权益只有 ' + (a.worst.lo.eq * 100).toFixed(1) + '%，却开 ' + (a.worst.lo.open * 100).toFixed(0) + '%。',
      '权益差 ' + (a.worst.eqGap * 100).toFixed(1) + ' 个百分点（已超过上面说的误差量级），方向却是反的。'));
  } else {
    box.append(h('div', { class: 'small muted', style: { marginTop: '6px' } },
      '这张图里没有找到「权益差超过误差、开池方向却相反」的手牌对 —— 说明它确实基本就是一个权益阈值。'));
  }

  // 上面那一条用的是裸权益。加了实现差之后，它里面有一部分是模型有意为之的，
  // 不能直接当错误读。按模型自己的口径（权益 + Δ/底池）再判一次，那才是真的内部矛盾。
  if (a.deltaSpot) {
    box.append(h('div', { class: 'small', style: { marginTop: '8px', lineHeight: '1.9' } },
      h('b', {}, '上面那一条要怎么读：'),
      '它用的是「裸全下权益」。图里已经接了权益实现差，所以「裸权益高却开得少」不一定是错——',
      '同花连牌的裸权益低、实现率高，模型就是有意让它多开的。',
      '换成模型自己的口径 ', h('span', { class: 'mono' }, '权益 + (Δ自己 − 跟注范围平均 Δ)/2/底池'),
      '（Δ 取自 ' + a.deltaSpot.label + '，SPR ' + a.deltaSpot.spr + '，开池被跟后的底池按 ' + a.deltaSpot.pot + ' 算，跟注范围平均 Δ = ' + a.deltaSpot.oppMeanDelta.toFixed(2) + '）再判一次：',
      a.worstAdj
        ? h('span', {}, '最严重的一处是 ' + a.worstAdj.hi.n + '（' + (a.worstAdj.hi.eqAdj * 100).toFixed(1) + '%）只开 ' +
          (a.worstAdj.hi.open * 100).toFixed(0) + '%，而 ' + a.worstAdj.lo.n + '（' + (a.worstAdj.lo.eqAdj * 100).toFixed(1) + '%）开 ' +
          (a.worstAdj.lo.open * 100).toFixed(0) + '%，差 ' + (a.worstAdj.eqGap * 100).toFixed(1) + ' 个百分点。',
          h('b', {}, '这一条才是这张图自己跟自己矛盾的地方。'))
        : h('b', {}, '找不到这样的手牌对——按模型自己的口径，这张图是自洽的。'),
      h('div', { class: 'muted' }, '这张表里共 ' + a.deltaCoverage + '/169 类有 Δ 值；显示为破折号的是连 Δ 都没有的类，在模型里按 0 算。')));
  }

  const pairs = a.rows.filter((x) => /^(22|33|44|55)$/.test(x.n) && x.open < 0.5);
  box.append(h('div', { class: 'small', style: { marginTop: '8px', lineHeight: '1.9' } },
    h('b', {}, '模型缺掉的那部分价值，可以直接量出来：'),
    h('div', {}, '一个口袋对子在翻牌击中暗三条的概率是 ',
      h('span', { class: 'mono' }, '1 − C(48,3)/C(50,3) = 144/1225 ≈ 11.76%'),
      '（数学竞赛 P02 会让引擎枚举全部 19600 种翻牌把这个数算出来）。',
      hasReal
        ? h('span', {}, '在原来的纯权益结算模型里，这部分价值是 ', h('b', {}, '零'),
          '——翻前结束后直接按全下权益结算，没有翻后，也就没有暗三条可打。',
          '现在它就是上面那一列 Δ：用解算器把这部分价值量出来、接回结算叶子，所以小对子的 Δ 是正的。')
        : h('span', {}, '这部分价值在这个模型里是 ', h('b', {}, '零'), ' —— 翻前结束后直接按全下权益结算，没有翻后，也就没有暗三条可打。')),
    pairs.length
      ? h('div', {}, '所以这张图里 ', pairs.map((x) => x.n + '（权益 ' + (x.eq * 100).toFixed(1) + '%、开池 ' + (x.open * 100).toFixed(0) + '%）').join('、'), ' 被判成弃牌，是模型定义决定的结果。')
      : h('div', {}, '这张图的开池范围本身很宽，小对子都开了，所以这一点在这张图上看不出来；换上面的参照或换一张图更明显。'),
    h('div', { class: 'muted' }, hasReal
      ? '同理，同花连牌的隐含赔率与位置带来的实现率差异，也都包在 Δ 里（IP 侧的 Δ 系统性高于 OOP 侧）。'
      : '同理，同花连牌的隐含赔率、位置带来的权益实现率差异，在这个模型里同样是零。')));

  box.append(h('div', { class: 'small muted', style: { marginTop: '8px' } },
    hasReal
      ? '这张图已经把翻后价值以「权益实现差」的形式接进来了，比原来的纯权益结算准得多；但 Δ 用的是固定代表范围与两档 SPR（牌面本身是全枚举的），仍是近似。当结论与你的直觉冲突时，以解算器对具体局面的解为准。'
      : '这张图是纯权益结算的基线，只能看「纯摊牌价值」这一维度上手牌的相对强弱。'));
  return box;
}

function buildPreflopView() {
  const v = $('#view-preflop');
  v.innerHTML = '';
  const status = h('div', { class: 'small muted' });
  const sel = h('select', { onchange: () => load(sel.value) }, h('option', { value: 'hu' }, '2 人（SB vs BB）'), h('option', { value: '3max' }, '3 人（BTN/SB/BB）'), h('option', { value: '6max' }, '6 人（成品未内置，需自行预解算）'));
  const liveBtn = h('button', { onclick: () => liveSolve() }, '现场解算（约 30 秒）');
  const pathEl = h('div', { class: 'pf-path' });
  const gridWrap = h('div', { style: { maxWidth: '520px' } });
  const detail = h('div', { class: 'panel small' });
  const quizEl = h('div', { class: 'panel' });
  const auditEl = h('div');
  v.append(h('div', { class: 'note' },
      '模型 = 翻前行动树 + 权益结算叶子 + ', h('b', {}, '权益实现差修正'), '。',
      '实现差是用解算器在全部 1755 个同构翻牌上测出来的「实际 EV − 裸权益份额」，把翻后价值带回翻前，',
      '所以小对子和同花连牌不再被系统性低估。仍是近似：Δ 用固定代表范围与两档 SPR 测得。',
      '下面「模型自检」里有运行时算出来的具体数字，以及这张图还剩哪些自相矛盾。'),
    h('div', { class: 'panel' }, h('div', { class: 'row' }, sel, liveBtn, status)),
    h('div', { class: 'cols cols-even' }, h('div', { class: 'panel' }, h('h2', {}, '路径'), pathEl, gridWrap), h('div', {}, detail, quizEl)),
    auditEl);

  async function refreshAudit() {
    auditEl.innerHTML = '';
    if (!pfState.current) return;
    if (!pfState.eqTable) {
      const eq = embeddedData('eq169');
      pfState.eqTable = eq ? eq.table : (await loadEq169());
    }
    if (pfState.realization === null) {
      loadRealizationTable();
    }
    // Δ 表可能是异步取回来的，拿到后重画这块面板
    refreshAuditIfOpen = () => { if (auditEl.isConnected) refreshAudit(); };
    auditEl.append(buildPreflopAudit(pfState.current));
  }

  async function load(name) {
    const c = await loadPreflopData(name);
    if (!c) {
      // 6 人树有 3 万多个决策节点，30 秒现场解算出来的东西不能当结论用，别把人往那上引。
      status.textContent = name === '6max'
        ? '成品不内置 6 人图：6 人树有 3 万多个决策节点，要跑 node tools/precompute_preflop.mjs 600 6max（至少 10 分钟）再重新打包。下面的“现场解算”只有 30 秒，在 6 人树上远不够收敛，只能当演示看。'
        : `没有 ${name} 的预解算文件（运行 node tools/precompute_preflop.mjs 生成），或点“现场解算”。`; pfState.current = null; pathEl.innerHTML = ''; gridWrap.innerHTML = ''; return; }
    pfState.current = c; pfState.path = [];
    status.textContent = `${c.players} 人 ${c.stack}bb，${c.iterations} 次迭代`;
    renderPath();
    renderQuiz();
    refreshAudit();
  }
  async function liveSolve() {
    liveBtn.disabled = true;
    const players = sel.value === 'hu' ? 2 : sel.value === '3max' ? 3 : 6;
    try {
      const eq = embeddedData('eq169');
      const eqTable = eq ? eq.table : (await loadEq169());
      // 实现差表要一并传给 Worker，否则现场解算出来的是纯权益模型
      const real = loadRealizationTable();
      const m = await client.preflop({ players, stack: 100, ms: 30000, eqTable, realization: real || null }, (p) => { status.textContent = p.phase === 'eq169' ? `生成 169×169 权益表 ${p.done}/${p.total}` : `迭代 ${p.iter}`; });
      // 存到单独的键上：现场 30 秒解出来的图比预解算那份粗得多（已提交的是亿级迭代），
      // 不能把它顶掉——否则切走再切回拿到的还是这份粗图。
      pfState.charts[sel.value + ':live'] = m.charts; pfState.current = m.charts; pfState.path = [];
      status.textContent = `现场解算完成：${m.charts.iterations} 次迭代`
        + (m.charts.hasRealization ? '' : '（没有权益实现差表，这是纯权益结算模型）')
        + '，远不及预解算那份收敛；切走再切回就会回到预解算的图。';
      renderPath(); renderQuiz(); refreshAudit();
    } catch (e) { status.textContent = '失败：' + e.message; }
    liveBtn.disabled = false;
  }
  async function loadEq169() { try { const r = await fetch('data/preflop/eq169.json'); if (r.ok) return (await r.json()).table; } catch (e) { /* 无 */ } return null; }
  function nodeAt(path) {
    const c = pfState.current;
    let node = c.charts[0];
    for (const a of path) { const nxt = node.actions[a].next; node = c.charts.find((x) => x.id === nxt); if (!node) return null; }
    return node;
  }
  function renderPath() {
    const c = pfState.current;
    pathEl.innerHTML = '';
    let node = c.charts[0];
    const crumbs = h('div', { class: 'crumbs' }, h('button', { class: pfState.path.length ? '' : 'primary', onclick: () => { pfState.path = []; renderPath(); } }, '开始'));
    for (let i = 0; i < pfState.path.length; i++) {
      const a = node.actions[pfState.path[i]];
      crumbs.append(h('button', { class: i === pfState.path.length - 1 ? 'primary' : '', onclick: () => { pfState.path = pfState.path.slice(0, i + 1); renderPath(); } }, `${node.pos}:${a.label}`));
      node = c.charts.find((x) => x.id === a.next);
      if (!node) break;
    }
    pathEl.append(crumbs);
    if (!node) { pathEl.append(h('div', { class: 'muted' }, '终端（弃牌/摊牌结算）')); gridWrap.innerHTML = ''; return; }
    const colors = actionColors(node.actions);
    pathEl.append(h('div', {}, h('b', {}, `${node.pos} 行动`), `（底池 ${node.pot}bb，需跟注 ${node.toCall}bb）`));
    node.actions.forEach((a, i) => {
      let freq = 0;
      for (let k = 0; k < 169; k++) freq += node.probs[i * 169 + k] * NOTATION_TO_COMBOS.get(NOTATION_LIST[k]).length;
      freq /= 1326;
      pathEl.append(h('div', { class: 'bar-row' }, h('button', { style: { width: '120px', textAlign: 'left', borderColor: colors[i] }, onclick: () => { pfState.path = [...pfState.path, i]; renderPath(); } }, a.label), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: pct(freq, 1), background: colors[i] } })), h('span', { class: 'mono small', style: { width: '56px' } }, pct(freq, 1))));
    });
    pathEl.append(legendEl(node.actions, colors));
    gridWrap.innerHTML = '';
    gridWrap.append(renderGrid((nt) => { const k = NOTATION_LIST.indexOf(nt); return { weight: 1, probs: node.actions.map((_, a) => node.probs[a * 169 + k]), colors }; }, null, (nt) => {
      const k = NOTATION_LIST.indexOf(nt);
      detail.innerHTML = '';
      detail.append(h('b', {}, nt), h('div', {}, node.actions.map((a, i) => `${a.label} ${pct(node.probs[i * 169 + k], 1)}`).join('　')));
    }));
  }
  function renderQuiz() {
    const c = pfState.current;
    quizEl.innerHTML = '';
    quizEl.append(h('h2', {}, '翻前闪卡'));
    const btn = h('button', { class: 'primary', onclick: newQuiz }, '出题');
    const body = h('div');
    quizEl.append(btn, body);
    function newQuiz() {
      // 随机挑一个深度 ≤ 3 的决策节点和一类手牌
      const cands = c.charts.filter((x) => x.raises <= 2);
      const node = cands[(Math.random() * cands.length) | 0];
      const k = (Math.random() * 169) | 0;
      body.innerHTML = '';
      body.append(h('div', {}, `局面：${node.history || '无人行动'} → 你在 ${node.pos}，拿 `, h('b', {}, NOTATION_LIST[k]), `，底池 ${node.pot}bb，需跟注 ${node.toCall}bb。`));
      const btns = h('div', { class: 'actions' });
      node.actions.forEach((a, i) => btns.append(h('button', { onclick: () => answer(i) }, a.label)));
      body.append(btns);
      function answer(i) {
        btns.querySelectorAll('button').forEach((b) => (b.disabled = true));
        const probs = node.actions.map((_, a) => node.probs[a * 169 + k]);
        const best = probs.indexOf(Math.max(...probs));
        const ok = probs[i] >= 0.3;
        body.append(h('div', { class: 'note' }, ok ? '✓ 在策略内。' : '✗ 偏离。', ` 图上的策略：${node.actions.map((a, j) => `${a.label} ${pct(probs[j])}`).join('，')}。`));
        // 翻前图只给出策略频率，没有动作 EV，所以这里**没有** EV 损失可记。
        // 早先版本往 evLossPct 里写死 3%，那是编出来的数字，会污染漏洞报告的筹码口径。
        store.addAttempt({
          time: Date.now(), kind: 'preflop', scenarioId: 'preflop-' + c.players + 'p',
          scenarioName: `翻前图（${c.players} 人 ${c.stack}bb）`,
          board: '翻前', hand: NOTATION_LIST[k], street: -1, history: node.history || '无人行动',
          chosen: node.actions[i].label, best: node.actions[best].label,
          evLossPct: null, grade: ok ? '良好' : '小错', mistake: ok ? '正确' : '翻前偏离', freq: probs[i],
        });
      }
    }
  }
  load('hu');
}

exports.loadPreflopData = loadPreflopData;
exports.buildPreflopView = buildPreflopView;
});
