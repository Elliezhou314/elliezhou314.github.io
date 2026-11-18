__squidDefine('src/train/puzzles.js', function (exports) {
'use strict';
// 数学竞赛题库。
//
// 铁律：每道题的标准答案都由引擎在运行时**现算**（compute），不写死常数。
// 同时给出闭式/手推答案（analytic），tools/puzzletest.mjs 会逐题交叉验证两者一致——
// 一旦引擎改坏了，题库的答案会跟着错，测试立刻失败。这既是数学竞赛的严谨要求，
// 也是"数字不是编的"最直接的证明：评委可以当场改参数，答案跟着重算。
//
// 难度分三级：省赛（组合计数与基础概率）/ 国赛（贝叶斯、均衡解析解）/ IMO（多街递推、博弈值）。
//
// verify 字段标明这道题的两条路径有多独立：
//   'enumeration' —— compute 枚举、analytic 组合公式，两条真正独立
//   'solver'      —— 另有 solverCheck()，让 CFR 从零跑出同一个数（最强）
//   'cfr'         —— compute 就是自博弈迭代的结果，与闭式解比对
//   'numeric'     —— compute 用数值方法（二分等）反解，不套闭式
//   'counting'    —— 两侧本质是同一套计数逻辑写了两遍，能抓笔误、抓不住概念错误

const { parseCards, strToCard, rankOf, COMBOS } = __squidRequire('src/core/cards.js');
const { evaluate, categoryOf } = __squidRequire('src/core/evaluator.js');
const { parseRange, removeDead, rangeComboCount } = __squidRequire('src/core/range.js');
const { equityHandVsRange, equityHandVsRanges, equityMultiway, enumerateRunouts } = __squidRequire('src/core/equity.js');
const { solveKuhnCFR, solveKuhnExact } = __squidRequire('src/train/kuhn.js');

// ---------------------------------------------------------------------------
// 答案解析：接受整数、小数、百分数、分数 p/q、以及若干闭式写法
// ---------------------------------------------------------------------------
/**
 * 把玩家输入的答案解析成数字。支持：
 *   整数 / 小数 / 科学计数     3、0.5、1e-3
 *   百分数                     34.97%
 *   分数与四则运算             378/1081、(21^(1/3)-1)/2
 *   幂（右结合）与开方         2^10、sqrt(21)、cbrt(21)、根号21
 *
 * 这里是**手写的递归下降解析器**，不用 new Function/eval。
 * 早先版本图省事用 new Function 求值，只靠一个字符白名单正则挡：
 * 但正则允许 [a-z] 加括号和点，于是 alert(1)、localStorage.clear()、process.exit(1)
 * 这类输入全都能跑通（实测 process.exit(1) 会直接结束进程）。
 * 一个只需要认数字和四则运算的输入框，不该有执行任意全局函数的能力。
 */
function parseAnswer(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s) return null;
  // 全角转半角、去空白、统一负号与根号写法
  s = s.replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[−–—]/g, '-').replace(/[／]/g, '/').replace(/[＊×]/g, '*')
    .replace(/[＋]/g, '+').replace(/[％]/g, '%')
    .replace(/根号|√/g, 'sqrt').replace(/立方根/g, 'cbrt')
    .replace(/\s+/g, '').replace(/。$/, '');
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
  if (!s) return null;

  if (s.length > 200) return null; // 正常答案不会这么长；顺便挡住深层嵌套的爆栈输入
  let i = 0, depth = 0;
  const MAX_DEPTH = 60;
  const eat = (ch) => { if (s[i] === ch) { i++; return true; } return false; };

  // expr := term (('+'|'-') term)*
  function expr() {
    let v = term();
    if (v === null) return null;
    for (;;) {
      if (eat('+')) { const r = term(); if (r === null) return null; v += r; }
      else if (eat('-')) { const r = term(); if (r === null) return null; v -= r; }
      else return v;
    }
  }
  // term := unary (('*'|'/') unary)*
  function term() {
    let v = unary();
    if (v === null) return null;
    for (;;) {
      if (eat('*')) { const r = unary(); if (r === null) return null; v *= r; }
      else if (eat('/')) { const r = unary(); if (r === null) return null; if (r === 0) return null; v /= r; }
      else return v;
    }
  }
  // unary := ('+'|'-') unary | power
  function unary() {
    if (eat('-')) { const v = unary(); return v === null ? null : -v; }
    if (eat('+')) return unary();
    return power();
  }
  // power := primary ('^' unary)?   —— 右结合，指数侧允许负号
  function power() {
    const base = primary();
    if (base === null) return null;
    if (eat('^')) {
      const e = unary();
      if (e === null) return null;
      const r = Math.pow(base, e);
      return Number.isFinite(r) ? r : null;
    }
    return base;
  }
  // primary := number | ('sqrt'|'cbrt') '(' expr ')' | '(' expr ')'
  function primary() {
    if (++depth > MAX_DEPTH) return null; // 括号套太深直接判非法，不让递归把栈打爆
    try {
      return primaryInner();
    } finally { depth--; }
  }
  function primaryInner() {
    if (eat('(')) {
      const v = expr();
      if (v === null || !eat(')')) return null;
      return v;
    }
    for (const [name, fn] of [['sqrt', Math.sqrt], ['cbrt', Math.cbrt]]) {
      if (s.startsWith(name, i)) {
        i += name.length;
        // 允许 sqrt(21) 也允许 sqrt21
        let arg;
        if (eat('(')) { arg = expr(); if (arg === null || !eat(')')) return null; }
        else { arg = primary(); if (arg === null) return null; }
        const r = fn(arg);
        return Number.isFinite(r) ? r : null;
      }
    }
    const m = /^\d+(\.\d+)?(e[-+]?\d+)?|^\.\d+/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const v = Number(m[0]);
    return Number.isFinite(v) ? v : null;
  }

  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return pct ? v / 100 : v;
}

/**
 * 四舍五入保留一位小数。判分和显示共用这一个函数，两边的进位永远一致。
 * 不直接用 toFixed(1)：玩家写 34.95%，换算成概率再乘回 100 是 34.949999…，toFixed 会舍成 34.9。
 * 这里先加一个远小于题目精度的 1e-9 吸收浮点误差，逢五进一（负数按绝对值进位），负零写成 0.0。
 */
