__squidDefine('src/engine/game.js', function (exports) {
'use strict';
// 单机牌局引擎：2~6 人无限注德州，含盲注、边池、完整手牌记录。
// 机器人策略在 bot.js；这里只管规则。

const { makeRng, shuffle, cardToStr, cardsToStr, comboIndex } = __squidRequire('src/core/cards.js');
const { evaluate, describeValue } = __squidRequire('src/core/evaluator.js');

const STREET_CN = ['翻前', '翻牌', '转牌', '河牌'];

/** 一组可能带小数的金额的最大公约数（按 1/1000 的精度做整数化） */
function gcdOf(xs) {
  if (!xs.length) return 0;
  const g2 = (a, b) => (b ? g2(b, a % b) : a);
  const ints = xs.map((x) => Math.round(x * 1000));
  let g = ints[0];
  for (let i = 1; i < ints.length; i++) g = g2(g, ints[i]);
  return g / 1000;
}

class HandEngine {
  /**
   * cfg: { seats:[{name, stack, isHero, bot}], button, sb, bb, ante, seed, handNo }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.n = cfg.seats.length;
    if (this.n < 2 || this.n > 6) throw new Error('支持 2~6 人');
    this.rng = makeRng(cfg.seed ?? (Date.now() >>> 0));
    // 最小筹码单位：所有下注按它取整，派彩也按它拆分，保证筹码严格守恒。
    // 下限 0.01：盲注/前注是无法精确表示的分数时（比如 bb/3），gcd 会退化到 0.001 以下，
    // 浮点累积误差就会超过守恒判据；真实牌局的注码也不会细到这个程度。
    this.chipUnit = Math.max(0.01, cfg.chipUnit || gcdOf([cfg.sb, cfg.bb, cfg.ante].filter((x) => x > 0)) || 0.5);
    // 盲注与前注本身也要对齐到这个单位，否则底池里会留下拆不开的零头，
    // 派彩无论怎么分都不守恒（实测 ante=bb/3 时 3000 手里有 77 手对不上）。
    const snap = (x) => Math.round((x || 0) / this.chipUnit) * this.chipUnit;
    this.sb = snap(cfg.sb); this.bb = snap(cfg.bb); this.ante = snap(cfg.ante || 0);
    this.button = cfg.button % this.n;
    this.seats = cfg.seats.map((s, i) => ({ seat: i, name: s.name, stack: s.stack, stack0: s.stack, hole: [], invested: 0, streetBet: 0, folded: false, allin: false, isHero: !!s.isHero, bot: s.bot || null, showed: false }));
    this.board = [];
    this.street = 0;
    this.history = [];
    this.over = false;
    this.result = null;
    this.deck = shuffle([...Array(52).keys()], this.rng);
    this.deckPos = 0;
    this.handNo = cfg.handNo || 1;
    this._start();
  }

  get pot() { return this.seats.reduce((a, s) => a + s.invested, 0); }
  get hero() { return this.seats.find((s) => s.isHero); }
  get active() { return this.seats.filter((s) => !s.folded); }
  get toActSeat() { return this.over || this.pending.length === 0 ? null : this.seats[this.pending[0]]; }
  isHeroTurn() { const s = this.toActSeat; return !!s && s.isHero; }

  _draw() { return this.deck[this.deckPos++]; }

  _start() {
    for (const s of this.seats) { s.hole = [this._draw(), this._draw()]; }
    const n = this.n;
    const sbSeat = n === 2 ? this.button : (this.button + 1) % n;
    const bbSeat = n === 2 ? (this.button + 1) % n : (this.button + 2) % n;
    this.sbSeat = sbSeat; this.bbSeat = bbSeat;
    if (this.ante > 0) for (const s of this.seats) this._put(s, Math.min(this.ante, s.stack), 'ante', false);
    this._put(this.seats[sbSeat], Math.min(this.sb, this.seats[sbSeat].stack), 'sb');
    this._put(this.seats[bbSeat], Math.min(this.bb, this.seats[bbSeat].stack), 'bb');
    this.currentBet = this.bb;
    this.lastRaise = this.bb;
    this.raisesThisStreet = 0;
    // 翻前从 BB 之后开始
    this.pending = this._orderFrom((bbSeat + 1) % n).filter((i) => !this.seats[i].folded && !this.seats[i].allin);
    this._log({ kind: 'deal', street: 0 });
  }

  /**
   * 投入筹码。前注不属于"本街下注额"——它是每人无条件的入池费，
   * 算进 streetBet 会让大盲的 toCall 变成 -ante，把行动判定整个带偏。
   */
  _put(seat, amt, why, countsAsStreetBet = true) {
    seat.stack -= amt; seat.invested += amt;
    if (countsAsStreetBet) seat.streetBet += amt;
    if (seat.stack <= 1e-9) { seat.stack = 0; seat.allin = true; }
    if (why) this.history.push({ street: this.street, seat: seat.seat, kind: why, amount: amt, potAfter: this.pot });
  }

  _orderFrom(start) {
    const out = [];
    for (let k = 0; k < this.n; k++) out.push((start + k) % this.n);
    return out;
  }

  _log(ev) { this.history.push(ev); }

  /** 当前行动者的合法动作 */
  legalActions() {
    const s = this.toActSeat;
    if (!s) return [];
    const toCall = Math.max(0, this.currentBet - s.streetBet);
    const acts = [];
    if (toCall > 0) {
      acts.push({ kind: 'fold' });
      acts.push({ kind: 'call', amount: Math.min(toCall, s.stack), allin: s.stack <= toCall });
    } else acts.push({ kind: 'check' });
    if (s.stack > toCall) {
      const maxTo = s.streetBet + s.stack;
      const minTo = Math.min(maxTo, Math.max(this.currentBet + this.lastRaise, this.bb));
      acts.push({ kind: toCall > 0 ? 'raise' : 'bet', minTo, maxTo, toCall });
    }
    return acts;
  }

  /**
   * 执行动作。kind: fold/check/call/bet/raise；bet/raise 用 amountTo（本街累计下注到多少）
   */
  act(kind, amountTo = 0) {
    const s = this.toActSeat;
    if (!s) throw new Error('无人行动');
    const legal = this.legalActions();
    const toCall = Math.max(0, this.currentBet - s.streetBet);
    const rec = { street: this.street, seat: s.seat, kind, potBefore: this.pot, toCall, stackBefore: s.stack, currentBetBefore: this.currentBet, board: this.board.slice() };
    switch (kind) {
      case 'fold':
        if (toCall <= 0) throw new Error('无需弃牌');
        s.folded = true; rec.amount = 0;
        break;
      case 'check':
        if (toCall > 0) throw new Error('不能过牌');
        rec.amount = 0;
        break;
      case 'call': {
        if (toCall <= 0) throw new Error('无可跟');
        const amt = Math.min(toCall, s.stack);
        this._put(s, amt); rec.amount = amt;
        break;
      }
      case 'bet': case 'raise': {
        const opt = legal.find((a) => a.kind === 'bet' || a.kind === 'raise');
        if (!opt) throw new Error('不能下注/加注');
        // 对齐到最小筹码单位。取整后必须回钳到 [minTo, maxTo]：
        // 否则引擎会因为自己的取整而拒绝掉自己刚给出的合法动作。
        amountTo = Math.round(amountTo / this.chipUnit) * this.chipUnit;
        if (amountTo > opt.maxTo) amountTo = opt.maxTo;
        else if (amountTo < opt.minTo) amountTo = Math.min(opt.minTo, opt.maxTo);
        const add = amountTo - s.streetBet;
        this._put(s, add);
        const inc = amountTo - this.currentBet;
        if (inc >= this.lastRaise) this.lastRaise = inc;
        this.currentBet = amountTo;
        this.raisesThisStreet++;
        rec.amount = add; rec.amountTo = amountTo;
        // 其他人重新行动
        this.pending = this._orderFrom((s.seat + 1) % this.n).filter((i) => i !== s.seat && !this.seats[i].folded && !this.seats[i].allin);
        rec.stackAfter = s.stack;
        this._log(rec);
        this._afterAction();
        return rec;
      }
      default: throw new Error('未知动作 ' + kind);
    }
    rec.stackAfter = s.stack;
    this.pending.shift();
    this._log(rec);
    this._afterAction();
    return rec;
  }

  _afterAction() {
    const active = this.active;
    if (active.length === 1) return this._finish();
    if (this.pending.length > 0) return;
    // 本街结束
    const canAct = active.filter((s) => !s.allin);
    if (this.street === 3) return this._finish();
    this.street++;
    for (const s of this.seats) s.streetBet = 0;
    this.currentBet = 0; this.lastRaise = this.bb; this.raisesThisStreet = 0;
    this._dealBoard();
    if (canAct.length <= 1) {
      // 已无人可行动：直接发完
      while (this.street < 3) { this.street++; this._dealBoard(); }
      return this._finish();
    }
    this.pending = this._orderFrom((this.button + 1) % this.n).filter((i) => !this.seats[i].folded && !this.seats[i].allin);
  }

  _dealBoard() {
    const k = this.street === 1 ? 3 : 1;
    for (let i = 0; i < k; i++) this.board.push(this._draw());
    this._log({ kind: 'board', street: this.street, board: this.board.slice() });
  }

  _finish() {
    this.over = true;
    const active = this.active;
    const payouts = new Array(this.n).fill(0);
    const pots = [];
    if (active.length === 1) {
      payouts[active[0].seat] = this.pot;
      pots.push({ amount: this.pot, eligible: [active[0].seat], winners: [active[0].seat] });
    } else {
      while (this.board.length < 5) this.board.push(this._draw());
      const vals = new Array(this.n).fill(-1);
      for (const s of active) { vals[s.seat] = evaluate([...this.board, ...s.hole]); s.showed = true; }
      // 边池
      const levels = [...new Set(this.seats.map((s) => s.invested).filter((x) => x > 0))].sort((a, b) => a - b);
      let prev = 0;
      for (const L of levels) {
        let amount = 0;
        for (const s of this.seats) amount += Math.max(0, Math.min(s.invested, L) - prev);
        const eligible = active.filter((s) => s.invested >= L).map((s) => s.seat);
        if (amount > 0 && eligible.length) {
          let best = -1;
          for (const e of eligible) if (vals[e] > best) best = vals[e];
          const winners = eligible.filter((e) => vals[e] === best);
          // 按最小筹码单位（默认 0.5bb）做整数拆分再还原。
          // 直接 Math.floor(amount / winners) 会在底池含 .5 时凭空造出筹码，
          // 例如 10.5 的底池单人赢：floor=10、余 0.5 却按 +1 发，多出 0.5。
          const units = Math.round(amount / this.chipUnit);
          const shareUnits = Math.floor(units / winners.length);
          let remUnits = units - shareUnits * winners.length;
          // 余数按位置顺序（小盲起）依次多分一个最小单位，与真实牌桌一致
          for (const w of this._orderFrom((this.button + 1) % this.n)) {
            if (!winners.includes(w)) continue;
            const extra = remUnits > 0 ? 1 : 0;
            if (extra) remUnits--;
            payouts[w] += (shareUnits + extra) * this.chipUnit;
          }
          pots.push({ amount, eligible, winners, best: describeValue(best) });
        }
        prev = L;
      }
      this.vals = vals;
    }
    for (const s of this.seats) s.stack += payouts[s.seat];
    this.result = { payouts, pots, net: this.seats.map((s) => s.stack - s.stack0) };
    this._log({ kind: 'result', ...this.result });
  }

  /**
   * 可保存/复盘的手牌记录。
   * v 是记录格式的版本（v0.14 起写 2）：从这一版起，牌局回放（review/replay.js）用记录里每个动作自带的
   * 底池、后手、要跟的数逐步核对还原出来的画面，核对得上才回放。没有 v 的是更早的版本记的，同样逐步核对，
   * 对不上就如实说「回放不了」。格式本身没有变，所以旧记录多半照样能回放。
   */
  toRecord() {
    return {
      v: 2, handNo: this.handNo, seed: this.cfg.seed, n: this.n, button: this.button, sb: this.sb, bb: this.bb, ante: this.ante,
      seats: this.seats.map((s) => ({ seat: s.seat, name: s.name, stack0: s.stack0, stackEnd: s.stack, hole: s.hole.slice(), isHero: s.isHero, folded: s.folded, showed: s.showed, profile: s.bot ? s.bot.profile : null })),
      board: this.board.slice(),
      history: this.history.map((h) => ({ ...h })),
      result: this.result,
      heroSeat: this.hero ? this.hero.seat : -1,
    };
  }
}

/** 座位相对按钮的位置名 */
function positionName(seat, button, n) {
  const d = (seat - button + n) % n;
  if (n === 2) return d === 0 ? 'BTN/SB' : 'BB';
  const names6 = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
  const names = n === 6 ? names6 : n === 5 ? ['BTN', 'SB', 'BB', 'UTG', 'CO'] : n === 4 ? ['BTN', 'SB', 'BB', 'CO'] : ['BTN', 'SB', 'BB'];
  return names[d];
}

function handToText(rec) {
  const lines = [];
  const pos = (seat) => positionName(seat, rec.button, rec.n);
  lines.push(`第 ${rec.handNo} 手  盲注 ${rec.sb}/${rec.bb}  按钮=${rec.seats[rec.button].name}`);
  for (const s of rec.seats) lines.push(`  ${pos(s.seat)} ${s.name} 后手 ${s.stack0}${s.isHero || s.showed ? ' 手牌 ' + cardsToStr(s.hole) : ''}`);
  let street = -1;
  for (const h of rec.history) {
    if (h.kind === 'deal') continue;
    if (h.kind === 'board') { lines.push(`${STREET_CN[h.street]}: ${cardsToStr(h.board)}`); street = h.street; continue; }
    if (h.kind === 'result') { lines.push('结果: ' + h.pots.map((p) => `${p.amount} -> ${p.winners.map((w) => rec.seats[w].name).join('/')}${p.best ? '(' + p.best + ')' : ''}`).join('; ')); continue; }
    if (h.kind === 'sb' || h.kind === 'bb' || h.kind === 'ante') { lines.push(`  ${rec.seats[h.seat].name} 下${h.kind === 'ante' ? '前注' : h.kind === 'sb' ? '小盲' : '大盲'} ${h.amount}`); continue; }
    if (h.street !== street && h.street === 0) { lines.push('翻前:'); street = 0; }
    const s = rec.seats[h.seat];
    const cn = { fold: '弃牌', check: '过牌', call: `跟注 ${h.amount}`, bet: `下注 ${h.amountTo}`, raise: `加注到 ${h.amountTo}` }[h.kind];
    lines.push(`  ${pos(h.seat)} ${s.name}: ${cn}${h.stackAfter === 0 ? '(全下)' : ''}  [底池 ${h.potBefore}]`);
  }
  return lines.join('\n');
}

exports.positionName = positionName;
exports.handToText = handToText;
exports.HandEngine = HandEngine;
exports.STREET_CN = STREET_CN;
});
