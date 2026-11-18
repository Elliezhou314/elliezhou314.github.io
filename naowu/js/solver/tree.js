__squidDefine('src/solver/tree.js', function (exports) {
'use strict';
// 博弈树构建：翻后 2~3 人，自定义下注尺度 / 加注上限 / 后手 / 截断方式。
//
// 约定：
//   - 玩家下标 = 翻后行动顺序（0 最先行动，即 OOP）。
//   - 所有玩家后手取“有效后手”（最小值），因此没有边池；3 人局界面上只允许输入一个有效后手。
//   - 节点类型：D 决策 / C 发牌 / T 终端(弃牌或河牌摊牌) / E 权益结算叶子(截断树或全下后)。
//   - 尺度单位是“底池百分比”。加注尺度按“跟注后的底池”计算，即
//       raiseTotal = toCall + pct% × (pot + toCall)

const { cardToStr, remainingDeck } = __squidRequire('src/core/cards.js');

const STREET_NAMES = ['翻牌', '转牌', '河牌'];

const DEFAULT_SIZES = {
  flop: { bet: [33, 75], raise: [60] },
  turn: { bet: [50, 100], raise: [60] },
  river: { bet: [50, 100], raise: [60] },
};

function streetOfBoard(board) {
  if (board.length === 3) return 0;
  if (board.length === 4) return 1;
  if (board.length === 5) return 2;
  throw new Error('公共牌必须是 3/4/5 张');
}

const STREET_KEY = ['flop', 'turn', 'river'];

function buildTree(cfg) {
  const players = cfg.players || 2;
  const board = cfg.board.slice();
  const street0 = streetOfBoard(board);
  const eff = Math.min(...cfg.stacks.slice(0, players));
  const sizes = cfg.sizes || DEFAULT_SIZES;
  const raiseCap = cfg.raiseCap ?? 3;
  const allinThreshold = cfg.allinThreshold ?? 0.75; // 下注额 >= 后手×阈值 时改成全下
  const useAllin = cfg.allin ?? true;
  const leafMode = Object.assign({ turn: 'full', river: 'full' }, cfg.leafMode || {});
  const maxNodes = cfg.maxNodes || 400000;

  const nodes = [];
  let decisionCount = 0;
  const boardKeys = new Map(); // boardKey -> board 数组（用于解算器缓存牌力表）

  const keyOf = (b) => b.map(cardToStr).join('');

  function makeNode(n) {
    n.id = nodes.length;
    nodes.push(n);
    if (nodes.length > maxNodes) throw new Error(`博弈树超过 ${maxNodes} 个节点，请减少尺度或加注上限，或用截断模式`);
    return n;
  }

  /**
   * @param s 状态：{ street, board, invested[], streetBets[], stacks[], alive[], pending[], currentBet, raises, lastRaise, history }
   */
  function build(s) {
    // 街结束？
    if (s.pending.length === 0) return endStreet(s);
    const p = s.pending[0];
    const pot = cfg.pot + s.invested.reduce((a, b) => a + b, 0);
    const toCall = s.currentBet - s.streetBets[p];
    const stack = s.stacks[p];
    const node = makeNode({ type: 'D', street: s.street, board: s.board, player: p, pot, toCall, stacks: s.stacks.slice(), invested: s.invested.slice(), alive: s.alive.slice(), history: s.history, actions: [], dIndex: decisionCount++ });
    const sz = sizes[STREET_KEY[s.street]] || DEFAULT_SIZES[STREET_KEY[s.street]];
    const acts = [];

    if (toCall > 0) {
      acts.push({ kind: 'fold', amount: 0, label: '弃牌' });
      const callAmt = Math.min(toCall, stack);
      acts.push({ kind: 'call', amount: callAmt, label: callAmt < toCall ? `跟注全下(${callAmt})` : `跟注(${callAmt})` });
    } else {
      acts.push({ kind: 'check', amount: 0, label: '过牌' });
    }

    const canRaise = stack > toCall && s.raises < raiseCap;
    if (canRaise) {
      const pctList = toCall > 0 ? (sz.raise || []) : (sz.bet || []);
      const seen = new Set();
      let allinAdded = false;
      for (const pct of pctList) {
        let total;
        if (toCall > 0) total = toCall + Math.round((pct / 100) * (pot + toCall));
        else total = Math.max(1, Math.round((pct / 100) * pot));
        // 最小加注：加注增量不小于上一次加注增量
        const minRaiseTotal = toCall + Math.max(s.lastRaise, 1);
        if (toCall > 0 && total < minRaiseTotal) total = minRaiseTotal;
        if (total >= stack * allinThreshold || total >= stack) {
          if (useAllin && !allinAdded && stack > 0) { acts.push({ kind: 'allin', amount: stack, label: `全下(${stack})`, pct: null }); allinAdded = true; }
          continue;
        }
        if (seen.has(total)) continue;
        seen.add(total);
        const raiseTo = s.streetBets[p] + total;
        acts.push({ kind: toCall > 0 ? 'raise' : 'bet', amount: total, pct, label: toCall > 0 ? `加注至${raiseTo}(${pct}%)` : `下注${total}(${pct}%)` });
      }
      if (useAllin && !allinAdded && stack > 0 && (cfg.alwaysAllin || pctList.length === 0)) {
        acts.push({ kind: 'allin', amount: stack, label: `全下(${stack})`, pct: null });
      }
    }

    for (const a of acts) {
      const ns = applyAction(s, p, a);
      a.next = build(ns);
      node.actions.push(a);
    }
    return node;
  }

  function applyAction(s, p, a) {
    const invested = s.invested.slice(), streetBets = s.streetBets.slice(), stacks = s.stacks.slice(), alive = s.alive.slice();
    let pending = s.pending.slice(1);
    let currentBet = s.currentBet, raises = s.raises, lastRaise = s.lastRaise;
    const tag = { fold: 'F', check: 'X', call: 'C', bet: 'B', raise: 'R', allin: 'A' }[a.kind] + (a.pct != null ? a.pct : '');
    switch (a.kind) {
      case 'fold':
        alive[p] = false;
        break;
      case 'check':
        break;
      case 'call':
        invested[p] += a.amount; streetBets[p] += a.amount; stacks[p] -= a.amount;
        break;
      case 'bet': case 'raise': case 'allin': {
        invested[p] += a.amount; streetBets[p] += a.amount; stacks[p] -= a.amount;
        const newBet = streetBets[p];
        const inc = newBet - currentBet;
        if (inc > 0) {
          if (inc >= lastRaise || a.kind !== 'allin') { lastRaise = inc; raises += 1; }
          currentBet = newBet;
          // 其他还有筹码的活玩家重新进入待行动队列（按顺序，从 p 之后开始）
          pending = [];
          for (let k = 1; k < players; k++) {
            const q = (p + k) % players;
            if (alive[q] && stacks[q] > 0) pending.push(q);
          }
        }
        break;
      }
    }
    return { street: s.street, board: s.board, invested, streetBets, stacks, alive, pending, currentBet, raises, lastRaise, history: s.history + tag + '-' };
  }

  function endStreet(s) {
    const aliveList = [];
    for (let p = 0; p < players; p++) if (s.alive[p]) aliveList.push(p);
    const pot = cfg.pot + s.invested.reduce((a, b) => a + b, 0);
    const base = { pot, invested: s.invested.slice(), alive: s.alive.slice(), history: s.history, street: s.street, board: s.board };
    if (aliveList.length === 1) {
      return makeNode({ ...base, type: 'T', kind: 'fold', winner: aliveList[0] });
    }
    if (s.street === 2) {
      boardKeys.set(keyOf(s.board), s.board);
      return makeNode({ ...base, type: 'T', kind: 'showdown', boardKey: keyOf(s.board) });
    }
    const everyoneAllin = aliveList.every((p) => s.stacks[p] === 0) || aliveList.filter((p) => s.stacks[p] > 0).length <= 1;
    const nextKey = STREET_KEY[s.street + 1];
    if (everyoneAllin || leafMode[nextKey] === 'equity') {
      boardKeys.set(keyOf(s.board), s.board);
      return makeNode({ ...base, type: 'E', boardKey: keyOf(s.board), reason: everyoneAllin ? 'allin' : 'truncate' });
    }
    // 发下一张牌
    const cnode = makeNode({ ...base, type: 'C', children: [] });
    for (const c of remainingDeck(s.board)) {
      const nb = [...s.board, c];
      const pending = aliveList.filter((p) => s.stacks[p] > 0);
      const ns = { street: s.street + 1, board: nb, invested: s.invested.slice(), streetBets: new Array(players).fill(0), stacks: s.stacks.slice(), alive: s.alive.slice(), pending, currentBet: 0, raises: 0, lastRaise: 0, history: s.history + cardToStr(c) + '-' };
      cnode.children.push({ card: c, next: build(ns) });
    }
    return cnode;
  }

  const root = build({
    street: street0, board, invested: new Array(players).fill(0), streetBets: new Array(players).fill(0), stacks: new Array(players).fill(eff), alive: new Array(players).fill(true),
    pending: [...Array(players).keys()], currentBet: 0, raises: 0, lastRaise: 0, history: '',
  });

  return { root, nodes, decisionCount, players, board, street0, effStack: eff, pot0: cfg.pot, boardKeys, cfg };
}

/** 给界面显示的动作序列：'X-B33-C-Kd-X-B50-F-' -> ['过牌','下注33%','跟注','转牌Kd',...] */
function describeHistory(history) {
  return history.split('-').filter(Boolean).map((t) => {
    if (/^[2-9TJQKA][cdhs]$/.test(t)) return `发牌 ${t}`;
    const k = t[0], pct = t.slice(1);
    return { F: '弃牌', X: '过牌', C: '跟注', B: `下注${pct}%`, R: `加注${pct}%`, A: '全下' }[k] || t;
  });
}

exports.streetOfBoard = streetOfBoard;
exports.buildTree = buildTree;
exports.describeHistory = describeHistory;
exports.STREET_NAMES = STREET_NAMES;
exports.DEFAULT_SIZES = DEFAULT_SIZES;
});
