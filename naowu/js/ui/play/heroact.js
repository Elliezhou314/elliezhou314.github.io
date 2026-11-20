__squidDefine('src/ui/play/heroact.js', function (exports) {
'use strict';
// 轮到你时的操作区（从 views/play.js 拆出来，v0.16）：下注金额（快捷档位一排、滑杆 + 金额框）在上，弃牌 / 过牌或跟注 / 下注三个大键一排在下。
// 金额的算法、快捷档位、最小最大下注额都和原来一样，滑杆只是金额框的另一个入口，两边双向同步。
const { f1, h } = __squidRequire('src/ui/dom.js');

/** eng：牌局引擎（此刻轮到你）；step：下注的最小单位（小盲）；act(kind, amountTo)：做这个动作。返回要放进操作区的几块 */
function heroControls(eng, step, act) {
  const legal = eng.legalActions();
  const btnRow = h('div', { class: 'heroact' });
  let betCtl = null;
  for (const a of legal) {
    if (a.kind === 'fold') btnRow.append(h('button', { class: 'danger big', onclick: () => act('fold') }, '弃牌'));
    else if (a.kind === 'check') btnRow.append(h('button', { class: 'big', onclick: () => act('check') }, '过牌'));
    else if (a.kind === 'call') btnRow.append(h('button', { class: 'big', onclick: () => act('call') }, `跟注 ${f1(a.amount)}${a.allin ? '(全下)' : ''}`));
    else {
      const pot = eng.pot, toCall = a.toCall;
      const verb = a.kind === 'bet' ? '下注到' : '加注到';
      const amt = h('input', { type: 'number', value: Math.min(a.maxTo, Math.max(a.minTo, Math.round((pot + toCall) * 0.66 + toCall + eng.hero.streetBet))), min: a.minTo, max: a.maxTo, step, 'aria-label': verb + '多少' });
      const slider = h('input', { type: 'range', class: 'betrange', min: a.minTo, max: a.maxTo, step, value: amt.value, 'aria-label': verb + '多少（滑杆）' });
      const go = h('button', { class: 'primary big bet', onclick: () => act(a.kind, Number(amt.value)) }, verb);
      // 金额框 → 滑杆：滑杆自己会把超出范围的值钳到 [minTo, maxTo]；按钮上跟着显示金额
      const fromBox = () => { slider.value = amt.value; go.textContent = `${verb} ${f1(Number(amt.value))}`; };
      const setAmt = (x) => { amt.value = x; fromBox(); };
      slider.addEventListener('input', () => setAmt(slider.value));
      amt.addEventListener('input', fromBox);
      const quick = (frac, label) => h('button', { class: 'small', onclick: () => setAmt(Math.min(a.maxTo, Math.max(a.minTo, Math.round(eng.hero.streetBet + toCall + frac * (pot + toCall))))) }, label);
      betCtl = h('div', { class: 'betctl' },
        h('div', { class: 'quick' }, quick(0.33, '1/3'), quick(0.5, '1/2'), quick(0.75, '3/4'), quick(1, '底池'), h('button', { class: 'small', onclick: () => setAmt(a.maxTo) }, '全下')),
        h('div', { class: 'betamt' }, slider, amt));
      btnRow.append(go);
      fromBox();
    }
  }
  return betCtl ? [betCtl, btnRow] : [btnRow];
}

exports.heroControls = heroControls;
});
