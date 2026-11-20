__squidDefine('src/ui/views/contest.js', function (exports) {
'use strict';
// 「数学竞赛」视图：有唯一答案的题目，标准答案由引擎现算；答案保留一位小数即可。
const { PUZZLES, TIERS, getPuzzle, checkAnswer, formatAnswer } = __squidRequire('src/train/puzzles.js');
const { ALL_LEVELS } = __squidRequire('src/train/season.js');
const { clearCard, rankNow } = __squidRequire('src/ui/clearcard.js');
const { h, $, toast } = __squidRequire('src/ui/dom.js');
const { starRow } = __squidRequire('src/ui/fx.js');
const { puzzleRecord, savePuzzle, starsForNow, starsFor, contestTotals, markDailyPuzzleSolved, levelStars, syncPuzzleLevelScores } = __squidRequire('src/ui/progress.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { client, store } = __squidRequire('src/ui/services.js');
const { sfx } = __squidRequire('src/ui/sfx.js');
const { variantPanel } = __squidRequire('src/ui/contest/variant.js');
const { VERIFY_LABEL, wrongDirection } = __squidRequire('src/ui/contest/verify.js');
const { solverState } = __squidRequire('src/ui/views/solver.js');

// variant 为真时页面显示「变式练习」，不显示 12 道固定题的列表
const contestState = { tier: null, open: null, computed: new Map(), fromCampaign: false, variant: false };

// 主线程只算轻的题；重的（要枚举几百万手牌）交给 Worker，
// 否则手机上会把页面卡住好几秒（P01 实测 6 倍降频下阻塞约 5 秒）。
const HEAVY_PUZZLES = new Set(['P01', 'P02', 'P03', 'P12']);

async function computedFor(p, onWait) {
  if (contestState.computed.has(p.id)) return contestState.computed.get(p.id);
  let r;
  if (HEAVY_PUZZLES.has(p.id)) {
    if (onWait) onWait();
    try {
      r = await client.puzzle(p.id);
    } catch (e) {
      r = p.compute();   // Worker 起不来就退回主线程，宁可卡一下也要算出来
    }
  } else {
    r = p.compute();
  }
  contestState.computed.set(p.id, r);
  return r;
}

function buildContestView() {
  const v = $('#view-contest');
  v.innerHTML = '';
  if (contestState.open) { renderPuzzle(v, contestState.open); return; }

  const t = contestTotals();
  v.append(h('div', { class: 'panel' },
    h('h2', {}, '数学竞赛'),
    h('div', { class: 'scoreline' },
      h('span', {}, '总分 ', h('b', {}, t.score)),
      h('span', {}, '星级 ', h('b', {}, t.stars + '/' + t.maxStars)),
      h('span', {}, '已解 ', h('b', {}, t.solved + '/' + t.total)),
    ),
    h('div', { class: 'note' },
      '每道题都有唯一的答案。答案不是题库里提前写好的，而是你打开题目时本机当场算出来的——',
      '答完可以看它具体做了什么：把多少种牌面一个个数了一遍，或者让电脑自己跟自己打了多少轮。',
      '每道题还另有一种算法（大多是手算公式），两边算出来的数必须一样。'),
    h('div', { class: 'note' },
      h('b', {}, '答案保留一位小数即可'),
      '：概率写成百分数（如 35.0%），其余照题面的单位写（如 −2.2）；分数、算式也认，按它的值四舍五入后比对。'),
  ));

  const tiers = h('div', { class: 'tiers' });
  const listOn = (tier) => !contestState.variant && contestState.tier === tier;
  tiers.append(h('button', { class: listOn(null) ? 'on' : '', onclick: () => { contestState.tier = null; contestState.variant = false; buildContestView(); } }, '全部'));
  for (const tier of TIERS) {
    const n = PUZZLES.filter((p) => p.tier === tier).length;
    tiers.append(h('button', { class: listOn(tier) ? 'on' : '', onclick: () => { contestState.tier = tier; contestState.variant = false; buildContestView(); } }, tier + ' (' + n + ')'));
  }
  // 变式练习：和三档题目列表并列的一个签，点进去出同类型、换了数字和牌的新题
  tiers.append(h('button', { class: 'vxtab' + (contestState.variant ? ' on' : ''), 'data-act': 'variant', onclick: () => { contestState.variant = true; buildContestView(); } }, '变式练习'));
  v.append(tiers);
  if (contestState.variant) { v.append(variantPanel()); return; }

  const list = h('div', { class: 'plist' });
  for (const p of PUZZLES) {
    if (contestState.tier && p.tier !== contestState.tier) continue;
    const rec = puzzleRecord(p.id);
    const st = starsFor(rec);
    list.append(h('div', { class: 'pcard' + (rec && rec.solved ? ' solved' : ''), 'data-pid': p.id, onclick: () => { contestState.open = p.id; contestState.fromCampaign = false; buildContestView(); } },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('span', { class: 'pid' }, p.id),
        h('span', { class: 'tierbadge ' + p.tier }, p.tier)),
      h('div', { class: 'ptitle' }, p.title),
      h('div', { class: 'small muted' }, p.topic + ' · ' + p.points + ' 分'
        + (p.verify === 'solver' ? ' · 解算器验证' : p.verify === 'cfr' ? ' · CFR 验证' : '')),
      st ? starRow(st, { total: 3, size: 'sm', animate: false }) : null,
    ));
  }
  v.append(list);
}

function renderPuzzle(v, id) {
  const p = getPuzzle(id);
  const rec = puzzleRecord(id) || { attempts: 0, solved: false, usedHints: 0, exact: false };
  let computed = null;
  v.append(h('div', { class: 'row' },
    h('button', { onclick: () => { contestState.open = null; buildContestView(); } }, '← 返回题目列表'),
    contestState.fromCampaign ? h('button', { class: 'primary', onclick: () => { contestState.open = null; contestState.fromCampaign = false; switchView('campaign'); } }, '回到闯关 →') : null,
    h('span', { class: 'tierbadge ' + p.tier }, p.tier),
    h('span', { class: 'muted small' }, p.id + ' · ' + p.topic + ' · ' + p.points + ' 分')));

  const body = h('div', { class: 'panel pbody' });
  v.append(body);
  body.append(h('h2', {}, p.title), h('div', { class: 'statement' }, p.statement));

  const hintArea = h('div', {});
  let hintIdx = rec.usedHints || 0;
  const showHints = () => {
    hintArea.innerHTML = '';
    for (let i = 0; i < hintIdx; i++) hintArea.append(h('div', { class: 'hintbox' }, '提示 ' + (i + 1) + '：' + p.hints[i]));
  };
  showHints();
  const resetBtn = h('button', {
    onclick: () => {
      if (!rec.attempts) { toast('这道题还没作答过'); return; }
      // 清掉这道题的作答记录，星级也一并清掉——重来就要从零算，不能既保留高星又重刷
      delete store.data.puzzles[id];
      contestState.computed.delete(id);
      toast('已重置这道题，星级归零，可以重新挑战一次答对');
      buildContestView();
    },
    title: '清空这道题的作答次数、提示与星级，重新挑战',
  }, '重置这道题');
  const hintBtn = h('button', {
    onclick: () => {
      if (hintIdx >= p.hints.length) return;
      hintIdx++; rec.usedHints = hintIdx; savePuzzle(id, rec); showHints();
      if (hintIdx >= p.hints.length) hintBtn.disabled = true;
    },
  }, '要一条提示');
  if (hintIdx >= p.hints.length) hintBtn.disabled = true;

  const input = h('input', { type: 'text', placeholder: '保留一位小数，如 35.0%；也可以写分数或算式，如 378/1081', value: rec.lastAnswer || '' });
  const result = h('div', {});
  const evBox = h('div', {});
  const submit = h('button', { class: 'primary', onclick: () => grade() }, '提交答案');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') grade(); });
  body.append(hintArea, h('div', { class: 'answer-row' }, h('label', {}, '你的答案：'), input, submit, hintBtn, rec.attempts ? resetBtn : null), result, evBox);

  let computing = false;
  async function ensureComputed() {
    if (computed) return true;
    if (computing) return false;
    computing = true;
    try {
      computed = await computedFor(p, () => {
        result.innerHTML = '';
        result.append(h('div', { class: 'note' }, '解算内核正在枚举，算标准答案…（这道题要枚举几百万种牌面，手机上要等一两秒）'));
      });
      return true;
    } catch (err) {
      result.innerHTML = '';
      result.append(h('div', { class: 'verdict wrong' }, '引擎在算标准答案时出错：' + err.message));
      return false;
    } finally { computing = false; }
  }

  async function grade() {
    if (!input.value.trim()) { toast('先写个答案'); return; }
    submit.disabled = true;
    try {
      if (!(await ensureComputed())) return;
    let r;
    try { r = checkAnswer(p, input.value, computed); } catch (err) {
      result.innerHTML = '';
      result.append(h('div', { class: 'verdict wrong' }, '这个答案没看懂：' + err.message));
      return;
    }
    const wasSolved = !!rec.solved;
    rec.attempts = (rec.attempts || 0) + 1;
    rec.lastAnswer = input.value;
    if (r.ok) {
      rec.solved = true; rec.exact = r.exact;
      rec.bestStars = Math.max(rec.bestStars || 0, starsForNow(rec));
      markDailyPuzzleSolved(id);
    }
    savePuzzle(id, rec);
    result.innerHTML = '';
    if (r.ok) {
      const n = starsFor(rec);
      sfx.right();
      result.append(h('div', { class: 'verdict right' },
        h('b', {}, '✓ 答对了'),
        '　标准答案保留一位小数是 ' + formatAnswer(p, computed.value) + '。',
        h('div', { class: 'small muted gotstars' }, '第 ' + rec.attempts + ' 次作答，用了 ' + (rec.usedHints || 0) + ' 条提示 → ' + n + ' 星', starRow(n))));
      // 这道题是某个谜题关的最后一道：这一关打完了，弹过关卡片
      if (!wasSolved) for (const card of levelClearCards(id)) result.append(card);
      revealAll();
    } else {
      const hintLeft = p.hints.length - (rec.usedHints || 0);
      const dir = wrongDirection(r.parsed, computed.value);
      result.append(h('div', { class: 'verdict wrong' },
        h('b', {}, '✗ 不对'), '　' + r.reason + '。',
        // 不直接给答案，但给一个方向：往哪边偏、是不是差了个常见倍数
        dir ? h('div', { class: 'small', style: { marginTop: '4px' } }, dir) : null,
        h('div', { class: 'small muted', style: { marginTop: '4px' } },
          '已作答 ' + rec.attempts + ' 次。' + (hintLeft > 0 ? `还有 ${hintLeft} 条提示没用。` : '提示已用完。')),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          hintLeft > 0 ? h('button', { class: 'primary', onclick: () => hintBtn.click() }, '要一条提示') : null,
          h('button', { onclick: () => revealAll() }, '直接看答案与推导'))));
      }
    } finally { submit.disabled = false; }
  }

  async function revealAll() {
    if (!(await ensureComputed())) return;
    const a = p.analytic();
    evBox.innerHTML = '';
    evBox.append(h('div', { class: 'evidence' },
      h('h4', {}, '标准答案（打开题目时本机现算，保留一位小数）'),
      h('div', {}, h('b', { class: 'mono' }, formatAnswer(p, computed.value))),
      computed.evidence ? h('div', { style: { marginTop: '6px' } }, h('b', {}, '本机是怎么算出来的：'), computed.evidence) : null,
      h('div', { style: { marginTop: '6px' } }, h('b', {}, '可信程度：'), VERIFY_LABEL[p.verify] || '未标注'),
      h('div', { class: 'muted small', style: { marginTop: '6px' } },
        '这个数不是题库里写好的常数，每次打开题目都重新算。下面是另一种算法，两边算出来的结果一致；开发者可以运行 ',
        h('span', { class: 'mono' }, 'node tools/puzzletest.mjs'),
        ' 逐题核对。')));
    evBox.append(h('div', { class: 'derivation' },
      h('div', { style: { marginBottom: '4px' } }, h('b', {}, '另一种算法')),
      h('div', { class: 'mono', style: { marginBottom: '6px' } }, a.expr),
      h('div', {}, a.derivation),
      a.note ? h('div', { class: 'muted small', style: { marginTop: '6px' } }, a.note) : null));
    if (p.lab === 'kuhn') {
      evBox.append(h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { onclick: () => switchView('lab') }, '到定理实验室现场跑 CFR →')));
    }
    if (p.solver) {
      evBox.append(h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', {
          onclick: () => { solverState.applySpec(p.solver.spec); switchView('solver'); toast('已载入这道题的局面，点"开始解算"'); },
        }, '到解算器里验证这个局面 →')));
    }
  }

  if (rec.solved) revealAll();
}

