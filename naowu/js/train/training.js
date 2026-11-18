__squidDefine('src/train/training.js', function (exports) {
'use strict';
// 训练系统：场景库、特训地图、间隔重复、错误日志与漏洞报告。
// 判分口径：EV 损失 = 该点最高 EV 动作 − 你选的动作 EV（筹码），并换算成底池百分比。
//   2 人局：EV 由向量 CFR 精确计算；3 人局：蒙特卡洛估计，附标准误。

const { COMBOS, COMBO_COUNT, NOTATION_TO_COMBOS, comboToNotation, comboToPretty, cardToStr, parseCards, makeRng, cardsToPretty } = __squidRequire('src/core/cards.js');
const { sampleCombo, removeDead, parseRange } = __squidRequire('src/core/range.js');
const { emptySpeedRecord, coerceSpeedRecord } = __squidRequire('src/train/speed.js');
const { emptyVariantRecord, coerceVariantRecord, variantTotals } = __squidRequire('src/train/variants/record.js');

// ---------------------------------------------------------------------------
// 预置场景（范围是示例起点，都可以在界面里改；筹码单位 = 大盲）
// ---------------------------------------------------------------------------
const R = {
  btnOpen: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,64s+,53s+,A8o+,K9o+,Q9o+,J9o+,T9o',
  bbDefendVsBtn: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,98o',
  coOpen: '22+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,87s,76s,A9o+,KTo+,QTo+,JTo',
  btn3bet: 'TT+,AQs+,AQo+,A5s-A2s,KJs+,76s,65s',
  coCall3bet: '99-22,AJs-A2s,KTs+,QTs+,JTs,T9s,98s,87s,AQo,AJo,KQo',
  sbCallBtn: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,ATo+,KJo+,QJo',
  bb3wayDefend: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,64s+,A5o+,K9o+,Q9o+,J9o+,T9o',
  riverPolar: 'AA,KK,QQ,54s,65s,76s,87s,98s,T9s',
  riverBluffCatch: 'JJ,TT,99,88,AJs,AJo,KJs',
};

const SCENARIOS = [
  { id: 'srp-btn-bb-dry', group: '翻牌持续下注', name: 'SRP 按钮 vs 大盲：干燥 A 高牌面', players: 2, positions: ['BB', 'BTN'], heroSeat: 1, boards: ['Ah7d2c', 'Ks8c3d', 'Ac9h4s'], pot: 5.5, stack: 97, ranges: [R.bbDefendVsBtn, R.btnOpen], sizes: { flop: { bet: [33, 75], raise: [60] }, turn: { bet: [66], raise: [60] } }, raiseCap: 2, leafMode: { turn: 'equity' }, desc: '你在按钮位翻前开池，大盲跟注。翻牌 A 高干燥面，大盲过牌给你。', goal: '理解范围优势与坚果优势如何决定持续下注频率与尺度。' },
  { id: 'srp-btn-bb-wet', group: '翻牌持续下注', name: 'SRP 按钮 vs 大盲：湿润连接面', players: 2, positions: ['BB', 'BTN'], heroSeat: 1, boards: ['Ts9s8d', 'Jh9h7c', '8d7c6s'], pot: 5.5, stack: 97, ranges: [R.bbDefendVsBtn, R.btnOpen], sizes: { flop: { bet: [33, 75], raise: [60] }, turn: { bet: [66], raise: [60] } }, raiseCap: 2, leafMode: { turn: 'equity' }, desc: '同样的翻前，但翻牌是湿润连接面。大盲过牌。', goal: '湿面上范围优势缩小，学会降低持续下注频率、用更大尺度。' },
  { id: 'srp-bb-defend', group: '翻牌防守', name: 'SRP 大盲防守：面对按钮持续下注', players: 2, positions: ['BB', 'BTN'], heroSeat: 0, boards: ['Qd7c2h', 'Jc8s4d', '9h6d3c'], pot: 5.5, stack: 97, ranges: [R.bbDefendVsBtn, R.btnOpen], sizes: { flop: { bet: [33, 75], raise: [60] }, turn: { bet: [66], raise: [60] } }, raiseCap: 2, leafMode: { turn: 'equity' }, desc: '你在大盲跟注按钮开池。翻牌你过牌，按钮下注。', goal: '用最小防守频率（MDF）思路决定跟注/加注/弃牌，别过度弃牌。' },
  { id: '3bp-btn-vs-co', group: '3bet 底池', name: '3bet 底池：按钮 3bet，CO 跟注，K 高面', players: 2, positions: ['CO', 'BTN'], heroSeat: 1, boards: ['Kh7d2s', 'Kc9d4h', 'Qs6c2d'], pot: 20, stack: 90, ranges: [R.coCall3bet, R.btn3bet], sizes: { flop: { bet: [33, 66], raise: [60] }, turn: { bet: [66], raise: [60] } }, raiseCap: 2, leafMode: { turn: 'equity' }, desc: 'CO 开池，你在按钮 3bet，CO 跟注。翻牌 CO 过牌给你。', goal: '低 SPR 下的持续下注：小尺度高频率 vs 过牌，以及何时准备全下。' },
  { id: 'turn-barrel', group: '转牌决策', name: '转牌二次开火：翻牌下注被跟注后', players: 2, positions: ['BB', 'BTN'], heroSeat: 1, boards: ['Kd8s3c6h', 'Qh7d2c9s', 'Ac8d5hJc'], pot: 12, stack: 93, ranges: ['22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,A2o+,K7o+,Q8o+,J8o+,T8o+', '77+,A9s+,KTs+,QTs+,JTs,T9s,98s,ATo+,KJo+,QJo,A5s-A2s,K8s,Q9s,J9s,T8s,97s,86s,75s'], sizes: { turn: { bet: [50, 100], raise: [60] }, river: { bet: [50, 100], raise: [60] } }, raiseCap: 2, desc: '翻牌你下注 1/3 底池被大盲跟注。转牌来了，大盲再次过牌。（范围已按翻牌行动粗略收窄，可自行修改）', goal: '识别哪些转牌利于你继续开火、哪些该放弃；平衡价值与半诈唬。' },
  { id: 'river-polar', group: '河牌价值与诈唬', name: '河牌极化下注：价值 + 诈唬配比', players: 2, positions: ['OOP', 'IP'], heroSeat: 0, boards: ['Kh9d4s2c7h', 'Qs8d3h5cJd'], pot: 30, stack: 60, ranges: [R.riverPolar, R.riverBluffCatch], sizes: { river: { bet: [50, 100], raise: [] } }, raiseCap: 1, desc: '河牌，你的范围极化（坚果或空气），对手一手中等牌。你先行动。', goal: '掌握价值/诈唬配比公式：诈唬频率 = 下注/(下注+底池) ，尺度越大诈唬越多。' },
  { id: 'river-bluffcatch', group: '河牌抓诈', name: '河牌抓诈：面对极化下注', players: 2, positions: ['OOP', 'IP'], heroSeat: 1, boards: ['Kh9d4s2c7h', 'Qs8d3h5cJd'], pot: 30, stack: 60, ranges: [R.riverPolar, R.riverBluffCatch], sizes: { river: { bet: [50, 100], raise: [] } }, raiseCap: 1, desc: '河牌，对手极化范围向你下注，你拿中等牌。', goal: '用 MDF = 底池/(底池+下注) 决定跟注频率，并利用阻挡牌选择跟注组合。' },
  { id: '3way-srp-flop', group: '3 人局', name: '3 人底池：按钮 vs 小盲 vs 大盲，翻牌', players: 3, positions: ['SB', 'BB', 'BTN'], heroSeat: 2, boards: ['Jh8d3c', 'Kd7s2h', 'Ts9c4d'], pot: 9, stack: 97, ranges: [R.sbCallBtn, R.bb3wayDefend, R.btnOpen], sizes: { flop: { bet: [33, 66], raise: [60] } }, raiseCap: 2, leafMode: { turn: 'equity' }, engine: 'sampled', desc: '你按钮开池，小盲和大盲都跟注。翻牌两位都过牌给你。（3 人局：采样近似解，河牌前截断）', goal: '多人底池权益被稀释，持续下注要更紧、更偏价值；理解“中间位置”被夹击的风险。' },
  { id: '3way-river', group: '3 人局', name: '3 人河牌：夹在中间', players: 3, positions: ['OOP', 'MP', 'IP'], heroSeat: 1, boards: ['Qd9c5s2hKc', 'Jh7d4c8sAd'], pot: 24, stack: 50, ranges: ['QQ,99,55,KQs,AQs,J9s,T8s,76s,A5s', 'AQo,KQo,QJs,QTs,JJ,TT,88,77,A9s', 'KK,AA,K9s,K5s,JTs,T9s,87s,65s,A2s,A3s'], sizes: { river: { bet: [50, 100], raise: [70] } }, raiseCap: 2, engine: 'sampled', desc: '河牌 3 人底池，你在中间位置。OOP 先行动。', goal: '夹击位置的抓诈要比单挑紧得多：还有人在后面。' },
];

// ---------------------------------------------------------------------------
// 特训地图
// ---------------------------------------------------------------------------
const DRILL_MAP = [
  { id: 'm1', name: '翻前基本功', scenarios: [], kind: 'preflop', desc: '按位置开池 / 面对开池防守 / 3bet 与 4bet。用翻前预解算图做闪卡。', requires: [] },
  { id: 'm2', name: '翻牌持续下注', scenarios: ['srp-btn-bb-dry', 'srp-btn-bb-wet'], desc: '范围优势决定频率，坚果优势决定尺度。', requires: [] },
  { id: 'm3', name: '翻牌防守', scenarios: ['srp-bb-defend'], desc: 'MDF 与加注范围构建。', requires: ['m2'] },
  { id: 'm4', name: '3bet 底池', scenarios: ['3bp-btn-vs-co'], desc: '低 SPR 决策。', requires: ['m2'] },
  { id: 'm5', name: '转牌决策', scenarios: ['turn-barrel'], desc: '二次开火与放弃。', requires: ['m3'] },
  { id: 'm6', name: '河牌价值与诈唬', scenarios: ['river-polar'], desc: '价值:诈唬配比。', requires: ['m5'] },
  { id: 'm7', name: '河牌抓诈', scenarios: ['river-bluffcatch'], desc: 'MDF 与阻挡牌。', requires: ['m5'] },
  { id: 'm8', name: '3 人局', scenarios: ['3way-srp-flop', '3way-river'], desc: '多人底池的权益稀释与夹击。', requires: ['m6', 'm7'] },
];

// ---------------------------------------------------------------------------
// 进度存储（localStorage，可导入导出）
// ---------------------------------------------------------------------------
const KEY = 'squid.progress.v1';

const emptyProgress = () => ({
  version: 1, attempts: [], srs: {}, customScenarios: [], hands: [], puzzles: {},
  levels: {},   // 关卡成绩：{ [levelId]: { stars, bestScore, runs, bestLossPct } }
  season: { score: 0, bestCombo: 0, labRuns: 0, daily: {}, dailyStreak: 0, lastDaily: null, seen: {} },
  settings: { sfx: false },   // 界面设置：音效开关（默认关）
  speed: emptySpeedRecord(),  // 限时速算：{ best 最好成绩（答对数）, runs 60 秒挑战的局数, byType 各题型累计对错, history 逐局历史（v0.11 起，最多 200 局） }
  variants: emptyVariantRecord(),  // 数学竞赛的变式练习（v0.13）：{ byType: { P01: { done 做了几道, firstTry 其中第一次就答对的 }, … } }
});

/**
 * 把任意读到的东西整形成合法进度对象。
 * localStorage 里可能是 'null'、'[]'、旧版本数据、别人导入的半截 JSON——
 * 早先版本直接把 JSON.parse 的结果当 data，启动时 buildDrillView 就会抛异常、四个视图全白。
 */
function coerceProgress(raw) {
  const d = emptyProgress();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  if (Array.isArray(raw.attempts)) d.attempts = raw.attempts.filter((a) => a && typeof a === 'object');
  if (raw.srs && typeof raw.srs === 'object' && !Array.isArray(raw.srs)) {
    for (const [k, v] of Object.entries(raw.srs)) {
      if (!v || typeof v !== 'object') continue;
      d.srs[k] = {
        ease: Number.isFinite(v.ease) ? Math.min(3.5, Math.max(1.3, v.ease)) : 2.5,
        interval: Number.isFinite(v.interval) && v.interval >= 0 ? Math.min(v.interval, 365) : 0,
        reps: Number.isInteger(v.reps) && v.reps >= 0 ? v.reps : 0,
        due: Number.isFinite(v.due) ? v.due : 0,
        lastQ: Number.isFinite(v.lastQ) ? v.lastQ : undefined,
      };
    }
  }
  if (Array.isArray(raw.customScenarios)) d.customScenarios = raw.customScenarios.filter((s) => s && s.id && Array.isArray(s.ranges) && Array.isArray(s.boards));
  if (Array.isArray(raw.hands)) d.hands = raw.hands.filter((r) => r && Array.isArray(r.seats) && Array.isArray(r.board));
  // puzzles 也要逐条整形：记录是标量时界面读 rec.attempts 会抛，
  // usedHints 是个巨大的数时渲染提示的循环会把标签页卡死。
  if (raw.levels && typeof raw.levels === 'object' && !Array.isArray(raw.levels)) {
    for (const [k, v] of Object.entries(raw.levels)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      d.levels[k] = {
        stars: Number.isInteger(v.stars) ? Math.min(3, Math.max(0, v.stars)) : 0,
        bestScore: Number.isFinite(v.bestScore) ? Math.max(0, Math.min(v.bestScore, 1e9)) : 0,
        runs: Number.isInteger(v.runs) && v.runs >= 0 ? Math.min(v.runs, 1e6) : 0,
        bestLossPct: Number.isFinite(v.bestLossPct) ? v.bestLossPct : null,
      };
    }
  }
  if (raw.season && typeof raw.season === 'object' && !Array.isArray(raw.season)) {
    const t = raw.season;
    d.season = {
      score: Number.isFinite(t.score) ? Math.max(0, Math.min(t.score, 1e9)) : 0,
      bestCombo: Number.isInteger(t.bestCombo) ? Math.max(0, Math.min(t.bestCombo, 1e4)) : 0,
      labRuns: Number.isInteger(t.labRuns) ? Math.max(0, Math.min(t.labRuns, 1e6)) : 0,
      // daily 的值只认对象或 true，别的（0/null/字符串）会让「今天完成了没」判定出错
      daily: (() => {
        const out = {};
        if (t.daily && typeof t.daily === 'object' && !Array.isArray(t.daily)) {
          for (const [k, v] of Object.entries(t.daily)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
            if (v === true) out[k] = { p: [true, true], drill: true };
            else if (v && typeof v === 'object' && !Array.isArray(v)) {
              out[k] = { p: [!!(v.p && v.p[0]), !!(v.p && v.p[1])], drill: !!v.drill };
            }
          }
        }
        return out;
      })(),
      dailyStreak: Number.isInteger(t.dailyStreak) ? Math.max(0, Math.min(t.dailyStreak, 1e4)) : 0,
      lastDaily: typeof t.lastDaily === 'string' ? t.lastDaily : null,
      seen: (() => {
        const out = {};
        if (t.seen && typeof t.seen === 'object' && !Array.isArray(t.seen)) for (const [k, v] of Object.entries(t.seen)) out[k] = !!v;
        return out;
      })(),
    };
  }
  // 设置：只认布尔值，别的（字符串 'yes'、1、null）一律回到默认的「关」。
  // v0.8 的音效开关借放在 season.seen.sfx（当时这里还没有 settings 字段），旧存档读进来时搬到这里，
  // 并从 seen 里拿掉，免得同一个开关存两处。两处都有时以 settings 为准。
  const oldSfx = d.season.seen && Object.prototype.hasOwnProperty.call(d.season.seen, 'sfx') ? d.season.seen.sfx : undefined;
  if (oldSfx !== undefined) { d.settings.sfx = oldSfx; delete d.season.seen.sfx; }
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) && Object.prototype.hasOwnProperty.call(raw.settings, 'sfx')) {
    d.settings.sfx = typeof raw.settings.sfx === 'boolean' ? raw.settings.sfx : false;
  }
  // 限时速算的记录（v0.10 加的字段）：逐项只认非负整数、不认识的题型丢掉，校验规则在 speed.js 的 coerceSpeedRecord。
  // 旧存档没有这个字段时就是空记录（最好成绩 0、局数 0、各题型 0 对 0 错）。
  d.speed = coerceSpeedRecord(raw.speed);
  // 变式练习的记录（v0.13 加的字段）：只认非负整数、第一次就答对的不超过做了的、不认识的题型丢掉，规则在 variants/record.js。旧存档没有这个字段时给空记录。
  d.variants = coerceVariantRecord(raw.variants);
  if (raw.puzzles && typeof raw.puzzles === 'object' && !Array.isArray(raw.puzzles)) {
    for (const [k, v] of Object.entries(raw.puzzles)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      d.puzzles[k] = {
        attempts: Number.isInteger(v.attempts) && v.attempts >= 0 ? Math.min(v.attempts, 1e6) : 0,
        solved: !!v.solved,
        exact: !!v.exact,
        usedHints: Number.isInteger(v.usedHints) && v.usedHints >= 0 ? Math.min(v.usedHints, 20) : 0,
        lastAnswer: typeof v.lastAnswer === 'string' ? v.lastAnswer.slice(0, 200) : '',
      };
      // 历史最好星级（第一次就答对时落盘，之后再答也不掉星）。v0.11 之前这里漏了它，导入进度后
      // 「第一次就答对、后来又答过一次」的题会从 3 星掉成 1 星，在错题本里被误列成「没一次做对」。
      if (Number.isInteger(v.bestStars) && v.bestStars >= 1 && v.bestStars <= 3) d.puzzles[k].bestStars = v.bestStars;
    }
  }
  return d;
}

