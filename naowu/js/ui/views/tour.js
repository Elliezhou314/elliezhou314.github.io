__squidDefine('src/ui/views/tour.js', function (exports) {
'use strict';
// 新手引导：第一次打开时的四步说明。只出现一次，之后可以在「闯关」里重看。
const { h } = __squidRequire('src/ui/dom.js');
const { seasonData } = __squidRequire('src/ui/progress.js');
const { switchView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');

const TOUR = [
  {
    title: '这是什么',
    body: '一个德州扑克的数学训练器。它自带一个解算内核（CFR），不联网、不调任何接口。'
      + '题目的标准答案、定理实验室的结果、训练关的策略，都是你这台设备当场算出来的。',
    tip: '唯一预先算好的是「翻前图」那几张表（树太大，现场解要几分钟），它们在界面上标了是基线图、不是翻前解。其余全部现算。',
  },
  {
    title: '从「闯关」开始',
    body: '五章、17 个关卡，从河牌往前推（河牌的树最小，几秒就能解完；翻牌要跑转牌完整树，放在后面）。关卡分两种：有唯一答案的题，和对着解算器的策略做训练。'
      + '闯关页最上面还有「限时速算」：60 秒连续心算四选一，适合先热个身。',
    tip: '训练关的星级只看 EV 损失（≤0.5% 底池三星、≤2% 两星、≤6% 一星）；谜题关看你第几次答对、有没有看提示。连击只放大分数，两种星级都不受影响。',
  },
  {
    title: '「定理实验室」是拿来验的',
    body: '左边是教科书的解析解，右边是内核当场跑出来的结果。参数可以随便改，两边会一起变。比如 Kuhn 扑克的博弈值 −1/18，页面一打开就已经用 CFR 自博弈跑出来了。',
    tip: '不信可以把迭代轮数调大再跑一次。',
  },
  {
    title: '哪些地方我们说了实话',
    body: '3 人局用采样近似，多人博弈本来就没有纳什均衡保证，界面上会标「采样近似解」。翻牌解算的补牌是抽样的，会写明。判分落在采样噪声里时会告诉你「分不清」，而不是硬给个评级。',
    tip: '完整的自查清单在 docs/评审报告.md 里，包括我们自己找出来的十几个 bug。',
  },
];

function showTour(startAt = 0) {
  let i = startAt;
  const mask = h('div', { class: 'tourmask' });
  const card = h('div', { class: 'tourcard' });
  mask.append(card);
  const render = () => {
    const t = TOUR[i];
    card.innerHTML = '';
    card.append(
      h('div', { class: 'small muted' }, `${i + 1} / ${TOUR.length}`),
      h('h2', {}, t.title),
      h('div', { style: { lineHeight: '1.9', margin: '8px 0' } }, t.body),
      h('div', { class: 'note' }, t.tip),
      h('div', { class: 'actions', style: { justifyContent: 'space-between' } },
        h('div', { class: 'row' }, h('button', { onclick: close }, '跳过'), h('button', { onclick: () => { close(); switchView('lab'); } }, '直接看解算器现场跑')),
        h('div', { class: 'row' },
          i > 0 ? h('button', { onclick: () => { i--; render(); } }, '上一步') : null,
          h('button', { class: 'primary', onclick: () => { if (i < TOUR.length - 1) { i++; render(); } else close(); } },
            i < TOUR.length - 1 ? '下一步' : '开始'))),
    );
  };
  function close() {
    mask.remove();
    const s = seasonData();
    s.seen = s.seen || {};
    s.seen.tour = true;
    store.save();
  }
  render();
  document.body.append(mask);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
}

function maybeShowTour() {
  const s = seasonData();
  if (s.seen && s.seen.tour) return;
  // 已经有进度的老用户不打扰
  if (store.data.attempts.length || Object.keys(store.data.puzzles || {}).length) { s.seen = s.seen || {}; s.seen.tour = true; store.save(); return; }
  setTimeout(() => showTour(0), 400);
}

exports.showTour = showTour;
exports.maybeShowTour = maybeShowTour;
});
