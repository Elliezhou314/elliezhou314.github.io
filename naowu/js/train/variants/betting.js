__squidDefine('src/train/variants/betting.js', function (exports) {
'use strict';
// 变式练习：下注大小两类——均衡下诈唬该占几成 / 最少要防守多少（P06、P07 的变式）、几何下注（P10 的变式）。
//
// 两条路径：
//   compute()  —— 不套公式：把平均收益（或逐街的投入）写成一个比例的函数，反复猜、往回调（二分），找到正好满足条件的那个比例
//   analytic() —— 公式：b/(p+2b)、p/(p+b)、((1 + 2S/p)^(1/n) − 1)/2
// 诈唬比例和最少防守另有第三条路径在 tools/varianttest.mjs 里：抽几组参数让解算器从零自己打这个局面。
const { pct, num1, pick, randInt } = __squidRequire('src/train/variants/common.js');

/** 二分：在 [lo, hi] 里找 fn 由负变正（或由正变负）的那一点，fn 单调。反复 iters 次 */
function bisect(fn, lo, hi, iters) {
  const sLo = Math.sign(fn(lo));
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(fn(mid)) === sLo) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// P06 诈唬该占几成 / 最少要防守多少。底池取 20 到 200 的整十数，下注取 5 的倍数、在底池的两成到两倍之间
// ---------------------------------------------------------------------------
function equilibrium(rng) {
  const kind = pick(['bluff', 'defend'], rng);
  const P = 10 * randInt(2, 20, rng);
  const B = 5 * randInt(Math.ceil((P * 0.2) / 5), Math.floor((P * 2) / 5), rng);
  return kind === 'bluff' ? bluffEq(P, B) : defendEq(P, B);
}

function bluffEq(P, B) {
  const win = P + B, value = B / (P + 2 * B);
  return {
    params: { kind: 'bluff', pot: P, bet: B },
    kind: 'probability', tolerance: 1e-9, verify: 'numeric', heavy: false,
    title: `底池 ${P} 下注 ${B}：诈唬该占几成`,
    statement: `河牌底池 ${P}，你只能下注 ${B}（一次，不许加注）。你的范围只有坚果和纯空气两种牌，对手拿的全是只能抓诈唬的牌。均衡下，诈唬应占你下注范围的多大比例？`,
    hints: [
      '「均衡」在这里的意思是：对手拿着抓诈唬的牌，跟注和弃牌赚得一样多。否则他就会一直跟、或者一直弃，你就能反过来针对他。所以要找的是：你的下注里诈唬占多少，才能让他跟不跟都一样。',
      `对手跟注要花 ${B}。跟到你的诈唬，他赢下底池 ${P} 加你下注的 ${B}，净赚 ${win}；跟到你的坚果，他亏掉跟注的 ${B}。弃牌则不赚不亏，记为 0。`,
      `设你的下注里诈唬占 x、坚果占 1 − x。让他跟注的平均收益等于弃牌的 0：x × ${win} = (1 − x) × ${B}。解出 x。`,
    ],
    compute() {
      const callEv = (x) => x * win - (1 - x) * B;   // 对手跟注的平均收益
      const x = bisect(callEv, 0, 1, 100);
      return {
        value: x,
        evidence: `不套公式：设你的下注里诈唬占 x，对手跟注的平均收益是 x × ${win} − (1 − x) × ${B}（抓到诈唬赚 ${win}，抓到坚果亏 ${B}）。`
          + `本机先猜一个 x，看这个收益是正是负，再把猜测往回调——这样反复 100 次，找到让它正好等于 0 的比例：诈唬占下注的 ${pct(x)}。`
          + '此时对手跟注、弃牌赚得一样多，他怎么打都占不到便宜。',
        detail: { callEvAtX: callEv(x) },
      };
    },
    analytic() {
      return {
        value,
        expr: `b/(p+2b) = ${B}/${P + 2 * B} ≈ ${pct(value)}`,
        derivation: `对手跟注花 ${B}：抓到诈唬赚 ${win}（底池 ${P} + 你下注的 ${B}），抓到坚果亏 ${B}。要让他跟注和弃牌一样（平均赚 0），诈唬的数量 × ${win} = 坚果的数量 × ${B}，`
          + `也就是诈唬 : 坚果 = ${B} : ${win}，诈唬占下注的 ${B}/(${B} + ${win}) = ${B}/${P + 2 * B} ≈ ${pct(value)}。换成字母写：底池 p、下注 b 时，诈唬占下注的 b/(p+2b)——下注越大，能带的诈唬越多。`,
      };
    },
  };
}

function defendEq(P, B) {
  const value = P / (P + B);
  return {
    params: { kind: 'defend', pot: P, bet: B },
    kind: 'probability', tolerance: 1e-9, verify: 'numeric', heavy: false,
    title: `底池 ${P} 对手下注 ${B}：最少要防守几成`,
    statement: `对手在底池 ${P} 时下注 ${B}。为了让他拿任意两张牌诈唬都无利可图，你至少要跟注（不弃牌）多大比例的范围？`,
    hints: [
      `站在诈唬的人那边算账：他拿一手必输的牌下注 ${B}。你弃牌，他就白赢桌上的 ${P}；你跟注，他就亏掉这 ${B}。`,
      `设你弃牌的比例是 x（跟注的比例就是 1 − x）。他诈唬一次平均赚：x × ${P} − (1 − x) × ${B}。只要这个数大于 0，他闭着眼睛拿任何牌诈唬都能赚钱。`,
      `让它正好等于 0：x × ${P} = (1 − x) × ${B}，解出的 x 是你最多能弃牌的比例；题目问的「至少要跟注多少」就是 1 − x。`,
    ],
    compute() {
      const bluffEv = (x) => x * P - (1 - x) * B;    // 诈唬的人平均赚多少（x = 你弃牌的比例）
      const x = bisect(bluffEv, 0, 1, 100);
      return {
        value: 1 - x,
        evidence: `不套公式：设你弃牌的比例是 x，对手拿任何牌诈唬一次平均赚 x × ${P} − (1 − x) × ${B}。`
          + `本机先猜一个 x，看他是赚是亏，再把猜测往回调——这样反复 100 次，找到让他正好不赚不亏的 x ≈ ${pct(x)}，`
          + `所以你最多弃 ${pct(x)}，至少要跟注 ${pct(1 - x)}。`,
        detail: { foldAt: x },
      };
    },
    analytic() {
      return {
        value,
        expr: `p/(p+b) = ${P}/${P + B} ≈ ${pct(value)}`,
        derivation: `诈唬的人拿一手必输的牌下注 ${B}，想抢桌上的 ${P}。设你弃牌的比例是 x：他诈唬一次平均赚 x×${P} − (1−x)×${B}。令它等于 0：${P}x = ${B} − ${B}x，x = ${B}/${P + B}。`
          + `所以你最多只能弃 ${B}/${P + B}，至少要跟注 1 − ${B}/${P + B} = ${P}/${P + B} ≈ ${pct(value)}。跟得比这少，他拿任何烂牌诈唬都稳赚。`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// P10 几何下注：底池、后手、街数换数，每街下当时底池的同一个比例，最后一街正好打光。只出每街不超过一个底池的
// ---------------------------------------------------------------------------
const POTS10 = [6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const SUP = { 2: '²', 3: '³' };
const STREET_NAMES = { 2: '转牌、河牌两条街', 3: '翻牌、转牌、河牌三条街' };

function geometric(rng) {
  for (let tries = 0; tries < 500; tries++) {
    const n = rng() < 0.5 ? 2 : 3;
    const p0 = pick(POTS10, rng);
    const step = p0 >= 20 ? 10 : 5;
    const S = step * randInt(Math.ceil((p0 * 1.5) / step), Math.floor((p0 * 13) / step), rng);
    const f = (Math.pow(1 + (2 * S) / p0, 1 / n) - 1) / 2;
    if (f < 0.2 || f > 1) continue;
    return buildGeo(p0, S, n);
  }
  return null;
}

function buildGeo(p0, S, n) {
  const final = p0 + 2 * S;
  const ratioText = final % p0 === 0 ? `${final} ÷ ${p0} = ${final / p0}` : `${final} ÷ ${p0}`;
  const root = n === 2 ? '平方根' : '立方根';
  return {
    params: { pot: p0, stack: S, streets: n },
    kind: 'probability', tolerance: 1e-9, verify: 'numeric', heavy: false,
    title: `几何下注：底池 ${p0}、后手 ${S}，${n} 街打光`,
    statement: `底池 ${p0}，你和对手各有 ${S} 的后手。你想在${STREET_NAMES[n]}里每街都下当时底池的同一个比例 f（对手每次都跟注），恰好在河牌把 ${S} 全部投完。f 是多少？`,
    hints: [
      `先看一条街：底池是 ${p0} 时下注 f 倍底池，也就是 ${p0}f；对手跟注后底池多了两份 ${p0}f，变成 ${p0} + ${2 * p0}f = ${p0} × (1 + 2f)。每过一条街，底池都乘上同一个 (1 + 2f)。`,
      `${n} 条街下来底池是 ${p0} × (1 + 2f)${SUP[n]}。两个人各把 ${S} 全投进去，最后底池正好是 ${p0} + ${S} + ${S} = ${final}。`,
      `于是 (1 + 2f)${SUP[n]} = ${ratioText}，也就是 1 + 2f 等于这个数的${root}。解出 f 就行：写成百分数保留一位小数，也可以直接写算式。`,
    ],
    compute() {
      // 不用公式：把「每街下注 f 倍底池」逐街模拟一遍，二分搜索让总投入恰好等于后手
      const spentAt = (f) => { let pot = p0, spent = 0; for (let i = 0; i < n; i++) { const bet = f * pot; spent += bet; pot += 2 * bet; } return { spent, pot }; };
      const f = bisect((x) => spentAt(x).spent - S, 0, 10, 200);
      const { spent, pot } = spentAt(f);
      return {
        value: f,
        evidence: `不套公式：先猜一个比例，按「每条街下注当时底池的这个比例、对手跟注」模拟 ${n} 条街，看最后投进去的筹码是多了还是少了，再把猜测往回调——这样反复 200 次。`
          + `结果是每街下底池的 ${pct(f)}：底池从 ${p0} 涨到 ${num1(Math.round(pot * 10) / 10)}（目标 ${final}），每人正好投入 ${num1(Math.round(spent * 10) / 10)}。`,
        detail: { finalPot: pot, spent, target: final },
      };
    },
    analytic() {
      const f = (Math.pow(final / p0, 1 / n) - 1) / 2;
      let pot = p0;
      const bets = [];
      for (let i = 0; i < n; i++) { const bet = f * pot; bets.push(bet); pot += 2 * bet; }
      const names = n === 2 ? ['转牌', '河牌'] : ['翻牌', '转牌', '河牌'];
      const rootExpr = (n === 2 ? '√' : '∛') + (final % p0 === 0 ? String(final / p0) : `(${final}/${p0})`);
      const shown = bets.map((b) => Math.round(b * 10) / 10);
      const shownSum = Math.round(shown.reduce((s, b) => s + b, 0) * 10) / 10;
      return {
        value: f,
        expr: `f = (${rootExpr} − 1)/2 ≈ ${pct(f)}`,
        derivation: `每次下注当时底池的 f 倍、对手跟注，底池就从 p 变成 p + 2 × f × p = p × (1 + 2f)。${n} 条街后底池 = ${p0} × (1 + 2f)${SUP[n]}。`
          + `两人各把 ${S} 投完，最终底池是 ${p0} + ${2 * S} = ${final}，于是 (1 + 2f)${SUP[n]} = ${ratioText}，1 + 2f = ${rootExpr}（${root}），f = (${rootExpr} − 1)/2 ≈ ${pct(f)}，即每街下底池的 ${pct(f)}。`
          + `落到筹码上：${shown.map((b, i) => `${names[i]}下 ${num1(b)}`).join('、')}，`
          + (shownSum === S ? `加起来正好 ${S}。` : `加起来正好 ${S}（每个数各自保留了一位小数，直接相加会差一点）。`),
      };
    },
  };
}

const BETTING_GENERATORS = { P06: equilibrium, P10: geometric };

exports.BETTING_GENERATORS = BETTING_GENERATORS;
});