/**
 * 一份（已整形的）进度里有什么：给「粘贴导入」的预览、导入成功的提示用。全是从进度对象里数出来的真实数。
 * empty 为真表示什么都没有（和导入时「没有可识别的进度数据」是同一条判据）。
 */
function summarizeProgress(d) {
  const puzzles = Object.values(d.puzzles || {});
  const season = d.season || {};
  const hasSeason = season.score > 0 || season.dailyStreak > 0 || Object.keys(season.daily || {}).length > 0;
  const out = {
    attempts: d.attempts.length,
    hands: d.hands.length,
    puzzles: puzzles.length,
    puzzlesSolved: puzzles.filter((p) => p.solved).length,
    levels: Object.keys(d.levels || {}).length,
    scenarios: d.customScenarios.length,
    srs: Object.keys(d.srs || {}).length,
    speedBest: d.speed ? d.speed.best : 0,
    speedRuns: d.speed ? d.speed.runs : 0,
    variantsDone: variantTotals(d.variants).done,
    variantsFirst: variantTotals(d.variants).firstTry,
    seasonScore: season.score || 0,
  };
  out.empty = !out.attempts && !out.srs && !out.hands && !out.scenarios && !out.puzzles && !out.levels && !hasSeason && !out.speedRuns && !out.variantsDone;
  return out;
}

