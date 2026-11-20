__squidDefine('src/train/advice/text.js', function (exports) {
'use strict';
// 「我的提高建议」给玩家看的文字：每条建议一句结论、一行依据数字、一个按钮，「怎么算的」里是详细推导。
// 数全部来自 rules.js 判出来的项目（那些数又全部是从这台设备存的记录里数出来的），这里只负责写成中文句子。
const { pctText } = __squidRequire('src/train/speed.js');
const { CONF_PCT, CONF_Z, DRILL_BAR, MIN_DRILL, MIN_SPEED, MIN_VARIANT, NEED_CAP, RATE_BAR } = __squidRequire('src/train/advice/rules.js');

const BAR_PCT = Math.round(RATE_BAR * 100);

/** 区间上限的写法：往下取一位小数（低于门槛的上限绝不会写成门槛本身） */
const upperText = (u) => (Math.floor(u * 1000) / 10).toFixed(1) + '%';
/** 平均损失的写法：两位小数；两位小数会把「刚过门槛」写成门槛本身时多写两位 */
function lossText(x, bar = DRILL_BAR) {
  const s = x.toFixed(2);
  return x > bar && Number(s) <= bar ? x.toFixed(4) : s;
}
/** 两个显示出来的数相减（读者拿页面上的两个数自己减得对上），返回「高 / 低 X 个百分点」或「一样」 */
function diffWords(a, b, digits, up, down) {
  const d = Math.round((Number(b) - Number(a)) * 10 ** digits) / 10 ** digits;
  if (d === 0) return '和那时一样';
  return `比那时${d > 0 ? up : down} ${Math.abs(d).toFixed(digits)} 个百分点`;
}
const pctNum = (ok, n) => pctText(ok / n).slice(0, -1);   // '42.9'

const KIND_NAME = Object.freeze({ drill: '训练决策', speed: '限时速算', variant: '变式练习', puzzle: '固定题' });
const labelOf = (it) => (it.kind === 'speed' ? `速算「${it.name}」` : it.kind === 'variant' ? `变式「${it.name}」` : it.kind === 'drill' ? `训练「${it.name}」` : '固定题');

/** 正确率类的「怎么算的」 */
function rateHow(it, unit) {
  return [
    `正确率 = ${it.ok} ÷ ${it.n} = ${pctText(it.rate)}。`,
    `${unit}少的时候运气影响大，所以不直接拿 ${pctText(it.rate)} 和 ${BAR_PCT}% 比，而是算「有 ${CONF_PCT}% 的把握，真实正确率不会高于多少」（统计上叫区间上限）：`
      + `上限 =（p + z²÷2n + z×√(p×(1−p)÷n + z²÷4n²)）÷（1 + z²÷n），p 是正确率 ${pctText(it.rate)}，n = ${it.n}，z = ${CONF_Z}，算出来 ${upperText(it.upper)}。`,
  ];
}

/** 一条弱项的文字：title 结论、basis 依据、why 为什么算弱、how 怎么算的、action 按钮 */
function weakText(it) {
  if (it.kind === 'speed' || it.kind === 'variant') {
    const unit = it.kind === 'speed' ? '题数' : '道数';
    return {
      title: `${labelOf(it)}偏弱`,
      basis: it.kind === 'speed' ? `答了 ${it.n} 道对 ${it.ok} 道（${pctText(it.rate)}）` : `做了 ${it.n} 道，第一次就答对 ${it.ok} 道（${pctText(it.rate)}）`,
      why: `按 ${it.n} 道留出运气的余量，正确率往好里估最多 ${upperText(it.upper)}，还不到 ${BAR_PCT}%。`,
      how: [...rateHow(it, unit), `${upperText(it.upper)} 低于 ${BAR_PCT}%，就算往好里估也不够，所以算「确实弱」。`],
      action: it.kind === 'speed' ? { label: '去练这一类', target: { kind: 'speed', type: it.key } } : { label: '出一道这类题', target: { kind: 'variant', type: it.key } },
    };
  }
  if (it.kind === 'drill') {
    const avg = lossText(it.avg);
    return {
      title: `${labelOf(it)}丢得多`,
      basis: `判过 ${it.n} 个决策，平均每个损失 ${avg}% 底池`,
      why: `超过两星线 ${DRILL_BAR}% 底池（和关卡星级同一把尺子）。`,
      how: [
        `平均 = 累计损失 ${it.sum.toFixed(2)}% ÷ ${it.n} 个 = ${avg}% 底池。只数判过分的决策（取不到 EV、解得太糙没法判分的不算），和关卡星级同一个口径。`,
        `其中 ${it.leaks} 个被判为小错或大错，累计损失 ${it.leakLoss.toFixed(2)}%，就是错题本和漏洞报告里这个场景的那一批。`,
        `门槛：平均超过 ${DRILL_BAR}% 底池，就是关卡里拿不到两星的水平。`,
      ],
      action: it.exists ? { label: '再练这个局面', target: { kind: 'drill', id: it.key } } : { label: '去特训地图', target: { kind: 'view', view: 'drill' } },
      note: it.exists ? '' : '这个场景已经不在了（多半是删掉的自定义场景），没法直接再练。',
    };
  }
  // 固定题
  const ids = (rows) => rows.map((r) => r.id).join('、');
  const parts = [];
  if (it.unsolved.length) parts.push(`没解出 ${it.unsolved.length} 道（${ids(it.unsolved)}）`);
  if (it.partial.length) parts.push(`看过提示或答了不止一次 ${it.partial.length} 道（${ids(it.partial)}）`);
  const first = it.rows[0];
  return {
    title: `固定题还差 ${it.n} 道没拿满星`,
    basis: parts.join('；'),
    why: '没看提示、第一次就答对才是满星（3 星）。',
    how: [
      ...it.rows.map((r) => `${r.id}「${r.title}」：答了 ${r.attempts} 次，看了 ${r.hints} 条提示，${r.solved ? `解出了（${r.stars} 星）` : '还没解出'}。`),
      '和错题本里「没一次做对的题」是同一份名单。解出过的题可以在题目页点「重置这道题」，不看提示再做一遍。',
    ],
    action: { label: `去做 ${first.id}`, target: { kind: 'puzzle', id: first.id } },
  };
}

/** 数据还不够的一项：一句话写明还差多少能判断 */
function pendingText(it) {
  if (it.status === 'few') {
    const line = it.kind === 'speed' ? `${labelOf(it)}只答了 ${it.n} 道，再做 ${it.need} 道就能判断。`
      : it.kind === 'variant' ? `${labelOf(it)}只做了 ${it.n} 道，再做 ${it.need} 道就能判断。`
        : `${labelOf(it)}只判过 ${it.n} 个决策，再判 ${it.need} 个就能判断。`;
    return { line, action: pendingAction(it) };
  }
  // unsure：正确率低于门槛但样本还不够确定
  const head = it.kind === 'speed' ? `${labelOf(it)} ${it.n} 道对 ${it.ok} 道（${pctText(it.rate)}）` : `${labelOf(it)}做了 ${it.n} 道、第一次就答对 ${it.ok} 道（${pctText(it.rate)}）`;
  const tail = it.need > NEED_CAP ? `离 ${BAR_PCT}% 很近，要再做 ${NEED_CAP} 道以上才分得清。` : `照这个正确率再做 ${it.need} 道就能确定。`;
  return { line: `${head}，低于 ${BAR_PCT}% 但还说不准（往好里估最多 ${upperText(it.upper)}）：${tail}`, action: pendingAction(it) };
}

function pendingAction(it) {
  if (it.kind === 'speed') return { label: '去练这一类', target: { kind: 'speed', type: it.key } };
  if (it.kind === 'variant') return { label: '出一道这类题', target: { kind: 'variant', type: it.key } };
  return it.exists ? { label: '再练这个局面', target: { kind: 'drill', id: it.key } } : { label: '去特训地图', target: { kind: 'view', view: 'drill' } };
}

/** 一类一道都没做时的那句话 */
const EMPTY_LINE = Object.freeze({
  drill: `训练决策：还没有判过分的决策。同一个场景判够 ${MIN_DRILL} 个才开始判断。`,
  speed: `限时速算：还没答过题。每个题型答够 ${MIN_SPEED} 道才开始判断。`,
  variant: `变式练习：还没做过。每个题型做够 ${MIN_VARIANT} 道才开始判断。`,
  puzzle: '固定题：还没做过。',
});

/** 没有弱项时，各类里离门槛最近的那一项（照样是真实的数） */
function keepText(it) {
  if (it.kind === 'drill') {
    const avg = lossText(it.avg);
    return { line: `${labelOf(it)}平均 ${avg}% 底池，在 ${DRILL_BAR}% 以内，是这一类里离门槛最近的（差 ${(DRILL_BAR - Number(avg)).toFixed(2)} 个百分点）。`, action: pendingAction(it) };
  }
  const r = pctNum(it.ok, it.n);
  return { line: `${labelOf(it)}${it.n} 道里${it.kind === 'speed' ? '对' : '第一次就答对'} ${it.ok} 道（${r}%），是这一类里离 ${BAR_PCT}% 最近的（高 ${(Number(r) - BAR_PCT).toFixed(1)} 个百分点）。`, action: pendingAction(it) };
}

/** 「上次最弱的那项现在怎么样了」那句话。before / now 是同一项在快照时和现在的数 */
function compareText(c) {
  const head = `上次（${c.day.slice(5)}）最弱的是${c.label}：`;
  if (c.state === 'reset') {
    const was = c.kind === 'drill' ? `判过 ${c.before.n} 个决策` : c.kind === 'puzzle' ? `还差 ${c.before.n} 道没拿满星` : `做了 ${c.before.n} 道`;
    return `${head}那时${was}，现在的记录比那时还少（多半清空或导入过进度），没法对比。`;
  }
  if (c.kind === 'speed' || c.kind === 'variant') {
    const verb = c.kind === 'speed' ? '对' : '第一次就答对';
    const was = `${c.before.n} 道${verb} ${c.before.ok} 道（${pctText(c.before.ok / c.before.n)}）`;
    if (!c.after.n) return `${head}${was}。之后还没再练这一项。`;
    return `${head}${was}。之后又做了 ${c.after.n} 道${verb} ${c.after.ok} 道（${pctText(c.after.ok / c.after.n)}），`
      + `${diffWords(pctNum(c.before.ok, c.before.n), pctNum(c.after.ok, c.after.n), 1, '高', '低')}。`;
  }
  if (c.kind === 'drill') {
    const a0 = lossText(c.before.loss / c.before.n);
    const was = `判过 ${c.before.n} 个决策，平均每个损失 ${a0}% 底池`;
    if (!c.after.n) return `${head}${was}。之后还没再练这个场景。`;
    const a1 = lossText(c.after.loss / c.after.n);
    return `${head}${was}。之后又判了 ${c.after.n} 个，平均 ${a1}% 底池，${diffWords(a0, a1, 2, '高', '低')}。`;
  }
  const was = `那时还差 ${c.before.n} 道没拿满星（其中 ${c.before.ok} 道没解出）`;
  const now = c.after.n ? `现在还差 ${c.after.n} 道（其中 ${c.after.ok} 道没解出）` : '现在都拿满星了';
  return `${head}${was}，${now}。`;
}

/** 给玩家看的判断规则（界面「判断规则」里原样显示，README 和演示脚本也照抄这几句） */
const RULE_LINES = Object.freeze([
  `速算、变式按题型算正确率：速算一类答够 ${MIN_SPEED} 道、变式一类做够 ${MIN_VARIANT} 道才判断。题数少时运气影响大，所以留出余量（统计上 ${CONF_PCT}% 把握的区间）：往好里估的上限还不到 ${BAR_PCT}%，才算「确实弱」。`,
  `训练按场景算：同一个场景判过 ${MIN_DRILL} 个决策才判断；平均每个决策的 EV 损失超过 ${DRILL_BAR}% 底池（关卡两星线，和星级同一把尺子）就算弱。`,
  '固定题：做过但没拿满三星的（没解出、看过提示、答了不止一次），还差几道就写几道。',
  '排法：先从训练决策、限时速算、变式练习、固定题这四类里各挑最弱的一项（按这个顺序），不够三项再按同样的顺序挑各类第二弱的；同一类里离门槛差得多的在前。不把不同类的数拼成一个总分。',
  '自由牌局没有标准答案（输赢里有运气），不参与排名。',
]);

exports.lossText = lossText;
exports.weakText = weakText;
exports.pendingText = pendingText;
exports.keepText = keepText;
exports.compareText = compareText;
exports.upperText = upperText;
exports.KIND_NAME = KIND_NAME;
exports.labelOf = labelOf;
exports.EMPTY_LINE = EMPTY_LINE;
exports.RULE_LINES = RULE_LINES;
});
