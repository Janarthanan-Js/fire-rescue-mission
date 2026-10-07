/* ============================================================
   audio.js - Fully synthesized audio (Web Audio API).
   No external files -> works offline, no asset loading errors.
   Music = looping procedural chiptune-ish theme.
   ============================================================ */
(function (global) {
  'use strict';

  var Audio = {
    ctx: null,
    master: null,
    musicGain: null,
    sfxGain: null,
    started: false,
    _musicTimer: null,
    _musicStep: 0,
    _tension: 0,
    _fireLoop: null,
    _sprayLoop: null,
    enabled: true
  };

  function now() { return Audio.ctx ? Audio.ctx.currentTime : 0; }

  Audio.init = function () {
    if (Audio.ctx) return;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { Audio.enabled = false; return; }
      Audio.ctx = new AC();
      Audio.master = Audio.ctx.createGain();
      Audio.master.gain.value = 0.85;
      Audio.master.connect(Audio.ctx.destination);

      Audio.musicGain = Audio.ctx.createGain();
      Audio.musicGain.gain.value = 0.0;
      Audio.musicGain.connect(Audio.master);

      Audio.sfxGain = Audio.ctx.createGain();
      Audio.sfxGain.gain.value = 0.6;
      Audio.sfxGain.connect(Audio.master);

      Audio._ensureDinoDrone();
    } catch (e) {
      Audio.enabled = false;
    }
  };

  Audio.resume = function () {
    Audio.init();
    if (!Audio.ctx) return;
    if (Audio.ctx.state === 'suspended') {
      Audio.ctx.resume().catch(function () {});
    }
  };

  Audio.applySettings = function (settings) {
    Audio.init();
    if (!Audio.ctx) return;
    try {
      Audio.musicGain.gain.setTargetAtTime(settings.music ? 0.16 : 0.0, now(), 0.1);
      Audio.sfxGain.gain.setTargetAtTime(settings.sfx ? 0.6 : 0.0, now(), 0.1);
    } catch (e) {}
  };

  // ---------- low level helpers ----------
  function tone(o) {
    if (!Audio.enabled) return;
    Audio.init();
    if (!Audio.ctx) return;
    var t0 = now();
    var type = o.type || 'sine';
    var osc = Audio.ctx.createOscillator();
    var g = Audio.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 && o.f1 !== o.f0) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur); }
      catch (e) { osc.frequency.setValueAtTime(o.f1, t0 + o.dur); }
    }
    var peak = o.gain == null ? 0.25 : o.gain;
    var atk = o.atk == null ? 0.006 : o.atk;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    var dest = (o.bus === 'music') ? Audio.musicGain : Audio.sfxGain;
    osc.connect(g); g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
  }

  function noiseBurst(o) {
    if (!Audio.enabled) return;
    Audio.init();
    if (!Audio.ctx) return;
    var dur = o.dur || 0.25;
    var t0 = now();
    var len = Math.max(1, Math.floor(Audio.ctx.sampleRate * dur));
    var buf = Audio.ctx.createBuffer(1, len, Audio.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = Audio.ctx.createBufferSource();
    src.buffer = buf;
    var filt = Audio.ctx.createBiquadFilter();
    filt.type = o.filter || 'lowpass';
    filt.frequency.setValueAtTime(o.cut0 || 900, t0);
    if (o.cut1) {
      try { filt.frequency.exponentialRampToValueAtTime(Math.max(60, o.cut1), t0 + dur); } catch (e) {}
    }
    var g = Audio.ctx.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.3 : o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var dest = (o.bus === 'music') ? Audio.musicGain : Audio.sfxGain;
    src.connect(filt); filt.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ---------- public SFX ----------
  var S = {};
  S.click = function () { tone({ type: 'triangle', f0: 520, f1: 720, dur: 0.07, gain: 0.22 }); };
  S.back = function () { tone({ type: 'triangle', f0: 440, f1: 300, dur: 0.09, gain: 0.2 }); };
  S.rescueStart = function () { tone({ type: 'sine', f0: 560, f1: 700, dur: 0.16, gain: 0.16 }); };
  S.rescue = function () {
    tone({ type: 'triangle', f0: 660, f1: 880, dur: 0.12, gain: 0.24 });
    setTimeout(function () { tone({ type: 'triangle', f0: 880, f1: 1180, dur: 0.16, gain: 0.24 }); }, 90);
    setTimeout(function () { tone({ type: 'sine', f0: 1320, f1: 1560, dur: 0.2, gain: 0.18 }); }, 200);
  };
  S.extinguish = function () { noiseBurst({ dur: 0.3, cut0: 1600, cut1: 260, gain: 0.22 }); };
  S.splash = function () { noiseBurst({ dur: 0.12, cut0: 2600, cut1: 700, gain: 0.12, filter: 'bandpass' }); };
  S.hurt = function () {
    tone({ type: 'sawtooth', f0: 260, f1: 120, dur: 0.18, gain: 0.24 });
    noiseBurst({ dur: 0.12, cut0: 500, cut1: 200, gain: 0.14 });
  };
  S.explosion = function () {
    noiseBurst({ dur: 0.6, cut0: 1400, cut1: 90, gain: 0.5 });
    tone({ type: 'sine', f0: 150, f1: 40, dur: 0.55, gain: 0.35 });
    tone({ type: 'square', f0: 90, f1: 30, dur: 0.4, gain: 0.16 });
  };
  S.warn = function () { tone({ type: 'square', f0: 880, f1: 660, dur: 0.12, gain: 0.18 }); };
  S.fuse = function () { tone({ type: 'square', f0: 1200, f1: 1200, dur: 0.05, gain: 0.12 }); };
  // ---- Dinosaur: deep rumble + rising alarm, then a full-throated roar ----
  S.dinoWarn = function () {
    // low tremolo rumble
    for (var i = 0; i < 7; i++) {
      (function (k) {
        setTimeout(function () {
          tone({ type: 'sawtooth', f0: 58 + k * 3, f1: 44 + k * 2, dur: 0.42, gain: 0.30, atk: 0.06 });
          tone({ type: 'square', f0: 88, f1: 66, dur: 0.6, gain: 0.12, bus: 'music' });
        }, k * 300);
      })(i);
    }
    noiseBurst({ dur: 2.1, cut0: 320, cut1: 70, gain: 0.16 });
  };
  S.dinoRoar = function () {
    // pitch-swept growl + noise snarl
    tone({ type: 'sawtooth', f0: 130, f1: 52, dur: 1.05, gain: 0.40, atk: 0.03 });
    tone({ type: 'square', f0: 96, f1: 40, dur: 1.1, gain: 0.22, atk: 0.02 });
    tone({ type: 'sawtooth', f0: 205, f1: 70, dur: 0.7, gain: 0.16, atk: 0.05 });
    noiseBurst({ dur: 1.0, cut0: 900, cut1: 120, gain: 0.30, filter: 'bandpass' });
  };
  S.dinoBite = function () {
    noiseBurst({ dur: 0.22, cut0: 1800, cut1: 180, gain: 0.42 });
    tone({ type: 'sawtooth', f0: 170, f1: 60, dur: 0.24, gain: 0.30 });
  };
  S.dinoStomp = function () {
    tone({ type: 'sine', f0: 92, f1: 34, dur: 0.24, gain: 0.24 });
    noiseBurst({ dur: 0.14, cut0: 400, cut1: 90, gain: 0.14 });
  };
  S.dinoLeave = function () {
    tone({ type: 'sawtooth', f0: 90, f1: 190, dur: 0.5, gain: 0.16 });
    noiseBurst({ dur: 0.5, cut0: 500, cut1: 1600, gain: 0.10 });
  };
  S.blocked = function () { tone({ type: 'square', f0: 180, f1: 120, dur: 0.14, gain: 0.2 }); };
  S.unlock = function () {
    tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.18, gain: 0.22 });
    setTimeout(function () { tone({ type: 'triangle', f0: 780, f1: 1040, dur: 0.22, gain: 0.22 }); }, 130);
  };
  S.victory = function () {
    var seq = [523, 659, 784, 1047, 1319];
    seq.forEach(function (f, i) {
      setTimeout(function () {
        tone({ type: 'triangle', f0: f, f1: f * 1.01, dur: 0.28, gain: 0.26 });
        tone({ type: 'sine', f0: f / 2, f1: f / 2, dur: 0.3, gain: 0.12 });
      }, i * 130);
    });
  };
  S.gameover = function () {
    var seq = [392, 330, 262, 196];
    seq.forEach(function (f, i) {
      setTimeout(function () { tone({ type: 'sawtooth', f0: f, f1: f * 0.96, dur: 0.34, gain: 0.24 }); }, i * 190);
    });
  };
  S.star = function (i) {
    var base = [660, 880, 1180][i] || 880;
    tone({ type: 'triangle', f0: base, f1: base * 1.25, dur: 0.18, gain: 0.24 });
  };

  Audio.sfx = S;
  Audio.play = function (name) { if (S[name]) try { S[name](); } catch (e) {} };

  // ---------- continuous loops (fire / spray) controlled by game ----------
  Audio.setFireLevel = function (level) {
    Audio._tension = level;
    // Managed through music intensity, keep simple.
  };

  // Danger level 0..1 (1 = a dinosaur is right on top of you).
  // Drives a low dino drone whose gain + filter track proximity.
  Audio.setDinoLevel = function (level) {
    Audio._dinoLevel = level || 0;
    Audio.init();
    if (!Audio.ctx || !Audio._dinoDrone) return;
    try {
      Audio._dinoDrone.gain.setTargetAtTime(0.0016 + Audio._dinoLevel * 0.05, now(), 0.15);
      if (Audio._dinoDrone.filt) {
        Audio._dinoDrone.filt.frequency.setTargetAtTime(90 + Audio._dinoLevel * 320, now(), 0.2);
      }
    } catch (e) {}
  };

  Audio._ensureDinoDrone = function () {
    if (Audio._dinoDrone || !Audio.ctx) return;
    try {
      var osc = Audio.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      var filt = Audio.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 120;
      var g = Audio.ctx.createGain();
      g.gain.value = 0.0001;
      osc.connect(filt); filt.connect(g); g.connect(Audio.sfxGain);
      osc.start();
      Audio._dinoDrone = { osc: osc, filt: filt, gain: g };
    } catch (e) { Audio._dinoDrone = null; }
  };

  // ---------- procedural music ----------
  // A simple driving theme built from scheduled tones.
  var MELODY = [
    0, 3, 7, 10, 7, 3, 0, -2,
    0, 3, 7, 12, 10, 7, 3, 0
  ];
  var BASS = [0, 0, -5, -5, -7, -7, -3, -3, 0, 0, -5, -5, -7, -7, -3, 2];
  var ROOT = 55; // A1

  function freq(semi) { return ROOT * Math.pow(2, semi / 12); }

  Audio.startMusic = function () {
    Audio.init();
    if (!Audio.ctx || Audio._musicTimer) return;
    Audio._musicStep = 0;
    var baseStep = 0.27;
    Audio._musicTimer = setInterval(function () {
      if (!Audio.ctx || !Audio.enabled) return;
      var st = Audio._musicStep % 16;
      var stepDur = baseStep - Audio._tension * 0.06; // tenser/faster when fires remain
      // bass
      tone({ type: 'triangle', f0: freq(BASS[st]), f1: freq(BASS[st]), dur: stepDur * 0.95, gain: 0.32, bus: 'music', atk: 0.01 });
      // lead on some steps
      if (st % 2 === 0 || st === 7 || st === 15) {
        var m = MELODY[st];
        tone({ type: 'square', f0: freq(m + 24), f1: freq(m + 24), dur: stepDur * 0.55, gain: 0.09, bus: 'music', atk: 0.005 });
      }
      if (st % 4 === 0) {
        noiseBurst({ dur: 0.09, cut0: 4000, cut1: 1400, gain: 0.14, bus: 'music' });
      }
      if (st % 8 === 4) {
        noiseBurst({ dur: 0.14, cut0: 2600, cut1: 800, gain: 0.1, bus: 'music' });
      }
      Audio._musicStep++;
    }, baseStep * 1000);
  };

  Audio.stopMusic = function () {
    if (Audio._musicTimer) { clearInterval(Audio._musicTimer); Audio._musicTimer = null; }
  };

  global.Audio2 = Audio; // avoid clashing with window.Audio constructor
  global.GameAudio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