class ProgressStore {
  constructor(storage) {
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.data = this._load();
  }
  _load() {
    let raw = null;
    try { raw = this.storage && this.storage.getItem(KEY); } catch (e) { return emptyProgress(); } // 隐私模式下 getItem 也可能抛
    if (!raw) return emptyProgress();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {
      this.loadError = '本地进度数据已损坏，已重置（旧数据保留在 ' + KEY + '.broken）';
      try { this.storage.setItem(KEY + '.broken', raw); this.storage.removeItem(KEY); } catch (e2) { /* 满了就算了 */ }
      return emptyProgress();
    }
    const d = coerceProgress(parsed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(parsed.attempts) && Object.keys(parsed).length) {
      this.loadError = '本地进度数据格式不认识，已按空进度启动。';
    }
    return d;
  }
  save() {
    try { this.storage && this.storage.setItem(KEY, JSON.stringify(this.data)); this.saveError = null; } catch (e) {
      // 配额满：先砍历史手牌，再砍训练记录，还不行就如实报错，不能静默丢数据
      this.saveError = e && e.name === 'QuotaExceededError' ? '本地存储已满' : '本地存储写入失败';
      try {
        this.data.hands = this.data.hands.slice(-40);
        this.data.attempts = this.data.attempts.slice(-800);
        this.storage.setItem(KEY, JSON.stringify(this.data));
        this.saveError = '本地存储接近上限，已自动清理较早的历史记录';
      } catch (e2) { /* 仍然失败就保留 saveError 让界面提示 */ }
    }
  }
  /** 导出成文本。compact 为真时不缩进（「复制进度」用，文本小一些）；两种写法读回来完全一样 */
  export(compact = false) { return compact ? JSON.stringify(this.data) : JSON.stringify(this.data, null, 2); }
  /**
   * 读一份进度文本但**不落盘**：整形后返回进度对象和摘要（给「粘贴导入」先预览用）。
   * 不是合法进度时抛错，错误信息直接给玩家看；当前进度一点不动。
   * 粘贴时前后常带着别的字（「这是我的进度：」、聊天软件加的换行），所以只取第一个「{」到最后一个「}」之间的部分。
   */
  inspect(text) {
    const s = String(text == null ? '' : text);
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error(s.trim() ? '这段文字里找不到进度数据（进度文本以「{」开头、以「}」结尾）' : '还没有粘贴任何内容');
    let parsed;
    try { parsed = JSON.parse(s.slice(a, b + 1)); } catch (e) {
      throw new Error('这段文字不是完整的进度数据，可能没复制全（有的聊天软件会截断很长的消息，换成备忘录或邮件再试）');
    }
    const d = coerceProgress(parsed);
    const sum = summarizeProgress(d);
    if (sum.empty) throw new Error('这段文字里没有可识别的进度数据');
    return { data: d, summary: sum };
  }
  import(json) {
    const { data: d } = this.inspect(json);
    this.data = d; this.save();
    return { attempts: d.attempts.length, hands: d.hands.length, scenarios: d.customScenarios.length, puzzles: Object.keys(d.puzzles).length, levels: Object.keys(d.levels).length };
  }
  reset() { this.data = emptyProgress(); this.save(); }

