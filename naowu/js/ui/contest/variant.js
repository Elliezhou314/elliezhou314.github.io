__squidDefine('src/ui/contest/variant.js', function (exports) {
'use strict';
// 数学竞赛的「变式练习」签：选题型（或随机）→ 出一道同类型、换了数字和牌的新题 → 和固定题一样作答、要提示、看答案与推导。
// 出题、两条算法都在 train/variants/；这里只管显示和记账。
//
// 口径：
//   - 每道题有个编号（「变式 P03 · 482913」），同一个编号任何时候出的都是同一道题。
//   - 重的题型（五张牌的牌型、公共牌发 5 张）交给后台线程按「题型 + 种子」算，题面先出来，玩家可以先写答案；
//     要等的时候页面上写明在算什么。
//   - 记录只记「每个题型做了几道、第一次就答对几道」，存在进度的 variants 字段；不计入赛季分、星级、段位、成就，
//     也不碰 12 道固定题的任何记录（store.data.puzzles 一个字都不写）。
//
// 测试钩子：window.__squidVariantTest = { seeds: [种子, …] } —— 出题时按顺序取走一个种子（取完了就随机）。
// tools/uicheck 靠它在 Node 里出同一道题、知道标准答案。界面上没有任何入口能设它。
const { checkAnswer, formatAnswer } = __squidRequire('src/train/puzzles.js');
const { makeVariant, randomVariantSeed } = __squidRequire('src/train/variants/index.js');
const { recordVariant, coerceVariantRecord } = __squidRequire('src/train/variants/record.js');
const { VARIANT_TYPES, VARIANT_TYPE_IDS } = __squidRequire('src/train/variants/types.js');
const { pctText } = __squidRequire('src/train/speed.js');
const { appendTo, h, toast } = __squidRequire('src/ui/dom.js');
const { client, store } = __squidRequire('src/ui/services.js');
const { sfx } = __squidRequire('src/ui/sfx.js');
const { VERIFY_LABEL, wrongDirection } = __squidRequire('src/ui/contest/verify.js');

// pick：选的题型（'random' 或题型 id）；q：当前这道题；其余是这道题的作答状态
const vs = { pick: 'random', q: null, computed: null, pending: null, token: 0, hints: 0, attempts: 0, recorded: false, revealed: false };

/** 下一个种子：测试钩子给了就用它，否则随机 */
function nextSeed() {
  const hook = typeof window !== 'undefined' ? window.__squidVariantTest : null;
  if (hook && Array.isArray(hook.seeds) && hook.seeds.length) {
    const s = hook.seeds.shift();
    if (Number.isInteger(s)) return s;
  }
  return randomVariantSeed();
}

/** 开始算标准答案：重的交给后台线程（起不来就退回主线程），轻的在主线程算（先让题面画出来） */
function startCompute(q) {
  const token = ++vs.token;
  vs.computed = null;
  const job = q.heavy
    ? client.variant(q.type, q.seed).catch(() => q.compute())
    : new Promise((res) => setTimeout(() => res(q.compute()), 0));
  vs.pending = job.then((r) => { if (token === vs.token) vs.computed = r; return r; });
  return token;
}

function newPuzzle(root, type) {
  const t = type || (vs.pick === 'random' ? VARIANT_TYPE_IDS[Math.floor(Math.random() * VARIANT_TYPE_IDS.length)] : vs.pick);
  try {
    vs.q = makeVariant(t, nextSeed());
  } catch (e) {
    toast('出题失败：' + e.message);
    return;
  }
  Object.assign(vs, { hints: 0, attempts: 0, recorded: false, revealed: false });
  startCompute(vs.q);
  render(root);
  if (root.scrollIntoView) root.scrollIntoView({ block: 'start' });
}

/** 这道题做完了（答对或看了答案）：记一笔，一道题只记一次 */
function finish(firstTry) {
  if (vs.recorded) return;
  vs.recorded = true;
  store.data.variants = recordVariant(store.data.variants, vs.q.type, firstTry);
  store.save();
}

/** 整个签：没出题时是选题型的面板，出了题是题目 */
function variantPanel() {
  const root = h('div', { class: 'vxroot' });
  render(root);
  return root;
}

function render(root) {
  root.innerHTML = '';
  appendTo(root, vs.q ? puzzleView(root) : chooser(root));
}

// ---------------------------------------------------------------------------
// 选题型
// ---------------------------------------------------------------------------
function chooser(root) {
  const rec = coerceVariantRecord(store.data.variants);
  const chips = h('div', { class: 'vxtypes' });
  const opt = (id, label, sub) => h('button', { 'data-type': id, class: vs.pick === id ? 'on' : '', 'aria-pressed': String(vs.pick === id),
    onclick: () => { vs.pick = id; render(root); } }, label, sub ? h('span', { class: 'small muted' }, ' ' + sub) : null);
  chips.append(opt('random', '随机'));
  for (const t of VARIANT_TYPES) chips.append(opt(t.id, t.name, '原题 ' + t.from));
  const tbl = h('table', { class: 'tbl vxtbl' }, h('tr', {}, h('th', {}, '题型'), h('th', {}, '做了'), h('th', {}, '第一次就答对')));
  for (const t of VARIANT_TYPES) {
    const x = rec.byType[t.id];
    tbl.append(h('tr', { 'data-type': t.id, 'data-done': String(x.done), 'data-first': String(x.firstTry) },
      h('td', {}, t.name), h('td', { class: 'mono' }, x.done),
      h('td', { class: 'mono' }, x.done ? `${x.firstTry}（${pctText(x.firstTry / x.done)}）` : '—')));
  }
  return [
    h('div', { class: 'panel vxintro' },
      h('h2', {}, '变式练习'),
      h('div', { class: 'note' },
        '上面 12 道题做完就没了，这里能一直出同类型的新题：每个题型都是某一道固定题的同类题，数字、牌、范围每次都换。',
        '标准答案仍然是本机当场算的，另有一种算法核对，和固定题一样有三条提示、答完能看「本机是怎么算出来的」。'),
      h('div', { class: 'note' }, h('b', {}, '变式练习不计入总分、星级、赛季分、段位和成就'), '，也不改 12 道固定题的任何记录；这里只记每个题型做了几道、第一次（没看提示）就答对几道。'),
      h('div', { class: 'small muted vxreplay' },
        '每道题有一个编号，比如「变式 P03 · 482913」：同一个编号任何时候出的都是同一道题。开发者可以运行 ',
        h('span', { class: 'mono' }, 'node tools/varianttest.mjs --show P03 482913'),
        ' 在命令行重放这道题，看它的题面、提示、标准答案和两种算法。'),
      h('h3', {}, '选一个题型'),
      chips,
      h('div', { class: 'actions' }, h('button', { class: 'primary big', 'data-act': 'vx-new', onclick: () => newPuzzle(root) }, '出一道题'))),
    h('div', { class: 'panel' }, h('h2', {}, '各题型做了多少'), h('div', { class: 'scroll-x' }, tbl)),
  ];
}

// ---------------------------------------------------------------------------
// 一道题
// ---------------------------------------------------------------------------
function puzzleView(root) {
  const q = vs.q;
  const token = vs.token;
  const back = () => { vs.q = null; vs.token++; render(root); };
  const head = h('div', { class: 'row' },
    h('button', { 'data-act': 'vx-change', onclick: back }, '← 换个题型'),
    h('span', { class: 'tierbadge ' + q.tier }, q.tier),
    h('span', { class: 'muted small' }, `${q.typeName} · 原题 ${q.from}`));
  const body = h('div', { class: 'panel pbody vxbody', 'data-type': q.type, 'data-seed': String(q.seed) });
  const hintArea = h('div', {});
  const showHints = () => { hintArea.innerHTML = ''; for (let i = 0; i < vs.hints; i++) hintArea.append(h('div', { class: 'hintbox' }, '提示 ' + (i + 1) + '：' + q.hints[i])); };
  showHints();
  const hintBtn = h('button', { 'data-act': 'vx-hint', onclick: () => {
    if (vs.hints >= q.hints.length) return;
    vs.hints++; showHints();
    if (vs.hints >= q.hints.length) hintBtn.disabled = true;
  } }, '要一条提示');
  const input = h('input', { type: 'text', placeholder: q.kind === 'probability' ? '一位小数，如 35.0%' : '一位小数，如 −2.2', 'aria-label': '你的答案（保留一位小数，也可以写分数或算式）' });
  const submit = h('button', { class: 'primary', 'data-act': 'vx-submit', onclick: () => grade() }, '提交答案');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') grade(); });
  const status = h('div', { class: 'vxstatus' });
  const result = h('div', {});
  const evBox = h('div', {});
  body.append(h('div', { class: 'vxcode', 'data-code': q.code }, q.code), h('h2', {}, q.title), h('div', { class: 'statement' }, q.statement),
    hintArea, h('div', { class: 'answer-row' }, h('label', {}, '你的答案：'), input, submit, hintBtn), status, result, evBox);
  if (vs.hints >= q.hints.length) hintBtn.disabled = true;

  // 要等后台线程的题：写明在算什么，算完收起来
  if (!vs.computed && q.waitText) {
    status.append(h('div', { class: 'note vxwait' }, q.waitText));
    vs.pending.then(() => { if (token === vs.token) status.innerHTML = ''; }, () => {});
  }

  /** 拿到标准答案（这道题已经换掉了就返回 null） */
  async function answerReady() {
    try {
      const r = await vs.pending;
      return token === vs.token ? r : null;
    } catch (err) {
      result.innerHTML = '';
      result.append(h('div', { class: 'verdict wrong' }, '本机在算标准答案时出错：' + err.message));
      return null;
    }
  }

  async function grade() {
    if (!input.value.trim()) { toast('先写个答案'); return; }
    submit.disabled = true;
    try {
      const computed = await answerReady();
      if (!computed) return;
      const r = checkAnswer(q, input.value, computed);
      vs.attempts++;
      result.innerHTML = '';
      if (r.ok) {
        const first = vs.attempts === 1 && vs.hints === 0 && !vs.revealed;
        finish(first);
        sfx.right();
        result.append(h('div', { class: 'verdict right' }, h('b', {}, '✓ 答对了'), '　标准答案保留一位小数是 ' + formatAnswer(q, computed.value) + '。',
          h('div', { class: 'small muted' }, `第 ${vs.attempts} 次作答，用了 ${vs.hints} 条提示` + (first ? '：第一次就答对，记进「第一次就答对」。' : '。'))));
        reveal(computed);
        return;
      }
      sfx.wrong();
      const hintLeft = q.hints.length - vs.hints;
      const dir = r.parsed == null ? null : wrongDirection(r.parsed, computed.value);
      result.append(h('div', { class: 'verdict wrong' }, h('b', {}, '✗ 不对'), '　' + r.reason + '。',
        dir ? h('div', { class: 'small', style: { marginTop: '4px' } }, dir) : null,
        h('div', { class: 'small muted', style: { marginTop: '4px' } }, `已作答 ${vs.attempts} 次。` + (hintLeft > 0 ? `还有 ${hintLeft} 条提示没用。` : '提示已用完。')),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          hintLeft > 0 ? h('button', { class: 'primary', onclick: () => hintBtn.click() }, '要一条提示') : null,
          h('button', { 'data-act': 'vx-reveal', onclick: async () => { const c = await answerReady(); if (c) { finish(false); reveal(c); } } }, '直接看答案与推导'))));
    } finally { submit.disabled = false; }
  }

  function reveal(computed) {
    vs.revealed = true;
    const a = q.analytic();
    evBox.innerHTML = '';
    evBox.append(h('div', { class: 'evidence' },
      h('h4', {}, '标准答案（出题时本机现算，保留一位小数）'),
      h('div', {}, h('b', { class: 'mono' }, formatAnswer(q, computed.value))),
      h('div', { style: { marginTop: '6px' } }, h('b', {}, '本机是怎么算出来的：'), computed.evidence),
      h('div', { style: { marginTop: '6px' } }, h('b', {}, '可信程度：'), VERIFY_LABEL[q.verify] || '未标注'),
      h('div', { class: 'muted small', style: { marginTop: '6px' } },
        `这个数不是写好的常数，是按这道题的数字当场算的。下面是另一种算法，两边算出来的结果一致；开发者可以运行 `,
        h('span', { class: 'mono' }, `node tools/varianttest.mjs --show ${q.type} ${q.seed}`), ' 重放这道题，或者运行 ',
        h('span', { class: 'mono' }, 'node tools/varianttest.mjs'), ' 把每个题型的几百道题逐题核对。')));
    evBox.append(h('div', { class: 'derivation' },
      h('div', { style: { marginBottom: '4px' } }, h('b', {}, '另一种算法')),
      h('div', { class: 'mono', style: { marginBottom: '6px' } }, a.expr),
      h('div', {}, a.derivation)));
  }

  const actions = h('div', { class: 'actions vxactions' },
    h('button', { class: 'primary', 'data-act': 'vx-next', onclick: () => newPuzzle(root, q.type) }, '再来一道'),
    h('button', { 'data-act': 'vx-change', onclick: back }, '换个题型'));
  return [head, body, actions];
}

exports.variantPanel = variantPanel;
});
