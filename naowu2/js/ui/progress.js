__squidDefine('src/ui/progress.js', function (exports) {
'use strict';
// 进度与赛季的纯逻辑：关卡星级、谜题星级、每日挑战、成就。只读写 store，不碰 DOM。
const { PUZZLES } = __squidRequire('src/train/puzzles.js');
const { CHAPTERS, ALL_LEVELS, getLevel, dailyChallenge, dayKey, puzzleRunScore, puzzleStarsNow, puzzleStars } = __squidRequire('src/train/season.js');
const { SCENARIOS } = __squidRequire('src/train/training.js');
const { toast } = __squidRequire('src/ui/dom.js');
const { store } = __squidRequire('src/ui/services.js');

function allScenarios() { return [...SCENARIOS, ...store.data.customScenarios]; }

function puzzleRecord(id) {
  store.data.puzzles = store.data.puzzles || {};
  return store.data.puzzles[id] || null;
}

function savePuzzle(id, rec) {
  store.data.puzzles = store.data.puzzles || {};
  store.data.puzzles[id] = rec;
  store.save();
}

/** 谜题星级的规则在 train/season.js（puzzleStarsNow / puzzleStars），这里沿用原来的名字给各页面用 */
const starsForNow = puzzleStarsNow;
const starsFor = puzzleStars;

function contestTotals() {
  let score = 0, stars = 0, solved = 0;
  for (const p of PUZZLES) {
    const rec = puzzleRecord(p.id);
    const s = starsFor(rec);
    if (rec && rec.solved) { solved++; stars += s; score += Math.round(p.points * (s === 3 ? 1 : s === 2 ? 0.8 : 0.5)); }
  }
  return { score, stars, solved, total: PUZZLES.length, maxStars: PUZZLES.length * 3 };
}

function levelRec(id) { return (store.data.levels && store.data.levels[id]) || null; }

function seasonData() {
  if (!store.data.season) store.data.season = { score: 0, bestCombo: 0, labRuns: 0, daily: {}, dailyStreak: 0, lastDaily: null, seen: {} };
  return store.data.season;
}

/** 谜题关的星级：取该关所有题的星级之和 / 题数（向下取整） */
function puzzleLevelStars(level) {
  const st = level.puzzles.map((pid) => starsFor(puzzleRecord(pid)));
  if (st.some((x) => x === 0)) return 0;
  return Math.floor(st.reduce((a, b) => a + b, 0) / st.length);
}

function levelStars(level) {
  if (level.kind === 'puzzle') return puzzleLevelStars(level);
  const r = levelRec(level.id);
  return r ? r.stars : 0;
}

function levelCleared(level) { return levelStars(level) > 0; }

const DEMO = typeof location !== 'undefined' && /(^|[#&])demo\b/.test(location.hash);

function levelUnlocked(level) {
  if (DEMO) return true;   // 演示模式：全部解锁，方便 5 分钟里跳到任意一关
  return level.requires.every((rid) => { const l = getLevel(rid); return l ? levelCleared(l) : true; });
}

function achievementState() {
  const chapterStars = {};
  for (const c of CHAPTERS) chapterStars[c.id] = c.levels.reduce((a, l) => a + levelStars(l), 0);
  const graded = store.data.attempts.filter((a) => Number.isFinite(a.evLossPct)).length;
  const puz = store.data.puzzles || {};
  const firstTryNoHints = Object.values(puz).filter((r) => r && r.solved && r.attempts === 1 && !r.usedHints).length;
  const imoSolved = PUZZLES.filter((p) => p.tier === 'IMO' && (puz[p.id] || {}).solved).length;
  const s = seasonData();
  return {
    levelsCleared: ALL_LEVELS.filter(levelCleared).length,
    chapterStars,
    bestCombo: s.bestCombo,
    // 只认训练关真实打出来的 EV 损失。早先 OR 了「任一谜题关三星」，
    // 结果做对两道纯概率题就能点亮一个叫「零损失」的成就，与文案不符。
    hasPerfectLevel: Object.values(store.data.levels || {}).some((r) => Number.isFinite(r.bestLossPct) && r.bestLossPct <= 0.5),
    firstTryNoHints, imoSolved,
    dailyStreak: s.dailyStreak, labRuns: s.labRuns,
    gradedDecisions: graded, score: s.score,
  };
}

/** 保存一次关卡训练的成绩，并把分数记进赛季 */
function saveLevelRun(level, run) {
  store.data.levels = store.data.levels || {};
  const prev = store.data.levels[level.id] || { stars: 0, bestScore: 0, runs: 0, bestLossPct: null };
  const rec = {
    stars: Math.max(prev.stars, run.stars),
    bestScore: Math.max(prev.bestScore, run.score),
    runs: prev.runs + 1,
    bestLossPct: Number.isFinite(run.avgLossPct) ? (prev.bestLossPct == null ? run.avgLossPct : Math.min(prev.bestLossPct, run.avgLossPct)) : prev.bestLossPct,
  };
  store.data.levels[level.id] = rec;
  const s = seasonData();
  // 首次通关按本次得分入账；重打只补「比历史最好多出来的那部分」，
  // 否则反复刷最简单的一关就能把段位刷上去，段位就不再代表水平了。
  const gained = prev.runs === 0 ? run.score : Math.max(0, run.score - prev.bestScore);
  s.score += gained;
  s.bestCombo = Math.max(s.bestCombo, run.bestCombo);
  store.save();
  return { ...rec, gained };
}

/** 谜题关的星级会随答题变化，这里把新拿到的星换算成赛季分（只补增量） */
function syncPuzzleLevelScores() {
  store.data.levels = store.data.levels || {};
  const s = seasonData();
  let gained = 0;
  for (const l of ALL_LEVELS) {
    if (l.kind !== 'puzzle') continue;
    const st = puzzleLevelStars(l);
    const prev = store.data.levels[l.id] || { stars: 0, bestScore: 0, runs: 0, bestLossPct: null };
    if (st <= prev.stars) continue;
    const score = puzzleRunScore(st, l.puzzles.length);
    gained += Math.max(0, score - prev.bestScore);
    store.data.levels[l.id] = { ...prev, stars: st, bestScore: Math.max(prev.bestScore, score), runs: prev.runs + 1 };
  }
  if (gained > 0) { s.score += gained; store.save(); }
  return gained;
}

/** 玩家当前解锁到哪：决定每日挑战能出到多难 */
function dailyScope() {
  const clearedIds = new Set(ALL_LEVELS.filter(levelCleared).map((l) => l.id));
  const scen = ALL_LEVELS.filter((l) => l.kind === 'drill' && levelUnlocked(l)).map((l) => l.scenario);
  // 打通到第几章决定题目难度上限
  const ch = CHAPTERS.filter((c) => c.levels.some((l) => clearedIds.has(l.id)));
  const deepest = ch.length ? CHAPTERS.indexOf(ch[ch.length - 1]) : 0;
  const maxTier = deepest >= 3 ? 'IMO' : deepest >= 1 ? '国赛' : '省赛';
  return { unlockedScenarios: scen, maxTier };
}

function todayChallenge() { return dailyChallenge(Date.now(), dailyScope()); }

function dailyRec(key) {
  const s = seasonData();
  if (!s.daily[key]) s.daily[key] = { p: [false, false], drill: false };
  return s.daily[key];
}

function markDailyDone(key) {
  const s = seasonData();
  const rec = dailyRec(key);
  if (rec.done) return;
  rec.done = true;
  const y = dayKey(Date.now() - 86400000);
  s.dailyStreak = s.lastDaily === y ? s.dailyStreak + 1 : 1;
  s.lastDaily = key;
  store.save();
  toast(`每日挑战完成！已连续 ${s.dailyStreak} 天`, 4000);
}

/** 答对一道题时，如果它正是今天的每日题，就记一笔「今天答过了」 */
function markDailyPuzzleSolved(puzzleId) {
  const d = todayChallenge();
  const i = d.puzzles.indexOf(puzzleId);
  if (i < 0) return;
  const rec = dailyRec(d.key);
  if (rec.p[i]) return;
  rec.p[i] = true;
  store.save();
}

exports.allScenarios = allScenarios;
exports.puzzleRecord = puzzleRecord;
exports.savePuzzle = savePuzzle;
exports.contestTotals = contestTotals;
exports.levelRec = levelRec;
exports.seasonData = seasonData;
exports.levelStars = levelStars;
exports.levelCleared = levelCleared;
exports.levelUnlocked = levelUnlocked;
exports.achievementState = achievementState;
exports.saveLevelRun = saveLevelRun;
exports.syncPuzzleLevelScores = syncPuzzleLevelScores;
exports.todayChallenge = todayChallenge;
exports.dailyRec = dailyRec;
exports.markDailyDone = markDailyDone;
exports.markDailyPuzzleSolved = markDailyPuzzleSolved;
exports.starsForNow = starsForNow;
exports.starsFor = starsFor;
exports.DEMO = DEMO;
});
