__squidDefine('src/ui/table.js', function (exports) {
'use strict';
// 牌桌组件：纯显示，不认识牌局引擎。调用方（自由牌局页面）每次把「此刻桌上应该是什么样」
// 写成一个普通对象交给 show()，组件和上一次的样子比一比，把差别用动画演出来，
// 最后一步总是把这个对象原样画到位——所以任何一个静止画面上的数字都只来自调用方给的对象，
// 动画自己不记账。
//
// 交给 show() 的对象：
//   key      每手牌唯一；变了就是新的一手（重建座位、播发牌）
//   hero     自己的座位号（固定画在下方正中，其余座位按椭圆顺时针排开）
//   button   庄家座位号；acting 正在行动的座位号（-1 表示没人）
//   board    公共牌编码数组；pot 桌子中间「已经收进池里」的数
//   seats    [{ name, pos, stack, bet, cards, folded, win }]：bet 是摆在面前的本街下注；
//            cards 为 null 表示背面朝上（对手摊牌前不把真牌放进页面）
//   say      { seat, text } 一次性的动作气泡（可以没有）
//   awards   [{ amount, winners:[座位号] }] 结束时每个池（主池、边池）分给谁；done 这手已经结束
//
// 尺寸：用 ResizeObserver 量牌桌宽度，把牌宽等写成像素 CSS 变量，窄于 NARROW 像素时加 narrow 类。
// 不用容器查询和 cqw（旧安卓内核不认），也不用独立的 translate/rotate/scale 属性：
// 居中定位的 transform 写在外层元素上，动画只动内层，互不覆盖。
const { placeBets } = __squidRequire('src/ui/betspot.js');
const { placeBubble } = __squidRequire('src/ui/bubble.js');
const { cardEl, setCardFace } = __squidRequire('src/ui/cards.js');
const { f1 } = __squidRequire('src/ui/dom.js');
const { centerIn, holeRect, rectOf } = __squidRequire('src/ui/feltrect.js');
const { sfx } = __squidRequire('src/ui/sfx.js');

const NARROW = 560;      // 牌桌宽度低于这个像素就换竖椭圆布局、收起位置名
const EDGE = 4;          // 座位、筹码离毡面边缘至少留这么多像素
const LONGEST = 599.5;   // 起始后手 100、6 人桌全桌 600：下注、底池、后手最长显示成「599.5」

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一摞筹码：按 100/25/5/1 拆，最多 5 枚（只是示意，金额以旁边的数字为准） */
function chipsHtml(v) {
  const out = [];
  let left = Math.round(v);
  for (const d of [100, 25, 5, 1]) { let k = 0; while (left >= d && k < 3 && out.length < 5) { out.push(`<i class="chip c${d}"></i>`); left -= d; k++; } }
  if (!out.length) out.push('<i class="chip c1"></i>');
  return '<span class="chips">' + out.join('') + '</span>';
}

function createTable(root) {
  root.classList.add('ptable');
  root.innerHTML = '';
  const rail = el('div', 'rail'), felt = el('div', 'felt');
  rail.append(felt); root.append(rail);
  const mark = el('div', 'mark', '脑雾克星');
  const boardEl = el('div', 'board');
  const potEl = el('div', 'pot', '<span class="pot-in"><span class="chips"></span><span class="lbl">底池</span><b>0</b></span>');
  const dbtn = el('div', 'dbtn', '<span>D</span>');
  // 量尺：看不见的三块样板，按实际会出现的最长一档（599.5）量下注标签、底池标签、后手数字有多大，给下注找位置用
  const probe = el('div', 'probe', `<span class="pbet"><span class="bet-in">${chipsHtml(LONGEST)}<b>${f1(LONGEST)}</b></span></span>`
    + `<span class="ppot"><span class="pot-in">${chipsHtml(LONGEST)}<span class="lbl">本手底池</span><b>${f1(LONGEST)}</b></span></span><span class="stk">${f1(LONGEST)}</span>`);
  felt.append(mark, boardEl, potEl, dbtn, probe);
  for (let i = 0; i < 5; i++) boardEl.append(el('span', 'slot'));
  potEl.style.visibility = 'hidden';
  dbtn.hidden = true;

  const T = { gen: 0, last: null, running: false, seats: [], anims: new Set(), temps: new Set(), ro: null };

  // ---------------------------------------------------------------- 静态画法
  function build(view) {
    for (const s of T.seats) { clearTimeout(s.sayTimer); s.el.remove(); s.bet.remove(); s.say.remove(); }
    T.seats = view.seats.map((cfg, i) => {
      const se = el('div', 'seat' + (i === view.hero ? ' me' : ''));
      se.innerHTML = '<div class="plate"><span class="av"></span><span class="who"><b></b><i></i></span><span class="stk"></span></div><div class="hole"></div>';
      const bet = el('div', 'bet', '<span class="bet-in"><span class="chips"></span><b></b></span>');
      bet.hidden = true;
      felt.append(se, bet);
      return { el: se, hole: se.querySelector('.hole'), plate: se.querySelector('.plate'), say: null, stk: se.querySelector('.stk'), bet, betAt: null, cards: [], sayTimer: 0 };
    });
    // 动作气泡是毡面上的独立一块（不在座位里面），摆在所有座位和下注后面画，位置由 placeSay 现算
    for (const s of T.seats) { s.say = el('div', 'say'); felt.append(s.say); }
    boardEl.innerHTML = '';
    for (let i = 0; i < 5; i++) boardEl.append(el('span', 'slot'));
  }

  /** 发一张手牌到座位 i（背面朝上），返回那张牌 */
  function addHoleCard(i) {
    const s = T.seats[i];
    const wrap = el('span', 'hc'), c = cardEl(null, true);
    wrap.append(c); s.hole.append(wrap); s.cards.push(c);
    return c;
  }

  function setFace(c, code) {
    if (code === null || code === undefined) { c.classList.add('down'); setCardFace(c, null); return; }
    setCardFace(c, code); c.classList.remove('down');
  }

  function setBet(i, v) {
    const b = T.seats[i].bet;
    if (!(v > 0)) { b.hidden = true; b.querySelector('b').textContent = ''; return; }
    b.querySelector('.chips').outerHTML = chipsHtml(v);
    b.querySelector('b').textContent = f1(v);
    b.hidden = false;
  }

  function setPot(v, done) {
    potEl.querySelector('.chips').outerHTML = chipsHtml(v || 1);
    potEl.querySelector('b').textContent = f1(v);
    potEl.querySelector('.lbl').textContent = done ? '本手底池' : '底池';
    potEl.style.visibility = v > 0 ? 'visible' : 'hidden';
    potEl.classList.toggle('done', !!done);
  }

  function setBoard(board, upTo) {
    const n = upTo === undefined ? board.length : upTo;
    const slots = boardEl.children;
    for (let i = 0; i < 5; i++) {
      const want = i < n;
      const cur = slots[i];
      if (want && cur.classList.contains('pc')) { setFace(cur, board[i]); continue; }
      if (want) { cur.replaceWith(cardEl(board[i])); continue; }
      if (!cur.classList.contains('slot')) cur.replaceWith(el('span', 'slot'));
    }
  }

  /** 名字、位置、后手、类名：这些不需要动画，随时可以直接写 */
  function syncPlates(view, keepStacks) {
    view.seats.forEach((cfg, i) => {
      const s = T.seats[i];
      s.el.querySelector('.av').textContent = (cfg.name || '?').slice(0, 1);
      s.el.querySelector('.who b').textContent = cfg.name;
      s.el.querySelector('.who i').textContent = cfg.pos || '';
      if (!keepStacks || !keepStacks.has(i)) s.stk.textContent = f1(cfg.stack);
      s.el.classList.toggle('folded', !!cfg.folded);
    });
  }

  /** 一步到位：把 view 原样画出来，不播任何动画。每次 show() 的最后一步都是它 */
  function applyInstant(view) {
    syncPlates(view);
    view.seats.forEach((cfg, i) => {
      const s = T.seats[i];
      while (s.cards.length < 2) addHoleCard(i);
      s.cards.forEach((c, k) => setFace(c, cfg.cards ? cfg.cards[k] : null));
      setBet(i, cfg.bet);
      s.el.classList.toggle('acting', i === view.acting);
      s.el.classList.toggle('win', !!cfg.win);
    });
    setBoard(view.board);
    setPot(view.pot, view.done);
    layout();
  }

  // ---------------------------------------------------------------- 位置
  /** 量牌桌宽度，算出毡面高度、牌的尺寸和每个元素的位置（全部是像素） */
  function layout() {
    const W0 = root.clientWidth;
    if (!W0) return;   // 视图没显示（display:none）时量不到，等显示出来 ResizeObserver 会再叫一次
    const narrow = W0 < NARROW;
    root.classList.toggle('narrow', narrow);
    const n = T.seats.length || 3;
    const pad = Math.round(clamp(W0 * (narrow ? 0.026 : 0.021), 6, 18));
    const W = W0 - 2 * pad;
    const H = Math.round(W * (narrow ? (n >= 5 ? 1.3 : 1.12) : (n >= 5 ? 0.62 : 0.5625)));
    rail.style.padding = pad + 'px';
    rail.style.borderRadius = Math.round(W0 * (narrow ? 0.32 : 0.26)) + 'px';
    felt.style.height = H + 'px';
    felt.style.borderRadius = Math.round(W * (narrow ? 0.3 : 0.24)) + 'px';
    const px = (v) => Math.round(v) + 'px';
    // 牌宽：公共牌 --cw、对手 --cwo、自己 --cwh（自己的最大）。窄桌上按比例放大一点，不然手机上自己的牌只有指甲盖大
    root.style.setProperty('--cw', px(clamp(W * (narrow ? 0.072 : 0.06), 22, 54)));
    root.style.setProperty('--cwo', px(clamp(W * (narrow ? 0.056 : 0.046), 18, 42)));
    root.style.setProperty('--cwh', px(clamp(W * (narrow ? 0.1 : 0.07), 26, 62)));
    felt.style.fontSize = px(clamp(W * 0.015, 11, 14));
    // 后手数字的格子按最长一档「599.5」留宽（--stkw，量尺是 probe 里的样板）：名牌宽度不随后手数字变，座位和下注的位置也就不随后手变。
    // v0.14.3 用「名牌宽减后手宽再加最长一档」去估，两个宽度的小数部分随数字变，找空位时会跳到另一处——一手牌里下注标签跟着后手跳（v0.14.4 修）
    root.style.setProperty('--stkw', probe.children[2].getBoundingClientRect().width + 'px');

    const place = (e, x, y) => {
      const w = e.offsetWidth, h = e.offsetHeight;
      e.style.left = px(clamp(x, w / 2 + EDGE, W - w / 2 - EDGE));
      e.style.top = px(clamp(y, h / 2 + EDGE, H - h / 2 - EDGE));
    };
    const cx = W / 2, cy = H / 2;
    const resized = T.size !== W + 'x' + H;
    T.size = W + 'x' + H;
    place(mark, cx, H * 0.29);
    place(boardEl, cx, H * (narrow ? 0.44 : 0.46));
    place(potEl, cx, H * (narrow ? 0.57 : 0.62));
    const last = T.last;
    if (!last) return;
    const hero = last.hero || 0;
    // 座位：自己在正下方；其余按座位号顺时针等分椭圆（屏幕坐标 y 朝下，角度增大即顺时针）
    const ang = (i) => ((90 + ((i - hero + n) % n) * 360 / n) * Math.PI) / 180;
    const rx = W * (narrow ? 0.36 : 0.4), ry = H * (narrow ? 0.4 : 0.37);
    const bx = W * (narrow ? 0.25 : 0.27), by = H * (narrow ? 0.24 : 0.25);
    T.seats.forEach((s, i) => {
      const a = ang(i);
      if (i === hero) place(s.el, cx, H - s.el.offsetHeight / 2 - EDGE);
      else place(s.el, cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    });
    // 庄家按钮在座位朝桌心那一侧、偏前一点
    if (last.button >= 0 && last.button < n) {
      const a = ang(last.button) - (24 * Math.PI) / 180;
      place(dbtn, cx + bx * 1.05 * Math.cos(a), cy + by * 1.1 * Math.sin(a));
      dbtn.hidden = false;
    } else dbtn.hidden = true;
    // 下注：先照原来的算法得到想摆的点（座位和桌心之间、偏后一点），再交给 betspot.js 让开名牌、手牌、公共牌五张的位置、底池、庄家按钮
    // 和别家的下注（标签、底池、后手都按最长一档「599.5」量，量尺是 probe 里那几块看不见的样板）。没问题的座位原样不动
    const f = felt.getBoundingClientRect();
    const [pb, pp] = probe.children;
    const pc = centerIn(potEl, felt);
    const hard = [rectOf(boardEl, f), { l: pc.x - pp.offsetWidth / 2, t: pc.y - pp.offsetHeight / 2, r: pc.x + pp.offsetWidth / 2, b: pc.y + pp.offsetHeight / 2 }];
    if (!dbtn.hidden) hard.push(rectOf(dbtn, f));
    const seatsC = T.seats.map((s) => {
      hard.push(rectOf(s.plate, f), holeRect(s.hole, f));   // 名牌的后手格子已经按最长一档留宽（--stkw），不用再估
      return centerIn(s.el, felt);
    });
    const want = T.seats.map((s, i) => { const ab = ang(i) + (22 * Math.PI) / 180; return { x: cx + bx * Math.cos(ab), y: cy + by * Math.sin(ab) }; });
    const spots = placeBets({ W, H, R: parseFloat(felt.style.borderRadius) || 0, edge: EDGE, cx, cy, box: { w: pb.offsetWidth, h: pb.offsetHeight }, want, seats: seatsC, hard });
    T.seats.forEach((s, i) => {
      s.betAt = { x: Math.round(spots[i].x), y: Math.round(spots[i].y) };
      s.betBox = spots[i].box;
      s.bet.style.left = s.betAt.x + 'px'; s.bet.style.top = s.betAt.y + 'px';
    });
    // 牌桌大小变了（转屏、拉窗口）：亮着的气泡跟着重新找位置。大小没变就不动它，免得气泡亮着的时候跳一下
    // 收着的气泡（透明）也挪回左上角：它们还停在旧尺寸下的位置的话，牌桌变窄后会伸出页面右边、让手机上整页能横向滚动
    if (resized) T.seats.forEach((s, i) => { if (s.say.classList.contains('on')) placeSay(i); else { s.say.style.left = '0px'; s.say.style.top = '0px'; } });
  }

  /** 给座位 i 的气泡找位置（见 bubble.js）：不压任何人的名牌、手牌，不压公共牌、底池、下注 */
  function placeSay(i) {
    const s = T.seats[i];
    if (!s || !felt.clientWidth) return;
    const f = felt.getBoundingClientRect();
    const W = felt.clientWidth, H = felt.clientHeight;
    const hard = [rectOf(boardEl, f), rectOf(potEl, f)], soft = [];
    T.seats.forEach((o, k) => {
      hard.push(rectOf(o.plate, f), holeRect(o.hole, f));
      if (!o.bet.hidden) hard.push(rectOf(o.bet, f));
      else if (o.betBox) soft.push(o.betBox);   // 还没下注的人：以后下注会出现在这儿（按最长一档算的大小）
      if (k !== i && o.say.classList.contains('on')) soft.push(rectOf(o.say, f));
    });
    if (!dbtn.hidden) soft.push(rectOf(dbtn, f));
    const p = placeBubble({ w: s.say.offsetWidth, h: s.say.offsetHeight, W, H, R: parseFloat(felt.style.borderRadius) || 0, edge: EDGE,
      plate: rectOf(s.plate, f), hole: holeRect(s.hole, f), cx: W / 2, hard, soft });
    s.say.style.left = Math.round(p.x) + 'px';
    s.say.style.top = Math.round(p.y) + 'px';
    s.say.dataset.fit = String(p.level);
  }

  if (typeof ResizeObserver !== 'undefined') { T.ro = new ResizeObserver(() => layout()); T.ro.observe(root); }
  else if (typeof window !== 'undefined') window.addEventListener('resize', layout);

  // ---------------------------------------------------------------- 动画工具
  const animOn = () => !reduceMotion() && root.offsetParent !== null;
  function anim(e, kf, opt) {
    if (!animOn() || !e.animate) return null;
    const a = e.animate(kf, opt);
    T.anims.add(a);
    a.onfinish = () => T.anims.delete(a);
    return a;
  }
  const wait = (ms) => (animOn() ? sleep(ms) : Promise.resolve());
  function stopAll() {
    for (const a of T.anims) { try { a.cancel(); } catch (e) { /* 已经结束 */ } }
    T.anims.clear();
    for (const e of T.temps) e.remove();
    T.temps.clear();
  }
  /** 翻开一张牌：先背面朝上放好，下一帧再去掉 down，让 CSS 过渡把它转过来 */
  function flipUp(c, code) {
    setCardFace(c, code);
    if (!animOn()) { c.classList.remove('down'); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => c.classList.remove('down')));
  }
  /** 亮出动作气泡。要在这一步的下注摆好之后叫（找位置时要让开它们）；hold 为真时不自动收（只给测试钩子用） */
  function say(view, hold) {
    if (!view.say || !T.seats[view.say.seat]) return;
    const i = view.say.seat, s = T.seats[i];
    clearTimeout(s.sayTimer);
    s.say.textContent = view.say.text;
    placeSay(i);
    s.say.classList.add('on');
    if (!hold) s.sayTimer = setTimeout(() => s.say.classList.remove('on'), 1100);
  }
  // 测试钩子（tools/uicheck_bubble.mjs）：让第 seat 家亮出文字为 text 的气泡并一直亮着，hide() 全部收掉。只读写气泡，不碰牌局
  if (typeof window !== 'undefined') {
    window.__squidTableTest = {
      say: (seat, text) => say({ say: { seat, text } }, true),
      hide: () => { for (const s of T.seats) { clearTimeout(s.sayTimer); s.say.classList.remove('on'); } },
      // tools/uicheck_bets.mjs：把此刻的画面换个庄位、换一组下注直接画出来（只是摆样子，不碰牌局）；unstage() 画回原样
      stage: (o) => { const v = T.staged || T.last; if (!v) return false; T.staged = v;
        show({ ...v, say: null, acting: -1, button: o.button >= 0 ? o.button : v.button, pot: o.pot >= 0 ? o.pot : v.pot, done: o.done === undefined ? v.done : o.done,
          seats: v.seats.map((p, i) => ({ ...p, bet: o.bets ? o.bets[i] || 0 : p.bet, stack: o.stacks ? o.stacks[i] : p.stack })) }, { instant: true }); return true; },
      unstage: () => { const v = T.staged; T.staged = null; if (v) show(v, { instant: true }); },
      spots: () => T.seats.map((s) => s.betAt),
    };
  }

  // ---------------------------------------------------------------- 演出
  async function dealIn(view, ok) {
    const n = view.seats.length;
    applyInstant({ ...view, acting: -1, seats: view.seats.map((s) => ({ ...s, bet: 0, cards: null, win: false })) });
    for (const s of T.seats) { s.hole.innerHTML = ''; s.cards = []; }
    // 从庄家左手边开始，一人一张发两圈
    const start = (view.button + 1) % n;
    const fc = { x: felt.clientWidth / 2, y: felt.clientHeight * 0.46 };
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < n; j++) {
        const i = (start + j) % n;
        const c = addHoleCard(i);
        const p = centerIn(c, felt);
        anim(c, [{ transform: `translate(${fc.x - p.x}px,${fc.y - p.y}px) rotate(-25deg) scale(.7)`, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
        sfx.card();
        await wait(n > 4 ? 70 : 100); if (!ok()) return;
      }
    }
    await wait(300); if (!ok()) return;
    view.seats.forEach((cfg, i) => { if (cfg.cards) T.seats[i].cards.forEach((c, k) => flipUp(c, cfg.cards[k])); });
    sfx.card();
    await wait(420); if (!ok()) return;
    let any = false;
    view.seats.forEach((cfg, i) => { if (cfg.bet > 0) { any = true; setBet(i, cfg.bet); popBet(i); } });
    if (any) { sfx.chip(); await wait(240); }
  }

  function popBet(i) {
    anim(T.seats[i].bet.querySelector('.bet-in'), [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  /** 各家面前的筹码滑进底池 */
  async function collect(prev, ok) {
    const p = centerIn(potEl, felt);
    const moving = [];
    prev.seats.forEach((cfg, i) => {
      if (!(cfg.bet > 0)) return;
      const b = T.seats[i].bet, q = centerIn(b, felt);
      moving.push(anim(b.querySelector('.bet-in'), [{ transform: 'none', opacity: 1 }, { transform: `translate(${p.x - q.x}px,${p.y - q.y}px) scale(.6)`, opacity: 0.2 }], { duration: 340, easing: 'ease-in', fill: 'forwards' }));
    });
    if (!moving.length) return;
    sfx.chip();
    await wait(340);
    if (!ok()) return;
    prev.seats.forEach((s, i) => setBet(i, 0));
    // fill:forwards 的动画要撤掉，否则下次这个位置再下注，筹码还停在底池那里
    for (const a of moving) if (a) { a.cancel(); T.anims.delete(a); }
  }

  /** 结束：底池的筹码飞给每个池实际的赢家（边池、平分都按 awards 里写的来） */
  async function award(view, ok) {
    const from = centerIn(potEl, felt);
    for (const pot of view.awards) {
      for (const w of pot.winners) {
        const plate = T.seats[w] && T.seats[w].el.querySelector('.plate');
        if (!plate) continue;
        const to = centerIn(plate, felt);
        const fly = el('div', 'fly', '<span class="fly-in">' + chipsHtml((pot.amount || view.pot) / pot.winners.length) + '</span>');
        fly.style.left = from.x + 'px'; fly.style.top = from.y + 'px';
        felt.append(fly); T.temps.add(fly);
        anim(fly.firstChild, [{ transform: 'none', opacity: 1 }, { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(.7)`, opacity: 0.15 }], { duration: 520, easing: 'ease-in', fill: 'forwards' });
      }
      sfx.chip();
      await wait(560); if (!ok()) return;
      for (const e of T.temps) e.remove();
      T.temps.clear();
    }
  }

  async function transition(prev, view, ok) {
    const winners = new Set();
    if (view.awards && !prev.awards) view.seats.forEach((s, i) => { if (s.win) winners.add(i); });
    syncPlates(view, winners);
    for (const s of T.seats) s.el.classList.remove('acting');
    // 1) 收池：本街有人下过注、而新画面里桌上的注变少了
    const collecting = prev.seats.some((s, i) => s.bet > 0 && !(view.seats[i].bet >= s.bet));
    if (collecting) {
      await collect(prev, ok); if (!ok()) return;
      setPot(view.pot, false);
    }
    // 2) 新下的注出现在面前
    let popped = false;
    view.seats.forEach((cfg, i) => {
      const before = collecting ? 0 : prev.seats[i].bet;
      if (cfg.bet > before) { setBet(i, cfg.bet); popBet(i); popped = true; }
    });
    if (popped) { sfx.chip(); layout(); }
    if (!collecting) setPot(view.pot, false);
    // 动作气泡在这一步的下注摆好之后亮（带动作的画面不会收池，所以和下注是同一刻出来的）
    say(view);
    // 3) 摊牌：对手的牌翻开
    let shown = false;
    view.seats.forEach((cfg, i) => {
      if (cfg.cards && !prev.seats[i].cards) { shown = true; T.seats[i].cards.forEach((c, k) => flipUp(c, cfg.cards[k])); }
    });
    if (shown) { sfx.card(); await wait(520); if (!ok()) return; }
    // 4) 公共牌逐张翻开；一次发好几条街（全下后跑完）时，街与街之间停一下
    for (let i = prev.board.length; i < view.board.length; i++) {
      if (i > prev.board.length && i >= 3) { await wait(560); if (!ok()) return; }
      const c = cardEl(view.board[i], true);
      c.classList.add('down');
      boardEl.children[i].replaceWith(c);
      flipUp(c, view.board[i]);
      sfx.card();
      await wait(i < 3 ? 190 : 120); if (!ok()) return;
    }
    if (view.board.length > prev.board.length) { await wait(480); if (!ok()) return; }
    // 5) 派彩
    if (winners.size) { await wait(200); if (!ok()) return; await award(view, ok); }
  }

  /**
   * 把桌子变成 view 的样子，能演的部分用动画演。返回的 Promise 在画到位后给 true；
   * 中途又来了新的 show()（下一手、开新桌、操作太快）就给 false，旧的这段立刻作废，不再碰页面。
   */
  async function show(view, opts = {}) {
    const gen = ++T.gen;
    const ok = () => gen === T.gen;
    stopAll();
    const prev = T.last;
    const interrupted = T.running;
    T.last = view;
    const newHand = !prev || prev.key !== view.key || prev.seats.length !== view.seats.length;
    if (newHand) build(view);
    if (opts.instant || !animOn()) {
      T.running = false;
      // 直接到位（回放里往回走、拖进度条）：上一个画面还没消失的动作气泡要收掉，不然会挂在不相干的那一步上
      if (opts.instant) for (const s of T.seats) { clearTimeout(s.sayTimer); s.say.classList.remove('on'); }
      // CSS 过渡（翻牌、高亮）也不许播：先挂上 still 类关掉过渡，画到位后强制算一遍样式，再摘掉——值已经在终点，摘掉不会再起过渡
      root.classList.add('still');
      applyInstant(view); say(view);
      void root.offsetHeight;
      root.classList.remove('still');
      return true;
    }
    if (interrupted && !newHand) applyInstant(prev);   // 上一段被打断：先一步到它的终点，再从那里演
    T.running = true;
    if (newHand) await dealIn(view, ok);
    else await transition(prev, view, ok);
    if (!ok()) return false;
    T.running = false;
    applyInstant(view);
    return true;
  }

  return { el: root, show, layout, destroy: () => { stopAll(); T.gen++; if (T.ro) T.ro.disconnect(); } };
}

exports.createTable = createTable;
});
