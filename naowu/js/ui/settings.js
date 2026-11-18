__squidDefine('src/ui/settings.js', function (exports) {
'use strict';
// 界面设置：目前只有音效开关。
// 状态存在进度对象的 settings.sfx（train/training.js 的 coerceProgress 负责校验、并把 v0.8 借放在
// 赛季 seen 表里的旧值迁移过来），导出导入进度时一起带着。默认关。
// 开关按钮可能同时出现在两处（电脑上的顶栏、手机上的「更多」面板），点哪一个都同步更新全部。
const { h } = __squidRequire('src/ui/dom.js');
const { store } = __squidRequire('src/ui/services.js');
const { setSoundOn, sfx, soundOn } = __squidRequire('src/ui/sfx.js');

const buttons = new Set();

function label() { return `音效：${soundOn() ? '开' : '关'}`; }

function refreshButtons() {
  for (const b of buttons) {
    b.textContent = label();
    b.setAttribute('aria-pressed', String(soundOn()));
    b.classList.toggle('on', soundOn());
  }
}

/** 启动时、导入进度后调用：按存档里的设置把音效开关摆好 */
function applySettings() {
  const st = store.data.settings || {};
  setSoundOn(st.sfx === true);
  refreshButtons();
}

function toggleSound() {
  setSoundOn(!soundOn());
  store.data.settings = store.data.settings || {};
  store.data.settings.sfx = soundOn();
  store.save();
  refreshButtons();
  if (soundOn()) sfx.chip();   // 打开时响一声，让人知道声音确实出得来
}

/** 造一个音效开关按钮（可以造多个，状态同步） */
function soundButton(extraClass = '') {
  const b = h('button', { class: ('sfxbtn ' + extraClass).trim(), onclick: () => toggleSound() });
  buttons.add(b);
  refreshButtons();
  return b;
}

exports.applySettings = applySettings;
exports.toggleSound = toggleSound;
exports.soundButton = soundButton;
});
