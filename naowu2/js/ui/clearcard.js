__squidDefine('src/ui/clearcard.js', function (exports) {
'use strict';
// 过关卡片：闯关里一关打完时弹出（训练关在 views/drill.js，谜题关在 views/contest.js）。
// 卡片只演已经算好的结果：星数由调用方从 summarizeRun / levelStars 取来，段位比较用 season.js 的 rankOf。
// 零星或给不出星时不写「过关」，照实说。
const { ALL_LEVELS, RANKS, getLevel, rankOf } = __squidRequire('src/train/season.js');
const { h } = __squidRequire('src/ui/dom.js');
const { starRow } = __squidRequire('src/ui/fx.js');
const { levelUnlocked, seasonData } = __squidRequire('src/ui/progress.js');
const { startLevel, switchView } = __squidRequire('src/ui/router.js');
const { sfx } = __squidRequire('src/ui/sfx.js');

/** 结算前后各取一次，比较段位有没有升 */
function rankNow() { return rankOf(seasonData().score); }

const rankIndex = (name) => RANKS.findIndex((r) => r.name === name);

/** 闯关顺序里的下一关；每日挑战（不在关卡表里）和最后一关返回 null */
function nextLevelOf(level) {
  const i = ALL_LEVELS.findIndex((l) => l.id === level.id);
  return i >= 0 && i + 1 < ALL_LEVELS.length ? ALL_LEVELS[i + 1] : null;
}

/**
 * @param {object} o
 * @param {object} o.level        关卡对象（ALL_LEVELS 里的那个，或每日挑战临时拼的）
 * @param {number} o.stars        这次的星数（调用方从现有逻辑取）
 * @param {boolean} o.graded      能不能给星：false 表示一个可判分的决策都没有
 * @param {string} o.why          一句话说明星数由来
 * @param {string} [o.extra]      补充一行（例如历史最好成绩）
 * @param {object} o.rankBefore   结算前的 rankOf(...)
 * @param {object} o.rankAfter    结算后的 rankOf(...)
 */
function clearCard({ level, stars, graded, why, extra, rankBefore, rankAfter }) {
  const eyebrow = !graded ? '给不出星级' : stars > 0 ? '过关' : '没拿到星';
  const card = h('div', { class: 'clear' + (stars > 0 ? '' : ' dim'), 'data-stars': String(stars) },
    h('div', { class: 'eb' }, eyebrow),
    h('div', { class: 'nm' }, level.name),
    starRow(stars, { total: 3, size: 'lg' }),
    h('div', { class: 'why' }, why),
    extra ? h('div', { class: 'why' }, extra) : null);
  // 段位只在真的升了的时候提
  if (rankBefore && rankAfter && rankIndex(rankAfter.name) > rankIndex(rankBefore.name)) {
    card.append(h('div', { class: 'rankup' }, `段位升到 ${rankAfter.name}`));
  }
  const next = level.daily ? null : nextLevelOf(level);
  const btns = h('div', { class: 'actions' });
  if (next && levelUnlocked(next)) {
    btns.append(h('button', { class: 'primary', onclick: () => startLevel(next) }, `下一关：${next.name}`));
  } else if (next) {
    btns.append(h('button', { class: 'primary', disabled: true }, '下一关未解锁'));
  }
  btns.append(h('button', { onclick: () => switchView('campaign') }, '回到闯关'));
  card.append(btns);
  if (next && !levelUnlocked(next)) {
    card.append(h('div', { class: 'why' }, `「${next.name}」要先完成 ${next.requires.map((r) => (getLevel(r) || {}).name || r).join('、')}（至少 1 星）。`));
  } else if (!next && !level.daily) {
    card.append(h('div', { class: 'why' }, '这是闯关的最后一关。'));
  }
  if (stars > 0) sfx.clear();
  return card;
}

exports.rankNow = rankNow;
exports.clearCard = clearCard;
});
