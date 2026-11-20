__squidDefine('src/ui/views/help.js', function (exports) {
'use strict';
// 「高阶数学」视图：工具里用到的公式的说明页。
const { h, $, pct } = __squidRequire('src/ui/dom.js');

function buildHelpView() {
  const v = $('#view-help');
  const calc = h('div', { class: 'panel' });
  const potIn = h('input', { type: 'number', value: 10, step: 0.5 }), betIn = h('input', { type: 'number', value: 7, step: 0.5 });
  const out = h('div', { class: 'kv', style: { marginTop: '8px' } });
  function upd() {
    const p = Number(potIn.value), b = Number(betIn.value);
    out.innerHTML = '';
    const rows = [['跟注所需权益 b/(p+2b)…（对手下注 b 后你跟 b）', pct(b / (p + 2 * b), 1)], ['对手诈唬盈亏平衡弃牌率 b/(p+b)', pct(b / (p + b), 1)], ['你的最小防守频率 MDF = p/(p+b)', pct(p / (p + b), 1)], ['你下注 b 时，河牌诈唬占比上限 b/(2b+p)…（诈唬/(价值+诈唬)）', pct(b / (2 * b + p), 1)], ['价值:诈唬', `${((p + b) / b).toFixed(2)} : 1`]];
    for (const [k, val] of rows) out.append(h('b', {}, k), h('span', { class: 'mono' }, val));
  }
  potIn.addEventListener('input', upd); betIn.addEventListener('input', upd); upd();
  calc.append(h('h2', {}, '速算器'), h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, '底池 p'), potIn), h('div', { class: 'field' }, h('label', {}, '下注 b'), betIn)), out);
  v.innerHTML = '';
  v.append(h('div', { class: 'cols cols-even' }, h('div', { class: 'panel' }, h('h2', {}, '用数学逻辑高阶打法（这套工具的所有判断都建立在这些公式上）'), h('div', { class: 'small', html: `
<p><b>1. 底池赔率与所需权益。</b>面对下注 b、底池 p（含对方下注）：所需权益 = b/(p+b)。权益 ≥ 所需就跟；不够就看隐含赔率（后面还能赢多少）。</p>
<p><b>2. 诈唬的盈亏平衡。</b>你下注 b 到底池 p：对手弃牌率 ≥ b/(p+b) 时纯诈唬为正 EV。半诈唬额外有权益兜底。</p>
<p><b>3. MDF（最小防守频率）。</b>面对下注 b 到底池 p，你至少防守 p/(p+b) 的范围，否则对手拿任何两张牌下注都赚。MDF 是防剥削的下限，不是目标。</p>
<p><b>4. 价值/诈唬配比。</b>河牌极化下注 b：诈唬占比 = b/(2b+p)。下注底池 → 1/3 诈唬；下注 2 倍底池 → 40%。转牌、翻牌要留“下一街还能继续诈唬”的空间，所以比例更高。</p>
<p><b>5. 范围优势 vs 坚果优势。</b>范围整体权益高 → 可以高频小尺度下注；坚果组合（set、两对、坚果听牌）明显更多 → 可以大尺度、可以加注。两个都没有 → 多过牌。解算器里的“范围整体频率”和 13×13 网格就是在看这两件事。</p>
<p><b>6. SPR（后手/底池）。</b>SPR ≤ 3：顶对以上通常愿意全下；SPR 6~10：需要两对以上；SPR 高：听牌的隐含赔率好。</p>
<p><b>7. 阻挡牌。</b>抓诈时优先用挡住对手价值组合、不挡住其诈唬组合的牌跟注；诈唬时优先用挡住对手跟注范围的牌。解算器在河牌上会把这些体现在同一记号内不同花色组合的策略差异里。</p>
<p><b>8. EV 不看结果。</b>训练里的评分只比较动作 EV，输赢不算。长期收益 = Σ（每个决策的 EV），把每次 EV 损失当成可量化的漏洞去修。</p>
<p><b>9. 多人底池。</b>3 人局权益被稀释、夹击风险高：持续下注更紧更偏价值，抓诈频率显著低于单挑。另外 3 人博弈没有“纳什均衡保证”，解算器给出的是自博弈近似解。</p>
<p><b>10. 用工具的正确方式。</b>先解一个结构（例如 SRP BTN vs BB 干燥面），看整体频率 → 看哪些手牌在做什么 → 总结成可执行的规则 → 去特训地图里练到平均 EV 损失 &lt; 1% 底池。</p>` })), calc));
}

exports.buildHelpView = buildHelpView;
});
