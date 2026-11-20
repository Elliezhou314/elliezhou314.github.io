__squidDefine('src/ui/selftest.js', function (exports) {
'use strict';
// 端到端自检：打开 xxx.html#selftest，在页面顶部打印各模块是否跑通（无头浏览器测试用）。
const { parseCards, NOTATION_TO_COMBOS } = __squidRequire('src/core/cards.js');
const { HeuristicBot } = __squidRequire('src/engine/bot.js');
const { HandEngine } = __squidRequire('src/engine/game.js');
const { analyzeHand } = __squidRequire('src/review/review.js');
const { SCENARIOS, DrillSession, scenarioToSpec } = __squidRequire('src/train/training.js');
const { embeddedSolution } = __squidRequire('src/ui/data.js');
const { h } = __squidRequire('src/ui/dom.js');
const { client, drillClient } = __squidRequire('src/ui/services.js');
const { makeEvProvider } = __squidRequire('src/ui/views/drill.js');
const { loadPreflopData } = __squidRequire('src/ui/views/preflop.js');

async function runSelfTest() {
  const out = h('pre', { id: 'selftest', class: 'review' }, 'SELFTEST START\n');
  document.body.prepend(out);
  const log = (s) => { out.textContent += s + '\n'; };
  try {
    const sol = await client.solve({ players: 2, board: parseCards('2s7d9cJhQs'), pot: 10, stack: 30, ranges: ['KK,54o', 'TT'], sizes: { river: { bet: [100], raise: [] } }, raiseCap: 1, allin: false }, { ms: 4000, targetExploitPct: 0.05 }, () => {});
    const st = sol.strategyAt(sol.root);
    const betIdx = sol.root.actions.findIndex((a) => a.kind === 'bet');
    log(`SELFTEST solve ok iter=${sol.summary.iterations} exploit=${sol.summary.exploitPct.toFixed(3)} KKbet=${st.byNotation.KK.probs[betIdx].toFixed(2)} airbet=${st.byNotation['54o'].probs[betIdx].toFixed(2)}`);
    const r = await client.actionEVs(sol.solveId, sol.root.id);
    log(`SELFTEST ev ok finite=${Number.isFinite(r.evs[NOTATION_TO_COMBOS.get('KK')[0]])}`);
    // 剥削分析必须端到端跑通：对照组（均衡对手）的剥削收益要恰好为 0，
    // 有漏洞的对手要为正——这一条同时验证了 Worker 通道、solveId 复用与算法本身。
    const exBal = (await client.exploit(sol.solveId, 0, 'balanced')).analysis;
    const exSta = (await client.exploit(sol.solveId, 0, 'station')).analysis;
    if (Math.abs(exBal.gain) > 0.02) throw new Error(`剥削对照组收益应为 0，实际 ${exBal.gain}`);
    if (!(exSta.gain > 0)) throw new Error(`对跟注站的剥削收益应为正，实际 ${exSta.gain}`);
    // 内置均衡解：装载后现场重算的可利用度必须与产物里记的对得上，
    // 并且能算出有限的动作 EV（判分靠的就是它）。
    {
      const sc0 = SCENARIOS.find((x) => x.players === 2 && embeddedSolution(x.id, x.boards[0]));
      if (!sc0) throw new Error('没有任何内置均衡解（data/solutions/drills.json 没内嵌进来？）');
      const b0 = sc0.boards[0];
      const emb = embeddedSolution(sc0.id, b0);
      const spec0 = scenarioToSpec(sc0, b0);
      const ps = await client.loadSolution(spec0, emb.dims, emb.strategies,
        { iterations: emb.iterations, solveSeconds: emb.solveSeconds, exploitPct: emb.exploitPct }, () => {});
      const gap = Math.abs(ps.summary.exploitPct - emb.reloadedExploitPct);
      if (gap > 0.005) throw new Error(`内置解装载后可利用度 ${ps.summary.exploitPct} 与产物记的 ${emb.reloadedExploitPct} 对不上`);
      const pev = await client.actionEVs(ps.solveId, ps.root.id);
      if (!pev.evs.some((x) => Number.isFinite(x))) throw new Error('内置解算不出动作 EV');
      log(`SELFTEST preloaded ok ${sc0.id}|${b0} 可利用度=${ps.summary.exploitPct.toFixed(4)}% 离线=${emb.exploitPct}% 迭代=${emb.iterations} EV可算=true`);
    }
    log(`SELFTEST exploit ok 对照组=${exBal.gain.toFixed(4)} 跟注站=+${exSta.gain.toFixed(3)} 风险=${exSta.risk.toFixed(3)} 节点=${exSta.diffs.length}`);
    const eq = await client.equity({ kind: 'hvr', hole: parseCards('AsKs'), range: 'QQ', board: [], samples: 5000 });
    log(`SELFTEST equity AKs vs QQ = ${eq.equity.toFixed(3)}`);
    const sol3 = await drillClient.solve({ players: 3, board: parseCards('2s7d9cKhQs'), pot: 12, stack: 30, ranges: ['KK,AA,54o', 'TT,JJ', '99,88,A2s'], sizes: { river: { bet: [60], raise: [70] } }, raiseCap: 2 }, { ms: 2000 }, () => {});
    log(`SELFTEST 3p ok iter=${sol3.summary.iterations}`);
    const ds = new DrillSession(sol, 0, makeEvProvider(sol, client)); // 与真实训练同一条路径
    let st2 = null;
    for (let i = 0; i < 10 && (!st2 || st2.over); i++) st2 = ds.newHand();
    const fb = await ds.choose(0);
    const nAct = sol.nodes[fb.nodeId != null ? fb.nodeId : sol.root.id].actions.length;
    if (!Array.isArray(fb.evs) || fb.evs.length !== fb.actions.length) throw new Error(`drill EV 数组长度 ${fb.evs && fb.evs.length} != 动作数 ${fb.actions.length}（引擎判定或取值路径错了）`);
    if (!fb.evs.every((x) => Number.isFinite(x))) throw new Error('drill EV 里有非有限值');
    // 判分必须与 EV 数组自洽（与发到什么牌无关）：
    // 选的动作就是最优时损失必须是 0，否则必须为正。
    // 早先这里只打一行 grade，而 grade 随发牌变（发到 KK 就是大错、发到 54o 就是完美），
    // 看起来像回归实则什么都没测。
    {
      const best = Math.max(...fb.evs);
      const chosenIsBest = Math.abs(fb.evs[0] - best) < 1e-9;
      if (chosenIsBest && fb.lossPct > 1e-6) throw new Error(`选中的就是最优动作，损失却是 ${fb.lossPct}`);
      if (!chosenIsBest && !(fb.lossPct > 0)) throw new Error(`选中的不是最优动作，损失却是 ${fb.lossPct}`);
    }
    log(`SELFTEST drill ok grade=${fb.grade} loss=${fb.lossPct.toFixed(2)} evs=${fb.evs.length}/${fb.actions.length} 引擎=${sol.summary.engine} isVector=${sol.isVector}`);
    const eng = new HandEngine({ seats: [{ name: '你', stack: 100, isHero: true }, { name: 'b1', stack: 100, bot: new HeuristicBot('balanced', 1) }, { name: 'b2', stack: 100, bot: new HeuristicBot('tight', 2) }], button: 0, sb: 0.5, bb: 1, seed: 42 });
    let guard = 0;
    while (!eng.over && guard++ < 60) {
      const s = eng.toActSeat;
      if (!s) break;
      if (s.isHero) { const la = eng.legalActions(); const a = la.find((x) => x.kind === 'call' || x.kind === 'check'); eng.act(a.kind); }
      else { const d = s.bot.decide(eng); eng.act(d.kind, d.amountTo); }
    }
    const an = analyzeHand(eng.toRecord());
    log(`SELFTEST game ok over=${eng.over} decisions=${an.decisions.length}`);
    const pf = await loadPreflopData('hu');
    log(`SELFTEST preflop data ${pf ? 'ok charts=' + pf.charts.length : 'missing'}`);
    log('SELFTEST DONE');
  } catch (e) { log('SELFTEST FAIL ' + (e.stack || e.message)); }
  document.title = 'SELFTEST ' + (out.textContent.includes('FAIL') ? 'FAIL' : 'DONE');
}

exports.runSelfTest = runSelfTest;
});
