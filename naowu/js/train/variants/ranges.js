__squidDefine('src/train/variants/ranges.js', function (exports) {
'use strict';
// 变式练习：和范围打交道的两类——阻挡牌数组合（P04 的变式）、看到下注后是诈唬的概率（P05、P11 的变式）。
//
// 两条路径：
//   compute()  —— 用范围解析器把范围展开成 1326 种具体的两张牌，逐个去掉和已知牌撞车的，再数（或加权）
//   analytic() —— 按类别用计数公式：对子 = 剩下几张里挑 2 张；同花色 = 两张都还在的花色数；不同花色 = 张数相乘再减同花色
// 两边都是「数组合」，只是各写了一遍，所以可信程度标「中」（能抓算错，抓不住想错），和原题一样如实标。
const { RANKS, rankOf } = __squidRequire('src/core/cards.js');
const { parseRange, removeDead, rangeComboCount } = __squidRequire('src/core/range.js');
const { cardText, cardsText, rankName, pct, about, num1, pick, randInt, dealFrom } = __squidRequire('src/train/variants/common.js');

const R = (ch) => RANKS.indexOf(ch);
const card = (r, s) => r * 4 + s;

/** 一类牌的名字和白话：KK（一对 K）、AKs（同花色的 A 和 K）、54o（一张 5 一张 4，花色不同） */
function className(cls) {
  const x = rankName(R(cls[0])), y = rankName(R(cls[1]));
  if (cls.length === 2) return `${cls}（一对 ${x}）`;
  return cls[2] === 's' ? `${cls}（同花色的 ${x} 和 ${y}）` : `${cls}（一张 ${x} 一张 ${y}，花色不同）`;
}

/**
 * 按计数公式数一类牌还剩几种（不用范围解析器），并写出怎么数的。dead 是对手拿不到的牌。
 * 对子：这个点数还剩 left 张，left×(left−1)÷2；同花色：四种花色里两张都还在的；不同花色：x 剩几张 × y 剩几张 − 同花色还在的。
 */
function classCount(cls, dead) {
  const deadSet = new Set(dead);
  const x = R(cls[0]), y = R(cls[1]);
  const live = (r) => [0, 1, 2, 3].filter((s) => !deadSet.has(card(r, s)));
  const X = rankName(x), Y = rankName(y);
  if (cls.length === 2) {
    const left = live(x).length;
    const n = (left * (left - 1)) / 2;
    return { n, full: 6, how: left === 4 ? `4 张 ${X} 都在，两两配对 6 种` : `${X} 只剩 ${left} 张，两两配对 ${left}×${left - 1}÷2 = ${n} 种` };
  }
  const suitedLive = [3, 2, 1, 0].filter((s) => !deadSet.has(card(x, s)) && !deadSet.has(card(y, s)));   // 按 ♠♥♦♣ 的顺序写
  const suitedList = suitedLive.map((s) => cardText(card(x, s)) + cardText(card(y, s)));
  if (cls[2] === 's') {
    const n = suitedLive.length;
    return { n, full: 4, how: n === 4 ? '四种花色都在，4 种' : n === 0 ? '四种花色都被挡掉了，0 种' : `四种花色里只剩 ${suitedList.join('、')}，${n} 种` };
  }
  const sx = live(x).length, sy = live(y).length;
  const n = sx * sy - suitedLive.length;
  return { n, full: 12, how: `${sx} 张 ${X} 配 ${sy} 张 ${Y} 共 ${sx * sy} 种，去掉其中同花色的 ${suitedLive.length} 种，剩 ${n} 种` };
}

/** 用范围解析器数：展开成具体的两张牌、去掉撞车的 */
const parsedCount = (cls, dead) => rangeComboCount(removeDead(parseRange(cls), dead));

/** 某个点数还剩哪几张（对手还拿得到的） */
function liveCardsText(r, dead) {
  const deadSet = new Set(dead);
  return [0, 1, 2, 3].filter((s) => !deadSet.has(card(r, s))).map((s) => cardText(card(r, s))).reverse().join('、');
}

// ---------------------------------------------------------------------------
// P04 阻挡牌：对手的范围是几类牌，你手里的两张（有时再加翻牌）挡掉一部分，还剩多少种组合
// ---------------------------------------------------------------------------
const POOL4 = ['AA', 'KK', 'QQ', 'JJ', '99', '88', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'KQs', 'KQo', 'KJs', 'QJs'];

function blockers(rng) {
  for (let tries = 0; tries < 2000; tries++) {
    const n = randInt(2, 4, rng);
    const classes = [];
    while (classes.length < n) { const c = pick(POOL4, rng); if (!classes.includes(c)) classes.push(c); }
    classes.sort((a, b) => POOL4.indexOf(a) - POOL4.indexOf(b));
    const ranksIn = [...new Set(classes.flatMap((c) => [R(c[0]), R(c[1])]))];
    // 你的第一张牌一定是范围里出现的点数（否则可能一张都挡不掉），第二张随便发；有时再加一个翻牌
    const c1 = card(pick(ranksIn, rng), randInt(0, 3, rng));
    const rest = dealFrom(rng, [c1], rng() < 0.35 ? 4 : 1);
    const hero = [c1, rest[0]], flop = rest.slice(1);
    const dead = [...hero, ...flop];
    const per = classes.map((cls) => ({ cls, ...classCount(cls, dead) }));
    const total = per.reduce((s, p) => s + p.n, 0), full = per.reduce((s, p) => s + p.full, 0);
    if (total === full) continue;                       // 一张都没挡掉，没意思
    if (per.filter((p) => p.n > 0).length < 2) continue; // 至少两类还有剩的：提示里分类写出的数不会正好就是答案
    return buildBlockers(classes, hero, flop, per, total, full);
  }
  return null;
}

function buildBlockers(classes, hero, flop, per, total, full) {
  const text = classes.join(',');
  const dead = [...hero, ...flop];
  const hasSO = classes.some((c) => c.length === 3);
  const deadText = flop.length ? `你手里的 ${cardsText(hero)} 和翻牌 ${cardsText(flop)}` : `你手里的 ${cardsText(hero)}`;
  const ranks = [...new Set(classes.flatMap((c) => [R(c[0]), R(c[1])]))].sort((a, b) => b - a);
  const touched = ranks.filter((r) => dead.some((c) => rankOf(c) === r));
  const live = touched.map((r) => {
    const left = liveCardsText(r, dead);
    return left ? `${rankName(r)} 只剩 ${left}` : `${rankName(r)} 一张都不剩`;
  }).join('，');
  const fullOf = (p) => `${p.cls} ${p.full} 种`;
  return {
    params: { classes, hero, flop, range: text },
    kind: 'number', tolerance: 1e-9, verify: 'counting', heavy: false,
    title: `阻挡牌：拿 ${cardsText(hero)}，对手还剩几种组合`,
    statement: `对手的范围是「${text}」${hasSO ? '（s 表示两张同花色，o 表示两张不同花色，比如 AKs 是同花色的 A 和 K）' : ''}。`
      + `你手里拿着 ${cardsText(hero)}${flop.length ? `，翻牌是 ${cardsText(flop)}` : ''}。对手范围里还剩多少种具体的两张牌组合？（比如 AA 原本有 6 种：4 张 A 两两配对）`,
    hints: [
      `先数没人占牌时各有多少种：${per.map(fullOf).join('、')}，一共 ${full} 种。对子是 4 张里挑 2 张，6 种${hasSO ? '；同花色的两张不同点数有 4 种（四种花色各一种）；不同花色的有 12 种（4 张配 4 张，减去同花色的 4 种）' : ''}。`,
      `${deadText}，对手就拿不到了：${live}。凡是用到${flop.length ? '这几张' : '这两张'}牌的组合都要划掉。`,
      `逐类数——${per.map((p) => `${p.cls}：${p.how}`).join('；')}。最后把各类加起来。`,
    ],
    compute() {
      const parts = classes.map((cls) => ({ cls, before: parsedCount(cls, []), after: parsedCount(cls, dead) }));
      const w = parseRange(text);
      const before = rangeComboCount(w), after = rangeComboCount(removeDead(w, dead));
      return {
        value: after,
        evidence: `把对手范围展开成具体的两张牌，一共 ${before} 种；划掉所有用到${flop.length ? '你的手牌或翻牌' : '你手里两张牌'}的，剩 ${after} 种。分开看：`
          + parts.map((p) => `${p.cls} 从 ${p.before} 种剩 ${p.after} 种`).join('，') + '。',
        detail: { before, after, parts },
      };
    },
    analytic() {
      return {
        value: total,
        expr: `${per.map((p) => `${p.cls}:${p.n}`).join(' + ')} = ${total}`,
        derivation: `${deadText}，对手拿不到。${per.map((p) => `${p.cls}：${p.how}`).join('；')}。合计 ${per.map((p) => p.n).join(' + ')} = ${total} 种（没挡牌时是 ${full} 种）。`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// P05 看到下注后是诈唬的概率：价值牌一类全部下注、空气牌一类按频率诈唬；你手里的牌可能挡掉对手一部分组合
// ---------------------------------------------------------------------------
const VALUE5 = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs'];
const AIR5 = ['54s', '65s', '76s', '87s', '98s', '43s', '53s', '64s', '54o', '65o', '76o', '87o'];
const FREQ5 = [10, 20, 25, 30, 40, 50, 60, 75];

function bluffShare(rng) {
  for (let tries = 0; tries < 2000; tries++) {
    const vc = pick(VALUE5, rng), ac = pick(AIR5, rng), f = pick(FREQ5, rng);
    const airRanks = [R(ac[0]), R(ac[1])], valRanks = [R(vc[0]), R(vc[1])];
    // 公共牌里没有空气牌的点数（不然它配上了对子，就不是空气了）
    const board = dealFrom(rng, airRanks.flatMap((r) => [0, 1, 2, 3].map((s) => card(r, s))), 5);
    const mode = pick(['clean', 'air', 'value'], rng);
    const free = (r) => [0, 1, 2, 3].map((s) => card(r, s)).filter((c) => !board.includes(c));
    let c1;
    if (mode === 'air') c1 = pick(free(pick(airRanks, rng)), rng);
    else if (mode === 'value') { const opts = free(pick(valRanks, rng)); if (!opts.length) continue; c1 = pick(opts, rng); }
    const others = [...airRanks, ...valRanks];
    const deadForHero = [...board, ...(c1 == null ? [] : [c1])];
    const pool = dealFrom(rng, deadForHero, 47 - (c1 == null ? 0 : 1)).filter((c) => !others.includes(rankOf(c)));
    const hero = (c1 == null ? pool.slice(0, 2) : [c1, pool[0]]).sort((a, b) => b - a);   // 大的写前面（数值比较，各家浏览器一样）
    const dead = [...board, ...hero];
    const V = classCount(vc, dead), A = classCount(ac, dead);
    if (V.n < 1 || A.n < 1) continue;
    const P = 10 * randInt(2, 15, rng);
    const B = 5 * randInt(Math.ceil(P / 10), Math.floor((P * 1.5) / 5), rng);
    return buildBluff({ vc, ac, f, board, hero, blocker: c1, V, A, P, B, mode });
  }
  return null;
}

function buildBluff({ vc, ac, f, board, hero, blocker, V, A, P, B, mode }) {
  const vName = className(vc), aName = className(ac);
  const dead = [...board, ...hero];
  const airBet = (A.n * f) / 100, tot = V.n + airBet;
  const value = airBet / tot;
  const need = B / (P + 2 * B);
  const blockNote = mode === 'air' ? `你手里的 ${cardText(blocker)} 挡掉了一部分 ${ac}。` : mode === 'value' ? `你手里的 ${cardText(blocker)} 挡掉了一部分 ${vc}。` : '';
  const verdict = `假如你的牌只能赢诈唬、输给价值牌：跟注花 ${B} 去赢 ${P + B}（底池加他的下注），至少要 ${B}/${P + 2 * B} ≈ ${pct(need)} 的时候是诈唬才不亏，`
    + `这里是 ${pct(value)}，${value >= need ? '跟注不亏' : '跟注是亏的'}。`;
  return {
    params: { value: vc, air: ac, freq: f, board, hero, pot: P, bet: B, mode },
    kind: 'probability', tolerance: 1e-12, verify: 'counting', heavy: false,
    title: `${vc} 对 ${ac}：看到下注，他在诈唬吗`,
    statement: `河牌公共牌是 ${cardsText(board)}，底池 ${P}，对手下注 ${B}。对手的范围只有两类：价值牌 ${vName}，他拿到就一定下注；`
      + `空气牌 ${aName}，他只有 ${f}% 的时候拿来下注诈唬，其余时候放弃。你手里是 ${cardsText(hero)}。看到他下注，他手里是空气牌（在诈唬）的概率是多少？`,
    hints: [
      '看到下注时，对手的牌只可能是「会下注的那些组合」。先数他还可能拿着几种价值牌、几种空气牌（公共牌和你手里的牌他拿不到），再看会下注的里面空气占几成。',
      `${vc}：${V.how}；${ac}：${A.how}。${blockNote}`,
      `会下注的价值牌是全部 ${V.n} 种；会下注的空气牌是 ${A.n} × ${f}% = ${about(airBet)} 种。看到下注时，他手里是这 ${V.n} + ${about(airBet)} 种之一，答案就是空气那部分占的比例。`,
    ],
    compute() {
      const wV = removeDead(parseRange(vc), dead), wA = removeDead(parseRange(ac), dead);
      let betV = 0, betA = 0;
      for (let i = 0; i < 1326; i++) { betV += wV[i] * 1; betA += wA[i] * (f / 100); }
      const v = betA / (betV + betA);
      return {
        value: v,
        evidence: `把对手的两类牌展开成具体的两张牌，去掉和公共牌、你的手牌撞车的：${vc} 还有 ${rangeComboCount(wV)} 种，${ac} 还有 ${rangeComboCount(wA)} 种。`
          + `逐个组合按「会不会下注」加权（价值牌每种算 1，空气牌每种算 ${f}%）：会下注的一共 ${about(betV + betA)} 种，其中空气 ${about(betA)} 种，占 ${pct(v)}。${verdict}`,
        detail: { nV: rangeComboCount(wV), nA: rangeComboCount(wA), betA },
      };
    },
    analytic() {
      return {
        value,
        expr: `(${A.n}×${f}%) / (${V.n} + ${A.n}×${f}%) = ${num1(airBet)} ÷ ${num1(tot)} ≈ ${pct(value)}`,
        derivation: `${vc}：${V.how}，全部下注；${ac}：${A.how}，其中 ${f}% 下注，也就是 ${A.n} × ${f}% = ${about(airBet)} 种。`
          + `看到下注时他手里是这 ${about(tot)} 种之一，诈唬占 ${num1(airBet)} ÷ ${num1(tot)} ≈ ${pct(value)}。${blockNote}${verdict}`,
      };
    },
  };
}

const RANGE_GENERATORS = { P04: blockers, P05: bluffShare };

exports.className = className;
exports.classCount = classCount;
exports.RANGE_GENERATORS = RANGE_GENERATORS;
});