  addAttempt(a) { this.data.attempts.push(a); if (this.data.attempts.length > 5000) this.data.attempts.shift(); this.save(); }
  addHand(rec) { this.data.hands.push(rec); if (this.data.hands.length > 300) this.data.hands.shift(); this.save(); }

  /** SM-2 精简版：q 0~5 */
  reviewScenario(id, q) {
    const s = this.data.srs[id] || { ease: 2.5, interval: 0, reps: 0, due: 0 };
    if (q < 3) { s.reps = 0; s.interval = 0; }
    else { s.interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.interval * s.ease); s.reps++; }
    s.ease = Math.max(1.3, s.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    s.due = Date.now() + s.interval * 86400000;
    s.lastQ = q;
    this.data.srs[id] = s;
    this.save();
    return s;
  }

  dueScenarios(all) {
    const now = Date.now();
    return all.filter((sc) => { const s = this.data.srs[sc.id]; return !s || s.due <= now; });
  }

  moduleStats(mod, all) {
    const ids = new Set(mod.scenarios);
    const at = this.data.attempts.filter((a) => ids.has(a.scenarioId) && Number.isFinite(a.evLossPct)).slice(-40);
    if (!at.length) return { attempts: 0, accuracy: null, avgLossPct: null, unlocked: this.isUnlocked(mod) };
    const avgLoss = at.reduce((s, a) => s + a.evLossPct, 0) / at.length;
    const acc = at.filter((a) => !MISTAKE_GRADES.has(a.grade)).length / at.length;
    // "已掌握"还要求真的下过注：只按过牌/跟注也能刷出高正确率，所以要求出现过下注/加注类动作
    // 只认主动投入的动作。tree.js 里的「跟注全下(N)」标签含「全下」二字但那是被动跟注，
    // 用它凑数就又能靠纯被动打法刷出「已掌握」。
    const aggressive = at.filter((a) => { const c = a.chosen || ''; return /下注|加注/.test(c) || (/全下/.test(c) && !/跟注/.test(c)); }).length;
    return { attempts: at.length, accuracy: acc, avgLossPct: avgLoss, unlocked: this.isUnlocked(mod), aggressive, mastered: at.length >= 20 && acc >= 0.75 && aggressive >= 3 };
  }

