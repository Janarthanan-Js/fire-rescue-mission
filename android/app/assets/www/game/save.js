/* ============================================================
   save.js - Persistent progress + settings (localStorage)
   Robust: never throws, validates data, migrates schema.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'fireRescueMission.save.v1';

  function defaults() {
    return {
      schema: 1,
      unlocked: 1,             // highest unlocked level (1-based)
      levels: {},              // { "1": { stars, best, completed, bestTime } }
      settings: { music: true, sfx: true, vibration: true },
      tutorialDone: false,
      totalRescues: 0,
      lastPlayed: 0,
      endlessBestWave: 0,
      endlessFarthest: 0
    };
  }

  var state = defaults();
  var available = true;

  function safeGet(k) {
    try { return global.localStorage.getItem(k); }
    catch (e) { available = false; return null; }
  }
  function safeSet(k, v) {
    try { global.localStorage.setItem(k, v); return true; }
    catch (e) { available = false; return false; }
  }

  function clampInt(n, lo, hi, def) {
    n = parseInt(n, 10);
    if (isNaN(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }

  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    d.unlocked = clampInt(raw.unlocked, 1, global.CFG ? global.CFG.MAX_LEVELS : 10, 1);
    d.tutorialDone = !!raw.tutorialDone;
    d.totalRescues = clampInt(raw.totalRescues, 0, 999999, 0);
    d.lastPlayed = clampInt(raw.lastPlayed, 0, 9999999999999, 0);
    d.endlessBestWave = clampInt(raw.endlessBestWave, 0, 99999, 0);
    d.endlessFarthest = clampInt(raw.endlessFarthest, 0, 99999, 0);
    if (raw.settings && typeof raw.settings === 'object') {
      d.settings.music = raw.settings.music !== false;
      d.settings.sfx = raw.settings.sfx !== false;
      d.settings.vibration = raw.settings.vibration !== false;
    }
    if (raw.levels && typeof raw.levels === 'object') {
      Object.keys(raw.levels).forEach(function (k) {
        var lv = parseInt(k, 10);
        if (isNaN(lv) || lv < 1) return;
        var src = raw.levels[k] || {};
        d.levels[k] = {
          stars: clampInt(src.stars, 0, 3, 0),
          best: clampInt(src.best, 0, 9999999, 0),
          completed: !!src.completed,
          bestTime: clampInt(src.bestTime, 0, 999999, 0)
        };
      });
    }
    return d;
  }

  var Save = {
    get available() { return available; },

    load: function () {
      try {
        var raw = safeGet(KEY);
        if (raw) state = sanitize(JSON.parse(raw));
        else state = defaults();
      } catch (e) {
        state = defaults();
      }
      return state;
    },

    save: function () {
      try {
        state.lastPlayed = Date.now();
        return safeSet(KEY, JSON.stringify(state));
      } catch (e) { return false; }
    },

    reset: function () {
      state = defaults();
      try { global.localStorage.removeItem(KEY); } catch (e) {}
      this.save();
      return state;
    },

    data: function () { return state; },

    getSettings: function () { return state.settings; },

    setSetting: function (key, value) {
      if (state.settings && key in state.settings) {
        state.settings[key] = !!value;
        this.save();
      }
    },

    // ---- Level access ----
    isUnlocked: function (level) { return level <= state.unlocked; },

    getLevel: function (level) {
      return state.levels[String(level)] || { stars: 0, best: 0, completed: false, bestTime: 0 };
    },

    totalStars: function () {
      var t = 0;
      for (var i = 1; i <= (global.CFG ? global.CFG.MAX_LEVELS : 10); i++) {
        t += this.getLevel(i).stars;
      }
      return t;
    },

    completedCount: function () {
      var c = 0;
      for (var i = 1; i <= (global.CFG ? global.CFG.MAX_LEVELS : 10); i++) {
        if (this.getLevel(i).completed) c++;
      }
      return c;
    },

    /**
     * Record a level result. Returns { newBest, newStars, firstClear }.
     */
    completeLevel: function (level, result) {
      var rec = state.levels[String(level)] || { stars: 0, best: 0, completed: false, bestTime: 0 };
      var newBest = false, newStars = false, firstClear = !rec.completed;

      if (result.score > rec.best) { rec.best = result.score; newBest = true; }
      if (result.stars > rec.stars) { rec.stars = result.stars; newStars = true; }
      if (result.timeRemaining > rec.bestTime) rec.bestTime = result.timeRemaining;
      rec.completed = true;

      state.levels[String(level)] = rec;
      state.totalRescues += (result.rescued || 0);

      if (level >= state.unlocked && level < (global.CFG ? global.CFG.MAX_LEVELS : 10)) {
        state.unlocked = level + 1;
      }
      this.save();
      return { newBest: newBest, newStars: newStars, firstClear: firstClear };
    },

    markTutorialDone: function () {
      state.tutorialDone = true;
      this.save();
    },

    // ---- Endless mode ----
    endlessBest: function () { return state.endlessBestWave || 0; },

    /** Record a cleared endless wave. Returns { newBest, best }. */
    recordEndlessWave: function (wave, score) {
      var best = state.endlessBestWave || 0;
      var record = {};
      try { record = JSON.parse(safeGet('fireRescueMission.endless.v1') || '{}') || {}; } catch (e) { record = {}; }
      var prev = record[String(wave)] || 0;
      if (score > prev) record[String(wave)] = score;
      safeSet('fireRescueMission.endless.v1', JSON.stringify(record));

      var newBest = false;
      if (wave > best) { state.endlessBestWave = wave; newBest = true; }
      this.save();
      return { newBest: newBest, best: state.endlessBestWave };
    },

    endlessScore: function (wave) {
      try {
        var record = JSON.parse(safeGet('fireRescueMission.endless.v1') || '{}') || {};
        return record[String(wave)] || 0;
      } catch (e) { return 0; }
    }
  };

  global.Save = Save;
  if (typeof module !== 'undefined' && module.exports) module.exports = Save;
})(typeof window !== 'undefined' ? window : globalThis);