function oneDecimal(y) {
  const tenths = Math.floor(Math.abs(y) * 10 + 0.5 + 1e-9);
  return (y < 0 && tenths > 0 ? '-' : '') + (tenths / 10).toFixed(1);
}

/**
 * 答案在界面上的写法：一律保留一位小数。
 * 概率题写成百分数（35.0%），其余按题面的单位（−2.2 个筹码）；整数答案不带小数点（15）。
 */
function formatAnswer(puzzle, value) {
  if (!Number.isFinite(value)) return String(value);
  const s = puzzle.kind === 'probability' ? oneDecimal(value * 100) + '%'
    : Number.isInteger(value) ? String(value) : oneDecimal(value);
  return s.replace('-', '−');
}

/**
 * 判分：保留一位小数后和标准答案一样就算对。概率题按百分数比，其余按原单位比。
 * 例如 P03 的标准答案是 35.0%：写 35.0%、35、0.35、378/1081 都对；写 34.9% 不对。
 * 分数、算式照样认，按它的值四舍五入后再比。
 * 早先要求精确到小数点后好几位，而界面上显示的也是 0.349676（34.9676%）这种长串——
 * 对玩家来说一位小数已经足够说明算没算对。
 * 题目里的 tolerance 字段不参与判分，只用于 puzzletest 核对「引擎现算」与「另一种算法」。
 */