  isUnlocked(mod) {
    return mod.requires.every((rid) => {
      const m = DRILL_MAP.find((x) => x.id === rid);
      const st = m ? this.moduleStats(m, SCENARIOS) : null;
      return st && st.attempts >= 10 && st.accuracy >= 0.6;
    });
  }
}

// ---------------------------------------------------------------------------
// 判分
// ---------------------------------------------------------------------------
function gradeDecision({ evs, freqs, chosen, pot, se, exploitPct }) {
  const valid = evs.map((e) => (Number.isFinite(e) ? e : -Infinity));
  // 全部 EV 都不可用（3 人局采样失败、范围冲突）时不给分，交给界面提示重来
  // 注意 lossPct 必须是 NaN 而不是 0：返回 0 会让「分不清对错」被当成「零损失的完美决策」，
  // 在闯关的星级加权平均里能把 0 星刷成 2 星。
  if (!valid.some((v) => v > -Infinity)) return { best: chosen, loss: NaN, lossPct: NaN, grade: '无法判分', freq: freqs ? freqs[chosen] : null, noisy: true, unusable: true };
  let best = 0;
  for (let i = 1; i < valid.length; i++) if (valid[i] > valid[best]) best = i;
  // 选了一个 EV 不可用的动作：无法比较
  if (valid[chosen] === -Infinity) return { best, loss: NaN, lossPct: NaN, grade: '无法判分', freq: freqs ? freqs[chosen] : null, noisy: true, unusable: true };

  const loss = valid[best] - valid[chosen];
  const lossPct = pot > 0 ? (loss / pot) * 100 : 0;
  const freq = freqs ? freqs[chosen] : null;

  // EV 差是否显著。3 人局的 EV 是蒙特卡洛估计，两个动作的估计用同一批样本、正相关，
  // 用两者标准误之和是保守上界。chosen === best 时 loss = 0，本来就没扣分，不该标"噪声大"——
  // 旧实现漏了这个条件，导致"答对必标噪声、答错从不标"，判分提示完全反了。
  const seOk = se && Number.isFinite(se[chosen]) && Number.isFinite(se[best]);
  const seSum = seOk ? se[chosen] + se[best] : null;
  const mcNoisy = chosen !== best && seSum != null && loss < 2 * seSum;

  // 解本身不够准时，正确的反应是**不判分**，不是「都算完美」。
  //
  // 早先这里写成「EV 损失比解的可利用度还小 → 标噪声 → 提成完美」，两条降级规则串起来
  // 会把「大错」直接抬成「完美」并给满分：同样 12 个每次损失 4% 底池的决策，
  // 解到 0.15% 判「小错」得 300 分，解到 5% 反而判「完美」得 1000 分——解得越糙分数越高。
  // 而且 exploitPct 没有上限，越糊涂的解越宽容。
  //
  // 现在的口径：可利用度达到或超过三星门槛（0.5% 底池）时，这份解压根不够格支撑判分，
  // 整个决策记为「无法判分」。summarizeRun 会把它排除在星级与分数之外——
  // 既不因为解糙而加分，也不因为解糙而扣分。
  const GRADE_FLOOR = 0.5;
  if (Number.isFinite(exploitPct) && exploitPct >= GRADE_FLOOR) {
    return {
      best, loss, lossPct, grade: '无法判分', freq, noisy: true, unusable: true,
      solverTooCoarse: true, exploitPct, gradeFloor: GRADE_FLOOR,
    };
  }
  const noisy = mcNoisy;

  let grade;
  if (lossPct <= 0.5 || (freq != null && freq >= 0.35 && lossPct <= 2)) grade = '完美';
  else if (lossPct <= 2) grade = '良好';
  else if (lossPct <= 6) grade = '小错';
  else grade = '大错';
  // 差距落在采样噪声里就不扣分：统计上无法断定你选错了，最多算"良好"。
  // 注意只降不升——升级会让「解得越糙分数越高」，那正是上面那段注释讲的坑。
  if (noisy && (grade === '小错' || grade === '大错')) grade = '良好';

  return {
    best, loss, lossPct, grade, freq, noisy, mcNoisy, seSum, solverTooCoarse: false,
    exploitPct: Number.isFinite(exploitPct) ? exploitPct : null,
  };
}

