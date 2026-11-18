__squidDefine('src/train/variants/counting.js', function (exports) {
'use strict';
// 变式练习：组合计数两类——五张牌是某种牌型（P01 的变式）、公共牌命中的概率（P02 的变式）。
//
// 两条路径：
//   compute()  —— 一手一手、一种发法一种发法地数（五张牌用牌力评估器逐手判型；公共牌按点数、花色逐张检查）
//   analytic() —— 排列组合公式
// 两个都是「重」题：五张牌要判 2598960 手，公共牌发 5 张要检查 2118760 种发法，界面上交给后台线程算。
const { rankOf, suitOf } = __squidRequire('src/core/cards.js');
const { categoryCounts5 } = __squidRequire('src/train/puzzles.js');
const { C, chooseText, SUIT_CN, cardsText, rankName, pct, num1, pick, randInt, remaining, ranksList, STREET_CARDS } = __squidRequire('src/train/variants/common.js');

const TOTAL5 = 2598960;

// ---------------------------------------------------------------------------
// P01 五张牌是某种牌型。七种牌型，所以这个题型只出得了 7 道不同的题（如实说）。
// 常见的三种问概率；后四种的概率不到 0.5%，保留一位小数的百分数分不出对错，改问「平均每多少手出现一次」。
// ---------------------------------------------------------------------------
const FIVE = [
  {
    cat: 1, name: '一对', ask: 'prob',
    define: '两张同点数，另外三张点数各不相同、也不和这一对相同',
    looks: '两张同点数（比如两张 9）＋三张点数各不相同的散牌（比如 K、7、2）',
    steps: '① 成对的点数：13 种；② 这一对从 4 种花色里挑 2 张：4×3÷2 = 6 种；③ 三张散牌的点数从另外 12 个点数里挑 3 个：12×11×10÷6 = 220 种；④ 三张散牌各有 4 种花色：4×4×4 = 64 种。',
    product: '13 × 6 × 220 × 64',
    count: () => 13 * C(4, 2) * C(12, 3) * 4 ** 3,
  },
  {
    cat: 2, name: '两对', ask: 'prob',
    define: '两组同点数的对子加一张别的点数；不是葫芦、不是四条',
    looks: '两张同点数（比如两张 K）＋另外两张同点数（比如两张 7）＋一张跟它们都不同的散牌（比如一张 4）',
    steps: '① 挑哪两个点数成对：13 个点数里挑 2 个，13×12÷2 = 78 种；② 每个对子从 4 种花色里挑 2 张，各 6 种，两个对子 6×6 = 36 种；③ 散牌避开这两个点数（否则成了葫芦），只能从另外 11 个点数的 44 张里挑：44 种。',
    product: '78 × 36 × 44',
    count: () => C(13, 2) * C(4, 2) ** 2 * 44,
  },
  {
    cat: 3, name: '三条', ask: 'prob',
    define: '三张同点数，另外两张点数不同、也不和这三张相同；不是葫芦、不是四条',
    looks: '三张同点数（比如三张 8）＋两张点数不同的散牌（比如 A 和 5）',
    steps: '① 三条的点数：13 种；② 这三张从 4 种花色里挑 3 张：4 种；③ 两张散牌的点数从另外 12 个点数里挑 2 个（两张点数相同就成了葫芦）：12×11÷2 = 66 种；④ 两张散牌各有 4 种花色：4×4 = 16 种。',
    product: '13 × 4 × 66 × 16',
    count: () => 13 * C(4, 3) * C(12, 2) * 16,
  },
  {
    cat: 4, name: '顺子', ask: 'every',
    define: '五张点数连续，A 既可以当最大也可以当 1，比如 A、2、3、4、5；五张不能同花色，同花顺不算',
    looks: '五张点数连续的牌（比如 5、6、7、8、9），花色不全相同',
    steps: '① 顺子最大的那张可以是 5（A2345）到 A（10JQKA），一共 10 种；② 五张牌各有 4 种花色：4×4×4×4×4 = 1024 种；③ 其中五张同花色的是同花顺，每种点数有 4 种，要去掉：10 × 4 = 40 种。',
    product: '10 × 1024 − 40',
    count: () => 10 * 4 ** 5 - 40,
  },
  {
    cat: 5, name: '同花', ask: 'every',
    define: '五张同花色，但点数不连续，同花顺不算',
    looks: '五张同花色的牌（比如五张红心），点数不连成一串',
    steps: '① 花色：4 种；② 同一花色的 13 张里挑 5 张：13×12×11×10×9÷120 = 1287 种；③ 其中点数连续的是同花顺，每种花色 10 种，四种花色一共 40 种，要去掉。',
    product: '4 × 1287 − 40',
    count: () => 4 * C(13, 5) - 40,
  },
  {
    cat: 6, name: '葫芦', ask: 'every',
    define: '三张同点数加两张同点数',
    looks: '三张同点数（比如三张 Q）＋一对（比如两张 4）',
    steps: '① 三张那一组的点数：13 种，花色从 4 种里挑 3 种：4 种；② 一对的点数从另外 12 个点数里挑：12 种，花色从 4 种里挑 2 种：6 种。',
    product: '13 × 4 × 12 × 6',
    count: () => 13 * C(4, 3) * 12 * C(4, 2),
  },
  {
    cat: 7, name: '四条', ask: 'every',
    define: '四张同点数加一张别的牌',
    looks: '四张同点数（比如四张 6）＋一张别的牌',
    steps: '① 四张那一组的点数：13 种（四种花色全要，只有 1 种挑法）；② 第五张从剩下的 48 张里随便挑：48 种。',
    product: '13 × 48',
    count: () => 13 * 48,
  },
];

function fiveCard(rng) {
  const k = pick(FIVE, rng);
  const prob = k.ask === 'prob';
  const statement = prob
    ? `从一副 52 张的标准牌里随机发 5 张，恰好是「${k.name}」（${k.define}）的概率是多少？写成百分数，保留一位小数。`
    : `从一副 52 张的标准牌里随机发 5 张。「${k.name}」（${k.define}）平均每多少手出现一次？也就是 5 张牌一共有多少手，除以${k.name}有多少手，保留一位小数。`;
  const last = prob
    ? `${k.name}一共有多少手，就是上面几步的乘积（${k.product}）。分母是 52 张里挑 5 张的挑法：52×51×50×49×48÷120 = ${TOTAL5} 种。两个数一除就是答案。`
    : `${k.name}一共有多少手，就是上面几步算出来的 ${k.product}。5 张牌一共有 52×51×50×49×48÷120 = ${TOTAL5} 手，用它除以${k.name}的手数就是答案。`;
  return {
    params: { cat: k.cat, name: k.name, ask: k.ask },
    kind: prob ? 'probability' : 'number', tolerance: prob ? 1e-12 : 1e-9, verify: 'enumeration', heavy: true,
    waitText: '本机正在后台把 52 张里挑 5 张的全部 2598960 手逐手判断牌型，算这道题的标准答案（第一次要一两秒，之后就快了）。可以先写答案。',
    title: prob ? `五张牌恰好是${k.name}` : `${k.name}平均每多少手出现一次`,
    statement,
    hints: [
      `先数「${k.name}」一共有多少手 5 张牌，再和「5 张牌一共有多少手」比。一手${k.name}长这样：${k.looks}。`,
      `分几步数：${k.steps}`,
      last,
    ],
    compute() {
      const cnt = categoryCounts5();
      const hands = cnt[k.cat];
      return prob ? {
        value: hands / TOTAL5,
        evidence: `把 52 张里挑 5 张的全部 ${TOTAL5} 种牌一手一手发出来，用牌力评估器逐手判断牌型：恰好是${k.name}的有 ${hands} 手，占 ${pct(hands / TOTAL5)}。`,
        detail: { hands, total: TOTAL5 },
      } : {
        value: TOTAL5 / hands,
        evidence: `把 52 张里挑 5 张的全部 ${TOTAL5} 种牌一手一手发出来，用牌力评估器逐手判断牌型：是${k.name}的有 ${hands} 手，平均每 ${TOTAL5} ÷ ${hands} ≈ ${num1(TOTAL5 / hands)} 手出现一次。`,
        detail: { hands, total: TOTAL5 },
      };
    },
    analytic() {
      const hands = k.count();
      const v = prob ? hands / TOTAL5 : TOTAL5 / hands;
      return {
        value: v,
        expr: prob ? `${k.product} = ${hands}；${hands} ÷ ${TOTAL5} ≈ ${pct(v)}` : `${k.product} = ${hands}；${TOTAL5} ÷ ${hands} ≈ ${num1(v)}`,
        derivation: `${k.steps}${k.name}一共 ${k.product} = ${hands} 手；5 张牌一共 ${TOTAL5} 手。`
          + (prob ? `概率 = ${hands} ÷ ${TOTAL5} ≈ ${pct(v)}。` : `平均每 ${TOTAL5} ÷ ${hands} ≈ ${num1(v)} 手出现一次。换成概率不到 0.5%，保留一位小数的百分数分不出对错，所以这里问「每多少手一次」。`),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// P02 公共牌命中的概率：你拿两张牌，发 3 / 4 / 5 张公共牌，问某件事发生的概率。
// 事件只看点数和花色（不靠牌型判断），所以「逐种发法检查」和「排列组合公式」是两条互不依赖的路。
// ---------------------------------------------------------------------------
const EVENTS = ['set', 'over', 'pairAny', 'pairBoth', 'flush', 'flushDraw'];

/** 把剩下 50 张牌标上记号（第 0 位：属于 A 组；第 1 位：属于 B 组；第 2 位：是那个花色），逐种发法累加 */
function enumerateBoards(attrs, n, accept) {
  let hit = 0, total = 0;
  const m = attrs.length;
  const go = (start, left, a, b, s) => {
    if (!left) { total++; if (accept(a, b, s)) hit++; return; }
    for (let i = start; i <= m - left; i++) {
      const t = attrs[i];
      go(i + 1, left - 1, a + (t & 1), b + ((t >> 1) & 1), s + ((t >> 2) & 1));
    }
  };
  go(0, n, 0, 0, 0);
  return { hit, total };
}

function boardHit(rng) {
  const ev = pick(EVENTS, rng);
  const n = ev === 'flushDraw' ? 3 : randInt(3, 5, rng);
  let hand;
  if (ev === 'set' || ev === 'over') {
    const r = ev === 'over' ? randInt(0, 11, rng) : randInt(0, 12, rng);   // 「比它大」至少要有 K 以上的点数
    // 不用 sort 配随机比较函数洗牌：比较的次数各家浏览器不一样，同一个种子在不同设备上会出不同的题
    const s1 = randInt(0, 3, rng), s2 = (s1 + randInt(1, 3, rng)) % 4;
    hand = [r * 4 + Math.max(s1, s2), r * 4 + Math.min(s1, s2)];
  } else {
    const r1 = randInt(0, 12, rng);
    let r2 = randInt(0, 11, rng);
    if (r2 >= r1) r2++;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const s1 = randInt(0, 3, rng);
    const suited = ev === 'flush' || ev === 'flushDraw';
    const s2 = suited ? s1 : (rng() < 0.5 ? s1 : (s1 + randInt(1, 3, rng)) % 4);
    hand = [hi * 4 + s1, lo * 4 + s2];
  }
  const ra = rankOf(hand[0]), rb = rankOf(hand[1]), su = suitOf(hand[0]);
  const A = rankName(ra), B = rankName(rb), SU = SUIT_CN[su];
  const deck = remaining(hand);           // 50 张
  const T = C(50, n);
  const streetCards = STREET_CARDS[n];
  const overRanks = [];
  for (let r = ra + 1; r <= 12; r++) overRanks.push(r);
  const o = 4 * overRanks.length;

  // 每个事件：题面里的那句话、给每张牌打的记号、什么样的发法算中、公式和提示
  let ask, attr, accept, analytic, hints, short;
  if (ev === 'set') {
    ask = `其中至少出现一张 ${A} 的概率是多少？（你手里是一对 ${A}，来一张就是三条）`;
    short = `至少出现一张 ${A}`;
    attr = (c) => (rankOf(c) === ra ? 1 : 0);
    accept = (a) => a >= 1;
    const miss = C(48, n);
    analytic = { value: 1 - miss / T, expr: `1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}`,
      derivation: `还没发的 50 张里只剩 2 张 ${A}，另外 48 张都不是。一张 ${A} 都不来：从那 48 张里挑 ${n} 张，${miss} 种；50 张里挑 ${n} 张一共 ${T} 种。所以至少来一张 ${A} 的概率 = 1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}。` };
    hints = [
      `反过来想更容易：先算「这 ${n} 张里一张 ${A} 都没有」的概率，再用 1 去减。`,
      `你的两张 ${A} 已经在手里，还没发的 50 张里只剩 2 张 ${A}，另外 48 张都不是 ${A}。`,
      `一张 ${A} 都不来：从那 48 张里挑 ${n} 张，${chooseText(48, n)} 种；50 张里挑 ${n} 张一共 ${chooseText(50, n)} 种。一张都不来的概率是 ${miss}/${T}，答案是 1 减去它。`,
    ];
  } else if (ev === 'over') {
    ask = `其中至少出现一张比 ${A} 大的牌（${ranksList(overRanks)} 都算）的概率是多少？`;
    short = `至少出现一张比 ${A} 大的牌`;
    attr = (c) => (rankOf(c) > ra ? 1 : 0);
    accept = (a) => a >= 1;
    const miss = C(50 - o, n);
    analytic = { value: 1 - miss / T, expr: `1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}`,
      derivation: `比 ${A} 大的点数有 ${overRanks.length} 个，每个 4 张，一共 ${o} 张，都还没发。一张都不来：从另外 ${50 - o} 张里挑 ${n} 张，${miss} 种；50 张里挑 ${n} 张一共 ${T} 种。所以至少来一张的概率 = 1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}。` };
    hints = [
      `反过来想更容易：先算「这 ${n} 张里一张比 ${A} 大的牌都没有」的概率，再用 1 去减。`,
      `比 ${A} 大的点数有 ${overRanks.length} 个（${ranksList(overRanks)}），每个 4 张，一共 ${o} 张，都在还没发的 50 张里；剩下 ${50 - o} 张都不比 ${A} 大（包括还没发的 2 张 ${A}）。`,
      `一张都不来：从那 ${50 - o} 张里挑 ${n} 张，${chooseText(50 - o, n)} 种；50 张里挑 ${n} 张一共 ${chooseText(50, n)} 种。一张都不来的概率是 ${miss}/${T}，答案是 1 减去它。`,
    ];
  } else if (ev === 'pairAny') {
    ask = `其中至少出现一张 ${A} 或 ${B}（和你的手牌配成对）的概率是多少？`;
    short = `至少出现一张 ${A} 或 ${B}`;
    attr = (c) => (rankOf(c) === ra || rankOf(c) === rb ? 1 : 0);
    accept = (a) => a >= 1;
    const miss = C(44, n);
    analytic = { value: 1 - miss / T, expr: `1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}`,
      derivation: `还没发的 50 张里 ${A} 剩 3 张、${B} 剩 3 张，一共 6 张能配上。一张都不来：从另外 44 张里挑 ${n} 张，${miss} 种；50 张里挑 ${n} 张一共 ${T} 种。所以至少配上一张的概率 = 1 − ${miss}/${T} ≈ ${pct(1 - miss / T)}。` };
    hints = [
      `反过来想更容易：先算「这 ${n} 张里既没有 ${A} 也没有 ${B}」的概率，再用 1 去减。`,
      `你手里各有一张 ${A} 和 ${B}，还没发的 50 张里 ${A} 剩 3 张、${B} 剩 3 张，一共 6 张能配上，另外 44 张配不上。`,
      `一张都配不上：从那 44 张里挑 ${n} 张，${chooseText(44, n)} 种；50 张里挑 ${n} 张一共 ${chooseText(50, n)} 种。一张都配不上的概率是 ${miss}/${T}，答案是 1 减去它。`,
    ];
  } else if (ev === 'pairBoth') {
    ask = `其中既出现 ${A}、也出现 ${B}（两张手牌都配上对）的概率是多少？`;
    short = `既出现 ${A} 也出现 ${B}`;
    attr = (c) => (rankOf(c) === ra ? 1 : rankOf(c) === rb ? 2 : 0);
    accept = (a, b) => a >= 1 && b >= 1;
    const noA = C(47, n), noBoth = C(44, n), bad = 2 * noA - noBoth;
    analytic = { value: 1 - bad / T, expr: `1 − (${noA} + ${noA} − ${noBoth})/${T} ≈ ${pct(1 - bad / T)}`,
      derivation: `反面是「没有 ${A}」或者「没有 ${B}」。没有 ${A}：从另外 47 张里挑 ${n} 张，${noA} 种；没有 ${B} 同样 ${noA} 种；两个都没有：从另外 44 张里挑，${noBoth} 种，它在前两项里各数了一次，要减掉一次。反面一共 ${noA} + ${noA} − ${noBoth} = ${bad} 种，`
        + `50 张里挑 ${n} 张一共 ${T} 种，所以两个都出现的概率 = 1 − ${bad}/${T} ≈ ${pct(1 - bad / T)}。` };
    hints = [
      `「两个都出现」不好直接数，先数反面：「没有 ${A}」或者「没有 ${B}」。反面的种数 = 没有 ${A} 的种数 + 没有 ${B} 的种数 − 两个都没有的种数（两个都没有的那些在前两项里各数了一次，要减掉一次）。`,
      `还没发的 50 张里 ${A} 剩 3 张、${B} 剩 3 张。没有 ${A}：从另外 47 张里挑 ${n} 张，${chooseText(47, n)} 种；没有 ${B} 也是 ${noA} 种；两个都没有：从另外 44 张里挑 ${n} 张，${chooseText(44, n)} 种。`,
      `反面一共 ${noA} + ${noA} − ${noBoth} 种；50 张里挑 ${n} 张一共 ${chooseText(50, n)} 种。答案是 1 减去反面占的比例。`,
    ];
  } else if (ev === 'flush') {
    ask = `其中至少有 3 张${SU}（和你的两张${SU}凑成同花）的概率是多少？`;
    short = `至少有 3 张${SU}`;
    attr = (c) => (suitOf(c) === su ? 4 : 0);
    accept = (a, b, s) => s >= 3;
    const terms = [];
    for (let k = 3; k <= n; k++) terms.push({ k, a: C(11, k), b: C(39, n - k), v: C(11, k) * C(39, n - k) });
    const good = terms.reduce((s, t) => s + t.v, 0);
    const tt = terms.map((t) => `恰好 ${t.k} 张：${t.a}×${t.b} = ${t.v} 种`).join('；');
    analytic = { value: good / T, expr: `${terms.map((t) => t.v).join(' + ')} = ${good}；${good}/${T} ≈ ${pct(good / T)}`,
      derivation: `还没发的 50 张里${SU}剩 11 张、别的花色 39 张。按这 ${n} 张里有几张${SU}分开数，每种 = 从 11 张${SU}里挑那么多张 × 从 39 张别的里挑剩下的：${tt}。加起来 ${good} 种，50 张里挑 ${n} 张一共 ${T} 种，概率 = ${good}/${T} ≈ ${pct(good / T)}。` };
    hints = [
      `按「这 ${n} 张公共牌里有几张${SU}」分开数：${n === 3 ? '只有 3 张都是' + SU + '这一种' : '3 张到 ' + n + ' 张各算一次'}，加起来再除以总的发法数。`,
      `你手里两张${SU}，还没发的 50 张里${SU}剩 13 − 2 = 11 张，别的花色 39 张。恰好 k 张${SU}的发法 = 从 11 张${SU}里挑 k 张 × 从 39 张别的里挑剩下的 ${n} − k 张。`,
      `${terms.map((t) => `恰好 ${t.k} 张：${chooseText(11, t.k)} 乘 ${chooseText(39, n - t.k)}`).join('；')}。50 张里挑 ${n} 张一共 ${chooseText(50, n)} 种。把几项乘出来、加起来，再除以 ${T}。`,
    ];
  } else {
    ask = `其中恰好有 2 张${SU}（加上你手里的两张，就是差一张的同花听牌）的概率是多少？`;
    short = `恰好有 2 张${SU}`;
    attr = (c) => (suitOf(c) === su ? 4 : 0);
    accept = (a, b, s) => s === 2;
    const good = C(11, 2) * 39;
    analytic = { value: good / T, expr: `55×39/${T} = ${good}/${T} ≈ ${pct(good / T)}`,
      derivation: `还没发的 50 张里${SU}剩 11 张、别的花色 39 张。恰好两张${SU}：从 11 张里挑 2 张（55 种）× 第三张从 39 张别的里挑（39 种）= ${good} 种；翻牌一共 ${T} 种，概率 = ${good}/${T} ≈ ${pct(good / T)}。` };
    hints = [
      `数「恰好两张${SU}、一张别的花色」的翻牌有多少种，再除以翻牌一共有多少种。`,
      `你手里两张${SU}，还没发的 50 张里${SU}剩 11 张，别的花色 39 张。`,
      `两张${SU}从 11 张里挑：${chooseText(11, 2)} 种；第三张从 39 张别的花色里挑：39 种。翻牌一共 ${chooseText(50, 3)} 种。两种数一乘一除就是答案。`,
    ];
  }
  const attrs = deck.map(attr);
  const hand2 = cardsText(hand);
  return {
    params: { event: ev, n, hand },
    kind: 'probability', tolerance: 1e-12, verify: 'enumeration', heavy: n === 5,
    waitText: n === 5 ? `本机正在后台把 50 张里发 5 张的全部 ${T} 种发法逐一检查，算这道题的标准答案。可以先写答案。` : '',
    title: `拿 ${hand2}，${n === 3 ? '翻牌' : n === 4 ? '到转牌' : '到河牌'}${short}`,
    statement: `你手里是 ${hand2}。还没发的牌有 50 张，从中发出${streetCards}，${ask}`,
    hints,
    compute() {
      const r = enumerateBoards(attrs, n, accept);
      return {
        value: r.hit / r.total,
        evidence: `你拿 ${hand2}，剩下 50 张牌里发 ${n} 张，全部 ${r.total} 种发法一种一种摆出来，逐张看点数和花色：「${short}」的有 ${r.hit} 种，占 ${pct(r.hit / r.total)}。`,
        detail: { hit: r.hit, total: r.total },
      };
    },
    analytic: () => analytic,
  };
}

const COUNTING_GENERATORS = { P01: fiveCard, P02: boardHit };

exports.COUNTING_GENERATORS = COUNTING_GENERATORS;
});
