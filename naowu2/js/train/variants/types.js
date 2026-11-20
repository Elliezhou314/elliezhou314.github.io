__squidDefine('src/train/variants/types.js', function (exports) {
'use strict';
// 变式练习的题型清单：只有名字和出处，不带出题代码（进度整形、错题本只要这张表，不必把出题器整个拉进来）。
//
// 每个题型都是数学竞赛里一道固定题的同类题：数字、牌、范围每次换，答案仍由本机现算，另有一条独立的算法核对。
// id 沿用原题的题号（P05 同时是 P11 的变式，P06 同时是 P07 的变式），玩家看到的编号是「变式 P03 · 482913」。

const VARIANT_TYPES = Object.freeze([
  { id: 'P01', name: '五张牌是某种牌型', from: 'P01', tier: '省赛', topic: '组合计数' },
  { id: 'P02', name: '公共牌命中的概率', from: 'P02', tier: '省赛', topic: '条件概率' },
  { id: 'P03', name: '听牌命中的概率', from: 'P03', tier: '省赛', topic: '条件概率' },
  { id: 'P04', name: '阻挡牌：对手还剩几种组合', from: 'P04', tier: '省赛', topic: '组合计数' },
  { id: 'P05', name: '看到下注后是诈唬的概率', from: 'P05、P11', tier: '国赛', topic: '贝叶斯' },
  { id: 'P06', name: '诈唬占几成、最少防守多少', from: 'P06、P07', tier: '国赛', topic: '均衡解析解' },
  { id: 'P08', name: '数补牌再算期望值', from: 'P08', tier: '国赛', topic: '期望值' },
  { id: 'P10', name: '几何下注', from: 'P10', tier: 'IMO', topic: '多街递推' },
].map(Object.freeze));

const VARIANT_TYPE_IDS = Object.freeze(VARIANT_TYPES.map((t) => t.id));

const variantTypeOf = (id) => VARIANT_TYPES.find((t) => t.id === id) || null;

/** 种子的范围：0 ~ 999999，六位以内，编号好念、好抄 */
const VARIANT_SEED_MAX = 999999;

/** 给玩家看的编号：「变式 P03 · 482913」 */
const variantCode = (type, seed) => `变式 ${type} · ${seed}`;

exports.VARIANT_TYPES = VARIANT_TYPES;
exports.VARIANT_TYPE_IDS = VARIANT_TYPE_IDS;
exports.variantTypeOf = variantTypeOf;
exports.VARIANT_SEED_MAX = VARIANT_SEED_MAX;
exports.variantCode = variantCode;
});