/** 错误类型标签 */
function classifyMistake(actions, chosen, best) {
  const c = actions[chosen].kind, b = actions[best].kind;
  if (chosen === best) return '正确';
  const agg = (k) => k === 'bet' || k === 'raise' || k === 'allin';
  if (c === 'fold' && (b === 'call' || agg(b))) return '过度弃牌';
  if (c === 'call' && agg(b)) return '太被动/错失价值';
  if (c === 'check' && agg(b)) return '错失下注';
  if (agg(c) && (b === 'check' || b === 'fold')) return '过度激进';
  if (agg(c) && b === 'call') return '加注过多';
  if (c === 'call' && b === 'fold') return '跟注过松';
  if (c === 'check' && b === 'fold') return '';
  if (agg(c) && agg(b)) return (actions[chosen].amount || 0) < (actions[best].amount || 0) ? '尺度偏小' : '尺度偏大';
  return '其他';
}

// ---------------------------------------------------------------------------
// 场景训练会话：在已解的树上发牌、机器人按解的策略行动、英雄决策、判分
// ---------------------------------------------------------------------------
class DrillSession {
  /**
   * @param solution Solution（主线程只读解）
   * @param heroSeat 英雄的玩家下标
   * @param evProvider async (nodeId, combo) => { evs:[nA], se?:[nA] }
   */
  constructor(solution, heroSeat, evProvider, seed = Date.now() >>> 0) {
    this.sol = solution;
    this.hero = heroSeat;
    this.evProvider = evProvider;
    // 这份解自己的可利用度，判分时当精度下限用
    this.exploitPct = solution && solution.summary && Number.isFinite(solution.summary.exploitPct)
      ? solution.summary.exploitPct : null;
    this.rng = makeRng(seed);
    this.P = solution.players;
  }

