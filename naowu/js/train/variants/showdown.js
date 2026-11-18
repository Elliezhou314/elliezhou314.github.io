__squidDefine('src/train/variants/showdown.js', function (exports) {
'use strict';
// 变式练习：数补牌再算期望值（P08 的变式）。转牌圈，对手全下并亮出两张牌，你拿着听牌，问跟注的期望值。
//
// 两条路径：
//   compute()  —— 把河牌的 44 种可能逐张发出来，用牌力评估器比你和对手的七张牌，数赢、输、平分
//   analytic() —— 数补牌（只看点数和花色，算上对手亮出来的牌挡掉的），再列期望值算式
// 出题时逐张核对：评估器判你赢的河牌必须正好是补牌、而且没有平分的牌；对不上（比如来一张补牌对手也成了更大的牌、
// 或者你配上对子也能赢）就换一局，保证「数补牌」在这道题里是精确的。
const { categoryOf, evaluate, CATEGORY_CN } = __squidRequire('src/core/evaluator.js');
const { cardsText, rankName, pct, signed1, pick, randInt, dealFrom } = __squidRequire('src/train/variants/common.js');
const { analyzeDraw, outsSentence } = __squidRequire('src/train/variants/draws.js');

const UNSEEN = 44;   // 52 − 你的 2 张 − 公共牌 4 张 − 对手亮出的 2 张

/** 对手现在的牌写成一句话：一对 Q、两对（K 和 7）、三条 9…… */
function handName(v) {
  const cat = categoryOf(v), k1 = (v >> 16) & 15, k2 = (v >> 12) & 15;
  if (cat === 1) return `一对 ${rankName(k1)}`;
  if (cat === 2) return `两对（${rankName(k1)} 和 ${rankName(k2)}）`;
  if (cat === 3) return `三条 ${rankName(k1)}`;
  return CATEGORY_CN[cat];
}

/** 河牌逐张发：你赢、输、平分各几张 */
function riverShowdown(hero, board, vil) {
  const seen = new Set([...hero, ...board, ...vil]);
  let win = 0, lose = 0, tie = 0;
  const wins = [];
  for (let c = 0; c < 52; c++) {
    if (seen.has(c)) continue;
    const a = evaluate([...hero, ...board, c], 7), b = evaluate([...vil, ...board, c], 7);
    if (a > b) { win++; wins.push(c); } else if (a < b) lose++; else tie++;
  }
  return { win, lose, tie, wins };
}

function showdownEV(rng) {
  const want = pick(['flush', 'straight', 'combo'], rng);
  const P = 10 * randInt(2, 15, rng);
  const B = 5 * randInt(Math.ceil(P / 20), Math.floor((P * 1.5) / 5), rng);
  for (let tries = 0; tries < 400000; tries++) {
    const cards = dealFrom(rng, [], 8);
    // 两人的手牌都是大的写前面（数值比较的排序，各家浏览器结果一样）
    const hero = cards.slice(0, 2).sort((a, b) => b - a), board = cards.slice(2, 6), vil = cards.slice(6).sort((a, b) => b - a);
    const d = analyzeDraw(hero, board, cards);
    if (d.madeStraight || d.madeFlush) continue;
    const hasF = d.flushSuit >= 0, hasS = d.straightRanks.length > 0;
    const cls = hasF && hasS ? 'combo' : hasF ? 'flush' : hasS ? 'straight' : null;
    if (cls !== want) continue;
    const hv = evaluate([...hero, ...board], 6), vv = evaluate([...vil, ...board], 6);
    if (categoryOf(vv) < 1 || vv <= hv) continue;   // 对手现在至少一对、而且比你大
    const outs = cls === 'flush' ? d.flushOuts : cls === 'straight' ? d.straightOuts : d.outs;
    if (outs.length < 2) continue;
    const r = riverShowdown(hero, board, vil);
    if (r.tie || r.win !== outs.length || !r.wins.every((c) => outs.includes(c))) continue;
    return build(hero, board, vil, P, B, cls, d, outs.length, vv);
  }
  return null;
}

function build(hero, board, vil, P, B, cls, d, N, vv) {
  const H = cardsText(hero), BD = cardsText(board), V = cardsText(vil);
  const kinds = cls === 'combo' ? ['flush', 'straight'] : [cls];
  const outsText = outsSentence(d, kinds, '你的牌、公共牌和对手亮出的牌');
  const win = P + B, L = UNSEEN - N;
  const num = N * win - L * B;
  const value = num / UNSEEN;
  const need = B / (P + 2 * B);
  return {
    params: { hero, board, vil, pot: P, bet: B, cls, outs: N },
    kind: 'number', tolerance: 1e-9, verify: 'enumeration', heavy: false,
    title: `转牌全下：${cls === 'flush' ? '同花听牌' : cls === 'straight' ? '顺子听牌' : '同花加顺子听牌'}跟不跟`,
    statement: `转牌局面：你拿 ${H}，公共牌是 ${BD}，底池 ${P}。对手全下 ${B}，并亮出了他的两张牌 ${V}。河牌还要发一张。`
      + `你跟注的期望值是多少筹码？（赢了拿走底池 ${P} 和对手的 ${B}，净赚 ${win}；输了亏掉跟注的 ${B}）`,
    hints: [
      `河牌只剩一张。你看得见 8 张牌（你的 2 张、公共牌 4 张、对手亮出的 2 张），没发的还有 52 − 8 = ${UNSEEN} 张。对手现在是${handName(vv)}，比你大，你要靠河牌反超。`,
      `${outsText}。补牌一共 ${N} 张——这一局里只有它们能让你赢，也没有平分的牌。所以跟注后赢的概率是 ${N}/${UNSEEN}，输的概率是 ${L}/${UNSEEN}。`,
      `赢了净赚 ${win}，输了亏掉 ${B}。期望值 = ${N}/${UNSEEN} × ${win} + ${L}/${UNSEEN} × (−${B})，算出来保留一位小数。`,
    ],
    compute() {
      const r = riverShowdown(hero, board, vil);
      const ev = (r.win * win - r.lose * B + r.tie * (P / 2)) / UNSEEN;
      return {
        value: ev,
        evidence: `河牌还有 ${UNSEEN} 种可能，逐张发出来，用牌力评估器比你和对手的七张牌：你赢 ${r.win} 张、输 ${r.lose} 张${r.tie ? `、平分 ${r.tie} 张` : '、没有平分的'}。`
          + `所以跟注后有 ${r.win}/${UNSEEN} 的机会净赚 ${win}，${r.lose}/${UNSEEN} 的机会亏掉 ${B}，平均 ${signed1(ev)} 个筹码。`,
        detail: { win: r.win, lose: r.lose, tie: r.tie },
      };
    },
    analytic() {
      return {
        value,
        expr: `(${N}×${win} − ${L}×${B})/${UNSEEN} = ${String(num).replace('-', '−')}/${UNSEEN} ≈ ${signed1(value)}`,
        derivation: `${outsText}。没发的 ${UNSEEN} 张里 ${N} 张能让你赢、${L} 张不能。赢了净赚 ${win}（底池 ${P} + 对手的 ${B}），输了亏掉自己的 ${B}。`
          + `期望值 = (${N}×${win} − ${L}×${B})/${UNSEEN} = ${String(num).replace('-', '−')}/${UNSEEN} ≈ ${signed1(value)}，所以这个跟注${value > 0 ? '是赚的' : value < 0 ? '是亏的' : '不赚不亏'}：`
          + `跟 ${B} 去争最终 ${P + 2 * B} 的底池，至少要 ${B}/${P + 2 * B} ≈ ${pct(need)} 的胜率，你有 ${N}/${UNSEEN} ≈ ${pct(N / UNSEEN)}。`
          + `出题时本机把 ${UNSEEN} 张河牌逐张比过牌：让你赢的正好是这 ${N} 张补牌，没有平分的，所以「数补牌」在这一局是精确的。`,
      };
    },
  };
}

const SHOWDOWN_GENERATORS = { P08: showdownEV };

exports.SHOWDOWN_GENERATORS = SHOWDOWN_GENERATORS;
});
