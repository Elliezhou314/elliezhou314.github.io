__squidDefine('src/ui/dom.js', function (exports) {
'use strict';
// 界面小工具：建 DOM、格式化数字、提示条、13×13 网格。不依赖任何视图。
// 牌面在 cards.js（它可以用这里的东西，这里不反过来引用它，免得成环）。
const { NOTATIONS_GRID } = __squidRequire('src/core/cards.js');

/** 原生 Element.append(null) 会插入字符串 "null"，这里统一过滤掉空值 */
function appendTo(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);

const pct = (x, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');

const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString() : '—');

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');

function toast(msg, ms = 2600) {
  // 位置写在 style.css 的 .toast 里：手机宽度下要让到底部导航上方，内联样式就压不住了
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), ms);
}

const ACTION_BASE = { fold: '#3b82f6', check: '#22c55e', call: '#16a34a', bet: '#ef4444', raise: '#dc2626', allin: '#7c3aed' };

function actionColors(actions) {
  const bets = actions.filter((a) => a.kind === 'bet' || a.kind === 'raise');
  return actions.map((a) => {
    if (a.kind === 'bet' || a.kind === 'raise') {
      const i = bets.indexOf(a), n = bets.length;
      const light = n > 1 ? 68 - (i / (n - 1)) * 30 : 55;
      return `hsl(0 80% ${light}%)`;
    }
    return ACTION_BASE[a.kind] || '#888';
  });
}

/** 13x13 网格。getCell(notation) -> { weight, probs?, colors?, label? } */
function renderGrid(getCell, onCell, onHover) {
  const g = h('div', { class: 'grid13' });
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
    const nt = NOTATIONS_GRID[r][c];
    const info = getCell(nt) || { weight: 0 };
    const cell = h('div', { class: 'cell' + (info.weight > 0 ? ' on' : ''), 'data-nt': nt });
    if (info.probs && info.colors) {
      let acc = 0; const stops = [];
      info.probs.forEach((p, i) => { const s = acc * 100, e = (acc + p) * 100; stops.push(`${info.colors[i]} ${s.toFixed(1)}% ${e.toFixed(1)}%`); acc += p; });
      cell.append(h('div', { class: 'bar', style: { background: `linear-gradient(90deg,${stops.join(',')})`, opacity: String(0.25 + 0.75 * Math.min(1, info.weight)) } }));
    } else if (info.weight > 0) {
      cell.append(h('div', { class: 'bar', style: { background: info.color || 'var(--accent)', opacity: String(0.2 + 0.8 * Math.min(1, info.weight)) } }));
    }
    cell.append(h('span', {}, info.label || nt));
    if (onCell) cell.addEventListener('click', (e) => onCell(nt, e));
    if (onHover) cell.addEventListener('mouseenter', () => onHover(nt));
    g.append(cell);
  }
  return g;
}

function legendEl(actions, colors) {
  return h('div', { class: 'legend' }, actions.map((a, i) => h('span', {}, h('i', { style: { background: colors[i] } }), a.label)));
}

exports.appendTo = appendTo;
exports.h = h;
exports.toast = toast;
exports.actionColors = actionColors;
exports.renderGrid = renderGrid;
exports.legendEl = legendEl;
exports.$ = $;
exports.pct = pct;
exports.f1 = f1;
exports.f2 = f2;
});