  /** 新的一手：返回到达英雄决策点的状态，或 null（这手英雄没轮到决策，例如对手先弃牌） */
  newHand() {
    const board = this.sol.spec.board.slice();
    const hands = new Array(this.P).fill(-1);
    const dead = new Uint8Array(52);
    for (const c of board) dead[c] = 1;
    for (let p = 0; p < this.P; p++) {
      const w = removeDead(this.sol.ranges[p], board);
      for (let tries = 0; tries < 500; tries++) {
        const h = sampleCombo(w, this.rng);
        if (h < 0) return null;
        const [a, b] = COMBOS[h];
        if (!dead[a] && !dead[b]) { hands[p] = h; dead[a] = 1; dead[b] = 1; break; }
      }
      if (hands[p] < 0) return null;
    }
    this.state = { hands, board, node: this.sol.root, steps: [], log: [], dead, over: false };
    return this._advance();
  }

  /** 推进到英雄决策 / 终端 */
  _advance() {
    const st = this.state;
    for (;;) {
      const node = st.node;
      if (node.type === 'T' || node.type === 'E') { st.over = true; return st; }
      if (node.type === 'C') {
        // 随机发一张不冲突的牌
        const avail = node.children.filter((c) => !st.dead[c.card]);
        const pick = avail[(this.rng() * avail.length) | 0];
        st.dead[pick.card] = 1;
        st.board = [...st.board, pick.card];
        st.log.push({ type: 'card', card: pick.card, street: node.street + 1 });
        st.node = this.sol.nodes[pick.next];
        st.steps.push(pick.card);
        continue;
      }
      if (node.player === this.hero) return st;
      // 机器人按平均策略抽动作
      const p = node.player, L = this.sol.combos[p], n = L.length, S = this.sol.strategies[node.dIndex];
      const k = this.sol.pos[p][st.hands[p]];
      let a = 0;
      if (k >= 0) {
        let x = this.rng();
        for (; a < node.actions.length - 1; a++) { x -= S[a * n + k]; if (x <= 0) break; }
      }
      st.log.push({ type: 'action', player: p, action: node.actions[a], nodeId: node.id });
      st.node = this.sol.nodes[node.actions[a].next];
      st.steps.push(a);
    }
  }

  /** 英雄选择动作 -> 判分并推进 */
  async choose(actionIndex) {
    const st = this.state;
    const node = st.node;
    if (node.type !== 'D' || node.player !== this.hero) throw new Error('不是英雄的决策点');
    const combo = st.hands[this.hero];
    const view = this.sol.strategyAt(node);
    const freqs = node.actions.map((_, a) => view.byCombo[a * COMBO_COUNT + combo]);
    const ev = await this.evProvider(node.id, combo);
    const g = gradeDecision({ evs: ev.evs, freqs, chosen: actionIndex, pot: node.pot, se: ev.se, exploitPct: this.exploitPct });
    const mistake = classifyMistake(node.actions, actionIndex, g.best);
    const feedback = { nodeId: node.id, combo, comboStr: comboToPretty(combo), notation: comboToNotation(combo), board: st.board.slice(), pot: node.pot, actions: node.actions.map((a) => a.label), evs: ev.evs, se: ev.se || null, freqs, chosen: actionIndex, ...g, mistake, history: node.history, rangeFreq: view.rangeFreq };
    st.log.push({ type: 'action', player: this.hero, action: node.actions[actionIndex], nodeId: node.id, feedback });
    st.node = this.sol.nodes[node.actions[actionIndex].next];
    st.steps.push(actionIndex);
    this._advance();
    return feedback;
  }

