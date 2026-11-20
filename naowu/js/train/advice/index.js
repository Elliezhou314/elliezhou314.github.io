__squidDefine('src/train/advice/index.js', function (exports) {
'use strict';
// 「我的提高建议」：吃这台设备存的原始记录（进度对象），给出「最该练的 3 项」、数据还不够的项目、上次最弱那项的对比。纯函数，不碰 DOM。
//
// 规则在 rules.js（门槛、样本下限、区间上限），文字在 text.js，快照在 snapshot.js。
// 每个数都是从记录里数出来的：速算看 speed.byType、变式看 variants.byType、训练看 attempts（和漏洞报告、错题本同一批）、
// 固定题看 puzzles（和错题本「没一次做对」同一份名单）。自由牌局（hands）没有标准答案，只报手数、不参与。
// tools/advicetest.mjs 用另写的笨办法把每个数重算一遍，并和错题本、漏洞报告、速算最弱题型这些现有函数对账。
const { isGradedDecision, isPreflopCard } = __squidRequire('src/train/notebook.js');
const { PUZZLES } = __squidRequire('src/train/puzzles.js');
const { CHAPTERS, dayKey } = __squidRequire('src/train/season.js');
const { SCENARIOS } = __squidRequire('src/train/training.js');
const { VARIANT_TYPES } = __squidRequire('src/train/variants/types.js');
const { byGap, drillItems, puzzleItem, speedItems, variantItems } = __squidRequire('src/train/advice/rules.js');
const { baselineSnap } = __squidRequire('src/train/advice/snapshot.js');
const { compareText, EMPTY_LINE, keepText, labelOf, pendingText, weakText } = __squidRequire('src/train/advice/text.js');

/** 四类的先后：排前三时按这个顺序轮流挑（见 text.js 的 RULE_LINES） */
const CATEGORY_ORDER = Object.freeze(['drill', 'speed', 'variant', 'puzzle']);
const TOP_N = 3;

/** 各类判出来的全部项目 */
function judgeAll(progress, scenarios) {
  const d = progress || {};
  return {
    drill: drillItems(d.attempts, scenarios),
    speed: speedItems(d.speed),
    variant: variantItems(d.variants),
    puzzle: [puzzleItem(d.puzzles, PUZZLES)],
  };
}

/** 前 N 项：每一类先挑最弱的一项（按 CATEGORY_ORDER），不够再挑各类第二弱的……同一类里按 byGap 排 */
function pickTop(cats, n = TOP_N) {
  const weak = {};
  for (const k of CATEGORY_ORDER) weak[k] = cats[k].filter((x) => x.status === 'weak').sort(byGap);
  const out = [];
  for (let round = 0; out.length < n; round++) {
    let any = false;
    for (const k of CATEGORY_ORDER) {
      if (out.length >= n) break;
      if (weak[k][round]) { out.push(weak[k][round]); any = true; }
    }
    if (!any) break;
  }
  return out;
}

/** 入门路径：完全没有记录时给的三件事（通用的，不是根据记录算的；名字和题号从关卡、题型清单里取） */
function starterPath() {
  const first = CHAPTERS[0].levels[0];
  const p = PUZZLES.find((x) => x.id === first.puzzles[0]);
  const vt = VARIANT_TYPES.find((t) => t.from.split('、').includes(p.id)) || VARIANT_TYPES[0];
  return [
    { title: '先打一局 60 秒速算', basis: '七类心算题混着出，打完看哪一类错得多。', action: { label: '去速算', target: { kind: 'view', view: 'speed' } } },
    { title: `做闯关第一关「${first.name}」`, basis: `两道题：${first.puzzles.map((id) => `${id}「${PUZZLES.find((x) => x.id === id).title}」`).join('、')}。`, action: { label: `去做 ${p.id}`, target: { kind: 'puzzle', id: p.id } } },
    { title: `出一道变式练习「${vt.name}」`, basis: `和 ${p.id} 同一类，换了牌和数字。`, action: { label: '出一道这类题', target: { kind: 'variant', type: vt.id } } },
  ];
}

/** 某一项现在的数（对比用）：按快照记的类别和键重新判一遍；这一项已经不存在（题型改名、场景记录全没了）给 null */
function currentOf(cats, kind, key) {
  return (cats[kind] || []).find((x) => x.key === key) || null;
}

/** 「上次最弱的那项现在怎么样了」：快照时的数对现在的数 */
function compareSnapshot(snap, cats, attempts) {
  if (!snap) return null;
  const cur = currentOf(cats, snap.kind, snap.key);
  const label = labelOf({ kind: snap.kind, name: cur ? cur.name : snap.name });
  const c = { day: snap.day, kind: snap.kind, key: snap.key, label, before: { n: snap.n, ok: snap.ok, loss: snap.loss }, after: { n: 0, ok: 0, loss: 0 }, state: 'idle' };
  if (snap.kind === 'speed' || snap.kind === 'variant') {
    const n = cur ? cur.n : 0, ok = cur ? cur.ok : 0;
    if (n < snap.n || ok < snap.ok || (n - ok) < (snap.n - snap.ok)) c.state = 'reset';
    else {
      c.after = { n: n - snap.n, ok: ok - snap.ok };
      if (c.after.n) { const r0 = snap.ok / snap.n, r1 = c.after.ok / c.after.n; c.state = r1 > r0 ? 'better' : r1 < r0 ? 'worse' : 'same'; }
    }
  } else if (snap.kind === 'drill') {
    // 之后：快照时间之后写入的、同一场景、判过分的决策（按记录里的时间）
    let n = 0, loss = 0;
    for (const a of Array.isArray(attempts) ? attempts : []) {
      if (!isGradedDecision(a) || String(a.scenarioId) !== snap.key || !(a.time > snap.time)) continue;
      n++; loss += a.evLossPct;
    }
    if ((cur ? cur.n : 0) < snap.n && !n) c.state = 'reset';
    else {
      c.after = { n, ok: 0, loss };
      if (n) { const a0 = snap.loss / snap.n, a1 = loss / n; c.state = a1 < a0 ? 'better' : a1 > a0 ? 'worse' : 'same'; }
    }
  } else {
    if (!cur || cur.status === 'none') c.state = 'reset';   // 一道作答记录都没有了：清空或导入过
    else {
      const now = cur.status === 'weak' ? { n: cur.n, ok: cur.ok } : { n: 0, ok: 0 };
      c.after = now;
      c.state = now.n < snap.n ? 'better' : now.n > snap.n ? 'worse' : 'same';
    }
  }
  c.text = compareText(c);
  return c;
}

/** 快照：最弱那一项此刻的数（没有弱项给 null） */
function snapOf(item, now) {
  if (!item) return null;
  const s = { day: dayKey(now), time: now, kind: item.kind, key: item.key, name: item.name, n: item.n, ok: item.ok, loss: null };
  if (item.kind === 'drill') { s.ok = item.leaks; s.loss = item.sum; }
  return s;
}

/**
 * 整份建议。progress 是（已整形的）进度对象；opts.now 现在的时间（毫秒），opts.scenarios 场景清单（默认内置 + 进度里的自定义场景）。
 * status：
 *   start    一条可判的记录都没有（速算、变式、固定题、训练决策全空）→ 给通用的入门路径
 *   pending  有记录，但没有一项够下结论
 *   none     有项目下了结论，但没有弱项 → 「没有明显的弱项」和保持建议
 *   weak     有弱项 → 前三项
 */
function adviceReport(progress, opts = {}) {
  const d = progress || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const scenarios = opts.scenarios || [...SCENARIOS, ...(Array.isArray(d.customScenarios) ? d.customScenarios : [])];
  const cats = judgeAll(d, scenarios);
  const all = CATEGORY_ORDER.flatMap((k) => cats[k]);
  const top = pickTop(cats).map((it) => ({ ...it, text: weakText(it) }));
  const pending = all.filter((x) => x.status === 'few' || x.status === 'unsure')
    .sort((a, b) => (a.need - b.need) || (CATEGORY_ORDER.indexOf(a.kind) - CATEGORY_ORDER.indexOf(b.kind)) || (a.key < b.key ? -1 : 1))
    .map((it) => ({ ...it, text: pendingText(it) }));
  const judged = all.filter((x) => x.status === 'weak' || x.status === 'ok');
  const hasData = all.some((x) => x.status !== 'none');
  const status = !hasData ? 'start' : top.length ? 'weak' : judged.length ? 'none' : 'pending';
  // 没有弱项时的保持建议：每一类里过了门槛、离门槛最近的一项（固定题过了门槛就是都满星，没有「最近」可言）
  const keep = status === 'none' ? CATEGORY_ORDER.filter((k) => k !== 'puzzle').map((k) => cats[k].filter((x) => x.status === 'ok').sort((a, b) => a.margin - b.margin)[0])
    .filter(Boolean).map((it) => ({ ...it, text: keepText(it) })) : [];
  const empty = CATEGORY_ORDER.filter((k) => cats[k].every((x) => x.status === 'none')).map((k) => ({ kind: k, line: EMPTY_LINE[k] }));
  const attempts = Array.isArray(d.attempts) ? d.attempts : [];
  const today = dayKey(now);
  const snap = baselineSnap(d.advice, today);
  return {
    today, status, top, pending, keep, empty, cats,
    hands: Array.isArray(d.hands) ? d.hands.length : 0,
    preflop: attempts.filter(isPreflopCard).length,
    starter: status === 'start' ? starterPath() : null,
    compare: compareSnapshot(snap, cats, attempts),
    snap: snapOf(top[0], now),
  };
}

/** 闯关页顶上那一行：最弱的一项（或者「没有明显的弱项」「刚开始」），和一个直达按钮 */
function adviceHeadline(rep) {
  if (rep.status === 'weak') { const t = rep.top[0].text; return { line: `最该练：${t.title}（${t.basis}）`, action: t.action }; }
  if (rep.status === 'start') { const s = rep.starter[0]; return { line: `刚开始：${s.title}。`, action: s.action }; }
  if (rep.status === 'none') return { line: '没有明显的弱项。', action: rep.keep[0] ? rep.keep[0].text.action : null };
  const p = rep.pending[0];
  return { line: `数据还不够：${p.text.line}`, action: p.text.action };
}

exports.judgeAll = judgeAll;
exports.pickTop = pickTop;
exports.starterPath = starterPath;
exports.compareSnapshot = compareSnapshot;
exports.snapOf = snapOf;
exports.adviceReport = adviceReport;
exports.adviceHeadline = adviceHeadline;
exports.CATEGORY_ORDER = CATEGORY_ORDER;
exports.TOP_N = TOP_N;
});
