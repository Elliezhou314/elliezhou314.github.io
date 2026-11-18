__squidDefine('src/train/speed.js', function (exports) {
'use strict';
// 限时速算：60 秒内连续心算，每题四选一。这里只放纯逻辑——出题、判分、统计、记录的整形，界面里不放数学。
//
// 铁律照旧：
//   - 每道题由随机参数现场出，答案现算；概率写成百分数保留一位小数、筹码保留一位小数、个数是整数，
//     一位小数的口径直接用数学竞赛的 oneDecimal（puzzles.js），不另写一套四舍五入。
//   - 干扰项来自真实的常见错误（把 B/(P+2B) 算成 B/(P+B)、两张命中算成 N/47+N/46、补牌数差一两张、
//     忘了自己手里的牌挡掉的组合、期望值忘了减去输的部分……），每个干扰项都带一句它错在哪。
//     四个选项保留一位小数后必须两两不同；概率题再加间距（干扰项离答案 ≥ 3 个百分点、两两 ≥ 1 个百分点），凑不出就换一组参数重出。
//   - tools/speedtest.mjs 用另一条独立的路径逐题核对答案：期望值反验「正好不赚不亏」、逐张枚举剩余牌、
//     逐个枚举 1326 种手牌、牌力评估器对剩余每张牌逐张判断。这里的算式一条都不复用。
//
// 出题器是纯函数：吃一个随机数发生器（core/cards.js 的 makeRng），同一个种子出同一串题，测试可以重放。
// 记录（最好成绩、总局数、各题型累计对错）存在进度对象的 speed 字段，由 train/training.js 的 coerceProgress 用这里的
// coerceSpeedRecord 校验。速算不进赛季分、星级、段位、成就。
const { RANKS, SUITS, rankOf, suitOf, shuffle } = __squidRequire('src/core/cards.js');
const { oneDecimal } = __squidRequire('src/train/puzzles.js');

/** 一局的时长（秒）和答错后停留的时间（毫秒，这段时间计时不停） */
const SPEED_SECONDS = 60;
const SPEED_REVEAL_MS = 1500;

/** 七种题型。name 是给玩家看的短名字 */
const SPEED_TYPES = Object.freeze([
  { id: 'odds', name: '跟注要多少胜率' },
  { id: 'mdf', name: '最少要防守多少' },
  { id: 'next', name: '下一张命中' },
  { id: 'two', name: '两张里至少中一张' },
  { id: 'ev', name: '跟注的期望值' },
  { id: 'combos', name: '数组合' },
  { id: 'outs', name: '数补牌' },
].map(Object.freeze));
const SPEED_TYPE_IDS = Object.freeze(SPEED_TYPES.map((t) => t.id));
const typeName = (id) => (SPEED_TYPES.find((t) => t.id === id) || {}).name || id;

// ---------------------------------------------------------------------------
// 显示口径
// ---------------------------------------------------------------------------
/** 概率 → 「25.0%」 */
const pctText = (x) => oneDecimal(x * 100) + '%';
/** 筹码 → 「+2.0 筹码」「−1.5 筹码」「0.0 筹码」（负号用 −，和数学竞赛一致） */
function chipText(x) {
  const s = oneDecimal(x);
  if (s.startsWith('-')) return '−' + s.slice(1) + ' 筹码';
  return (s === '0.0' ? '' : '+') + s + ' 筹码';
}
const unitText = (unit) => (n) => `${n} ${unit}`;

const SUIT_CN = { c: '梅花', d: '方块', h: '红心', s: '黑桃' };
const SUIT_SYM = { c: '♣', d: '♦', h: '♥', s: '♠' };
const rankName = (r) => (RANKS[r] === 'T' ? '10' : RANKS[r]);
/** 一张牌写成玩家看得懂的样子：A♠、10♥ */
const cardText = (c) => rankName(rankOf(c)) + SUIT_SYM[SUITS[suitOf(c)]];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// 牌桌上常见的下注尺度；底池取 10、20……120，只留下注额是整数的组合
const SIZES = [
  { num: 1, den: 3, name: '三分之一池' },
  { num: 1, den: 2, name: '半池' },
  { num: 2, den: 3, name: '三分之二池' },
  { num: 3, den: 4, name: '四分之三池' },
  { num: 1, den: 1, name: '满池' },
];
function potAndBet(rng) {
  for (;;) {
    const P = 10 * (1 + Math.floor(rng() * 12));
    const s = pick(SIZES, rng);
    const B = (P * s.num) / s.den;
    if (Number.isInteger(B)) return { P, B, size: s.name };
  }
}

/**
 * 正确答案 + 候选干扰项 → 四个两两不同的选项（按显示出来的文字比），正确答案的位置随机。
 * 候选里凑不出三个和正确答案、彼此都不同的，返回 null，由调用方换一组参数重出。
 * gap 给了就再加一条间距规矩（概率题用 PCT_GAP）：这是 60 秒心算，差零点几个百分点的选项等于逼人笔算。
 */
function buildOptions(rng, correct, candidates, fmt, valid = () => true, gap = null) {
  const correctText = fmt(correct);
  const seen = new Set([correctText]);
  const chosen = [];
  const num = (t) => parseFloat(t);   // 显示出来的数（「25.0%」→ 25）
  for (const d of shuffle(candidates.slice(), rng)) {
    if (!Number.isFinite(d.v) || !valid(d.v)) continue;
    const t = fmt(d.v);
    if (seen.has(t)) continue;
    // 间距：离正确答案至少 gap.near、和已选的干扰项至少 gap.pair（按显示出来的数比）。口算分不开的选项不要
    if (gap && (Math.abs(num(t) - num(correctText)) < gap.near - 1e-9 || chosen.some((c) => Math.abs(num(t) - num(c.text)) < gap.pair - 1e-9))) continue;
    seen.add(t);
    chosen.push({ text: t, value: d.v, why: d.why });
    if (chosen.length === 3) break;
  }
  if (chosen.length < 3) return null;
  const answer = Math.floor(rng() * 4);
  chosen.splice(answer, 0, { text: correctText, value: correct, why: null });
  return { options: chosen, answer, answerText: correctText };
}
const isProb = (v) => v >= 0 && v <= 1;
/** 概率题的间距：干扰项离正确答案至少 3 个百分点，干扰项两两至少 1 个百分点 */
const PCT_GAP = { near: 3, pair: 1 };

// 牌桌上常见的听牌和补牌张数（「下一张」「两张」两种题型用）。张数逐条按牌算过：
//   口袋对子等三条 2；卡顺 4；两张高牌等一对 3+3=6；两头顺 8；同花 13−4=9；
//   同花加卡顺 9+4−1=12（卡顺那 4 张里有 1 张同花色已经算过）；同花加两头顺 9+8−2=15；
//   暗三条等葫芦或四条：翻牌（三张公共牌不成对）另两种点数各 3 张 + 第四张 = 7，转牌（四张不成对）3×3+1 = 10。
const DRAW = {
  2: '口袋对子等第三张成三条', 4: '卡顺，等中间那一张', 6: '两张高牌，等任意一张配成对', 8: '两头顺',
  9: '同花听牌', 12: '同花加卡顺', 15: '同花加两头顺',
  7: '暗三条等葫芦或四条，三张公共牌没有对子', 10: '暗三条等葫芦或四条，四张公共牌没有对子',
};
const draws = (ns) => ns.map((n) => ({ n, name: DRAW[n] }));
// 「下一张」不出 2 张：答案只有 4% 上下，离它 3 个百分点以外凑不出三个真实的错法。
// 「两张」不出暗三条：转牌不中时河牌的补牌会变多，「至少中一张这 7 张」就不等于最后成葫芦的概率，问法有歧义。
const DRAWS_FLOP = draws([4, 6, 7, 8, 9, 12, 15]);
const DRAWS_TURN = draws([4, 6, 8, 9, 10, 12, 15]);
const DRAWS_TWO = draws([2, 4, 6, 8, 9, 12, 15]);

// ---------------------------------------------------------------------------
// 七种题型。每个生成器返回 null 表示这组参数凑不出四个不同的选项，换一组再出。
// ---------------------------------------------------------------------------
const GEN = {
  /** 1. 跟注需要多少胜率：B / (P + 2B) */
  odds(rng) {
    const { P, B, size } = potAndBet(rng);
    const v = B / (P + 2 * B);
    const o = buildOptions(rng, v, [
      { v: B / (P + B), why: `${B} ÷ (${P} + ${B})：忘了把你自己跟进去的 ${B} 也算进底池` },
      { v: B / P, why: `${B} ÷ ${P}：只拿下注和原来的底池比` },
      { v: (P + B) / (P + 2 * B), why: `(${P} + ${B}) ÷ (${P} + 2×${B})：算成了你能赢走的那一份，不是你要付的那一份` },
      { v: (2 * B) / (P + 2 * B), why: `2×${B} ÷ (${P} + 2×${B})：把对手的下注也算成你要付的` },
    ], pctText, isProb, PCT_GAP);
    if (!o) return null;
    return { ...o, value: v, detail: { P, B },
      text: `底池 ${P}，对手下注 ${B}（${size}）。你跟注至少要多少胜率才不亏？`,
      how: `跟 ${B} 去赢 ${P} + ${B}：${B} ÷ (${P} + 2×${B}) = ${o.answerText}` };
  },

  /** 2. 最少要防守多少：P / (P + B) */
  mdf(rng) {
    const { P, B, size } = potAndBet(rng);
    const v = P / (P + B);
    const o = buildOptions(rng, v, [
      { v: B / (P + B), why: `${B} ÷ (${P} + ${B})：这是对手诈唬要你弃牌的比例，和要防守的比例弄反了` },
      { v: P / (P + 2 * B), why: `${P} ÷ (${P} + 2×${B})：分母多算了一次下注` },
      { v: B / (P + 2 * B), why: `${B} ÷ (${P} + 2×${B})：这是跟注需要的胜率，不是防守比例` },
      { v: (P + B) / (P + 2 * B), why: `(${P} + ${B}) ÷ (${P} + 2×${B})：分子分母都多算了一次下注` },
    ], pctText, isProb, PCT_GAP);
    if (!o) return null;
    return { ...o, value: v, detail: { P, B },
      text: `底池 ${P}，对手下注 ${B}（${size}）。你至少要跟注多大比例的牌，对手拿任何牌诈唬才都占不到便宜？`,
      how: `对手冒 ${B} 去抢 ${P}：${P} ÷ (${P} + ${B}) = ${o.answerText}` };
  },

  /** 3. 下一张命中：N / 47（翻牌后）或 N / 46（转牌后）。说明里先教口算「补牌数 × 2」 */
  next(rng) {
    const turn = rng() < 0.5;
    const d = pick(turn ? DRAWS_TURN : DRAWS_FLOP, rng);
    const N = d.n, U = turn ? 46 : 47;
    const v = N / U;
    const twoCards = 1 - ((U - N) / U) * ((U - 1 - N) / (U - 1));
    const o = buildOptions(rng, v, [
      { v: twoCards, why: `1 − (${U - N} ÷ ${U}) × (${U - 1 - N} ÷ ${U - 1})：这是还能看两张牌时的概率，${turn ? '转牌后只剩河牌一张' : '这里只问转牌一张'}` },
      { v: N / 100, why: `${N}%：把补牌张数直接当成了百分数` },
      { v: (4 * N) / 100, why: `${N} × 4%：「乘 4」是估两张牌的，这里只剩一张，该乘 2` },
      { v: (U - N) / U, why: `${U - N} ÷ ${U}：这是不中的概率` },
      { v: N / (U - N), why: `${N} ÷ ${U - N}：拿补牌数去比不中的张数，算成了中与不中的比` },
    ], pctText, isProb, PCT_GAP);
    if (!o) return null;
    return { ...o, value: v, detail: { N, unseen: U, street: turn ? 'turn' : 'flop', draw: d.name },
      text: turn
        ? `转牌后你有 ${N} 张补牌（${d.name}；你的两张和四张公共牌都见过了，还有 46 张没见过）。河牌中的概率是多少？`
        : `翻牌后你有 ${N} 张补牌（${d.name}；你的两张和三张公共牌都见过了，还有 47 张没见过）。转牌一张就中的概率是多少？`,
      how: `口算：${N} 张 × 2 ≈ ${2 * N}%；精确：${N} ÷ ${U} = ${o.answerText}` };
  },

  /** 4. 两张里至少中一张（翻牌后）：1 − (47−N)/47 × (46−N)/46。说明里先教口算「补牌数 × 4」，偏高得明显时照实说 */
  two(rng) {
    const d = pick(DRAWS_TWO, rng);
    const N = d.n;
    const v = 1 - ((47 - N) / 47) * ((46 - N) / 46);
    const o = buildOptions(rng, v, [
      { v: N / 47 + N / 46, why: `${N} ÷ 47 + ${N} ÷ 46：两张的命中率直接相加，转牌已经中了的情况被算了两次` },
      { v: N / 47, why: `${N} ÷ 47：只算了转牌一张` },
      { v: (N / 47) * ((N - 1) / 46), why: `(${N} ÷ 47) × (${N - 1} ÷ 46)：算成了两张都中` },
      { v: ((47 - N) / 47) * ((46 - N) / 46), why: `(${47 - N} ÷ 47) × (${46 - N} ÷ 46)：这是两张都不中的概率，忘了用 1 去减` },
      { v: N / 100, why: `${N}%：把补牌张数直接当成了百分数` },
    ], pctText, isProb, PCT_GAP);
    if (!o) return null;
    const est = 4 * N;
    const high = est - Math.round(v * 100) >= 3 ? `，补牌多时偏高` : '';
    return { ...o, value: v, detail: { N, draw: d.name },
      text: `翻牌后你有 ${N} 张补牌（${d.name}；还有 47 张没见过）。转牌和河牌两张发完，至少中一张的概率是多少？`,
      how: `口算：${N} 张 × 4 ≈ ${est}%${high}；精确：1 − (${47 - N} ÷ 47) × (${46 - N} ÷ 46) = ${o.answerText}` };
  },

  /** 5. 跟注的期望值：w × (P + B) − (1 − w) × B。胜率取 10% 的整数倍，中间结果最多一位小数 */
  ev(rng) {
    const { P, B, size } = potAndBet(rng);
    const wp = 10 * (1 + Math.floor(rng() * 8));   // 10%~80%
    const w = wp / 100;
    const winPart = w * (P + B), losePart = (1 - w) * B;
    const v = winPart - losePart;
    const o = buildOptions(rng, v, [
      { v: winPart, why: `只算了赢的 ${wp}% × (${P} + ${B})，忘了减去输的部分` },
      { v: w * P - losePart, why: `赢的时候只算了原来的底池 ${P}，漏了对手下的 ${B}` },
      { v: winPart - B, why: `输的部分没乘输的概率，整个 ${B} 都减掉了` },
      { v: -v, why: '正负号反了' },
    ], chipText);
    if (!o) return null;
    return { ...o, value: v, detail: { P, B, w },
      text: `底池 ${P}，对手下注 ${B}（${size}），你的胜率是 ${wp}%。跟注平均赚或亏多少筹码？`,
      how: `赢 ${wp}% × (${P} + ${B}) − 输 ${100 - wp}% × ${B} = ${oneDecimal(winPart)} − ${oneDecimal(losePart)} = ${o.answerText}` };
  },

  /** 6. 数组合：对手的范围是几类牌，你手里的两张挡掉一部分，按花色组合公式数 */
  combos(rng) {
    const pool = ['AA', 'KK', 'QQ', 'AKs', 'AKo', 'AQs', 'AQo'];
    const n = rng() < 0.25 ? 1 : 2;
    const classes = shuffle(pool.slice(), rng).slice(0, n)
      .sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
    const ranksIn = [...new Set(classes.flatMap((c) => [c[0], c[1]]))];
    // 你的第一张牌一定是范围里出现的点数（否则挡不掉任何组合），第二张随便发
    const c1 = RANKS.indexOf(pick(ranksIn, rng)) * 4 + Math.floor(rng() * 4);
    let c2 = c1;
    while (c2 === c1) c2 = Math.floor(rng() * 52);
    const hero = [c1, c2];
    const held = (r) => hero.filter((c) => RANKS[rankOf(c)] === r);
    const words = [], parts = [];
    let total = 0, full = 0;
    const count = (cards) => {   // 给定「手里有哪几张」，各类剩多少种（干扰项也用它，模拟只扣了一张牌的错法）
      const h = (r) => cards.filter((c) => RANKS[rankOf(c)] === r);
      return classes.map((cl) => {
        const x = cl[0], y = cl[1];
        if (x === y) { const left = 4 - h(x).length; return (left * (left - 1)) / 2; }
        const sx = 4 - h(x).length, sy = 4 - h(y).length;
        const blocked = new Set([...h(x), ...h(y)].map(suitOf)).size;
        return cl[2] === 's' ? 4 - blocked : sx * sy - (4 - blocked);
      });
    };
    const each = count(hero);
    classes.forEach((cl, i) => {
      const x = cl[0], y = cl[1];
      if (x === y) {
        const left = 4 - held(x).length;
        words.push(cl);
        parts.push(`${cl} 剩 ${left} 张 ${x} 任取两张：${left}×${left - 1}÷2 = ${each[i]} 种`);
        full += 6;
      } else if (cl[2] === 's') {
        words.push(`同花 ${x}${y}`);
        parts.push(`同花 ${x}${y} 的 4 种花色挡掉 ${4 - each[i]} 种：4 − ${4 - each[i]} = ${each[i]} 种`);
        full += 4;
      } else {
        const sx = 4 - held(x).length, sy = 4 - held(y).length;
        words.push(`不同花 ${x}${y}`);
        parts.push(`不同花 ${x}${y} 是 ${sx} 张 ${x} × ${sy} 张 ${y} 再去掉同花的 ${sx * sy - each[i]} 种：${sx}×${sy} − ${sx * sy - each[i]} = ${each[i]} 种`);
        full += 12;
      }
      total += each[i];
    });
    if (total === full) return null;   // 一张都没挡掉，题就没意思了
    const sum = (a) => a.reduce((s, x) => s + x, 0);
    const o = buildOptions(rng, total, [
      { v: full, why: '忘了你手里的牌挡掉的组合' },
      { v: sum(count([hero[0]])), why: `只扣了 ${cardText(hero[0])} 挡掉的，漏了 ${cardText(hero[1])}` },
      { v: sum(count([hero[1]])), why: `只扣了 ${cardText(hero[1])} 挡掉的，漏了 ${cardText(hero[0])}` },
      { v: total - 1, why: '差了一种' }, { v: total + 1, why: '多数了一种' },
      { v: total - 2, why: '差了两种' }, { v: total + 2, why: '多数了两种' },
    ], unitText('种'), (v) => v >= 0);
    if (!o) return null;
    return { ...o, value: total, cards: { hole: hero, board: [] }, detail: { classes, hero },
      text: `对手的范围只有这${n === 1 ? '一' : '两'}类牌：${words.join('、')}。你手里拿着 ${cardText(hero[0])} ${cardText(hero[1])}，对手还剩多少种组合？（按具体的两张牌算，比如 AA 原本有 6 种）`,
      how: parts.length > 1 ? `${parts.join('；')}；合计 ${each.join(' + ')} = ${o.answerText}` : parts[0] };
  },

  /** 7. 数补牌：画出手牌和公共牌，数能让你成同花（或成顺子）的牌。局面保证问法没有歧义 */
  outs(rng) {
    const flush = rng() < 0.5;
    const nBoard = rng() < 0.5 ? 3 : 4;
    for (let tries = 0; tries < 20000; tries++) {
      const deck = shuffle([...Array(52).keys()], rng);
      const hole = deck.slice(0, 2), board = deck.slice(2, 2 + nBoard);
      const r = flush ? flushDraw(hole, board) : straightDraw(hole, board);
      if (!r) continue;
      const street = nBoard === 3 ? '翻牌三张' : '四张公共牌（翻牌加转牌）';
      const o = buildOptions(rng, r.outs, r.wrong, unitText('张'), (v) => v >= 0);
      if (!o) continue;
      return { ...o, value: r.outs, cards: { hole, board }, detail: { kind: flush ? 'flush' : 'straight', ...r.detail },
        text: `看图：你的两张手牌和${street}。你没见过的牌里，有几张能让你${flush ? '成同花' : '成顺子'}？`,
        how: r.how(o.answerText) };
    }
    return null;
  },
};

// ---- 数补牌用到的局面判断：只看点数和花色，不调牌力评估器（评估器留给测试做独立核对） ----
function rankCounts(cards) { const n = new Array(13).fill(0); for (const c of cards) n[rankOf(c)]++; return n; }
function suitCounts(cards) { const n = [0, 0, 0, 0]; for (const c of cards) n[suitOf(c)]++; return n; }
/** 点数集合里有没有五张连着的（A 也可以当 1） */
function hasStraight(ranks) {
  const has = (r) => ranks.has(r === -1 ? 12 : r);
  for (let lo = -1; lo <= 8; lo++) { let ok = true; for (let k = 0; k < 5; k++) if (!has(lo + k)) { ok = false; break; } if (ok) return true; }
  return false;
}
/** 现在最多一对、没有顺子：再来一张牌出不了葫芦、四条，问「成同花 / 成顺子」时答案不会被更大的牌型盖住 */
function atMostOnePair(cards) {
  const rc = rankCounts(cards);
  return rc.filter((x) => x >= 2).length <= 1 && Math.max(...rc) <= 2 && !hasStraight(new Set(cards.map(rankOf)));
}
/** 同花听牌：恰好四张同花色、至少一张在手里，现在最多一对 */
function flushDraw(hole, board) {
  const all = [...hole, ...board];
  const sc = suitCounts(all);
  const s = sc.findIndex((x) => x === 4);
  if (s < 0 || !hole.some((c) => suitOf(c) === s) || !atMostOnePair(all)) return null;
  const mine = hole.filter((c) => suitOf(c) === s).length;
  const outs = 13 - sc[s];
  const name = SUIT_CN[SUITS[s]];
  return {
    outs, detail: { suit: SUITS[s] },
    wrong: [
      { v: 13 - mine, why: `只减了手里的 ${mine} 张${name}，公共牌上的${name}也见过了` },
      { v: 13, why: `把${name}整个 13 张都算上了` },
      { v: outs - 1, why: '差了一张' }, { v: outs + 1, why: '多数了一张' }, { v: outs - 2, why: '差了两张' },
    ],
    how: (ans) => `${name}一共 13 张，你的手牌和公共牌里已经有 ${sc[s]} 张：13 − ${sc[s]} = ${ans}`,
  };
}
/** 顺子听牌：现在最多一对、没有顺子；再来一张也不可能成同花；能成顺的点数都要用上你的手牌（公共牌自己连不成顺） */
function straightDraw(hole, board) {
  const all = [...hole, ...board];
  if (Math.max(...suitCounts(all)) > 3 || !atMostOnePair(all)) return null;
  const known = new Set(all.map(rankOf)), boardRanks = new Set(board.map(rankOf));
  const need = [];
  for (let r = 0; r < 13; r++) {
    if (known.has(r)) continue;
    if (hasStraight(new Set([...known, r]))) {
      if (hasStraight(new Set([...boardRanks, r]))) return null;   // 公共牌自己就成顺：谁都有，问法有歧义
      need.push(r);
    }
  }
  if (!need.length) return null;
  const outs = need.length * 4;   // 这些点数一张都没见过，每种 4 张
  const names = need.map((r) => rankName(r));
  return {
    outs, detail: { ranks: names },
    wrong: [
      { v: need.length === 1 ? 8 : outs / 2, why: need.length === 1 ? '当成两头都能成顺了，其实只差中间一张' : '只算了一头' },
      { v: outs - 1, why: '差了一张' }, { v: outs + 1, why: '多数了一张' },
      { v: outs - 2, why: '差了两张' }, { v: outs + 2, why: '多数了两张' },
    ],
    how: (ans) => `差一张 ${names.join(' 或 ')} 就成顺子，这${need.length > 1 ? '几' : '一'}种点数各 4 张都没见过：${need.length} × 4 = ${ans}`,
  };
}

/** 出一道指定题型的题。凑不出四个不同选项就换一组参数，最多试 200 次 */
function makeQuestion(type, rng) {
  const gen = GEN[type];
  if (!gen) throw new Error('没有这种题型：' + type);
  for (let i = 0; i < 200; i++) {
    const q = gen(rng);
    if (q) return { type, typeName: typeName(type), cards: null, ...q };
  }
  throw new Error('出不了题：' + type);
}

/**
 * 一局的出题器。题型按「一袋七种、洗乱了依次取」轮换：一局里各题型大致均匀，
 * 换袋时如果新袋的第一种和上一题相同就和第二种对调，所以不会连续两题同一题型（只选了一种题型的练习除外）。
 */
function createSpeedDeck(rng, types = SPEED_TYPE_IDS) {
  let ids = (types || []).filter((t) => SPEED_TYPE_IDS.includes(t));
  if (!ids.length) ids = SPEED_TYPE_IDS.slice();
  let bag = [], last = null;
  return {
    next() {
      if (!bag.length) {
        bag = shuffle(ids.slice(), rng);
        if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
      }
      const t = bag.shift();
      last = t;
      return makeQuestion(t, rng);
    },
  };
}

// ---------------------------------------------------------------------------
// 判分与统计
// ---------------------------------------------------------------------------
/** 点了第几个选项 → 对不对 */
const isCorrect = (q, choice) => choice === q.answer;

/**
 * 一局的统计。log 是按顺序的作答记录 [{ type, ok }]。
 * 返回答对几题、正确率（空局为 NaN）、最长连对、各题型对错、最弱的一类（这局答错过的题型里错得比例最高的；没答错过就是 null）。
 */
function summarizeSpeed(log) {
  const byType = {};
  for (const id of SPEED_TYPE_IDS) byType[id] = { right: 0, wrong: 0 };
  let correct = 0, streak = 0, bestStreak = 0;
  for (const a of log) {
    if (!byType[a.type]) continue;
    if (a.ok) { correct++; streak++; bestStreak = Math.max(bestStreak, streak); byType[a.type].right++; }
    else { streak = 0; byType[a.type].wrong++; }
  }
  const answered = SPEED_TYPE_IDS.reduce((s, id) => s + byType[id].right + byType[id].wrong, 0);
  let weakest = null, worst = -1;
  for (const id of SPEED_TYPE_IDS) {
    const t = byType[id], n = t.right + t.wrong;
    if (!t.wrong) continue;
    const rate = t.wrong / n + t.wrong * 1e-6;   // 错得比例一样时，错得多的更弱
    if (rate > worst) { worst = rate; weakest = id; }
  }
  return { answered, correct, accuracy: answered ? correct / answered : NaN, bestStreak, byType, weakest };
}

// ---------------------------------------------------------------------------
// 记录：存在进度对象的 speed 字段
// ---------------------------------------------------------------------------
/** 逐局历史最多留多少局（超出时丢掉最早的） */
const SPEED_HISTORY_MAX = 200;

/**
 * 空记录。history 是 60 秒挑战的逐局历史 [{ time, correct, answered }]（v0.11 加的，按时间先后，最多 SPEED_HISTORY_MAX 局）。
 * 加这个字段之前打的局只记进了 best / runs，没有逐局明细，所以 runs 可以比 history 的长度大。
 */
function emptySpeedRecord() {
  const byType = {};
  for (const id of SPEED_TYPE_IDS) byType[id] = { right: 0, wrong: 0 };
  return { best: 0, runs: 0, byType, history: [] };
}

/**
 * 逐局历史里的一条：时间是有限的正数（毫秒），答对数、答题数是非负整数（上限 10000）且答对数不超过答题数。
 * 一条里任何一项不合法就整条丢掉——时间和对错数都没法「纠正」出一个真值，编一个进去比丢掉更糟。
 */
function coerceRun(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const okInt = (v) => Number.isInteger(v) && v >= 0 && v <= 1e4;
  if (!Number.isFinite(r.time) || r.time <= 0 || r.time > 8.64e15) return null;
  if (!okInt(r.correct) || !okInt(r.answered) || r.correct > r.answered) return null;
  return { time: r.time, correct: r.correct, answered: r.answered };
}

/** 整形读到的记录：只认非负整数（有上限），不认识的题型丢掉，缺的补零；整个不是对象就给空记录 */
function coerceSpeedRecord(raw) {
  const d = emptySpeedRecord();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const int = (v, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
  d.best = int(raw.best, 1e4);
  d.runs = int(raw.runs, 1e6);
  if (raw.byType && typeof raw.byType === 'object' && !Array.isArray(raw.byType)) {
    for (const id of SPEED_TYPE_IDS) {
      const t = raw.byType[id];
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      d.byType[id] = { right: int(t.right, 1e7), wrong: int(t.wrong, 1e7) };
    }
  }
  // 逐局历史：不是数组（旧存档没有这个字段）就是空的；不合法的条目丢掉，只留最近 SPEED_HISTORY_MAX 局
  if (Array.isArray(raw.history)) d.history = raw.history.map(coerceRun).filter(Boolean).slice(-SPEED_HISTORY_MAX);
  return d;
}

/** 记一道题的对错（两种模式都记进各题型累计）。返回新记录，不改传进来的 */
function recordAnswer(rec, type, ok) {
  const d = coerceSpeedRecord(rec);
  if (!d.byType[type]) return d;
  d.byType[type] = { ...d.byType[type], [ok ? 'right' : 'wrong']: d.byType[type][ok ? 'right' : 'wrong'] + 1 };
  return d;
}

/**
 * 记一局 60 秒挑战：总局数加一，答对数超过最好成绩就刷新，逐局历史追加一条（时间、答对数、答题数）。
 * summary 没给答题数时按答对数记（答题数不会比答对数少）。返回 { rec, newBest, prevBest }
 */
function recordTimedRun(rec, summary, now = Date.now()) {
  const d = coerceSpeedRecord(rec);
  const prevBest = d.best;
  d.runs = Math.min(d.runs + 1, 1e6);
  const newBest = summary.correct > prevBest;
  if (newBest) d.best = summary.correct;
  const answered = Number.isInteger(summary.answered) ? summary.answered : summary.correct;
  const run = coerceRun({ time: now, correct: summary.correct, answered });
  if (run) d.history = [...d.history, run].slice(-SPEED_HISTORY_MAX);
  return { rec: d, newBest, prevBest };
}

exports.chipText = chipText;
exports.makeQuestion = makeQuestion;
exports.createSpeedDeck = createSpeedDeck;
exports.summarizeSpeed = summarizeSpeed;
exports.emptySpeedRecord = emptySpeedRecord;
exports.coerceSpeedRecord = coerceSpeedRecord;
exports.recordAnswer = recordAnswer;
exports.recordTimedRun = recordTimedRun;
exports.SPEED_SECONDS = SPEED_SECONDS;
exports.SPEED_REVEAL_MS = SPEED_REVEAL_MS;
exports.SPEED_TYPES = SPEED_TYPES;
exports.SPEED_TYPE_IDS = SPEED_TYPE_IDS;
exports.pctText = pctText;
exports.cardText = cardText;
exports.isCorrect = isCorrect;
exports.SPEED_HISTORY_MAX = SPEED_HISTORY_MAX;
});
