__squidDefine('src/ui/contest/verify.js', function (exports) {
'use strict';
// 数学竞赛的固定题和变式练习共用的两段文字：可信程度怎么说、答错时往哪个方向提醒。
// 两个页面模块都从这里取（contest.js 引用 variant.js，反过来引用就成环了，所以单放一个文件）。

// 每道题的两条路径有多独立，如实标出来——有几道题的两侧本质是同一套计数逻辑写了两遍，
// 能抓笔误但抓不住概念错误，不该和「解算器现跑」混为一谈。
const VERIFY_LABEL = Object.freeze({
  solver: '最强：除了公式，还让解算器不带任何公式、从零自己打这个局面，打出来的频率和公式一致（换三种下注大小都一致）',
  cfr: '强：答案就是让电脑自己跟自己对打几万轮学出来的，再和教科书上的公式对照',
  numeric: '强：不套公式，把每一步都模拟出来，再反复试出正好满足条件的数，然后和公式对照',
  enumeration: '强：一边把所有可能一个不漏地数一遍，一边用排列组合公式算，两种方法互不依赖',
  counting: '中：两边用的都是「数组合」的思路，只是各写了一遍——能发现算错，发现不了想错',
});

/**
 * 答错时不直接给答案，但给一个方向：往哪边偏、是不是差了个常见倍数。
 * parsed 是玩家写的数（已经按题目口径换算过），truth 是标准答案；看不出方向时返回 null。
 */
function wrongDirection(parsed, truth) {
  const ratio = Number.isFinite(parsed) && Number.isFinite(truth) && truth !== 0 ? parsed / truth : null;
  if (ratio == null) return null;
  const abs = truth < 0 ? '（按绝对值说）。' : '。';
  if (Math.abs(ratio - 1) < 0.05) return '已经很接近了——检查一下保留一位小数时是不是四舍五入错了。';
  if (Math.abs(ratio - 2) < 0.02) return '正好差 2 倍：是不是同一种情况被你数了两次？比如「先拿 A 再拿 K」和「先拿 K 再拿 A」其实是同一手牌。';
  if (Math.abs(ratio - 0.5) < 0.01) return '正好差一半：是不是漏掉了一半的情况？比如只数了「先 A 后 K」，没数「先 K 后 A」。';
  if (Math.abs(ratio - 100) < 1 || Math.abs(ratio - 0.01) < 0.0001) return '差了 100 倍 —— 百分数和小数弄反了。';
  if (ratio < 0) return '正负号反了。';
  if (ratio < 0.1) return '还不到标准答案的十分之一，偏小了' + abs;
  return '你的答案是标准答案的 ' + ratio.toFixed(1) + ' 倍，' + (ratio > 1 ? '偏大了' : '偏小了') + abs;
}

exports.wrongDirection = wrongDirection;
exports.VERIFY_LABEL = VERIFY_LABEL;
});
