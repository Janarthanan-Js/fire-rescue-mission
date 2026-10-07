/* ============================================================
   main.js - Application bootstrap & glue between UI + Game
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  var App = {
    game: null,
    ui: null,
    audio: global.GameAudio,
    ready: false
  };

  // ------------------------------------------------------------
  //  Settings application
  // ------------------------------------------------------------
  App.applySettings = function () {
    var st = global.Save.getSettings();
    App.audio.applySettings(st);
  };

  // ------------------------------------------------------------
  //  Navigation
  // ------------------------------------------------------------
  App.onPlay = function () {
    var st = global.Save.data();
    if (!st.tutorialDone) {
      // offer the tutorial the first time
      App.ui.tutorialIntro(function () {
        App.audio.resume();
        App.startLevel(0, true);
      });
    } else {
      // resume at the highest unlocked level for convenience
      var lv = Math.min(global.Save.data().unlocked, CFG.MAX_LEVELS);
      App.startLevel(lv);
    }
  };

  App.startLevel = function (id, isTutorial) {
    try {
      App.audio.resume();
      App.ui.clearOverlays();
      App.ui.clearScreens();   // remove the menu / level-select panel that started this level
      App.hideControls(false);
      App.ui.hideHUD();
      App.game.loadLevel(id, isTutorial);
      App.showControls();
      App.ui.showHUD();
      App.game.start();
      // intro hint
      var spec = App.game.level.spec;
      if (spec && spec.hint && !App.game.isTutorial) {
        setTimeout(function () { App.ui.hudHint(spec.hint, 4); }, 400);
      }
    } catch (e) {
      console.error('Failed to start level', e);
      App.ui.hudToast('Could not load level - returning to menu', 'bad');
      setTimeout(function () { App.exitToMenu(); }, 900);
    }
  };

  App.exitToMenu = function () {
    App.game.state = 'idle';
    App.game.endless = false;
    App.game.stop();
    App.hideControls(true);
    App.ui.hideHUD();
    App.ui.clearOverlays();
    App.ui.mainMenu();
  };

  // ------------------------------------------------------------
  //  Endless mode
  // ------------------------------------------------------------
  // Start (or restart) an endless run at `wave` (1-based).
  App.startEndless = function (wave) {
    wave = Math.max(1, parseInt(wave, 10) || 1);
    try {
      App.audio.resume();
      App.ui.clearOverlays();
      App.ui.clearScreens();
      App.hideControls(false);
      App.ui.hideHUD();
      App.game.loadEndless(wave);
      App.showControls();
      App.ui.showHUD();
      App.game.start();
    } catch (e) {
      console.error('Failed to start endless wave', e);
      App.ui.hudToast('Could not load wave - returning to menu', 'bad');
      setTimeout(function () { App.exitToMenu(); }, 900);
    }
  };

  // Advance to the next endless wave (called from the victory overlay).
  App.nextWave = function () {
    var next = (App.game.wave || 0) + 1;
    App.startEndless(next);
  };

  App.resume = function () {
    App.audio.resume();
    App.game.resume();
  };

  // ------------------------------------------------------------
  //  On-screen controls visibility
  // ------------------------------------------------------------
  App.showControls = function () {
    var c = document.getElementById('controls');
    if (c) c.classList.remove('hidden');
    App.game.input.enable(true);
  };
  App.hideControls = function (hide) {
    var c = document.getElementById('controls');
    if (c) c.classList.toggle('hidden', !!hide);
    if (hide) App.game.input.enable(false);
  };

  // ------------------------------------------------------------
  //  Pause handling
  // ------------------------------------------------------------
  App.onPausePressed = function () {
    if (App.game.state === 'playing') {
      App.game.pause();
      App.ui.pause(App.game);
    }
  };

  // ------------------------------------------------------------
  //  Toast helper (used by UI)
  // ------------------------------------------------------------
  App.toast = function (msg, kind) { App.ui.hudToast(msg, kind); };

  // ------------------------------------------------------------
  //  Resize
  // ------------------------------------------------------------
  App.onResize = function () {
    if (!App.game || !App.game.level) return;
    var oldZoom = App.game.camera.zoom;
    App.game.fit();
    App.game.camera.zoom = App.game.computeZoom();
    App.game.updateCamera(0.001, true);
    // keep the player centred after a resize
    App.game.camera.x = App.game.player.x;
    App.game.camera.y = App.game.player.y;
    App.game.updateCamera(0.001, true);
  };

  // ------------------------------------------------------------
  //  Boot
  // ------------------------------------------------------------
  App.boot = function () {
    try {
      global.Save.load();

      App.audio.init();
      App.ui = new global.UI(App);
      App.game = new global.Game(App);
      App.game.fit();

      // input element wiring
      global.Input.attach({
        joyZone: document.getElementById('joy-zone'),
        joyBase: document.getElementById('joy-base'),
        joyKnob: document.getElementById('joy-knob'),
        waterBtn: document.getElementById('btn-water'),
        rescueBtn: document.getElementById('btn-rescue'),
        pauseBtn: document.getElementById('btn-pause')
      });
      global.Input.onPause = App.onPausePressed;

      App.applySettings();

      // resize + orientation
      global.addEventListener('resize', App.onResize);
      global.addEventListener('orientationchange', function () { setTimeout(App.onResize, 220); });
      checkOrientation();

      // unlock audio on first interaction (mobile autoplay policy)
      var unlock = function () {
        App.audio.resume();
        global.removeEventListener('pointerdown', unlock);
        global.removeEventListener('touchstart', unlock);
      };
      global.addEventListener('pointerdown', unlock);
      global.addEventListener('touchstart', unlock);

      // tab visibility -> auto pause
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && App.game.state === 'playing') App.onPausePressed();
      });

      // safety: catch stray errors
      global.addEventListener('error', function (e) { console.warn('Runtime error', e.message); });

      App.ready = true;

      // mobile screen hint shown once
      setTimeout(function () {
        var loading = document.getElementById('screen-loading');
        if (loading) loading.classList.remove('active');
        App.ui.mainMenu();
        App.audio.applySettings(global.Save.getSettings());
      }, 650);
    } catch (e) {
      console.error('Boot failure', e);
      var loading = document.getElementById('screen-loading');
      if (loading) {
        loading.classList.add('active');
        loading.innerHTML = '<div class="loader-wrap"><div class="flame-logo big">\u26A0\uFE0F</div>' +
          '<h1 class="logo-text">Oops</h1><p class="muted">The game could not start. Please reload the page.</p></div>';
      }
    }
  };

  function checkOrientation() {
    var hint = document.getElementById('rotate-hint');
    if (!hint) return;
    var isPortrait = (global.innerHeight >= global.innerWidth);
    var tooWide = global.innerWidth > global.innerHeight && global.innerHeight < 500;
    hint.classList.toggle('hidden', isPortrait || !tooWide);
  }

  App._checkOrientation = checkOrientation;

  // expose for the resize path
  var _origResize = App.onResize;
  App.onResize = function () { _origResize(); checkOrientation(); };

  global.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.boot);
  } else {
    App.boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
