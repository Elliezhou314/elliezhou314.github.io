__squidDefine('src/engine/bot.js', function (exports) {
'use strict';
// 自由牌局用的启发式机器人。不是 GTO，是“带风格的合理对手”。
// 风格参数可调；决策以权益（真实计算）+ 底池赔率为骨架，加随机性。

const { COMBOS, NOTATION_TO_COMBOS, comboIndex, comboToNotation, makeRng } = __squidRequire('src/core/cards.js');
const { equityHandVsRange, equityHandVsRanges } = __squidRequire('src/core/equity.js');
const { parseRange } = __squidRequire('src/core/range.js');
const { positionName } = __squidRequire('src/engine/game.js');

const PROFILES = {
  balanced: { cn: '均衡型', vpip: 0.26, pfr: 0.19, aggr: 0.55, bluff: 0.28, callDown: 0.5 },
  tight: { cn: '紧凶型', vpip: 0.17, pfr: 0.14, aggr: 0.6, bluff: 0.15, callDown: 0.35 },
  station: { cn: '跟注站', vpip: 0.48, pfr: 0.1, aggr: 0.2, bluff: 0.08, callDown: 0.85 },
  maniac: { cn: '疯狂型', vpip: 0.5, pfr: 0.4, aggr: 0.85, bluff: 0.55, callDown: 0.55 },
};

// 169 类起手牌 vs 一手随机牌 的全下权益（蒙特卡洛，懒加载一次）
let RANK169 = null;
function preflopRank169(samples = 1200) {
  if (RANK169) return RANK169;
  const rng = makeRng(777);
  const random = parseRange('random');
  const eq = {};
  for (const [nt, idxs] of NOTATION_TO_COMBOS) {
    const c = COMBOS[idxs[0]];
    eq[nt] = equityHandVsRange(c, random, [], { samples, rng }).equity;
  }
  const order = Object.keys(eq).sort((a, b) => eq[b] - eq[a]);
  // 百分位：按组合数累计（AA 6 个组合、AKo 12 个……）
  const pct = {};
  let acc = 0;
  for (const nt of order) { const n = NOTATION_TO_COMBOS.get(nt).length; pct[nt] = (acc + n / 2) / 1326; acc += n; }
  RANK169 = { eq, order, pct };
  return RANK169;
}

/** 按“最强的前 x%”生成范围文本 */
function topPercentRange(x) {
  const { order } = preflopRank169();
  const out = [];
  let acc = 0;
  for (const nt of order) {
    const n = NOTATION_TO_COMBOS.get(nt).length;
    if (acc / 1326 >= x) break;
    out.push(nt); acc += n;
  }
  return out.join(',');
}

class HeuristicBot {
  constructor(profile = 'balanced', seed = 1) {
    this.profile = profile;
    this.p = PROFILES[profile] || PROFILES.balanced;
    this.rng = makeRng(seed);
  }

  /** 返回 {kind, amountTo} */
  decide(engine) {
    const seat = engine.toActSeat;
    const legal = engine.legalActions();
    const toCall = Math.max(0, engine.currentBet - seat.streetBet);
    const pot = engine.pot;
    const raiseOpt = legal.find((a) => a.kind === 'bet' || a.kind === 'raise');
    const r = this.rng;
    if (engine.street === 0) return this._preflop(engine, seat, legal, toCall, pot, raiseOpt);

    // 翻后：对手假设范围 = 最激进对手的翻前范围（按其翻前动作粗估），再按人数打折
    const opps = engine.active.filter((s) => s.seat !== seat.seat);
    const oppRange = this._assumedRange(engine, opps);
    // 单挑用枚举/蒙特卡洛；多人局对所有对手联合抽样，不用幂次折算（那会高估十几个百分点）
    let eq;
    if (opps.length > 1) {
      const r2 = equityHandVsRanges(seat.hole, opps.map(() => oppRange), engine.board, { samples: 120, maxRunouts: 60, rng: r });
      eq = r2.equity;
    } else {
      eq = equityHandVsRange(seat.hole, oppRange, engine.board, { samples: 600, rng: r }).equity;
    }
    if (!Number.isFinite(eq)) eq = 1 / (opps.length + 1);
    // 对手在本街下过注，则其范围更强：打折
    const oppBetThisStreet = engine.history.some((h) => h.street === engine.street && (h.kind === 'bet' || h.kind === 'raise') && h.seat !== seat.seat);
    if (oppBetThisStreet) eq *= 0.88;
    const spr = seat.stack / Math.max(pot, 1);

    if (toCall === 0) {
      const strong = eq > 0.62, medium = eq > 0.45;
      if (raiseOpt && (strong || (medium && r() < this.p.aggr * 0.5) || (eq < 0.4 && r() < this.p.bluff * (engine.street < 3 ? 0.6 : 0.35)))) {
        const frac = strong ? (r() < 0.5 ? 0.66 : 0.75) : 0.5;
        return { kind: raiseOpt.kind, amountTo: this._size(raiseOpt, pot, frac, seat) };
      }
      return { kind: 'check' };
    }
    const potOdds = toCall / (pot + toCall);
    const callOpt = legal.find((a) => a.kind === 'call');
    if (!callOpt) return { kind: 'fold' }; // 没得跟（理论上 toCall>0 必有 call，防御性兜底）
    if (eq > 0.78 && raiseOpt && r() < this.p.aggr) return { kind: raiseOpt.kind, amountTo: this._size(raiseOpt, pot + toCall, 0.75, seat) };
    if (eq >= potOdds + 0.04) return { kind: 'call', amount: callOpt.amount };
    if (eq >= potOdds - 0.06 && r() < this.p.callDown) return { kind: 'call', amount: callOpt.amount };
    if (raiseOpt && eq < 0.3 && r() < this.p.bluff * 0.25 && spr > 1.5) return { kind: raiseOpt.kind, amountTo: this._size(raiseOpt, pot + toCall, 0.8, seat) };
    return { kind: 'fold' };
  }

  _size(raiseOpt, pot, frac, seat) {
    let to = raiseOpt.toCall > 0 ? seat.streetBet + raiseOpt.toCall + Math.round(frac * (pot + raiseOpt.toCall)) : Math.round(frac * pot);
    to = Math.max(raiseOpt.minTo, Math.min(raiseOpt.maxTo, to));
    if (to > raiseOpt.maxTo * 0.8) to = raiseOpt.maxTo; // 快贴近全下就直接全下
    return to;
  }

  _assumedRange(engine, opps) {
    // 看翻前谁加注过：加注者 top 18%，跟注者 top 35%，其余 top 55%
    let tightest = 0.55;
    for (const o of opps) {
      const raised = engine.history.some((h) => h.street === 0 && h.seat === o.seat && (h.kind === 'raise' || h.kind === 'bet'));
      const called = engine.history.some((h) => h.street === 0 && h.seat === o.seat && h.kind === 'call');
      const x = raised ? 0.18 : called ? 0.35 : 0.55;
      if (x < tightest) tightest = x;
    }
    return parseRange(topPercentRange(tightest));
  }

  _preflop(engine, seat, legal, toCall, pot, raiseOpt) {
    const { pct } = preflopRank169();
    const nt = comboToNotation(comboIndex(seat.hole[0], seat.hole[1]));
    const my = pct[nt]; // 越小越强
    const r = this.rng;
    const n = engine.n;
    const posName = positionName(seat.seat, engine.button, n);
    const posFactor = { UTG: 0.7, MP: 0.85, CO: 1.0, BTN: 1.25, SB: 0.9, BB: 1.0, 'BTN/SB': 1.2 }[posName] || 1;
    const raisesBefore = engine.raisesThisStreet; // 大盲不算加注
    const callOpt = legal.find((a) => a.kind === 'call');
    if (raisesBefore === 0) {
      // 无人加注
      if (my <= this.p.pfr * posFactor && raiseOpt) return { kind: raiseOpt.kind, amountTo: Math.min(raiseOpt.maxTo, Math.max(raiseOpt.minTo, Math.round(engine.bb * 2.5 + (engine.pot > engine.sb + engine.bb ? engine.bb : 0)))) };
      if (toCall === 0) return { kind: 'check' };
      if (callOpt && my <= this.p.vpip * posFactor) return { kind: 'call', amount: callOpt.amount };
      return { kind: 'fold' };
    }
    if (raisesBefore === 1) {
      if (my <= this.p.pfr * 0.35 && raiseOpt && r() < 0.85) return { kind: raiseOpt.kind, amountTo: Math.min(raiseOpt.maxTo, Math.max(raiseOpt.minTo, Math.round(engine.currentBet * 3))) };
      if (!callOpt) return toCall === 0 ? { kind: 'check' } : { kind: 'fold' };
      if (my <= this.p.vpip * posFactor * 0.8) return { kind: 'call', amount: callOpt.amount };
      const potOdds = toCall / (pot + toCall);
      if (potOdds < 0.25 && my <= this.p.vpip * 1.3 && r() < this.p.callDown) return { kind: 'call', amount: callOpt.amount };
      return { kind: 'fold' };
    }
    // 面对 3bet 及以上
    if (my <= 0.03 && raiseOpt) return { kind: raiseOpt.kind, amountTo: raiseOpt.maxTo };
    if (!callOpt) return toCall === 0 ? { kind: 'check' } : { kind: 'fold' };
    if (my <= 0.08 || (my <= 0.15 && r() < this.p.callDown)) return { kind: 'call', amount: callOpt.amount };
    return { kind: 'fold' };
  }
}

exports.preflopRank169 = preflopRank169;
exports.topPercentRange = topPercentRange;
exports.HeuristicBot = HeuristicBot;
exports.PROFILES = PROFILES;
});