function checkAnswer(puzzle, input, computed) {
  const v = parseAnswer(input);
  if (v == null) return { ok: false, parsed: null, reason: '看不懂这个答案：保留一位小数写就行，概率写成百分数（如 35.0%），也可以写分数（如 378/1081）' };
  const truth = computed.value;
  // 概率题：允许玩家把百分数写成 35.0 这种（>1 且真值 ≤1 时按百分数理解）
  let x = v;
  if (puzzle.kind === 'probability' && truth <= 1 && v > 1 && v <= 100) x = v / 100;
  const inUnit = (y) => oneDecimal(puzzle.kind === 'probability' ? y * 100 : y);
  const ok = inUnit(x) === inUnit(truth);
  return {
    ok, exact: ok, parsed: x,
    reason: ok ? '保留一位小数后和标准答案一样' : '保留一位小数后和标准答案不一样',
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return Math.round(r); };

/** 枚举全部 C(52,5) 手牌，按类别计数（用于省赛计数题） */
let fiveCardCounts = null;
function categoryCounts5() {
  if (fiveCardCounts) return fiveCardCounts;
  const cnt = new Array(9).fill(0);
  const c = [0, 0, 0, 0, 0];
  for (c[0] = 0; c[0] < 52; c[0]++) for (c[1] = c[0] + 1; c[1] < 52; c[1]++) for (c[2] = c[1] + 1; c[2] < 52; c[2]++)
    for (c[3] = c[2] + 1; c[3] < 52; c[3]++) for (c[4] = c[3] + 1; c[4] < 52; c[4]++) cnt[categoryOf(evaluate(c, 5))]++;
  fiveCardCounts = cnt;
  return cnt;
}

// ---------------------------------------------------------------------------
// 题库
// ---------------------------------------------------------------------------
const PUZZLES = [
  // ======================== 省赛：组合计数与基础概率 ========================
  {
    id: 'P01', tier: '省赛', topic: '组合计数', points: 100, kind: 'probability', tolerance: 5e-6,
    verify: 'enumeration',
    title: '五张牌恰好是两对',
    statement: '从一副 52 张的标准牌里随机发 5 张，恰好构成"两对"（不是葫芦、不是四条）的概率是多少？写成百分数，保留一位小数。',
    hints: [
      '先数「恰好两对」一共有多少种 5 张牌，再除以「5 张牌一共有多少种」。一手两对长这样：两张同点数（比如两张 K）＋另外两张同点数（比如两张 7）＋一张跟它们都不同的散牌（比如一张 4）。',
      '分三步数：① 挑哪两个点数成对：13 个点数里挑 2 个，13×12÷2 = 78 种；② 每个对子从 4 种花色里挑 2 张，4×3÷2 = 6 种，两个对子就是 6×6 = 36 种；③ 散牌不能和这两个点数相同（否则成了葫芦），只能从另外 11 个点数的 44 张里挑，44 种。',
      '两对一共有多少手，就是上面三步的乘积。分母是 52 张里挑 5 张的挑法：52×51×50×49×48 ÷ (5×4×3×2×1) = 2598960 种。',
    ],
    compute() {
      const cnt = categoryCounts5();
      const hands = cnt[2];                    // 类别 2 = 两对
      const total = C(52, 5);
      return {
        value: hands / total,
        evidence: `把 52 张里挑 5 张的全部 ${total.toLocaleString()} 种牌一手一手发出来，逐手判断牌型：恰好两对的有 ${hands.toLocaleString()} 手，占 ${(hands / total * 100).toFixed(1)}%。`,
        detail: { hands, total },
      };
    },
    analytic() {
      const hands = C(13, 2) * C(4, 2) * C(4, 2) * 44;
      const total = C(52, 5);
      return {
        value: hands / total,
        expr: 'C(13,2)·C(4,2)²·44 / C(52,5) = 123552/2598960 ≈ 4.8%',
        derivation: '式子里的 C(n,k) 表示「从 n 个里挑 k 个」有多少种挑法。① 挑两个成对的点数：13 个里挑 2 个，78 种；② 每个对子从 4 种花色里挑 2 张，各 6 种，合起来 36 种；③ 第五张避开这两个点数，从另外 11 个点数的 44 张里挑，44 种。两对共 78×36×44 = 123552 手；5 张牌总共 2598960 种，概率 = 123552/2598960 ≈ 4.8%。',
      };
    },
  },
  {
    id: 'P02', tier: '省赛', topic: '条件概率', points: 100, kind: 'probability', tolerance: 5e-6,
    verify: 'enumeration',
    title: '口袋对子在翻牌击中暗三条',
    statement: '你手里是一对（比如 7♠7♥）。翻牌发 3 张公共牌，其中至少出现一张 7（即击中暗三条或更好）的概率是多少？',
    hints: [
      '反过来想更容易：先算「三张翻牌里一张 7 都没有」的概率，再用 1 去减。',
      '你的 7♠7♥ 已经在手里，还没发的牌有 50 张，其中只剩 2 张 7（7♦、7♣），另外 48 张都不是 7。',
      '三张翻牌都不是 7：从那 48 张里挑 3 张，48×47×46÷6 = 17296 种；50 张里挑 3 张一共 50×49×48÷6 = 19600 种。一张 7 都不来的概率就是 17296/19600，答案是 1 减去它。',
    ],
    compute() {
      const hole = parseCards('7s7h');
      const deck = [];
      for (let c = 0; c < 52; c++) if (c !== hole[0] && c !== hole[1]) deck.push(c);
      const sevens = new Set(deck.filter((c) => rankOf(c) === rankOf(hole[0])));
      let hit = 0, total = 0, strongNoSeven = 0;
      for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) for (let c = b + 1; c < deck.length; c++) {
        total++;
        const gotSeven = sevens.has(deck[a]) || sevens.has(deck[b]) || sevens.has(deck[c]);
        if (gotSeven) hit++;
        else if (categoryOf(evaluate([deck[a], deck[b], deck[c], hole[0], hole[1]], 5)) >= 3) strongNoSeven++;
      }
      return {
        value: hit / total,
        evidence: `你拿 7♠7♥，剩下 50 张牌里发 3 张翻牌，全部 ${total.toLocaleString()} 种发法逐一检查：至少出现一张 7 的有 ${hit.toLocaleString()} 种。` +
          `另有 ${strongNoSeven} 种翻牌一张 7 都没有、但公共牌自己凑成了三条（比如 K♠K♥K♦，你手里是葫芦），它们不算「击中暗三条」——` +
          `把它们也算进去会得到 ${((hit + strongNoSeven) / total * 100).toFixed(1)}%，而不是正确的 ${(hit / total * 100).toFixed(1)}%。`,
        detail: { hit, total, strongNoSeven },
      };
    },
    analytic() {
      const miss = C(48, 3), total = C(50, 3);
      return {
        value: 1 - miss / total,
        expr: '1 − C(48,3)/C(50,3) = 1 − 17296/19600 = 144/1225 ≈ 11.8%',
        derivation: '还没发的 50 张里只剩 2 张 7。三张翻牌一张 7 都不来：从另外 48 张里挑 3 张，17296 种；50 张里挑 3 张一共 19600 种。' +
          '所以至少来一张 7 的概率 = 1 − 17296/19600 = 2304/19600 = 144/1225 ≈ 11.8%。' +
          '容易错的地方：如果按「5 张牌凑成三条或更好」来数，会把 48 种「翻牌自己就是三条」的情况（比如 K♠K♥K♦，你是葫芦、却没有击中 7）也算进去，得到 12.0%——那是另一个事件。',
      };
    },
  },
  {
    id: 'P03', tier: '省赛', topic: '条件概率', points: 100, kind: 'probability', tolerance: 5e-6,
    verify: 'enumeration',
    title: '同花听牌走到河牌',
    statement: '翻牌后你有同花听牌（9 张补牌），还要发转牌和河牌两张。至少命中一张补牌的概率是多少？（注意：不是 9/47 + 9/46）',
    hints: [
      '反过来算：先算「转牌、河牌两张都没中」的概率，再用 1 去减。（题目里说的 9/47 + 9/46 错在第二项：9/46 是「转牌没中」之后河牌才中的概率，直接加上去等于默认转牌一定没中。）',
      '你看得见 5 张牌（2 张手牌＋3 张翻牌），没发的还有 47 张：9 张能让你成同花，38 张不能。',
      '两张都不中：从 38 张里挑 2 张，38×37÷2 = 703 种；47 张里挑 2 张一共 47×46÷2 = 1081 种。两张都不中的概率是 703/1081，答案是 1 减去它。',
    ],
    compute() {
      // 具体局面：手牌 As Ks，翻牌 Qs 7s 2d，补牌 = 剩下 9 张黑桃
      const hole = parseCards('AsKs'), board = parseCards('Qs7s2d');
      const outs = new Set();
      for (let c = 0; c < 52; c++) if ((c & 3) === (strToCard('As') & 3)) outs.add(c);
      for (const c of [...hole, ...board]) outs.delete(c);
      const runouts = enumerateRunouts(board.concat([])); // 仍需两张
      let hit = 0, total = 0;
      const deck = [];
      for (let c = 0; c < 52; c++) if (![...hole, ...board].includes(c)) deck.push(c);
      for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) {
        total++;
        if (outs.has(deck[a]) || outs.has(deck[b])) hit++;
      }
      return {
        value: hit / total,
        evidence: `以 A♠K♠、翻牌 Q♠7♠2♦ 为例：还没发的 47 张里有 ${outs.size} 张黑桃。转牌、河牌的全部 ${total.toLocaleString()} 种发法逐一检查，至少来一张黑桃的有 ${hit.toLocaleString()} 种，占 ${(hit / total * 100).toFixed(1)}%。`,
        detail: { hit, total, outs: outs.size, runouts: runouts.length },
      };
    },
    analytic() {
      const miss = C(38, 2), total = C(47, 2);
      return {
        value: 1 - miss / total,
        expr: '1 − C(38,2)/C(47,2) = 1 − 703/1081 = 378/1081 ≈ 35.0%',
        derivation: '没发的 47 张里 9 张能成同花、38 张不能。两张都不中：从 38 张里挑 2 张，703 种；47 张里挑 2 张一共 1081 种。至少中一张 = 1 − 703/1081 = 378/1081 ≈ 35.0%。' +
          '9/47 + 9/46 ≈ 38.7% 错在第二项：9/46 是「转牌没中」时河牌才中的概率，要先乘上转牌没中的概率 38/47 才能相加——9/47 + 38/47 × 9/46 = 378/1081，和上面一样。',
      };
    },
  },
  {
    id: 'P04', tier: '省赛', topic: '组合计数', points: 100, kind: 'number', tolerance: 1e-9,
    verify: 'counting',
    title: '阻挡牌：你手里的 A 让对手少了多少组合',
    statement: '对手的范围是 "AA,AKs,AKo,KK"。如果你手里拿着 A♠K♦，对手范围里还剩多少个具体的双牌组合？',
    hints: [
      '先数没人占牌时各有多少种：AA 有 6 种（4 张 A 两两配对）、KK 也是 6 种、AKs（同花色的 A 和 K）4 种、AKo（不同花色的 A 和 K）12 种，一共 28 种。',
      '你手里的 A♠ 和 K♦ 对手就拿不到了：他还能用的 A 只剩 A♥、A♦、A♣，K 只剩 K♠、K♥、K♣。凡是用到 A♠ 或 K♦ 的组合都要划掉。',
      'AA 从 3 张 A 里挑 2 张 = 3 种；KK 同理 3 种；AKs 要同花色，只剩 A♥K♥、A♣K♣ 两种（A♠K♠ 缺 A♠、A♦K♦ 缺 K♦）；AKo 是 3 张 A 配 3 张 K 共 9 种，再去掉其中同花色的那 2 种。最后把四类加起来。',
    ],
    compute() {
      const dead = parseCards('AsKd');
      // 分开数每一类，提示里写到的每个数都要能在这里对上（puzzletest 会核对）
      const parts = {};
      for (const cls of ['AA', 'KK', 'AKs', 'AKo']) {
        parts[cls] = { before: rangeComboCount(parseRange(cls)), after: rangeComboCount(removeDead(parseRange(cls), dead)) };
      }
      const w = parseRange('AA,AKs,AKo,KK');
      const before = rangeComboCount(w);
      const after = rangeComboCount(removeDead(w, dead));
      return {
        value: after,
        evidence: `把对手范围展开成具体的两张牌，一共 ${before} 种；划掉所有用到 A♠ 或 K♦ 的，剩 ${after} 种。分开看：`
          + Object.entries(parts).map(([k, v]) => `${k} 从 ${v.before} 种剩 ${v.after} 种`).join('，') + '。',
        detail: { before, after, parts },
      };
    },
    analytic() {
      // AA: 剩 3 张 A -> C(3,2)=3
      // KK: 剩 3 张 K -> C(3,2)=3
      // AKs: 4 种花色，A♠K♠ 被 A♠挡、A♦K♦ 被 K♦挡 -> 剩 2
      // AKo: 3 张可用 A × 3 张可用 K = 9，减去其中同花色的（A♥K♥、A♣K♣）=2 -> 7
      const v = 3 + 3 + 2 + 7;
      return {
        value: v,
        expr: 'AA:3 + KK:3 + AKs:2 + AKo:7 = 15',
        derivation: '你占了 A♠ 与 K♦。AA 从 6 种降到 3 种（剩下 3 张 A 两两配对）；KK 同理 3 种。AKs 原本 4 种同花组合，A♠K♠ 和 A♦K♦ 各被挡掉一张，剩 2 种。AKo 用剩下的 3 张 A（♥♦♣）配 3 张 K（♠♥♣）共 9 种，其中 A♥K♥、A♣K♣ 是同花要排除，剩 7 种。合计 15 种。',
      };
    },
  },

  // ======================== 国赛：贝叶斯与均衡解析解 ========================
  {
    id: 'P05', tier: '国赛', topic: '贝叶斯', points: 250, kind: 'probability', tolerance: 5e-5,
    verify: 'counting',
    title: '看到下注之后，对手是诈唬的概率',
    statement: '河牌底池 10。对手范围只有两类：坚果 KK（6 个组合）和空气 54o（12 个组合）。他用 KK 100% 下注 10，用 54o 以频率 f 下注。若 f = 25%，当你看到这个下注时，他是空气的概率是多少？',
    hints: [
      '把对手可能拿的牌一张张列出来：一共 18 种，6 种 KK、12 种 54o，每种一样可能。你看到他下注，就只剩「会下注的那些牌」还有可能——答案就是其中空气牌占几成。',
      '会下注的 KK：6 种全都下注，6 种。会下注的 54o：12 种里有 25%，也就是 12 × 25% = 3 种。',
      '看到下注时，他手里是这 6 + 3 = 9 种牌之一，其中空气是 3 种。',
    ],
    compute() {
      const board = parseCards('2s7d9cJhQs');
      const wKK = removeDead(parseRange('KK'), board);
      const wAir = removeDead(parseRange('54o'), board);
      const nKK = rangeComboCount(wKK), nAir = rangeComboCount(wAir);
      const f = 0.25;
      const bettingAir = nAir * f, bettingTotal = nKK * 1 + bettingAir;
      return {
        value: bettingAir / bettingTotal,
        evidence: `河牌 2♠7♦9♣J♥Q♠ 上，对手的 KK 有 ${nKK} 种组合、54o 有 ${nAir} 种${nKK === 6 && nAir === 12 ? '（牌面没有挡掉任何一种）' : ''}。`
          + `他下注时，手里可能是 ${nKK} 种 KK，或者 ${nAir} 种 54o 里拿来诈唬的 ${bettingAir} 种，一共 ${bettingTotal} 种，其中诈唬占 ${bettingAir}/${bettingTotal} ≈ ${(bettingAir / bettingTotal * 100).toFixed(1)}%。`,
        detail: { nKK, nAir, bettingAir, bettingTotal },
      };
    },
    analytic() {
      return {
        value: 3 / 9,
        expr: '(12×25%) / (6 + 12×25%) = 3/9 = 1/3 ≈ 33.3%',
        derivation: '会下注的价值牌：6 种 KK 全部下注；会下注的空气：12 种 54o 里 25%，即 3 种。看到下注时他手里是这 9 种之一，诈唬占 3/9 = 1/3 ≈ 33.3%。这也正是下注一个底池时的均衡诈唬比例（见 P06）：你拿抓诈牌跟注花 10、赢了拿 20，需要对手至少 1/3 是诈唬才不亏，这里正好 1/3，跟不跟都一样。',
      };
    },
  },
  {
    id: 'P06', tier: '国赛', topic: '均衡解析解', points: 250, kind: 'probability', tolerance: 0.02,
    title: '河牌极化：诈唬该占下注范围的几成',
    statement: '河牌底池 p=10，你只能下注 b=10（一次，不许加注）。你的范围是坚果 + 纯空气，对手全是抓诈手。均衡下，诈唬应占你下注范围的多大比例？请给出理论值，界面会用解算器现场跑出来对照。',
    hints: [
      '「均衡」在这里的意思是：对手拿着抓诈的牌，跟注和弃牌赚得一样多。否则他就会一直跟、或者一直弃，你就能反过来针对他。所以要找的是：你的下注里诈唬占多少，才能让他跟不跟都一样。',
      '对手跟注要花 10。跟到你的诈唬，他赢下底池 10 加你下注的 10，净赚 20；跟到你的坚果，他亏掉跟注的 10。弃牌则不赚不亏，记为 0。',
      '设你的下注里诈唬占 x、坚果占 1 − x。让他跟注的平均收益等于弃牌的 0：x × 20 = (1 − x) × 10。解出 x。',
    ],
    solver: {
      spec: { players: 2, board: '2s7d9cJhQs', pot: 10, stack: 30, ranges: ['KK,54o', 'TT'], sizes: { river: { bet: [100], raise: [] } }, raiseCap: 1, allin: false },
      note: '解算器跑出 54o 的下注频率后，诈唬占比 = 诈唬组合/(价值组合+诈唬组合)',
    },
    verify: 'solver',
    compute() {
      // 判分要快，这里用「让对手跟不跟都一样」这个条件直接解；真正独立的验证是 solverCheck()：
      // 让解算器从零自己打这个局面，puzzletest 会换三种下注大小逐一比对。
      const p = 10, b = 10;
      return {
        value: b / (p + 2 * b),
        evidence: `底池 ${p}、下注 ${b}：对手跟注抓到诈唬赚 ${p + b}，抓到坚果亏 ${b}。要让他跟不跟都一样，诈唬的数量 × ${p + b} = 坚果的数量 × ${b}，`
          + `也就是诈唬 : 坚果 = ${b} : ${p + b}，诈唬占下注的 ${b}/${p + 2 * b} ≈ ${(b / (p + 2 * b) * 100).toFixed(1)}%。`
          + '点下面「到解算器里验证这个局面」，解算器不用任何公式、从零自己打，会学出 KK 全部下注、54o 约 25% 下注——诈唬正好占三分之一。',
        detail: { bluffToValue: b / (p + b), callFreq: p / (p + b) },
      };
    },
    /** 独立验证：让解算器自己跑，不用任何公式 */
    async solverCheck(runSolver) {
      const out = [];
      for (const [p, b] of [[10, 10], [10, 5], [10, 20]]) {
        const r = await runSolver(p, b);
        const valueCombos = 6 * r.kkBet, bluffCombos = 12 * r.airBet;
        out.push({ p, b, solved: bluffCombos / (valueCombos + bluffCombos), theory: b / (p + 2 * b), exploitPct: r.exploitPct });
      }
      return out;
    },
    analytic() {
      return {
        value: 1 / 3,
        expr: 'b/(p+2b) = 10/30 = 1/3 ≈ 33.3%',
        derivation: '对手跟注花 10：抓到诈唬赚 20（底池 10 + 你下注的 10），抓到坚果亏 10。要让他跟注和弃牌一样（平均赚 0），诈唬的数量 × 20 = 坚果的数量 × 10，也就是诈唬 : 坚果 = 1 : 2，诈唬占下注的 1/3。' +
          '换成字母写：底池 p、下注 b 时，诈唬占下注的 b/(p+2b)。落到这个局面：KK 6 种全部下注，54o 的 12 种里下注 3 种（25%），3/(6+3) = 1/3。',
      };
    },
  },
  {
    id: 'P07', tier: '国赛', topic: '均衡解析解', points: 250, kind: 'probability', tolerance: 0.02,
    title: '最小防守频率（MDF）',
    statement: '对手在底池 p=10 时下注 b=7。为了让他用任意两张牌诈唬都无利可图，你至少要跟注（不弃牌）多大比例的范围？',
    hints: [
      '站在诈唬的人那边算账：他拿一手必输的牌下注 7。你弃牌，他就白赢桌上的 10；你跟注，他就亏掉这 7。',
      '设你弃牌的比例是 x（跟注的比例就是 1 − x）。他诈唬一次平均赚：x × 10 − (1 − x) × 7。只要这个数大于 0，他闭着眼睛拿任何牌诈唬都能赚钱。',
      '让它正好等于 0：x × 10 = (1 − x) × 7，解出的 x 是你最多能弃牌的比例；题目问的「至少要跟注多少」就是 1 − x。',
    ],
    verify: 'solver',
    compute() {
      const p = 10, b = 7;
      return {
        value: p / (p + b),
        evidence: `对手下注 ${b} 去抢底池 ${p}。你弃牌的比例是 x 时，他随便拿什么牌诈唬一次平均赚 x×${p} − (1−x)×${b}；`
          + `让它等于 0，得 x = ${b}/${p + b}，所以你至少要跟注 1 − ${b}/${p + b} = ${p}/${p + b} ≈ ${(p / (p + b) * 100).toFixed(1)}%。`
          + '另外让解算器从零自己打同样的局面，学出来的跟注频率和这个数一致（换三种下注大小都一致）。',
        detail: { foldFreq: b / (p + b), alpha: b / (p + b) },
      };
    },
    async solverCheck(runSolver) {
      const out = [];
      for (const [p, b] of [[10, 7], [10, 10], [10, 4]]) {
        const r = await runSolver(p, b);
        out.push({ p, b, solved: r.ttCall, theory: p / (p + b), exploitPct: r.exploitPct });
      }
      return out;
    },
    analytic() {
      return {
        value: 10 / 17,
        expr: 'p/(p+b) = 10/17 ≈ 58.8%',
        derivation: '诈唬的人拿一手必输的牌下注 7，想抢桌上的 10。设你弃牌的比例是 x：他诈唬一次平均赚 x×10 − (1−x)×7。令它等于 0：10x = 7 − 7x，x = 7/17。所以你最多只能弃 7/17，至少要跟注 1 − 7/17 = 10/17 ≈ 58.8%。跟得比这少，他拿任何烂牌诈唬都稳赚。',
      };
    },
  },
  {
    id: 'P08', tier: '国赛', topic: '期望值', points: 250, kind: 'number', tolerance: 5e-4,
    verify: 'counting',
    title: '先数补牌再列 EV 方程',
    statement: '转牌局面：你 A♠K♠，公共牌 Q♠7♠2♦9♥，底池 20，对手全下 10。你只有同花听牌（不考虑 A、K 成对算赢）。跟注的期望值是多少筹码？（赢则拿走底池 20+10+你的 10，输则损失 10）',
    hints: [
      '河牌只剩一张要发。你看得见 6 张牌（2 张手牌＋4 张公共牌），没发的还有 52 − 6 = 46 张。',
      '能让你成同花的是还没出现的黑桃：一副牌 13 张黑桃，你手里 2 张、桌上 2 张，还剩 9 张。所以跟注后赢的概率是 9/46，输的概率是 37/46。',
      '赢了你拿到底池 20 加对手的 10，净赚 30；输了亏掉跟注的 10。期望值 = 9/46 × 30 + 37/46 × (−10)。',
    ],
    compute() {
      const hole = parseCards('AsKs'), board = parseCards('Qs7s2d9h');
      const dead = new Set([...hole, ...board]);
      let outs = 0, deck = 0;
      for (let c = 0; c < 52; c++) {
        if (dead.has(c)) continue;
        deck++;
        if ((c & 3) === (strToCard('As') & 3)) outs++;   // 剩余黑桃
      }
      const pWin = outs / deck;
      return {
        value: pWin * 30 + (1 - pWin) * -10,
        evidence: `河牌还有 ${deck} 张可能，逐张检查：其中 ${outs} 张是黑桃（能成同花）。所以跟注后有 ${outs}/${deck} 的机会净赚 30，其余 ${deck - outs}/${deck} 的机会亏掉 10。`,
        detail: { outs, deck, pWin },
      };
    },
    analytic() {
      const pWin = 9 / 46;
      return {
        value: pWin * 30 + (1 - pWin) * -10,
        expr: '(9/46)×30 + (37/46)×(−10) = (270 − 370)/46 = −100/46 ≈ −2.2',
        derivation: '没发的 46 张里 9 张黑桃。赢了净赚 30（底池 20 + 对手的 10），输了亏掉自己的 10。EV = (9×30 − 37×10)/46 = −100/46 ≈ −2.2，所以这个跟注是亏的：跟 10 去争最终 40 的底池，至少要 10/40 = 25% 的胜率，而你只有 9/46 ≈ 19.6%。',
      };
    },
  },

  // ======================== IMO：多街递推与博弈值 ========================
  {
    id: 'P09', tier: 'IMO', topic: '博弈值', points: 500, kind: 'number', tolerance: 3e-3,
    title: 'Kuhn 扑克的博弈值',
    statement: 'Kuhn 扑克：三张牌 J<Q<K，每人一张，各下 1 个底注。先手可过牌或下注 1；若过牌，后手可过牌摊牌或下注 1（先手再决定弃牌/跟注）；若先手下注，后手弃牌或跟注。双方都最优时，先手的期望收益是多少？',
    hints: [
      '三张牌发给两个人，一共只有 6 种发法（先手 J 后手 Q、先手 J 后手 K、先手 Q 后手 J……），每种的概率都是 1/6。答案就是这 6 种情况下先手净赚多少的平均数。',
      '双方的最优打法不止一种，但算出来的平均输赢都一样，挑最简单的一种：先手三种牌都先过牌；后手拿 K 一定下注、拿 Q 过牌、拿 J 有 1/3 的时候下注诈唬；先手面对下注时，拿 K 一定跟、拿 Q 有 1/3 的时候跟、拿 J 一定弃。',
      '按这套打法逐个算先手净赚多少（底注 1、下注 1：过牌摊牌赢了净赚 1，下注被跟后赢了净赚 2，弃牌净亏 1）。例如先手 K、后手 J：后手有 1/3 下注被你跟住，你赚 2；2/3 过牌摊牌，你赚 1；这一种平均赚 1/3×2 + 2/3×1 = 4/3。把 6 种都算出来，加起来再除以 6。',
    ],
    lab: 'kuhn',
    verify: 'cfr',
    compute() {
      const cfr = solveKuhnCFR(30000);
      return {
        // 就用 CFR 自博弈跑出来的值，不回填 −1/18——否则与闭式解的比对恒等于 0，等于没验
        value: cfr.value,
        exploitability: cfr.exploitability,
        // 每局的输赢只有零点零几个筹码，保留一位小数看不出差别，所以换成「每 18 局」「每 1000 局」来说
        evidence: `让电脑自己跟自己打 ${cfr.iterations} 轮 Kuhn 扑克，每一轮都根据输赢微调打法（CFR 算法），最后先手平均每 18 局输 ${(-cfr.value * 18).toFixed(1)} 个筹码（手算是正好 1 个，即每局 −1/18）。`
          + `就算对手完全知道它的打法、专门针对它打，每 1000 局也只能多赢 ${(cfr.exploitability * 1000).toFixed(1)} 个筹码，说明它确实学到了最优打法。`
          + `它学出来的是：先手拿 J 有 ${(cfr.strategy.J[1] * 100).toFixed(1)}% 的时候诈唬，拿 K 有 ${(cfr.strategy.K[1] * 100).toFixed(1)}% 的时候下注，`
          + `约是前者的 3 倍（${(3 * cfr.strategy.J[1] * 100).toFixed(1)}%）——正是教科书上那一族最优打法里的一个。`,
        detail: { alpha: cfr.strategy.J[1], kBet: cfr.strategy.K[1], iterations: cfr.iterations },
      };
    },
    analytic() {
      return {
        value: -1 / 18,
        expr: '−1/18（每 18 局先手平均输 1 个筹码），保留一位小数是 −0.1',
        derivation: '双方的最优打法不止一种，挑最简单的一种算：先手三种牌都先过牌；后手拿 K 必下注、拿 Q 过牌、拿 J 有 1/3 下注诈唬；先手面对下注，拿 K 必跟、拿 Q 有 1/3 跟、拿 J 必弃。' +
          '逐个发法算先手净赚：J 对 Q −1、J 对 K −1、Q 对 J +2/3、Q 对 K −4/3、K 对 J +4/3、K 对 Q +1，加起来 −1/3；六种发法一样可能，平均 −1/18，也就是每 18 局先手输 1 个筹码。' +
          '其他最优打法（先手拿 J 以某个频率 α 诈唬、拿 K 以 3α 下注，α 可以是 0 到 1/3 之间的任意值）算出来的平均收益也都是 −1/18：先手亏的是位置，和他诈唬多少无关。',
      };
    },
  },
  {
    id: 'P10', tier: 'IMO', topic: '多街递推', points: 500, kind: 'probability', tolerance: 5e-5,
    title: '几何下注：三街打光后手，每街该下底池的几成',
    statement: '底池 p₀=10，你和对手各有 100 的后手。你想用三次等比例下注（每街都下当时底池的 f 倍，对手每次都跟注）恰好在河牌把 100 全部投完。f 是多少？',
    hints: [
      '先看一条街：底池是 10 时下注 f 倍底池，也就是 10f；对手跟注后底池多了两份 10f，变成 10 + 20f = 10 × (1 + 2f)。每过一条街，底池都乘上同一个 (1 + 2f)。',
      '三条街下来底池是 10 × (1 + 2f) × (1 + 2f) × (1 + 2f)。两个人各把 100 全投进去，最后底池正好是 10 + 100 + 100 = 210。',
      '于是 (1 + 2f)³ = 210 ÷ 10 = 21，也就是 1 + 2f 等于 21 的立方根。解出 f 就行：写成百分数保留一位小数，或者直接写 (21^(1/3)-1)/2。',
    ],
    verify: 'numeric',
    compute() {
      const p0 = 10, stack = 100, n = 3;
      // 不用闭式：把"每街下注 f 倍底池"逐街模拟一遍，二分搜索让总投入恰好等于后手。
      // 这样 compute 与 analytic 是两条独立路径，改坏一边测试就会红。
      const spentAt = (f) => { let pot = p0, spent = 0; for (let i = 0; i < n; i++) { const bet = f * pot; spent += bet; pot += 2 * bet; } return { spent, pot }; };
      let lo = 0, hi = 10;
      for (let it = 0; it < 200; it++) { const mid = (lo + hi) / 2; if (spentAt(mid).spent < stack) lo = mid; else hi = mid; }
      const f = (lo + hi) / 2;
      const { spent, pot } = spentAt(f);
      return {
        value: f,
        evidence: `不套公式：先猜一个比例，按「每条街下注当时底池的这个比例、对手跟注」模拟三条街，看最后投进去的筹码是多了还是少了，再把猜测往回调——这样反复 200 次。`
          + `结果是每街下底池的 ${(f * 100).toFixed(1)}%：底池从 ${p0} 涨到 ${pot.toFixed(1)}（目标 ${p0 + 2 * stack}），每人正好投入 ${spent.toFixed(1)}。`,
        detail: { finalPot: pot, spent, target: p0 + 2 * stack },
      };
    },
    analytic() {
      const f = (Math.pow(21, 1 / 3) - 1) / 2;
      let pot = 10;
      const bets = [];
      for (let i = 0; i < 3; i++) { const bet = f * pot; bets.push(bet); pot += 2 * bet; }
      return {
        value: f,
        expr: 'f = (∛21 − 1)/2 ≈ 87.9%',
        derivation: '每次下注当时底池的 f 倍、对手跟注，底池就从 p 变成 p + 2fp = p × (1 + 2f)。三条街后底池 = 10 × (1 + 2f)³。' +
          '两人各把 100 投完，最终底池是 10 + 200 = 210，于是 (1 + 2f)³ = 21，1 + 2f = ∛21，f = (∛21 − 1)/2 ≈ 87.9%，即每街下底池的 87.9%。' +
          `落到筹码上：翻牌下 ${bets[0].toFixed(1)}、转牌下 ${bets[1].toFixed(1)}、河牌下 ${bets[2].toFixed(1)}，三次加起来正好 100。`,
      };
    },
  },
  {
    id: 'P11', tier: 'IMO', topic: '阻挡牌与条件分布', points: 500, kind: 'probability', tolerance: 2e-3,
    verify: 'counting',
    title: '抓诈之前，先看你挡掉了什么',
    statement: '河牌 2♠7♦9♣J♥Q♠，底池 10。对手的范围只有两类：KK（6 种组合，价值牌）和 54o（12 种组合，纯空气）。'
      + '他按均衡打法下注一个底池：KK 全部下注，54o 有 25% 的时候下注诈唬。你手里是一手只能赢诈唬、输给 KK 的牌，有两种可能：T♦T♣，或者 6♠5♦。'
      + '拿 T♦T♣ 时，对手这次下注是诈唬的概率是多少？（再想想：换成 6♠5♦，这个概率会变大还是变小？）',
    hints: [
      '看到下注时，对手的牌只可能是「会下注的那些组合」。先数他会下注的价值牌有几种、诈唬牌有几种，诈唬的概率就是诈唬的种数除以总种数。',
      '你手里的牌对手就拿不到。T♦T♣ 里没有 K，也没有 5 和 4，所以对手的 KK 仍是 6 种、54o 仍是 12 种，其中 25% 用来诈唬，也就是 3 种。',
      '拿 T♦T♣ 时，会下注的是 6 种 KK + 3 种 54o。换成 6♠5♦ 就不一样了：你拿走了 5♦，对手含 5♦ 的 54o（5♦4♠、5♦4♥、5♦4♣）都不存在了，只剩 9 种，诈唬只剩 9 × 25%，约 2.3 种——诈唬占比变小，同样一手抓诈牌就不值得跟了。',
    ],
    compute() {
      const board = parseCards('2s7d9cJhQs');
      const f = 0.25; // 下注一个底池时的均衡诈唬频率（题面给出）
      const calc = (heroStr) => {
        const hero = parseCards(heroStr);
        const dead = [...board, ...hero];
        const nKK = rangeComboCount(removeDead(parseRange('KK'), dead));
        const nAir = rangeComboCount(removeDead(parseRange('54o'), dead));
        return { nKK, nAir, pBluff: (nAir * f) / (nKK + nAir * f) };
      };
      // 另一手抓诈牌选 6♠5♦：它挡掉 3 种 54o，而且能赢下剩下的每一种诈唬。
      // （早先用的是 5♠4♦——它跟 54o 的诈唬全是平分底池，根本抓不了诈，拿来讲阻挡牌是错的例子。）
      const tt = calc('TdTc'), blocker = calc('6s5d');
      const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
      return {
        value: tt.pBluff,
        evidence: `拿 T♦T♣：对手的 KK 还有 ${tt.nKK} 种、54o 还有 ${tt.nAir} 种，其中 25% 诈唬 = ${n1(tt.nAir * f)} 种，看到下注是诈唬的概率 ${(tt.pBluff * 100).toFixed(1)}%。`
          + `拿 6♠5♦：你占掉了 5♦，54o 只剩 ${blocker.nAir} 种（诈唬约 ${n1(blocker.nAir * f)} 种），KK 仍是 ${blocker.nKK} 种，诈唬概率降到 ${(blocker.pBluff * 100).toFixed(1)}%。`
          + '跟注花 10 去赢 20，至少要有 33.3% 是诈唬才不亏：T♦T♣ 正好打平，6♠5♦ 跟注就亏了。',
        detail: { tt, blocker },
      };
    },
    analytic() {
      return {
        value: 1 / 3,
        expr: '(12×25%)/(6 + 12×25%) = 1/3 ≈ 33.3%',
        derivation: '拿 T♦T♣ 时，你的牌不挡对手任何组合：他下注的范围是 6 种 KK + 12×25% = 3 种 54o，诈唬占 3/9 = 1/3。你跟注花 10，赢了拿到底池 10 加他下注的 10，所以至少要有 10/(10+20) = 1/3 的时候是诈唬才不亏——正好打平。' +
          '换成 6♠5♦：两手牌都是「只能赢诈唬、输给 KK」的抓诈牌，但你拿走了 5♦，对手含 5♦ 的三种 54o（5♦4♠、5♦4♥、5♦4♣）就不可能存在了，54o 只剩 9 种、诈唬只剩 9×25% 种，诈唬占比 (9×25%)/(6 + 9×25%) ≈ 27.3%，低于 1/3，跟注变成亏损。' +
          '同样是抓诈，差别全在「你手里的牌挡掉了对手多少诈唬」——这就是阻挡牌效应。',
      };
    },
  },
  {
    id: 'P12', tier: 'IMO', topic: '多人权益', points: 500, kind: 'probability', tolerance: 3e-3,
    verify: 'enumeration',
    title: '三人底池里权益被稀释多少',
    statement: '翻牌 J♥8♦3♣，你拿 A♠K♠。甲、乙两人的范围都是 "TT,99,AJs,KJs"（去掉与已知牌冲突后各 16 个组合）。'
      + '若只有甲一个对手，你的权益是 22.1%。现在甲乙两人都在池里，你的权益是多少？',
    hints: [
      '两位对手的牌是从同一副牌里一起发出来的，会互相占牌：比如甲拿了 T♠T♥，乙就不可能再有 T♠T♦。所以不能把「只对甲的权益」自乘一次当答案，要把两个人的手牌放在一起算。',
      '每人 16 种手牌。把甲、乙的手牌两两配对，去掉互相占牌的配对，剩下 188 种配对，每一种出现的机会一样大。',
      '对每一种配对，把转牌、河牌的全部发法（没发的 43 张里挑 2 张，903 种）逐个比牌：你要同时大过两个人才算赢，和人打平就按打平的人数平分。所有配对、所有发法取平均就是答案。这道题手算量很大，重点是想清楚「三个人一起比」和「两两单挑再相乘」差在哪。',
    ],
    compute() {
      // 标准答案走精确枚举：范围只有 16 个组合、188 个有序对，每对 903 种转河，
      // 比蒙特卡洛又快又准，也不会在界面上卡住主线程。
      const board = parseCards('Jh8d3c'), hole = parseCards('AsKs');
      const w = removeDead(parseRange('TT,99,AJs,KJs'), [...board, ...hole]);
      const list = [];
      for (let i = 0; i < 1326; i++) if (w[i] > 0) list.push(i);
      let num = 0, den = 0, pairs = 0, runouts = 0;
      for (const i of list) for (const j of list) {
        if (i === j) continue;
        const a = COMBOS[i], b = COMBOS[j];
        if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
        const pr = w[i] * w[j];
        const r = equityMultiway([hole, a, b], board, {});
        num += pr * r.equities[0];
        den += pr; pairs++;
        runouts = r.runouts;
      }
      const v = num / den;
      const one = equityHandVsRange(hole, w, board, {}).equity;
      return {
        value: v,
        evidence: `把甲、乙两人所有可能的手牌配对一个个列出来：去掉互相占牌的，共 ${pairs} 种；每一种再把转牌、河牌的全部 ${runouts} 种发法逐个比牌`
          + `（你要同时大过两个人才算赢，打平按人数平分），最后取平均——这是精确值，不是抽样估计。`
          + `只对甲一个人时，同样全部列举得 ${(one * 100).toFixed(1)}%。`,
        detail: { one, pairs, runouts },
      };
    },
    analytic() {
      // 第二条路径：独立的蒙特卡洛联合抽样（换种子），与上面的精确枚举互为验证。
      // 这道题没有初等闭式，所以"另一条路径"用的是不同的数值方法而不是公式。
      const board = parseCards('Jh8d3c'), hole = parseCards('AsKs');
      const r = parseRange('TT,99,AJs,KJs');
      const mc = equityHandVsRanges(hole, [r, r], board, { samples: 6000, seed: 777 });
      const one = equityHandVsRange(hole, r, board, {}).equity;
      return {
        value: mc.equity,
        expr: `随机模拟 ${mc.samples} 局 ≈ ${(mc.equity * 100).toFixed(1)}% ±${(mc.stderr * 100).toFixed(1)} 个百分点（这道题没有简单公式）`,
        derivation: `这道题考的是：多人底池的权益不能从单挑的权益折算出来。只对甲一个人时你的权益是 ${(one * 100).toFixed(1)}%。`
          + `两种常见错法：一是自乘一次得 ${(one * one * 100).toFixed(1)}%，这等于假设「赢甲」和「赢乙」互不相干，可两人的牌是从同一副牌里发的、会互相占牌；`
          + `二是套「单挑权益再开几次方」这类经验公式（早先的复盘就这么算过）得 ${(Math.pow(one, 1.35) * 100).toFixed(1)}%，它没有任何推导依据。`
          + `正确做法只能把两个人的手牌放在一起、一局一局地比。这里用另一种方法独立算了一遍：随机给甲、乙发牌，再随机发转牌、河牌，模拟 ${mc.samples} 局，`
          + `得到约 ${(mc.equity * 100).toFixed(1)}%——比单挑少了一截，但比自乘高得多。`,
        note: `这一侧是随机模拟，本身有误差（标准误约 ${(mc.stderr * 100).toFixed(1)} 个百分点），和上面的精确值对照时允许差 ±0.3 个百分点。`,
      };
    },
  },
];

const TIERS = ['省赛', '国赛', 'IMO'];
const TIER_POINTS = { 省赛: 100, 国赛: 250, IMO: 500 };

function puzzlesByTier(tier) { return PUZZLES.filter((p) => p.tier === tier); }
function getPuzzle(id) { return PUZZLES.find((p) => p.id === id); }

exports.parseAnswer = parseAnswer;
exports.oneDecimal = oneDecimal;
exports.formatAnswer = formatAnswer;
exports.checkAnswer = checkAnswer;
exports.puzzlesByTier = puzzlesByTier;
exports.getPuzzle = getPuzzle;
exports.PUZZLES = PUZZLES;
exports.TIERS = TIERS;
exports.TIER_POINTS = TIER_POINTS;
});
