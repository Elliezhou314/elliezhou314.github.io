__squidDefine('src/ui/review/transfer.js', function (exports) {
'use strict';
// 「历史与数据」签的「数据」面板：进度搬家与清空。
//
// 文件导出 / 导入在 iPhone 的全屏网页应用和安卓安装包里都靠不住（下载不知道落到哪、选文件的框可能不弹），
// 所以另给一条不靠文件的路：
//   复制进度  把进度文本写进剪贴板；剪贴板被拒绝时，改成显示一个已全选的文本框，让玩家自己复制。
//   粘贴导入  粘贴后先预览这份进度里有什么（数字全由 train/training.js 的 inspect / summarizeProgress 现数），
//             玩家点「确认覆盖」才替换当前进度；不是合法进度时说明原因，现有进度一点不动。
// 文件导入也走同一个预览；覆盖和清空的确认都是页面里的两步按钮，不用浏览器的 confirm()（有些全屏环境里它不弹）。
const { summarizeProgress } = __squidRequire('src/train/training.js');
const { appendTo, h, toast } = __squidRequire('src/ui/dom.js');
const { refreshView } = __squidRequire('src/ui/router.js');
const { store } = __squidRequire('src/ui/services.js');
const { applySettings } = __squidRequire('src/ui/settings.js');

/** 换掉一个元素的全部内容（不用 replaceChildren：旧安卓内核不认） */
const setKids = (el, ...kids) => { el.innerHTML = ''; return appendTo(el, ...kids); };

/** 文本大约多大：按 UTF-8 字节数 */
function sizeText(text) {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} 字节` : `约 ${(bytes / 1024).toFixed(1)} KB`;
}

/** 一份进度的摘要写成一句话（数字全来自 summarizeProgress） */
function summaryText(s) {
  const parts = [
    `训练记录 ${s.attempts} 条`,
    `自由牌局 ${s.hands} 手`,
    `数学竞赛 ${s.puzzles} 道题的作答（解出 ${s.puzzlesSolved} 道）`,
    `限时速算最好 ${s.speedBest} 题（挑战 ${s.speedRuns} 局）`,
    `闯关 ${s.levels} 关有成绩`,
  ];
  if (s.scenarios) parts.push(`自定义场景 ${s.scenarios} 个`);
  if (s.seasonScore) parts.push(`赛季分 ${Math.round(s.seasonScore)}`);
  return parts.join('、');
}

/** 导入成功之后：设置跟着换、相关页面按新进度重画 */
function afterImport(r) {
  applySettings();
  toast(`已导入：${r.attempts} 条训练记录、${r.hands} 手牌局、${r.scenarios} 个自定义场景、${r.puzzles} 道题的作答`, 4000);
  refreshView('review'); refreshView('drill'); refreshView('campaign'); refreshView('contest');
}

/** 预览一份进度文本：合法就列出内容并给「确认覆盖 / 取消」两步按钮，不合法就说明原因 */
function showPreview(stage, text, source) {
  stage.innerHTML = '';
  let res;
  try { res = store.inspect(text); } catch (e) {
    stage.append(h('div', { class: 'verdict wrong xferr', 'data-state': 'rejected' }, `没有导入${source}：${e.message}。现在的进度没有动。`));
    return;
  }
  const s = res.summary;
  const box = h('div', { class: 'xfpreview', 'data-state': 'preview', 'data-attempts': String(s.attempts), 'data-hands': String(s.hands),
    'data-puzzles': String(s.puzzles), 'data-speed-best': String(s.speedBest), 'data-levels': String(s.levels) },
  h('div', {}, h('b', {}, `${source}里有：`), summaryText(s), '。'),
  h('div', { class: 'small muted' }, '本机现在的进度：', summaryText(summarizeProgress(store.data)), '。'),
  h('div', { class: 'note' }, '确认后，本机现在的进度会被这一份整个替换，不能撤销。想先留一份底，就先点上面的「复制进度」或「导出进度」。'),
  h('div', { class: 'row' },
    h('button', { class: 'danger', 'data-act': 'import-confirm', onclick: () => {
      try { afterImport(store.import(text)); } catch (e) { setKids(stage, h('div', { class: 'verdict wrong xferr' }, '导入失败：' + e.message)); }
    } }, '确认覆盖当前进度'),
    h('button', { 'data-act': 'import-cancel', onclick: () => setKids(stage, h('div', { class: 'small muted', 'data-state': 'cancelled' }, '已取消，进度没有动。')) }, '取消')));
  stage.append(box);
  if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}

/** 复制进度：先试剪贴板，被拒绝（或没有剪贴板接口）就把文本摆出来、全选好 */
function copyProgress(out) {
  const text = store.export(true);
  const size = sizeText(text);
  const how = '把它发给自己（聊天软件、邮件、备忘录都行），在另一台设备上打开脑雾克星，到「复盘与漏洞 → 历史与数据」的「粘贴导入」里粘贴。';
  const manual = () => {
    const ta = h('textarea', { class: 'xftext', readonly: true, rows: 5, 'aria-label': '进度文本' });
    ta.value = text;
    setKids(out, h('div', { class: 'note', 'data-state': 'manual' }, `浏览器没让直接写剪贴板。下面是全部进度文本（${size}，${text.length} 个字符），已经全选好了：`
      + '手机上长按选中的文字点「拷贝」，电脑上按 Ctrl+C。然后' + how), ta);
    ta.focus(); ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* 有的浏览器对只读框不认，select() 已经够了 */ }
  };
  // writeText 必须在点按的同一拍里调用（iPhone 要求），所以这里不先 await 别的
  let p = null;
  try { p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : null; } catch (e) { p = null; }
  if (!p) { manual(); return; }
  p.then(() => setKids(out, h('div', { class: 'note', 'data-state': 'copied' }, `已复制到剪贴板（${size}，${text.length} 个字符）。` + how
    + '很长的消息有的聊天软件会截断，截断了导入时会说明，换备忘录或邮件就好。')), manual);
}

function exportFile() {
  const blob = new Blob([store.export()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `squid-progress-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
}

function resetBox() {
  const box = h('div', { class: 'row xfreset' });
  const idle = () => setKids(box, h('button', { class: 'danger', 'data-act': 'reset', onclick: ask }, '清空记录'));
  const ask = () => setKids(box,
    h('span', { class: 'small', 'data-state': 'ask' }, '确定清空全部进度？训练记录、牌局、答题、闯关星级、速算成绩都会清掉，不能撤销。'),
    h('button', { class: 'danger', 'data-act': 'reset-confirm', onclick: () => { store.reset(); applySettings(); refreshView('review'); refreshView('drill'); refreshView('campaign'); refreshView('contest'); } }, '确认清空'),
    h('button', { 'data-act': 'reset-cancel', onclick: idle }, '取消'));
  idle();
  return box;
}

/** 整个「数据」面板 */
function dataPanel() {
  const copyOut = h('div', { class: 'xfout' });
  const stage = h('div', { class: 'xfstage' });
  const paste = h('textarea', { class: 'xfpaste', rows: 4, 'data-act': 'paste-text', placeholder: '把「复制进度」得到的那段文字粘贴到这里', 'aria-label': '粘贴进度文本' });
  const onFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => showPreview(stage, t, '这个文件'), (err) => setKids(stage, h('div', { class: 'verdict wrong xferr' }, '这个文件读不出来：' + err.message + '。现在的进度没有动。')));
    e.target.value = '';
  };
  return h('div', { class: 'panel xfpanel' }, h('h2', {}, '数据'),
    h('h3', {}, '搬到另一台设备（不用文件）'),
    h('div', { class: 'small muted' }, '手机的全屏应用、安卓安装包里下载和选文件常常不好使，用这条路：这边「复制进度」，那边「粘贴导入」。'),
    h('div', { class: 'row' }, h('button', { class: 'primary', 'data-act': 'copy', onclick: () => copyProgress(copyOut) }, '复制进度')),
    copyOut,
    h('h3', {}, '粘贴导入'),
    paste,
    h('div', { class: 'row' }, h('button', { 'data-act': 'paste-read', onclick: () => showPreview(stage, paste.value, '粘贴的这段进度') }, '读取这段进度')),
    stage,
    h('h3', {}, '文件'),
    h('div', { class: 'row' },
      h('button', { 'data-act': 'export', onclick: exportFile }, '导出进度'),
      h('label', { class: 'small' }, '从文件导入：', h('input', { type: 'file', accept: '.json,application/json', 'data-act': 'import', onchange: onFile }))),
    h('h3', {}, '清空'),
    resetBox());
}

exports.sizeText = sizeText;
exports.summaryText = summaryText;
exports.dataPanel = dataPanel;
});