  /** 结算（英雄本手净收益，筹码）：仅供展示，训练判分不看结果 */
  settle() {
    const st = this.state;
    const node = st.node;
    if (!st.over) return null;
    const inv = node.invested[this.hero];
    if (node.type === 'T' && node.kind === 'fold') return node.winner === this.hero ? node.pot - inv : -inv;
    if (!node.alive[this.hero]) return -inv;
    // 摊牌：把公共牌补完
    const board = st.board.slice();
    const deck = [];
    for (let c = 0; c < 52; c++) if (!st.dead[c]) deck.push(c);
    while (board.length < 5) { const i = (this.rng() * deck.length) | 0; board.push(deck.splice(i, 1)[0]); }
    st.finalBoard = board;
    return null; // 具体比牌交给界面（需要 evaluator），这里只补牌
  }
}

// ---------------------------------------------------------------------------
// 漏洞报告：把错误按类型/街/场景聚合。
//
// 口径纪律：
//   - 只有真正算过 EV 的记录才计入损失。翻前闪卡没有动作 EV，evLossPct 为 null，
//     它计入次数和正确率，但不计入任何筹码口径（早先版本给它写死 3%，那是编的）。
//   - 同时给平均值和中位数：单次极端损失（比如一次 60% 底池的大错）会把平均值拉爆，
//     中位数才反映"常态漏洞"。
//   - lossBB 是筹码单位的实际损失，据此给出 bb/100 —— 这才是牌手看得懂的盈利口径。
//   - 只有 grade 判为小错/大错的才算"漏洞"；被判完美/良好的动作即便带类型标签也不算。
// ---------------------------------------------------------------------------
const MISTAKE_GRADES = new Set(['小错', '大错']);

/**
 * 一条记录算不算「漏洞」：算过 EV（evLossPct 是有限数）且被判为小错或大错。
 * 漏洞报告和错题本（train/notebook.js）用的是这同一条判据，两边的记录范围一条不差。
 */
function isLeak(a) {
  return !!a && Number.isFinite(a.evLossPct) && MISTAKE_GRADES.has(a.grade);
}

/** 中位数（空数组给 null）。漏洞报告与成长曲线共用 */
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function leakReport(attempts) {
  const graded = attempts.filter((a) => Number.isFinite(a.evLossPct));
  const mistakes = graded.filter(isLeak);
  const bucket = (list, keyOf) => {
    const out = {};
    for (const a of list) {
      const k = keyOf(a);
      if (k === undefined || k === null) continue;
      out[k] = out[k] || { n: 0, loss: 0, losses: [], bb: 0, hasBB: false };
      const e = out[k];
      e.n++; e.loss += a.evLossPct; e.losses.push(a.evLossPct);
      if (Number.isFinite(a.lossBB)) { e.bb += a.lossBB; e.hasBB = true; }
    }
    return Object.entries(out).map(([key, v]) => ({
      key, n: v.n, totalLoss: v.loss, avgLoss: v.loss / v.n, medianLoss: median(v.losses),
      totalBB: v.hasBB ? v.bb : null,
    })).sort((a, b) => b.totalLoss - a.totalLoss);
  };

  const allLosses = graded.map((a) => a.evLossPct);
  const bbLosses = graded.filter((a) => Number.isFinite(a.lossBB));
  const totalBB = bbLosses.reduce((s, a) => s + a.lossBB, 0);

  return {
    n: attempts.length,                 // 全部记录（含翻前闪卡）
    graded: graded.length,              // 其中算过 EV 的
    ungraded: attempts.length - graded.length,
    mistakes: mistakes.length,
    accuracy: graded.length ? 1 - mistakes.length / graded.length : null,
    avgLossPct: graded.length ? allLosses.reduce((s, x) => s + x, 0) / graded.length : 0,
    medianLossPct: median(allLosses),
    // 每 100 个决策的期望损失（bb）。只在有 lossBB 的记录上算，并标注样本量。
    bbPer100: bbLosses.length ? (totalBB / bbLosses.length) * 100 : null,
    bbSamples: bbLosses.length,
    byType: bucket(mistakes, (a) => a.mistake || '未分类'),
    byStreet: bucket(mistakes, (a) => (a.street === -1 ? null : a.street)),
    byScenario: bucket(mistakes, (a) => a.scenarioId),
  };
}

function scenarioToSpec(sc, boardOverride) {
  const boardStr = boardOverride || sc.boards[Math.floor(Math.random() * sc.boards.length)];
  return { players: sc.players, board: parseCards(boardStr), pot: sc.pot, stack: sc.stack, ranges: sc.ranges, sizes: sc.sizes, raiseCap: sc.raiseCap, leafMode: sc.leafMode, engine: sc.engine || 'auto', label: sc.name, positions: sc.positions, heroSeat: sc.heroSeat, scenarioId: sc.id };
}

exports.summarizeProgress = summarizeProgress;
exports.gradeDecision = gradeDecision;
exports.classifyMistake = classifyMistake;
exports.isLeak = isLeak;
exports.median = median;
exports.leakReport = leakReport;
exports.scenarioToSpec = scenarioToSpec;
exports.ProgressStore = ProgressStore;
exports.DrillSession = DrillSession;
exports.SCENARIOS = SCENARIOS;
exports.DRILL_MAP = DRILL_MAP;
});
