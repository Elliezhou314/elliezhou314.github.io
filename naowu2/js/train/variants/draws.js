__squidDefine('src/train/variants/draws.js', function (exports) {
'use strict';
// 变式练习：听牌命中的概率（P03 的变式）。另外放着数补牌用的局面分析，P08 的变式（showdown.js）也用它。
//
// 两条路径：
//   compute()  —— 把后面的牌逐种发出来，用牌力评估器看你的牌是不是凑成了同花 / 顺子
//   analytic() —— 先数补牌（只看点数和花色，不调评估器），再套「一张：补牌 ÷ 没发的张数；两张：1 − 两张都不中」
// 「数补牌」不是在每个局面都精确：两张牌都要来才成的顺子、同花顺和同花撞在一起、公共牌自己连成顺子……
// 所以出题时把每一种发法都核对一遍——评估器说凑成了的发法，必须正好是含补牌的那些发法；对不上就换一局。
const { rankOf, suitOf } = __squidRequire('src/core/cards.js');
const { evaluate, categoryOf } = __squidRequire('src/core/evaluator.js');
const { C, chooseText, SUIT_CN, cardText, cardsText, rankName, pct, pick, dealFrom, remaining, ranksList } = __squidRequire('src/train/variants/common.js');

/** 13 位点数掩码里有没有五张连着的（A 也能当 1） */
function maskHasStraight(m) {
  for (let hi = 12; hi >= 4; hi--) { const need = 0x1f << (hi - 4); if ((m & need) === need) return true; }
  return (m & 0x100f) === 0x100f;   // A2345：A 当 1 用
}
const maskOf = (cards) => cards.reduce((m, c) => m | (1 << rankOf(c)), 0);

/** 加上点数 r 之后成的那条顺子（取最高的一条），用来在提示里举例：「8、9、10、J、Q」 */
function straightWith(mask, r) {
  const m = mask | (1 << r);
  for (let hi = 12; hi >= 3; hi--) {
    const ranks = hi === 3 ? [12, 0, 1, 2, 3] : [hi - 4, hi - 3, hi - 2, hi - 1, hi];
    if (ranks.includes(r) && ranks.every((x) => (m >> x) & 1)) return ranks;
  }
  return null;
}

/**
 * 只看点数和花色的局面分析（不调评估器）。hero、board 是你的手牌和公共牌，seen 是所有看得见的牌（可以再加上对手亮出的牌）。
 *   madeStraight / madeFlush：现在就已经是顺子 / 同花
 *   flushSuit、flushOuts：同花听牌的花色（你的牌加公共牌恰好 4 张、至少一张在手里）和还没见过的那个花色的牌
 *   straightRanks、straightOuts：再来一张就成顺子的点数（公共牌自己加上它不成顺），以及这些点数里还没见过的牌
 *   suitMax：你的牌加公共牌里，同一花色最多几张
 */
function analyzeDraw(hero, board, seen) {
  const mine = [...hero, ...board];
  const sc = [0, 0, 0, 0];
  for (const c of mine) sc[suitOf(c)]++;
  const seenSet = new Set(seen);
  const unseen = remaining(seen);
  const mask = maskOf(mine), bmask = maskOf(board);
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (sc[s] === 4 && hero.some((c) => suitOf(c) === s)) flushSuit = s;
  const straightRanks = [];
  for (let r = 0; r < 13; r++) {
    if ((mask >> r) & 1) continue;
    if (maskHasStraight(mask | (1 << r)) && !maskHasStraight(bmask | (1 << r))) straightRanks.push(r);
  }
  const flushOuts = flushSuit < 0 ? [] : unseen.filter((c) => suitOf(c) === flushSuit);
  const straightOuts = unseen.filter((c) => straightRanks.includes(rankOf(c)));
  const outs = unseen.filter((c) => (flushSuit >= 0 && suitOf(c) === flushSuit) || straightRanks.includes(rankOf(c)));
  return {
    madeStraight: maskHasStraight(mask), madeFlush: Math.max(...sc) >= 5, suitMax: Math.max(...sc),
    flushSuit, flushOuts, straightRanks, straightOuts, outs, unseen, seenSet, mask,
    // 每个点数还剩几张没见过（对手亮出的牌也算见过）
    rankLeft: (r) => 4 - seen.filter((c) => rankOf(c) === r).length,
  };
}

/** 补牌怎么数，写成一句话（提示和推导共用）。kinds：要数哪几样（同花、顺子） */
function outsSentence(d, kinds, seenWho) {
  const parts = [];
  if (kinds.includes('flush')) {
    const SU = SUIT_CN[d.flushSuit];
    const seenSuit = 13 - d.flushOuts.length;
    parts.push(`${SU}一共 13 张，${seenWho}里已经有 ${seenSuit} 张，还剩 ${d.flushOuts.length} 张，来一张就成同花`);
  }
  if (kinds.includes('straight')) {
    const ex = straightWith(d.mask, d.straightRanks[0]);
    const per = d.straightRanks.map((r) => d.rankLeft(r));
    const allFour = per.every((x) => x === 4);
    const count = allFour ? `${d.straightRanks.length === 1 ? '这个点数' : '这几个点数'}一张都没见过，每个 4 张，一共 ${d.straightOuts.length} 张`
      : `${d.straightRanks.map((r, i) => `${rankName(r)} 还剩 ${per[i]} 张`).join('、')}，一共 ${d.straightOuts.length} 张`;
    parts.push(`差一张 ${d.straightRanks.map(rankName).join(' 或 ')} 就成顺子（比如来一张 ${rankName(d.straightRanks[0])}，就有 ${ranksList(ex)} 五张连着），${count}`);
  }
  let s = parts.join('；');
  if (kinds.length === 2) {
    const both = d.flushOuts.filter((c) => d.straightRanks.includes(rankOf(c)));
    s += `。其中 ${both.map(cardText).join('、')} 既是${SUIT_CN[d.flushSuit]}又能成顺，只能算一次：${d.flushOuts.length} + ${d.straightOuts.length} − ${both.length} = ${d.outs.length} 张`;
  }
  return s;
}

const WANT = { flush: [5, 8], straight: [4, 8], combo: [4, 5, 8] };
const EVENT = {
  flush: { text: '同花（五张同花色；同花顺也算）', short: '同花', label: '同花听牌' },
  straight: { text: '顺子（五张点数连续）', short: '顺子', label: '顺子听牌' },
  combo: { text: '同花或顺子（两样占一样就算；同花顺也算）', short: '同花或顺子', label: '同花加顺子听牌' },
};
const STREETS = {
  flop2: { nb: 3, k: 2, label: '转牌河牌两张' },
  flop1: { nb: 3, k: 1, label: '只看转牌' },
  turn1: { nb: 4, k: 1, label: '只看河牌' },
};

/** 把后面 k 张牌的每一种发法逐个发出来，交给 visit(发出来的牌) */
function eachRunout(unseen, k, visit) {
  if (k === 1) { for (const c of unseen) visit([c]); return; }
  for (let i = 0; i < unseen.length; i++) for (let j = i + 1; j < unseen.length; j++) visit([unseen[i], unseen[j]]);
}

/** 评估器逐种发法判断：凑成了几种、一共几种；check 为真时顺带核对「凑成了 ⇔ 含补牌」 */
function enumerateHits(hero, board, k, want, outsSet) {
  const unseen = remaining([...hero, ...board]);
  let hit = 0, total = 0, agree = true;
  eachRunout(unseen, k, (run) => {
    const cards = [...hero, ...board, ...run];
    const ok = want.includes(categoryOf(evaluate(cards, cards.length)));
    total++;
    if (ok) hit++;
    if (outsSet && ok !== run.some((c) => outsSet.has(c))) agree = false;
  });
  return { hit, total, agree };
}

function drawHit(rng) {
  const street = pick(['flop2', 'flop1', 'turn1'], rng);
  const want = pick(['flush', 'straight', 'combo'], rng);
  const { nb, k } = STREETS[street];
  for (let tries = 0; tries < 400000; tries++) {
    const cards = dealFrom(rng, [], 2 + nb);
    const hero = cards.slice(0, 2).sort((a, b) => b - a), board = cards.slice(2);   // 手牌大的写前面
    const d = analyzeDraw(hero, board, cards);
    if (d.madeStraight || d.madeFlush) continue;
    const hasF = d.flushSuit >= 0, hasS = d.straightRanks.length > 0;
    const cls = hasF && hasS ? 'combo' : hasF ? 'flush' : hasS ? 'straight' : null;
    if (cls !== want) continue;
    // 只问顺子时，后面的牌不许凑出同花（评估器会把「又是顺子又是同花」判成同花，问法就有歧义了）
    if (cls === 'straight' && d.suitMax > (k === 2 ? 2 : 3)) continue;
    const outs = cls === 'flush' ? d.flushOuts : cls === 'straight' ? d.straightOuts : d.outs;
    if (!enumerateHits(hero, board, k, WANT[cls], new Set(outs)).agree) continue;
    return buildDraw(hero, board, street, cls, d, outs.length);
  }
  return null;
}

function buildDraw(hero, board, street, cls, d, N) {
  const { nb, k } = STREETS[street];
  const U = 52 - 2 - nb;
  const ev = EVENT[cls];
  const H = cardsText(hero), B = cardsText(board);
  const kinds = cls === 'combo' ? ['flush', 'straight'] : [cls];
  const outsText = outsSentence(d, kinds, '你的手牌和公共牌');
  const seenN = 2 + nb;
  const statement = street === 'flop2'
    ? `你拿 ${H}，翻牌是 ${B}。转牌和河牌还要发两张。发完之后，你的两张手牌和五张公共牌合起来能凑成${ev.text}的概率是多少？`
    : street === 'flop1'
      ? `你拿 ${H}，翻牌是 ${B}。只看转牌这一张：发出来之后，你的两张手牌和四张公共牌合起来能凑成${ev.text}的概率是多少？`
      : `你拿 ${H}，公共牌是 ${B}（翻牌加转牌）。河牌还要发一张：发出来之后，你的两张手牌和五张公共牌合起来能凑成${ev.text}的概率是多少？`;
  const miss = C(U - N, 2), all = C(U, 2);
  const hints = [
    `先数补牌：还没发的牌里，哪些一来你就能凑成${ev.short}。你看得见 ${seenN} 张牌（2 张手牌＋${nb} 张公共牌），没发的还有 52 − ${seenN} = ${U} 张。`
      + (k === 2 ? '两张牌的问题反过来算更容易：先算两张都不是补牌的概率。' : ''),
    `${outsText}。补牌一共 ${N} 张，不是补牌的有 ${U - N} 张。`,
    k === 2
      ? `两张都不中：从 ${U - N} 张里挑 2 张，${chooseText(U - N, 2)} 种；${U} 张里挑 2 张一共 ${chooseText(U, 2)} 种。两张都不中的概率是 ${miss}/${all}，答案是 1 减去它。`
      : `只发一张，这一张正好是补牌的概率 = 补牌的张数 ÷ 没发的张数 ${U}。（这一局里，凑得成${ev.short}的牌都是补牌，补牌来了也一定凑得成。）`,
  ];
  const cats = WANT[cls];
  const value = k === 2 ? 1 - miss / all : N / U;
  return {
    params: { hero, board, street, cls, outs: N, unseen: U },
    kind: 'probability', tolerance: 1e-12, verify: 'enumeration', heavy: false,
    title: `${ev.label}：${STREETS[street].label}`,
    statement, hints,
    compute() {
      const r = enumerateHits(hero, board, k, cats, null);
      return {
        value: r.hit / r.total,
        evidence: `把${k === 2 ? `转牌、河牌的全部 ${r.total} 种发法` : `这一张牌的全部 ${r.total} 种可能`}逐个发出来，用牌力评估器看你的 ${seenN + k} 张牌：能凑成${ev.short}的有 ${r.hit} 种，占 ${pct(r.hit / r.total)}。`,
        detail: { hit: r.hit, total: r.total },
      };
    },
    analytic() {
      const check = `出题时本机把每一种发法都核对过：这一局凡是凑成${ev.short}的发法都至少含一张补牌，含补牌的发法也一定凑得成，所以在这一局里「数补牌」是精确的（有些局面不是，比如两张都要来才成的顺子，那种局面不会出成题）。`;
      if (k === 1) {
        return { value, expr: `${N}/${U} ≈ ${pct(value)}`,
          derivation: `${outsText}。补牌 ${N} 张，没发的 ${U} 张里随便来一张，正好是补牌的概率 = ${N}/${U} ≈ ${pct(value)}。${check}` };
      }
      return { value, expr: `1 − ${miss}/${all} = ${all - miss}/${all} ≈ ${pct(value)}`,
        derivation: `${outsText}。没发的 ${U} 张里 ${N} 张是补牌、${U - N} 张不是。两张都不中：从 ${U - N} 张里挑 2 张，${miss} 种；${U} 张里挑 2 张一共 ${all} 种。`
          + `至少中一张 = 1 − ${miss}/${all} = ${all - miss}/${all} ≈ ${pct(value)}。`
          + `直接写 ${N}/${U} + ${N}/${U - 1} 是错的：第二项是「转牌没中」之后河牌才中的概率，要先乘上转牌没中的概率 ${U - N}/${U} 才能相加。${check}` };
    },
  };
}

const DRAW_GENERATORS = { P03: drawHit };

exports.maskHasStraight = maskHasStraight;
exports.analyzeDraw = analyzeDraw;
exports.outsSentence = outsSentence;
exports.DRAW_GENERATORS = DRAW_GENERATORS;
});
