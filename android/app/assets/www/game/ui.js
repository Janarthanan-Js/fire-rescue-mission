/* ============================================================
   ui.js - Screen manager: menu, level select, settings, how-to,
   about, HUD, pause, victory, game over, tutorial overlays.
   Pure DOM. No game logic here.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function id(i) { return document.getElementById(i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function UI(app) {
    this.app = app;
    this.root = id('ui-root');
    this.current = null;
    this.overlays = [];
    this._hintTimer = null;
  }

  // ------------------------------------------------------------
  //  Screen management
  // ------------------------------------------------------------
  UI.prototype.showScreen = function (name, builder) {
    this.hideAllScreens();
    this.root.innerHTML = '';
    var s = builder ? builder(this) : null;
    this.current = name;
    id('screen-loading').classList.remove('active');
    if (s) this.root.appendChild(s);
    this.app.audio.play('click');
  };

  UI.prototype.hideAllScreens = function () {
    var self = this;
    ['screen-loading'].forEach(function (n) { var e = id(n); if (e) e.classList.remove('active'); });
    this.root.innerHTML = '';
  };

  UI.prototype.panel = function (title, opts) {
    var self = this;
    opts = opts || {};
    var p = el('section', 'screen-panel' + (opts.scroll ? ' scrollable' : ''));
    p.id = 'screen-' + (opts.id || 'x');
    p.classList.add('active');
    var bar = el('header', 'top-bar' + (opts.centerTitle ? ' center-title' : ''));
    if (opts.back) {
      var b = el('button', 'icon-btn', '<i class="fa-solid fa-arrow-left"></i>');
      b.setAttribute('aria-label', 'Back');
      b.addEventListener('click', function () {
        self.app.audio.play('back');
        opts.back();
      });
      bar.appendChild(b);
    }
    bar.appendChild(el('h2', null, esc(title)));
    if (opts.right) bar.appendChild(opts.right);
    p.appendChild(bar);
    return p;
  };

  UI.prototype.screen = function () { return this.root.firstChild; };
  UI.prototype.appendToScreen = function (node) {
    var s = this.root.querySelector('.screen-panel');
    if (s) s.appendChild(node); else this.root.appendChild(node);
  };

  // ------------------------------------------------------------
  //  MAIN MENU
  // ------------------------------------------------------------
  UI.prototype.mainMenu = function () {
    var self = this;
    // Safety net: never leave the in-game HUD / touch controls showing over the menu.
    try { if (this.app && this.app.hideControls) this.app.hideControls(true); } catch (e) {}
    this.hideHUD();
    this.hideAllScreens();
    this.root.innerHTML = '';
    var total = CFG.MAX_LEVELS;
    var stars = global.Save.totalStars();
    var done = global.Save.completedCount();

    var p = el('section', 'screen-panel');
    p.id = 'screen-menu';

    var head = el('div', 'menu-head');
    head.appendChild(el('div', 'menu-badge', '<i class="fa-solid fa-fire"></i> RESCUE OPS'));
    head.appendChild(el('div', 'menu-logo flame-logo', '\u{1F692}'));
    head.appendChild(el('h1', 'logo-text', 'FIRE RESCUE<br><span>MISSION</span>'));

    var scene = el('div', 'menu-fire-scene', '\u{1F525}\u{1F692}\u{1F3E0}');
    head.appendChild(scene);
    p.appendChild(head);

    var actions = el('div', 'menu-actions');
    var play = el('button', 'btn primary', '<i class="fa-solid fa-play"></i> PLAY');
    play.addEventListener('click', function () {
      self.app.audio.play('click');
      self.app.onPlay();
    });
    actions.appendChild(play);

    var row = el('div', 'row2');
    var lvBtn = el('button', 'btn', '<i class="fa-solid fa-list-ol"></i> LEVELS');
    lvBtn.addEventListener('click', function () { self.app.audio.play('click'); self.levelSelect(); });
    var setBtn = el('button', 'btn', '<i class="fa-solid fa-gear"></i> SETTINGS');
    setBtn.addEventListener('click', function () { self.app.audio.play('click'); self.settings(self.mainMenu.bind(self)); });
    row.appendChild(lvBtn); row.appendChild(setBtn);
    actions.appendChild(row);

    var endless = el('button', 'btn endless', '<i class="fa-solid fa-infinity"></i> ENDLESS MODE');
    endless.addEventListener('click', function () { self.app.audio.play('click'); self.endlessIntro(); });
    actions.appendChild(endless);

    var row2 = el('div', 'row2');
    var htp = el('button', 'btn ghost small', '<i class="fa-solid fa-circle-question"></i> HOW TO PLAY');
    htp.addEventListener('click', function () { self.app.audio.play('click'); self.howTo(); });
    var about = el('button', 'btn ghost small', '<i class="fa-solid fa-circle-info"></i> ABOUT');
    about.addEventListener('click', function () { self.app.audio.play('click'); self.about(); });
    row2.appendChild(htp); row2.appendChild(about);
    actions.appendChild(row2);

    p.appendChild(actions);

    var foot = el('div', 'menu-foot');
    var pill = el('div', 'progress-pill',
      '<i class="fa-solid fa-star" style="color:var(--gold)"></i> <b>' + stars + '</b> / ' + (total * 3) + ' stars');
    var pill2 = el('div', 'progress-pill',
      '<i class="fa-solid fa-flag-checkered"></i> <b>' + done + '</b> / ' + total + ' levels');
    foot.appendChild(pill); foot.appendChild(pill2);
    p.appendChild(foot);

    this.root.appendChild(p);
    this.current = 'menu';
  };

  // ------------------------------------------------------------
  //  LEVEL SELECT
  // ------------------------------------------------------------
  UI.prototype.levelSelect = function () {
    var self = this;
    var p = this.panel('SELECT MISSION', {
      id: 'levels', scroll: true, back: function () { self.mainMenu(); }
    });
    this.root.appendChild(p);

    var grid = el('div', 'levels-grid');
    for (var i = 1; i <= CFG.MAX_LEVELS; i++) {
      (function (lvNum) {
        var spec = global.Levels.getSpec(lvNum);
        var rec = global.Save.getLevel(lvNum);
        var unlocked = global.Save.isUnlocked(lvNum);
        var card = el('button', 'level-card' + (unlocked ? '' : ' locked') + (rec.completed ? ' completed' : ''));
        var types = CFG.LEVEL_TYPES[spec.type] || CFG.LEVEL_TYPES.house;

        var stars = '';
        for (var s = 0; s < 3; s++) {
          stars += '<i class="fa-solid fa-star ' + (s < rec.stars ? 'on' : 'off') + '"></i>';
        }
        card.innerHTML =
          '<div class="lv-top">' +
            '<span class="lv-num">' + lvNum + '</span>' +
            '<span class="lv-emoji">' + types.icon + '</span>' +
          '</div>' +
          '<div class="lv-type">' + esc(types.name) + '</div>' +
          '<div class="lv-diff">' + esc(spec.difficulty) + '</div>' +
          '<div class="lv-stars">' + stars + '</div>' +
          '<div class="lv-best">BEST ' + rec.best.toLocaleString() + '</div>' +
          (unlocked ? '' : '<div class="lv-lock"><i class="fa-solid fa-lock"></i></div>');

        card.addEventListener('click', function () {
          if (!unlocked) { self.app.audio.play('blocked'); return; }
          self.app.audio.play('click');
          self.app.startLevel(lvNum);
        });
        grid.appendChild(card);
      })(i);
    }
    p.appendChild(grid);
  };

  // ------------------------------------------------------------
  //  SETTINGS
  // ------------------------------------------------------------
  UI.prototype.settings = function (backFn) {
    var self = this;
    var st = global.Save.getSettings();
    var p = this.panel('SETTINGS', { id: 'settings', back: backFn || function () { self.mainMenu(); } });

    function toggleRow(icon, label, key, onChange) {
      var row = el('div', 'setting-row');
      var left = el('div', 's-left', '<i class="' + icon + '"></i>' + esc(label));
      var sw = el('div', 'switch' + (st[key] ? ' on' : ''));
      sw.addEventListener('click', function () {
        st[key] = !st[key];
        sw.classList.toggle('on', st[key]);
        global.Save.setSetting(key, st[key]);
        self.app.audio.play('click');
        self.app.applySettings();
        if (onChange) onChange(st[key]);
      });
      row.appendChild(left); row.appendChild(sw);
      return row;
    }

    var card = el('div', 'card');
    card.appendChild(toggleRow('fa-solid fa-music ic-fire', 'Background Music', 'music'));
    card.appendChild(toggleRow('fa-solid fa-volume-high ic-water', 'Sound Effects', 'sfx'));
    card.appendChild(toggleRow('fa-solid fa-mobile-screen-button ic-move', 'Vibration', 'vibration'));
    p.appendChild(card);

    // reset progress
    var card2 = el('div', 'card');
    card2.appendChild(el('h3', null, '<i class="fa-solid fa-triangle-exclamation"></i> DANGER ZONE'));
    var rb = el('button', 'btn danger wide', '<i class="fa-solid fa-trash"></i> RESET ALL PROGRESS');
    rb.addEventListener('click', function () {
      self.app.audio.play('click');
      self.confirm('Reset Progress?', 'All stars, unlocked levels and best scores will be erased. This cannot be undone.', 'RESET', function () {
        global.Save.reset();
        self.app.applySettings();
        self.app.toast('Progress reset');
        self.settings(backFn);
      });
    });
    card2.appendChild(rb);
    p.appendChild(card2);

    var card3 = el('div', 'card');
    card3.appendChild(el('h3', null, '<i class="fa-solid fa-keyboard"></i> DESKTOP CONTROLS'));
    card3.appendChild(el('div', 'help-list', '<ul class="help-list">' +
      '<li><i class="fa-solid fa-arrows-up-down-left-right ic-move"></i> Move with <b>WASD / Arrows</b></li>' +
      '<li><i class="fa-solid fa-droplet ic-water"></i> Hold <b>Space</b> to spray water</li>' +
      '<li><i class="fa-solid fa-hand-holding-heart ic-victim"></i> Hold <b>E</b> to rescue</li>' +
      '<li><i class="fa-solid fa-pause ic-time"></i> <b>Esc / P</b> to pause</li>' +
      '</ul>'));
    p.appendChild(card3);

    this.root.appendChild(p);
  };

  // ------------------------------------------------------------
  //  HOW TO PLAY
  // ------------------------------------------------------------
  UI.prototype.howTo = function () {
    var self = this;
    var p = this.panel('HOW TO PLAY', { id: 'howto', scroll: true, back: function () { self.mainMenu(); } });

    var c1 = el('div', 'card');
    c1.appendChild(el('h3', null, '<i class="fa-solid fa-bullseye"></i> YOUR MISSION'));
    c1.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-person-running ic-move"></i> Move your firefighter with the <b>joystick</b> (bottom-left).</li>' +
      '<li><i class="fa-solid fa-hand-holding-heart ic-victim"></i> Walk next to a trapped person and hold the green <b>RESCUE</b> button.</li>' +
      '<li><i class="fa-solid fa-fire ic-fire"></i> Face a fire and hold the blue <b>WATER</b> button to spray. Bigger fires need more water.</li>' +
      '<li><i class="fa-solid fa-door-open ic-star"></i> Finish all objectives, then reach the glowing green <b>EXIT</b>.</li>'));
    p.appendChild(c1);

    var c2 = el('div', 'card');
    c2.appendChild(el('h3', null, '<i class="fa-solid fa-triangle-exclamation"></i> HAZARDS'));
    c2.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-fire-flame-curved ic-fire"></i> Standing in fire <b>hurts</b> - keep your distance while spraying.</li>' +
      '<li><i class="fa-solid fa-bomb ic-fire"></i> <b>Red barrels</b> explode. Cool a primed barrel with water before the fuse runs out!</li>' +
      '<li><i class="fa-solid fa-biohazard ic-victim" style="color:#7bd63f"></i> <b>Toxic zones</b> poison you - walk around them.</li>' +
      '<li><i class="fa-solid fa-dragon" style="color:#ff6b60"></i> <b>DINOSAURS</b> hunt you (from level 3 and wave 4). You cannot kill or repel them - RUN, then finish the mission.</li>' +
      '<li><i class="fa-solid fa-droplet ic-water"></i> Refill water at blue <b>WATER STATIONS</b>. Water slowly regenerates too.</li>'));
    p.appendChild(c2);

    var c3 = el('div', 'card');
    c3.appendChild(el('h3', null, '<i class="fa-solid fa-star ic-star"></i> SCORING &amp; STARS'));
    c3.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-people-group ic-victim"></i> Every person rescued is worth <b>big points</b>.</li>' +
      '<li><i class="fa-solid fa-fire-extinguisher ic-fire"></i> Extinguished fires add points too.</li>' +
      '<li><i class="fa-solid fa-stopwatch ic-time"></i> Leftover <b>time</b>, <b>water</b> and <b>health</b> all boost your score.</li>' +
      '<li><i class="fa-solid fa-star ic-star"></i> Earn <b>1-3 stars</b> per mission. Get 3 stars for a flawless rescue!</li>'));
    p.appendChild(c3);

    var c4 = el('div', 'card');
    c4.appendChild(el('h3', null, '<i class="fa-solid fa-lightbulb"></i> TIPS'));
    c4.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-forward ic-move"></i> You can rescue people <b>before</b> or <b>after</b> putting out fires.</li>' +
      '<li><i class="fa-solid fa-clock ic-time"></i> Watch the timer - if it hits zero, the mission fails.</li>' +
      '<li><i class="fa-solid fa-heart ic-fire"></i> If your health hits zero you are out. Retreat, refill and try again.</li>' +
      '<li><i class="fa-solid fa-graduation-cap ic-victim"></i> New players: try the <b>Tutorial</b> from the PLAY button.</li>'));
    p.appendChild(c4);

    this.root.appendChild(p);
  };

  // ------------------------------------------------------------
  //  ABOUT
  // ------------------------------------------------------------
  UI.prototype.about = function () {
    var self = this;
    var p = this.panel('ABOUT', { id: 'about', scroll: true, back: function () { self.mainMenu(); } });
    var card = el('div', 'card');
    card.appendChild(el('h3', null, '\u{1F692} FIRE RESCUE MISSION'));
    card.appendChild(el('p', 'muted',
      'A fast, touch-friendly firefighting rescue game. Command a firefighter through ten escalating emergencies ' +
      '- houses, apartments, offices, schools, warehouses and factories - saving civilians and putting out the blaze ' +
      'before time runs out.'));
    card.appendChild(el('p', 'muted',
      'Earn up to three stars per mission and unlock the next level as you climb toward <b>The Last Alarm</b>.'));
    p.appendChild(card);

    var card2 = el('div', 'card');
    card2.appendChild(el('h3', null, '<i class="fa-solid fa-code"></i> TECH'));
    card2.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-mobile-screen-button ic-move"></i> HTML5 Canvas game loop @ 60fps, tuned for mid-range Android.</li>' +
      '<li><i class="fa-solid fa-volume-high ic-water"></i> All audio is synthesized at runtime - no downloads, plays offline.</li>' +
      '<li><i class="fa-solid fa-floppy-disk ic-victim"></i> Progress saves automatically to your device.</li>' +
      '<li><i class="fa-solid fa-cloud ic-star"></i> Deployed on Cloudflare Pages.</li>'));
    p.appendChild(card2);

    var card3 = el('div', 'card');
    card3.appendChild(el('h3', null, '<i class="fa-solid fa-circle-info"></i> DETAILS'));
    card3.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-code-branch"></i> Version</div><span class="st-val">' + CFG.VERSION + '</span>'));
    card3.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-layer-group"></i> Missions</div><span class="st-val">' + CFG.MAX_LEVELS + '</span>'));
    card3.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-people-group ic-victim"></i> Total rescued</div><span class="st-val">' + global.Save.data().totalRescues + '</span>'));
    p.appendChild(card3);

    var card4 = el('div', 'card');
    card4.appendChild(el('h3', null, '<i class="fa-solid fa-shield-halved"></i> ACCESSIBILITY'));
    var aBtn = el('button', 'btn ghost wide', '<i class="fa-solid fa-graduation-cap"></i> REPLAY TUTORIAL');
    aBtn.addEventListener('click', function () { self.app.audio.play('click'); self.app.startLevel(0, true); });
    card4.appendChild(aBtn);
    p.appendChild(card4);

    this.root.appendChild(p);
  };

  // ------------------------------------------------------------
  //  Confirm dialog
  // ------------------------------------------------------------
  UI.prototype.confirm = function (title, body, okLabel, onOk) {
    var self = this;
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card');
    card.appendChild(el('h2', 'lose', esc(title)));
    card.appendChild(el('p', 'sub', esc(body)));
    var actions = el('div', 'overlay-actions');
    var ok = el('button', 'btn danger wide', esc(okLabel || 'CONFIRM'));
    ok.addEventListener('click', function () {
      self.removeOverlay(ov);
      self.app.audio.play('click');
      if (onOk) onOk();
    });
    var cancel = el('button', 'btn ghost wide', 'CANCEL');
    cancel.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); });
    actions.appendChild(ok); actions.appendChild(cancel);
    card.appendChild(actions);
    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // ------------------------------------------------------------
  //  HUD
  // ------------------------------------------------------------
  UI.prototype.showHUD = function () {
    id('hud').classList.remove('hidden');
  };
  UI.prototype.hideHUD = function () {
    id('hud').classList.add('hidden');
  };

  UI.prototype.updateHUD = function (game) {
    var p = game.player;
    id('hud-time').textContent = fmtTime(game.timeLeft);
    id('hud-time').parentNode.classList.toggle('warn', game.timeLeft <= 30 && game.state === 'playing');
    id('hud-level').textContent = game.level.id === 0 ? 'TUTORIAL'
      : (game.endless ? ('WAVE ' + game.wave) : ('LEVEL ' + game.level.id));

    // endless task badge
    var taskEl = id('hud-task');
    if (taskEl) {
      if (game.endless && game.level.spec && game.level.spec.task) {
        var tk = game.level.spec.task;
        var th = '<i class="fa-solid ' + tk.icon + '"></i> <b>' + esc(tk.label) + '</b>';
        if (taskEl.dataset.sig !== th) { taskEl.innerHTML = th; taskEl.dataset.sig = th; }
        taskEl.classList.remove('hidden');
      } else {
        if (taskEl.dataset.sig) { taskEl.innerHTML = ''; taskEl.dataset.sig = ''; }
        taskEl.classList.add('hidden');
      }
    }

    var hp = Math.max(0, Math.min(1, p.health / p.maxHealth));
    var wf = Math.max(0, Math.min(1, p.water / p.maxWater));
    id('hud-health-fill').style.width = (hp * 100) + '%';
    id('hud-water-fill').style.width = (wf * 100) + '%';

    // objectives
    var obj = id('hud-objectives');
    var html = '';
    var objs = game.getObjectives();
    objs.forEach(function (o) {
      html += '<div class="obj' + (o.done ? ' done' : '') + '">' +
        '<i class="fa-solid ' + (o.done ? 'fa-circle-check' : o.icon) + '"></i>' +
        '<span>' + esc(o.label) + '</span></div>';
    });
    if (obj.dataset.sig !== html) { obj.innerHTML = html; obj.dataset.sig = html; }

    // rescue button affordance
    var rb = game.input.els && game.input.els.rescueBtn;
    if (rb) rb.classList.toggle('off', !game.nearVictim && !p.rescuing);
    var wb = game.input.els && game.input.els.waterBtn;
    if (wb) wb.classList.toggle('cooling', p.water < 2);

    // ---- dinosaur danger indicator ----
    var dl = id('hud-dino');
    if (dl) {
      var active = game.dinos && game.dinos.length > 0;
      var warned = game.dinoAlert > 0;
      var cls, sig;
      if (warned) {
        cls = 'hud-dino warn show';
        sig = 'warn';
      } else if (active) {
        var dist = game.dinoNearest;
        var close = dist < CFG.DINO.VIGNETTE_DIST;
        var lvl = close ? (1 - dist / CFG.DINO.VIGNETTE_DIST) : 0;
        var txt = dist === Infinity ? 'SEARCHING' : (Math.round(dist / CFG.TILE) + 'm');
        cls = 'hud-dino show' + (lvl > 0.66 ? ' close' : (lvl > 0.33 ? ' near' : ''));
        sig = 'dino:' + txt + ':' + cls;
      } else {
        cls = 'hud-dino';
        sig = 'off';
      }
      // Only touch the DOM when the rendered state actually changes
      // (this block used to rewrite innerHTML at 60fps and jank/crash
      // the Android WebView the moment a dinosaur spawned).
      if (dl.dataset.sig !== sig) {
        dl.dataset.sig = sig;
        dl.className = cls;
        if (sig === 'warn') {
          dl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> DANGER! DINOSAUR APPROACHING!';
        } else if (sig === 'off') {
          dl.innerHTML = '';
        } else {
          dl.innerHTML = '<i class="fa-solid fa-dragon"></i> DINOSAUR <b>' + txt + '</b>';
        }
      }
    }
  };

  UI.prototype.hudHint = function (msg, secs) {
    var h = id('hud-hint');
    if (!h) return;
    h.textContent = msg;
    h.classList.add('show');
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(function () { h.classList.remove('show'); }, (secs || 2) * 1000);
  };

  UI.prototype.hudToast = function (msg, kind) {
    var wrap = id('hud-toasts');
    if (!wrap) return;
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), esc(msg));
    wrap.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2100);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  };

  UI.prototype.hudTutorial = function (msg) {
    var t = id('hud-tutorial');
    if (!t) return;
    if (!msg) { t.classList.remove('show'); return; }
    t.innerHTML = msg;
    t.classList.add('show');
  };

  // ------------------------------------------------------------
  //  PAUSE
  // ------------------------------------------------------------
  UI.prototype.pause = function (game) {
    var self = this;
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card');
    card.appendChild(el('h2', null, '<i class="fa-solid fa-pause"></i> PAUSED'));
    card.appendChild(el('p', 'sub', esc(game.level.name)));
    var actions = el('div', 'overlay-actions');
    var res = el('button', 'btn primary wide', '<i class="fa-solid fa-play"></i> RESUME');
    res.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.resume(); });
    var rst = el('button', 'btn wide', '<i class="fa-solid fa-rotate-right"></i> RESTART LEVEL');
    rst.addEventListener('click', function () {
      self.removeOverlay(ov); self.app.audio.play('click');
      self.app.startLevel(game.level.id, game.isTutorial);
    });
    var set = el('button', 'btn ghost wide', '<i class="fa-solid fa-gear"></i> SETTINGS');
    set.addEventListener('click', function () {
      self.app.audio.play('click');
      self.removeOverlay(ov);
      self.settings(function () { self.pause(game); });
    });
    var exit = el('button', 'btn ghost wide', '<i class="fa-solid fa-house"></i> EXIT TO MAIN MENU');
    exit.addEventListener('click', function () {
      self.removeOverlay(ov); self.app.audio.play('back');
      self.app.exitToMenu();
    });
    actions.appendChild(res); actions.appendChild(rst); actions.appendChild(set); actions.appendChild(exit);
    card.appendChild(actions);
    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  UI.prototype.removeOverlay = function (ov) {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var i = this.overlays.indexOf(ov);
    if (i >= 0) this.overlays.splice(i, 1);
  };
  UI.prototype.clearOverlays = function () {
    var self = this;
    this.overlays.slice().forEach(function (o) { self.removeOverlay(o); });
    this.overlays = [];
  };
  // Removes any full-screen UI (main menu, level select, settings, ...) so that
  // gameplay is never left hidden behind a menu panel.
  UI.prototype.clearScreens = function () {
    this.root.innerHTML = '';
    this.current = null;
  };

  // ------------------------------------------------------------
  //  VICTORY
  // ------------------------------------------------------------
  UI.prototype.victory = function (game, result) {
    var self = this;
    if (result && result.endless) return this.endlessVictory(game, result);
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card');

    card.appendChild(el('h2', 'win', 'MISSION COMPLETE!'));
    card.appendChild(el('p', 'sub', esc(game.level.name)));

    var stars = el('div', 'result-stars');
    for (var i = 0; i < 3; i++) {
      var s = el('i', 'fa-solid fa-star' + (i < result.stars ? ' on' : ''));
      stars.appendChild(s);
    }
    card.appendChild(stars);
    if (result.newBest) card.appendChild(el('div', 'new-best', '\u2B50 NEW BEST SCORE'));
    else if (result.firstClear) card.appendChild(el('div', 'new-best', '\uD83C\uDF89 FIRST CLEAR'));

    var list = el('div', 'stat-list');
    function row(icon, label, val) {
      list.appendChild(el('div', 'stat-row',
        '<div class="st-left"><i class="fa-solid ' + icon + '"></i> ' + esc(label) + '</div><span class="st-val">' + esc(val) + '</span>'));
    }
    row('fa-people-group', 'People Rescued', result.rescued + ' / ' + result.totalVictims);
    row('fa-fire-extinguisher', 'Fires Out', result.firesOut + ' / ' + result.totalFires);
    row('fa-stopwatch ic-time', 'Time Remaining', fmtTime(result.timeRemaining));
    row('fa-droplet ic-water', 'Water Left', Math.round(result.waterRemaining) + ' / ' + Math.round(result.maxWater));
    row('fa-heart', 'Health Left', Math.round(result.health) + '%');
    var total = el('div', 'stat-row total',
      '<div class="st-left"><i class="fa-solid fa-trophy ic-star"></i> TOTAL SCORE</div><span class="st-val">' + result.score.toLocaleString() + '</span>');
    list.appendChild(total);
    card.appendChild(list);

    var actions = el('div', 'overlay-actions');
    if (result.hasNext) {
      var next = el('button', 'btn ok wide', '<i class="fa-solid fa-forward"></i> NEXT LEVEL');
      next.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startLevel(game.level.id + 1); });
      actions.appendChild(next);
    }
    var row2 = el('div', 'row2');
    var retry = el('button', 'btn ghost', '<i class="fa-solid fa-rotate-right"></i> RETRY');
    retry.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startLevel(game.level.id, game.isTutorial); });
    var lv = el('button', 'btn ghost', '<i class="fa-solid fa-list-ol"></i> LEVELS');
    lv.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.levelSelect(); });
    row2.appendChild(retry); row2.appendChild(lv);
    actions.appendChild(row2);
    var menu = el('button', 'btn ghost wide', '<i class="fa-solid fa-house"></i> MAIN MENU');
    menu.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); self.app.exitToMenu(); });
    actions.appendChild(menu);
    card.appendChild(actions);

    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);

    // star-by-star reveal
    var starEls = card.querySelectorAll('.result-stars i');
    starEls.forEach(function (se, idx) {
      if (idx < result.stars) {
        setTimeout(function () {
          se.classList.add('pop');
          self.app.audio.play('star', idx);
          self.app.vibrate(20);
        }, 320 + idx * 300);
      }
    });
  };

  // ------------------------------------------------------------
  //  ENDLESS VICTORY (wave cleared -> offer the next wave)
  // ------------------------------------------------------------
  UI.prototype.endlessVictory = function (game, result) {
    var self = this;
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card endless-card');

    card.appendChild(el('h2', 'win', '<i class="fa-solid fa-infinity"></i> WAVE ' + result.wave + ' CLEARED!'));
    card.appendChild(el('p', 'sub', 'Endless Mode - keep going as long as you can.'));
    if (result.newBest) card.appendChild(el('div', 'new-best', '\u2B50 NEW FURTHEST WAVE ' + result.best));

    var list = el('div', 'stat-list');
    function row(icon, label, val) {
      list.appendChild(el('div', 'stat-row',
        '<div class="st-left"><i class="fa-solid ' + icon + '"></i> ' + esc(label) + '</div><span class="st-val">' + esc(val) + '</span>'));
    }
    row('fa-people-group', 'People Rescued', result.rescued + ' / ' + result.totalVictims);
    row('fa-fire-extinguisher', 'Fires Out', result.firesOut + ' / ' + result.totalFires);
    row('fa-stopwatch ic-time', 'Time Remaining', fmtTime(result.timeRemaining));
    row('fa-heart', 'Health Left', Math.round(result.health) + '%');
    var total = el('div', 'stat-row total',
      '<div class="st-left"><i class="fa-solid fa-trophy ic-star"></i> WAVE SCORE</div><span class="st-val">' + result.score.toLocaleString() + '</span>');
    list.appendChild(total);
    card.appendChild(list);

    // next wave preview (what the difficulty task will be)
    var nxt = global.Levels.pickTask(result.wave + 1);
    if (nxt) {
      card.appendChild(el('div', 'wave-preview',
        '<div class="wp-label">NEXT UP - WAVE ' + (result.wave + 1) + '</div>' +
        '<div class="wp-task"><i class="fa-solid ' + nxt.icon + '"></i> ' + esc(nxt.label) + '</div>' +
        '<div class="wp-desc">' + esc(nxt.desc) + '</div>'));
    }

    var actions = el('div', 'overlay-actions');
    var next = el('button', 'btn ok wide', '<i class="fa-solid fa-forward"></i> NEXT WAVE');
    next.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.nextWave(); });
    actions.appendChild(next);

    var row2 = el('div', 'row2');
    var retry = el('button', 'btn ghost', '<i class="fa-solid fa-rotate-right"></i> RETRY WAVE');
    retry.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startEndless(result.wave); });
    var endRun = el('button', 'btn ghost', '<i class="fa-solid fa-flag-checkered"></i> END RUN');
    endRun.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); self.app.exitToMenu(); });
    row2.appendChild(retry); row2.appendChild(endRun);
    actions.appendChild(row2);
    card.appendChild(actions);

    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // ------------------------------------------------------------
  //  ENDLESS INTRO (rules card before a run starts)
  // ------------------------------------------------------------
  UI.prototype.endlessIntro = function () {
    var self = this;
    var best = global.Save.endlessBest();
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card endless-card');
    card.appendChild(el('h2', null, '<i class="fa-solid fa-infinity"></i> ENDLESS MODE'));
    card.appendChild(el('p', 'sub', 'Infinite waves. Every wave gets bigger, hotter and trickier.'));
    card.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-arrow-trend-up ic-fire"></i> Maps grow, fires multiply and time tightens each wave.</li>' +
      '<li><i class="fa-solid fa-list-check ic-star"></i> Each wave adds a <b>difficulty task</b> (blaze, timer, no explosions, sparse water, toxic air).</li>' +
      '<li><i class="fa-solid fa-floppy-disk ic-victim"></i> Every wave you clear is saved. One failure ends the run.</li>' +
      '<li><i class="fa-solid fa-trophy ic-star"></i> How far can you push before the inferno wins?</li>'));

    if (best > 0) {
      card.appendChild(el('div', 'wave-preview',
        '<div class="wp-label"><i class="fa-solid fa-medal"></i> FURTHEST WAVE</div>' +
        '<div class="wp-task">' + best + '</div>'));
    }

    var actions = el('div', 'overlay-actions');
    var go = el('button', 'btn primary wide', '<i class="fa-solid fa-play"></i> START ENDLESS RUN');
    go.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startEndless(1); });
    actions.appendChild(go);
    if (best > 0) {
      var cont = el('button', 'btn ok wide', '<i class="fa-solid fa-forward"></i> CONTINUE FROM WAVE ' + (best + 1));
      cont.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startEndless(best + 1); });
      actions.appendChild(cont);
    }
    var back = el('button', 'btn ghost wide', '<i class="fa-solid fa-arrow-left"></i> BACK');
    back.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); self.mainMenu(); });
    actions.appendChild(back);

    card.appendChild(actions);
    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // ------------------------------------------------------------
  //  GAME OVER
  // ------------------------------------------------------------
  UI.prototype.gameOver = function (game, reason, endlessRes) {
    var self = this;
    if (endlessRes && endlessRes.endless) return this.endlessGameOver(game, reason, endlessRes);
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card');
    card.appendChild(el('h2', 'lose', '<i class="fa-solid fa-skull"></i> MISSION FAILED'));
    var reasons = {
      time: 'Time ran out before the rescue was complete.',
      health: 'Your health reached zero. Stay clear of the flames and the dinosaur!',
      objective: 'A critical objective was failed.',
      dino: 'A dinosaur caught you. Keep moving and never stop running!'
    };
    card.appendChild(el('p', 'sub', esc(reasons[reason] || 'Better luck next time.')));

    var p = game.player;
    var list = el('div', 'stat-list');
    list.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-people-group"></i> Rescued</div><span class="st-val">' + p.rescued + ' / ' + game.level.victims.length + '</span>'));
    list.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-fire-extinguisher"></i> Fires Out</div><span class="st-val">' + p.extinguished + ' / ' + game.level.fires.length + '</span>'));
    card.appendChild(list);

    card.appendChild(el('p', 'sub', '<i class="fa-solid fa-lightbulb ic-time"></i> Tip: ' + esc(game.level.spec.hint || 'Keep trying!')));

    var actions = el('div', 'overlay-actions');
    var retry = el('button', 'btn primary wide', '<i class="fa-solid fa-rotate-right"></i> RETRY');
    retry.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startLevel(game.level.id, game.isTutorial); });
    actions.appendChild(retry);
    var row2 = el('div', 'row2');
    var lv = el('button', 'btn ghost', '<i class="fa-solid fa-list-ol"></i> LEVELS');
    lv.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.levelSelect(); });
    var menu = el('button', 'btn ghost', '<i class="fa-solid fa-house"></i> MENU');
    menu.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); self.app.exitToMenu(); });
    row2.appendChild(lv); row2.appendChild(menu);
    actions.appendChild(row2);
    card.appendChild(actions);

    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // ------------------------------------------------------------
  //  ENDLESS GAME OVER (run ended -> show best/furthest wave)
  // ------------------------------------------------------------
  UI.prototype.endlessGameOver = function (game, reason, result) {
    var self = this;
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card endless-card');
    card.appendChild(el('h2', 'lose', '<i class="fa-solid fa-fire"></i> RUN OVER'));
    var reasons = {
      time: 'Time ran out on wave ' + result.wave + '.',
      health: 'Your health reached zero on wave ' + result.wave + '.',
      objective: 'A critical objective was failed on wave ' + result.wave + '.'
    };
    card.appendChild(el('p', 'sub', esc(reasons[reason] || ('Your run ended on wave ' + result.wave + '.'))));

    card.appendChild(el('div', 'wave-preview',
      '<div class="wp-label">FURTHEST WAVE CLEARED</div>' +
      '<div class="wp-task">' + (result.best || 0) + '</div>'));

    var p = game.player;
    var list = el('div', 'stat-list');
    list.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-people-group"></i> Rescued</div><span class="st-val">' + p.rescued + ' / ' + game.level.victims.length + '</span>'));
    list.appendChild(el('div', 'stat-row', '<div class="st-left"><i class="fa-solid fa-fire-extinguisher"></i> Fires Out</div><span class="st-val">' + p.extinguished + ' / ' + game.level.fires.length + '</span>'));
    list.appendChild(el('div', 'stat-row total', '<div class="st-left"><i class="fa-solid fa-trophy ic-star"></i> WAVE SCORE</div><span class="st-val">' + result.score.toLocaleString() + '</span>'));
    card.appendChild(list);

    var actions = el('div', 'overlay-actions');
    var retry = el('button', 'btn primary wide', '<i class="fa-solid fa-rotate-right"></i> RETRY WAVE ' + result.wave);
    retry.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startEndless(result.wave); });
    actions.appendChild(retry);
    var row2 = el('div', 'row2');
    var again = el('button', 'btn ghost', '<i class="fa-solid fa-infinity"></i> NEW RUN');
    again.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startEndless(1); });
    var menu = el('button', 'btn ghost', '<i class="fa-solid fa-house"></i> MENU');
    menu.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('back'); self.app.exitToMenu(); });
    row2.appendChild(again); row2.appendChild(menu);
    actions.appendChild(row2);
    card.appendChild(actions);

    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // ------------------------------------------------------------
  //  Tutorial intro card
  // ------------------------------------------------------------
  UI.prototype.tutorialIntro = function (startFn) {
    var self = this;
    var ov = el('div', 'overlay');
    var card = el('div', 'overlay-card');
    card.appendChild(el('h2', null, '\u{1F468}\u200D\u{1F692} TRAINING DAY'));
    card.appendChild(el('p', 'sub', 'Welcome, rookie! Let\'s cover the basics.'));
    card.appendChild(el('ul', 'help-list',
      '<li><i class="fa-solid fa-arrows-up-down-left-right ic-move"></i> Drag the <b>joystick</b> (bottom-left) to move.</li>' +
      '<li><i class="fa-solid fa-hand-holding-heart ic-victim"></i> Hold the <b>green RESCUE</b> button near a trapped person.</li>' +
      '<li><i class="fa-solid fa-droplet ic-water"></i> Hold the <b>blue WATER</b> button and face a fire to spray.</li>' +
      '<li><i class="fa-solid fa-door-open ic-star"></i> When done, walk into the green <b>EXIT</b>.</li>'));
    var actions = el('div', 'overlay-actions');
    var go = el('button', 'btn primary wide', '<i class="fa-solid fa-play"></i> START TRAINING');
    go.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); startFn(); });
    actions.appendChild(go);
    var skip = el('button', 'btn ghost wide', 'SKIP TO LEVEL 1');
    skip.addEventListener('click', function () { self.removeOverlay(ov); self.app.audio.play('click'); self.app.startLevel(1); });
    actions.appendChild(skip);
    card.appendChild(actions);
    ov.appendChild(card);
    this.root.appendChild(ov);
    this.overlays.push(ov);
  };

  // Export utilities
  UI.fmtTime = fmtTime;
  UI.esc = esc;
  UI.el = el;

  global.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
