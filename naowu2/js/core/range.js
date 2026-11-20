__squidDefine('src/core/range.js', function (exports) {
'use strict';
// 范围 = Float32Array(1326)，每个组合一个 0..1 的权重。
//
// 文本语法（兼容常见解算器写法）：
//   AA            一类
//   AKs / AKo / AK（AK = 同花+非同花）
//   22+           对子往上
//   A2s+          固定高牌 A，低牌 2 往上到 K
//   T9s+          连牌：T9s JTs QJs KQs AKs（保持间隔往上）
//   QQ-88, AJs-A5s, T9s-54s   区间
//   AsKd          指定花色的单个组合
//   AA:0.5        权重（也支持 [50]AA[/50] 这种老写法）
//   random / 100% 全部
// 逗号、空格、分号都可以分隔。

const { RANKS, COMBO_COUNT, COMBOS, NOTATION_TO_COMBOS, comboToNotation, comboIndex, strToCard, rankOf } = __squidRequire('src/core/cards.js');

const R = (ch) => RANKS.indexOf(ch.toUpperCase());

function notation(hi, lo, suited) {
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (suited ? 's' : 'o');
}

/** 把单个 token 展开成记号列表 */
function expandToken(tok) {
  tok = tok.trim();
  if (!tok) return [];
  const low = tok.toLowerCase();
  if (low === 'random' || low === '100%' || low === 'all') {
    return [...NOTATION_TO_COMBOS.keys()];
  }
  // 区间 XX-YY
  const dash = tok.match(/^([2-9TJQKA]{2}[so]?)-([2-9TJQKA]{2}[so]?)$/i);
  if (dash) {
    const a = parseNotation(dash[1]), b = parseNotation(dash[2]);
    const out = [];
    if (a.hi === a.lo && b.hi === b.lo) {
      for (let r = Math.min(a.hi, b.hi); r <= Math.max(a.hi, b.hi); r++) out.push(notation(r, r, false));
      return out;
    }
    const suits = a.suited === null ? [true, false] : [a.suited];
    if (a.hi === b.hi) {
      for (let lo = Math.min(a.lo, b.lo); lo <= Math.max(a.lo, b.lo); lo++) for (const s of suits) out.push(notation(a.hi, lo, s));
      return out;
    }
    if (a.hi - a.lo === b.hi - b.lo) {
      const gap = a.hi - a.lo;
      for (let hi = Math.min(a.hi, b.hi); hi <= Math.max(a.hi, b.hi); hi++) for (const s of suits) out.push(notation(hi, hi - gap, s));
      return out;
    }
    throw new Error(`区间不合法: ${tok}`);
  }
  // 单个组合 AsKd
  const combo = tok.match(/^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/i);
  if (combo) return [tok];
  // XX+ / XYs+ / XY
  const plus = tok.match(/^([2-9TJQKA]{2})([so]?)(\+?)$/i);
  if (!plus) throw new Error(`无法解析: ${tok}`);
  const { hi, lo, suited } = parseNotation(plus[1] + plus[2]);
  const suits = suited === null ? (hi === lo ? [false] : [true, false]) : [suited];
  const out = [];
  if (!plus[3]) {
    for (const s of suits) out.push(notation(hi, lo, s));
    return out;
  }
  if (hi === lo) {
    for (let r = hi; r <= 12; r++) out.push(notation(r, r, false));
    return out;
  }
  if (hi - lo === 1) {
    for (let h = hi; h <= 12; h++) for (const s of suits) out.push(notation(h, h - 1, s));
    return out;
  }
  for (let l = lo; l < hi; l++) for (const s of suits) out.push(notation(hi, l, s));
  return out;
}

function parseNotation(s) {
  let hi = R(s[0]), lo = R(s[1]);
  if (hi < 0 || lo < 0) throw new Error(`无法解析: ${s}`);
  if (hi < lo) [hi, lo] = [lo, hi];
  const sfx = s[2] ? s[2].toLowerCase() : '';
  const suited = sfx === 's' ? true : sfx === 'o' ? false : null;
  return { hi, lo, suited };
}

/** 文本 -> Float32Array(1326) */
function parseRange(text) {
  const w = new Float32Array(COMBO_COUNT);
  if (!text || !text.trim()) return w;
  // [50]AA,KK[/50] 老写法 -> AA:0.5,KK:0.5
  text = text.replace(/\[(\d+(?:\.\d+)?)\]([^\[]*)\[\/\1\]/g, (_, pct, body) =>
    body.split(/[\s,;]+/).filter(Boolean).map((t) => `${t}:${Number(pct) / 100}`).join(','));
  for (const raw of text.split(/[\s,;]+/)) {
    if (!raw) continue;
    let weight = 1;
    let tok = raw;
    const wm = raw.match(/^(.+?):(\d*\.?\d+)$/);
    if (wm) { tok = wm[1]; weight = Number(wm[2]); if (weight > 1) weight /= 100; }
    for (const n of expandToken(tok)) {
      if (n.length === 4) {
        const idx = comboIndex(strToCard(n.slice(0, 2)), strToCard(n.slice(2)));
        w[idx] = Math.max(w[idx], weight);
      } else {
        for (const idx of NOTATION_TO_COMBOS.get(n) || []) w[idx] = Math.max(w[idx], weight);
      }
    }
  }
  return w;
}

/** Float32Array(1326) -> 紧凑文本（按 169 类聚合，混合权重的类按组合展开） */
function rangeToText(w) {
  const parts = [];
  for (const [n, idxs] of NOTATION_TO_COMBOS) {
    const ws = idxs.map((i) => w[i]);
    const nz = ws.filter((x) => x > 0);
    if (!nz.length) continue;
    const allSame = nz.length === ws.length && ws.every((x) => Math.abs(x - ws[0]) < 1e-4);
    if (allSame) parts.push(ws[0] >= 0.999 ? n : `${n}:${ws[0].toFixed(2)}`);
    else {
      for (const i of idxs) if (w[i] > 0) {
        const s = COMBOS[i].map((c) => RANKS[c >> 2] + 'cdhs'[c & 3]).join('');
        parts.push(w[i] >= 0.999 ? s : `${s}:${w[i].toFixed(2)}`);
      }
    }
  }
  return parts.join(',');
}

/** 每个 169 类的平均权重，用于 13x13 网格着色 */
function rangeByNotation(w) {
  const out = {};
  for (const [n, idxs] of NOTATION_TO_COMBOS) {
    let s = 0;
    for (const i of idxs) s += w[i];
    out[n] = s / idxs.length;
  }
  return out;
}

function rangeComboCount(w) {
  let s = 0;
  for (let i = 0; i < COMBO_COUNT; i++) s += w[i];
  return s;
}

/** 把与 dead 牌冲突的组合权重清零（返回新数组） */
function removeDead(w, dead) {
  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;
  const out = new Float32Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const [a, b] = COMBOS[i];
    out[i] = blocked[a] || blocked[b] ? 0 : w[i];
  }
  return out;
}

/** 从范围里按权重随机抽一个组合（rng 返回 [0,1)） */
function sampleCombo(w, rng) {
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) total += w[i];
  if (total <= 0) return -1;
  let x = rng() * total;
  for (let i = 0; i < COMBO_COUNT; i++) {
    x -= w[i];
    if (x <= 0) return i;
  }
  return COMBO_COUNT - 1;
}

/** 常用预设范围（只是起点，真正解算时可以随便改） */
const PRESETS = {
  '全部': 'random',
  '紧凑开池(UTG 15%)': '77+,ATs+,KQs,AJo+,KQo,T9s,98s',
  '中位开池(MP 20%)': '66+,A9s+,KTs+,QTs+,JTs,T9s,98s,87s,ATo+,KJo+',
  '按钮开池(BTN 45%)': '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,64s+,53s+,A8o+,K9o+,Q9o+,J9o+,T9o',
  '大盲防守(vs BTN)': '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o',
  '3bet范围(紧)': 'QQ+,AKs,AKo,A5s,A4s',
  '3bet范围(松)': 'TT+,AQs+,AQo+,A5s-A2s,KJs+,76s,65s',
};

exports.parseRange = parseRange;
exports.rangeToText = rangeToText;
exports.rangeByNotation = rangeByNotation;
exports.rangeComboCount = rangeComboCount;
exports.removeDead = removeDead;
exports.sampleCombo = sampleCombo;
exports.PRESETS = PRESETS;
});