/** 一道题的作答情况，用存档里的原始记录说话 */
function puzzleLine(pid) {
  const r = puzzleRecord(pid) || {};
  const now = starsForNow(r), best = starsFor(r);
  return `${pid} 作答 ${r.attempts || 0} 次、${r.usedHints ? `用了 ${r.usedHints} 条提示` : '没看提示'} → ${best} 星` + (best > now ? '（历史最好）' : '');
}

/**
 * 刚答对的这道题让哪些谜题关整关完成了，每关一张过关卡片。
 * 星数取 levelStars（各题星数的平均、向下取整），赛季分照闯关页的做法用 syncPuzzleLevelScores 补进去，
 * 前后各取一次段位，真升了卡片上才写。
 */
function levelClearCards(pid) {
  const out = [];
  for (const level of ALL_LEVELS) {
    if (level.kind !== 'puzzle' || !level.puzzles.includes(pid)) continue;
    if (!level.puzzles.every((q) => (puzzleRecord(q) || {}).solved)) continue;
    const rankBefore = rankNow();
    syncPuzzleLevelScores();
    const stars = levelStars(level);
    const lines = level.puzzles.map(puzzleLine).join('；');
    const why = level.puzzles.length > 1 ? `${lines}。整关取各题星数的平均、向下取整 → ${stars} 星` : lines;
    out.push(clearCard({ level, stars, graded: true, why, rankBefore, rankAfter: rankNow() }));
  }
  return out;
}

exports.buildContestView = buildContestView;
exports.contestState = contestState;
});
