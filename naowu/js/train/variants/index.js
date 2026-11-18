__squidDefine('src/train/variants/index.js', function (exports) {
'use strict';
// 变式练习的出题入口：按「题型 + 种子」出一道和数学竞赛固定题同样结构的题。
//
// 出来的题和 puzzles.js 里的题同一个形状——题面 statement、三条提示 hints、compute()（本机现算）、analytic()（另一种算法）、
// 可信程度 verify、答案类型 kind——所以判分（checkAnswer）、显示（formatAnswer）和答题页面都直接复用。
//
// 同一个种子出同一道题：出题只用 core/cards.js 的 makeRng，不碰 Math.random，也不用「sort 配随机比较函数」那种
// 各家浏览器结果不一样的洗牌。玩家看到的编号是「变式 P03 · 482913」，开发者可以用
//   node tools/varianttest.mjs --show P03 482913
// 在命令行重放同一道题。tools/varianttest.mjs 对每个题型出几百道，逐题核对 compute 与 analytic，并只从题面文字里把数读出来再算一遍。
const { makeRng } = __squidRequire('src/core/cards.js');
const { BETTING_GENERATORS } = __squidRequire('src/train/variants/betting.js');
const { COUNTING_GENERATORS } = __squidRequire('src/train/variants/counting.js');
const { DRAW_GENERATORS } = __squidRequire('src/train/variants/draws.js');
const { RANGE_GENERATORS } = __squidRequire('src/train/variants/ranges.js');
const { SHOWDOWN_GENERATORS } = __squidRequire('src/train/variants/showdown.js');
const { VARIANT_TYPE_IDS, VARIANT_SEED_MAX, variantTypeOf, variantCode } = __squidRequire('src/train/variants/types.js');

const GENERATORS = { ...COUNTING_GENERATORS, ...DRAW_GENERATORS, ...RANGE_GENERATORS, ...SHOWDOWN_GENERATORS, ...BETTING_GENERATORS };

/** 种子合不合法：0 ~ 999999 的整数 */
const isVariantSeed = (seed) => Number.isInteger(seed) && seed >= 0 && seed <= VARIANT_SEED_MAX;

/**
 * 出一道题。type 是题型（P01 … P10），seed 是 0 ~ 999999 的整数。
 * 出题器偶尔凑不出合格的局面（返回 null）就接着用同一个随机数发生器再试——仍然只由种子决定。
 */
function makeVariant(type, seed) {
  const gen = GENERATORS[type];
  if (!gen) throw new Error('没有这个题型：' + type);
  if (!isVariantSeed(seed)) throw new Error('种子要是 0 到 ' + VARIANT_SEED_MAX + ' 之间的整数：' + seed);
  const meta = variantTypeOf(type);
  const rng = makeRng((seed * 2654435761 + VARIANT_TYPE_IDS.indexOf(type) * 97) >>> 0);
  for (let i = 0; i < 50; i++) {
    const q = gen(rng);
    if (!q) continue;
    return {
      ...q,
      id: `${type}-${seed}`, code: variantCode(type, seed), type, seed,
      typeName: meta.name, from: meta.from, tier: meta.tier, topic: meta.topic,
    };
  }
  throw new Error('出不了题：' + variantCode(type, seed));
}

/** 随手取一个种子（界面上点「出题」时用；测试用固定的种子） */
const randomVariantSeed = () => Math.floor(Math.random() * (VARIANT_SEED_MAX + 1));

exports.makeVariant = makeVariant;
exports.isVariantSeed = isVariantSeed;
exports.randomVariantSeed = randomVariantSeed;
});
