/* ============================================================
   game.js - Core game controller: loop, world, entities, rules
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;
  var TILE = CFG.TILE;
  var WALL = 0, FLOOR = 1, EXIT = 2;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hypot(a, b) { return Math.sqrt(a * a + b * b); }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  function Game(app) {
    this.app = app;
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.fx = new global.FX();
    this.audio = app.audio;
    this.ui = app.ui;
    this.input = global.Input;

    this.state = 'idle';       // idle|playing|paused|won|over
    this.level = null;
    this.player = null;
    this.fires = []; this.victims = []; this.barrels = [];
    this.toxic = []; this.waters = [];
    this.dinos = [];

    this.dpr = 1; this.viewW = 0; this.viewH = 0;
    this.camera = { x: 0, y: 0, zoom: 1 };

    this._running = false;
    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this._sprayAcc = 0;
    this._boundLoop = this.loop.bind(this);
    this._spawnAt = null;
    this.explosions = 0;
    this.endReason = null;
    this._hintShownExit = false;
    this._objSig = '';
  }

  // ============================================================
  //  Sizing
  // ============================================================
  Game.prototype.fit = function () {
    var w = global.innerWidth || 360;
    var h = global.innerHeight || 640;
    this.dpr = Math.min(2, global.devicePixelRatio || 1);
    this.viewW = w; this.viewH = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
  };

  // ============================================================
  //  Level lifecycle
  // ============================================================
  Game.prototype.loadLevel = function (id, isTutorial) {
    this.isTutorial = !!isTutorial || id === 0;
    var lv = global.Levels.build(id === 0 ? 0 : id);
    this.endless = false;
    this.wave = 0;
    this.applyLevel(lv);
  };

  // Endless mode: build (or rebuild) wave `wave` (1-based) and play it.
  Game.prototype.loadEndless = function (wave) {
    wave = Math.max(1, parseInt(wave, 10) || 1);
    this.isTutorial = false;
    var lv = global.Levels.buildEndless(wave);
    this.endless = true;
    this.wave = wave;
    this.applyLevel(lv);
  };

  // Shared setup for campaign levels and endless waves.
  Game.prototype.applyLevel = function (lv) {
    var E = global.Entities;
    this.level = lv;
    this.buildFloor();          // pre-render this level's floor texture (required by render)

    this.timeLeft = lv.spec.time;
    this.totalTime = lv.spec.time;
    this.elapsed = 0;
    this.explosions = 0;
    this.nearVictim = null;
    this.rescueRing = null;
    this.slowFactor = 1;
    this.endReason = null;
    this._hintShownExit = false;
    this._objSig = '';
    this._sprayAcc = 0;

    this.fires = lv.fires.map(function (f) { return new E.Fire(f.x, f.y, f.size); });
    this.victims = lv.victims.map(function (v) { return new E.Victim(v.x, v.y); });
    this.barrels = lv.barrels.map(function (b) { return new E.Barrel(b.x, b.y); });
    this.toxic = lv.toxic.map(function (t) { return new E.ToxicZone(t.x, t.y, t.r); });
    this.waters = lv.waters.map(function (w) { return new E.WaterStation(w.x, w.y); });
    this.player = new E.Player(lv.spawn.x, lv.spawn.y);
    this.player.isTutorial = this.isTutorial;

    // --- dinosaurs ---
    this.dinos = [];
    this.dinoPlan = lv.dinoPlan || { enabled: false };
    this.dinoSpawns = (lv.dinoSpawns || []).slice();
    this.dinoTimer = this.dinoPlan.enabled ? this.dinoPlan.first : Infinity;
    this.dinoCount = 0;
    this.dinoWarned = false;
    this.dinoAlert = 0;          // seconds left on the "DANGER" banner
    this.dinoPreWarn = false;    // pre-spawn heads-up active
    this.dinoNearest = Infinity; // distance to nearest active dino (HUD)
    this.dinoEscapes = 0;        // dinos that gave up chasing

    this.initialFireCount = this.fires.length;
    this.initialVictimCount = this.victims.length;
    this._spawnAt = { x: lv.spawn.x, y: lv.spawn.y };
    this.aimAngle = this.player.facing;

    this.fx.reset();
    this.fx.setWorldBounds(lv.pxW, lv.pxH);
    this.fx.initMotes(lv);

    // camera snap
    this.camera.zoom = this.computeZoom();
    this.camera.x = lv.pxW / 2;
    this.camera.y = lv.pxH / 2;
    this.updateCamera(0.001, true);

    this.tutorialStep = this.isTutorial ? 0 : -1;
    this.tutorialTimer = 0;

    this.state = 'playing';
    this.ui.showHUD();
    this.ui.updateHUD(this);
  };

  Game.prototype.computeZoom = function () {
    var lv = this.level;
    var wantX = this.viewW / (8.6 * TILE);
    var wantY = this.viewH / (11.4 * TILE);
    var z = Math.min(wantX, wantY);
    var fillX = this.viewW / (lv.pxW - 8);
    var fillY = this.viewH / (lv.pxH - 8);
    z = Math.max(z, Math.min(fillX, fillY));
    z = Math.max(z, 0.28);
    return Math.min(z, 2.4);
  };

  Game.prototype.start = function () {
    this.fit();
    if (!this._running) {
      this._running = true;
      this._last = 0;
      this._acc = 0;
      this._raf = global.requestAnimationFrame(this._boundLoop);
    }
    this.audio.startMusic();
  };

  Game.prototype.stop = function () {
    this._running = false;
    if (this._raf) global.cancelAnimationFrame(this._raf);
    this._raf = null;
    this.audio.stopMusic();
  };

  Game.prototype.pause = function () {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseAll();
  };

  Game.prototype.resume = function () {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this._last = 0;
    this._acc = 0;
  };

  // ============================================================
  //  Main loop (fixed timestep, interpolated render)
  // ============================================================
  Game.prototype.loop = function (ts) {
    if (!this._running) return;
    this._raf = global.requestAnimationFrame(this._boundLoop);
    if (!this._last) this._last = ts;
    var dt = (ts - this._last) / 1000;
    this._last = ts;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    if (this.state === 'playing') {
      var step = 1 / 60, iter = 0;
      this._acc += dt;
      while (this._acc >= step && iter < 5) {
        this.update(step);
        this._acc -= step;
        iter++;
        if (this.state !== 'playing') { this._acc = 0; break; }
      }
    } else if (this.state === 'won' || this.state === 'over') {
      // keep visual effects alive after the mission ends
      this.fx.update(Math.min(dt, 0.05));
      for (var i = 0; i < this.fires.length; i++) this.fires[i].update(Math.min(dt, 0.05), this);
      this.player._bobT += dt;
    }
    this.render(ts / 1000);
  };

  // ============================================================
  //  Update
  // ============================================================
  Game.prototype.update = function (dt) {
    if (this.state !== 'playing' || !this.level) return;
    var i;

    // timer
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.fail('time'); return; }

    this.updateAim();
    this.player.update(dt, this);
    if (this.state !== 'playing') return;

    for (i = 0; i < this.fires.length; i++) this.fires[i].update(dt, this);
    for (i = 0; i < this.victims.length; i++) this.victims[i].update(dt, this);
    for (i = 0; i < this.barrels.length; i++) this.barrels[i].update(dt, this);
    for (i = 0; i < this.toxic.length; i++) this.toxic[i].update(dt, this);
    for (i = 0; i < this.waters.length; i++) this.waters[i].update(dt, this);

    this.updateDinos(dt);
    if (this.state !== 'playing') return;

    this.fx.update(dt);
    this.updateCamera(dt);
    this.updateTutorial(dt);
    this.checkExit();

    // music tension: more burning fires => faster theme
    this.audio.setFireLevel(Math.min(1, this.aliveFireCount() / 8));

    this.ui.updateHUD(this);
  };

  Game.prototype.updateAim = function () {
    var mv = this.input.getMoveVector();
    var m = hypot(mv.x, mv.y);
    if (m > 0.12) this.aimAngle = Math.atan2(mv.y, mv.x);
    else this.aimAngle = this.player.facing;
  };

  Game.prototype.aliveFireCount = function () {
    var n = 0;
    for (var i = 0; i < this.fires.length; i++) if (this.fires[i].alive) n++;
    return n;
  };

  // ------------------------------------------------------------
  //  Dinosaurs (lethal predator - cannot be killed or repelled)
  // ------------------------------------------------------------
  Game.prototype.updateDinos = function (dt) {
    if (this.isTutorial) { this.dinoNearest = Infinity; return; }
    var D = CFG.DINO, P = this.player, i, d;

    // banner / pre-warning countdown
    if (this.dinoAlert > 0) this.dinoAlert -= dt;

    // spawn scheduling
    if (this.dinoPlan && this.dinoPlan.enabled && this.state === 'playing') {
      this.dinoTimer -= dt;
      if (this.dinoTimer <= 0 && this.activeDinoCount() < this.dinoPlan.maxActive) {
        this.dinoTimer = this.dinoPlan.interval;
        if (!P.dead && this.dinoSpawns.length) this.spawnDino();
      }
    }

    // update each predator
    this.dinoNearest = Infinity;
    for (i = 0; i < this.dinos.length; i++) {
      d = this.dinos[i];
      d.update(dt, this);
      if (d.gone) {
        this.dinoEscapes++;
        if (this.dinos.length === 1) this.ui.hudToast('The dinosaur gave up - stay vigilant', 'good');
      } else if (d.alive) {
        this.dinoNearest = Math.min(this.dinoNearest, d.dist);
      }
    }
    // prune the departed
    for (i = this.dinos.length - 1; i >= 0; i--) {
      if (this.dinos[i].gone) this.dinos.splice(i, 1);
    }

    this.audio.setDinoLevel(this.dinoNearest === Infinity ? 0
      : clamp(1 - this.dinoNearest / D.VIGNETTE_DIST, 0, 1));
  };

  Game.prototype.activeDinoCount = function () {
    var n = 0;
    for (var i = 0; i < this.dinos.length; i++) if (this.dinos[i].alive && !this.dinos[i].gone) n++;
    return n;
  };

  // Choose a spawn tile that is well away from the player and off-screen-ish,
  // preferring the farthest available candidate.
  Game.prototype.spawnDino = function () {
    var P = this.player, best = null, bestD = -1;
    for (var i = 0; i < this.dinoSpawns.length; i++) {
      var s = this.dinoSpawns[i];
      var dx = s.x - P.x, dy = s.y - P.y;
      var dd = dx * dx + dy * dy;
      if (dd < 300 * 300) continue;               // never spawn on top of the player
      if (dd > bestD) { bestD = dd; best = s; }
    }
    if (!best) {
      // fallback: push out from the player toward the map centre
      var lv = this.level;
      var ang = Math.random() * 6.283;
      var dist = Math.max(lv.pxW, lv.pxH) * 0.4;
      best = { x: clamp(P.x + Math.cos(ang) * dist, TILE, lv.pxW - TILE),
               y: clamp(P.y + Math.sin(ang) * dist, TILE, lv.pxH - TILE) };
    }

    var opts = {
      speedMult: this.dinoPlan.speedMult,
      chaseTime: this.dinoPlan.chaseTime,
      facing: Math.atan2(P.y - best.y, P.x - best.x)
    };
    var dino = new global.Entities.Dino(best.x, best.y, opts);
    this.dinos.push(dino);

    // ---- warning sequence: roar, shake, banner ----
    this.dinoAlert = CFG.DINO.PREWARN + dino.warnTime;
    this.audio.play('dinoWarn');
    this.fx.addShake(18);
    this.fx.flashScreen(0.20, 'rgba(255,40,40,1)');
    this.fx.ring(best.x, best.y, 10, 260, 'rgba(255,60,50,0.8)', 0.9);
    this.fx.text(best.x, best.y - 60, 'DINOSAUR!', '#ff3b3b', 22);
    for (var k = 0; k < 14; k++) {
      this.fx.emit({ x: best.x + rand(-30, 30), y: best.y + rand(-20, 20), vx: rand(-40, 40), vy: rand(-50, -8), life: rand(0.4, 0.9), size: rand(6, 13), col: 'rgba(150,140,120,0.5)', type: 'puff', grow: 22, alpha: 0.55 });
    }
    this.vibrate(140);
    this.ui.hudToast('DANGER! DINOSAUR APPROACHING!', 'bad');
    return dino;
  };

  // Called by a Dino the moment it lands a bite.
  Game.prototype.onDinoBite = function (dino) {
    var P = this.player, D = CFG.DINO;
    if (P.dead) return;
    P.invuln = Math.max(P.invuln, 0.35);
    P.damage(D.ATTACK_DAMAGE, this);
    P.hurtFlash = 0.5;
    this.audio.play('dinoBite');
    this.fx.addShake(16);
    this.fx.flashScreen(0.3, 'rgba(255,30,30,1)');
    this.fx.text(P.x, P.y - 42, '-' + D.ATTACK_DAMAGE, '#ff4757', 20);
    this.fx.splashBurst(P.x, P.y);
    this.vibrate(160);
    // shove the player away from the jaws
    var ang = Math.atan2(P.y - dino.y, P.x - dino.x);
    P.x = clamp(P.x + Math.cos(ang) * 26, TILE, this.level.pxW - TILE);
    P.y = clamp(P.y + Math.sin(ang) * 26, TILE, this.level.pxH - TILE);
    // add the impulse to the camera lead so it reads as a knockback
    P.vx += Math.cos(ang) * D.KNOCKBACK * 0.4;
    P.vy += Math.sin(ang) * D.KNOCKBACK * 0.4;
  };

  // True when a dinosaur is close enough to threaten the player (HUD/vignette).
  Game.prototype.dinoThreat = function () {
    return this.dinoNearest !== Infinity && this.dinoNearest < CFG.DINO.VIGNETTE_DIST;
  };

  // ------------------------------------------------------------
  //  Camera
  // ------------------------------------------------------------
  Game.prototype.updateCamera = function (dt, snap) {
    var lv = this.level;
    this.camera.zoom = this.computeZoom();
    var tx = this.player.x, ty = this.player.y;
    // lead the camera slightly in the direction of movement
    tx += this.player.vx * 0.22;
    ty += this.player.vy * 0.22;
    var k = snap ? 1 : (1 - Math.pow(0.0025, dt));
    this.camera.x += (tx - this.camera.x) * k;
    this.camera.y += (ty - this.camera.y) * k;

    var z = this.camera.zoom;
    var halfW = this.viewW / (2 * z), halfH = this.viewH / (2 * z);
    this.camera.x = (lv.pxW <= halfW * 2) ? lv.pxW / 2 : clamp(this.camera.x, halfW, lv.pxW - halfW);
    this.camera.y = (lv.pxH <= halfH * 2) ? lv.pxH / 2 : clamp(this.camera.y, halfH, lv.pxH - halfH);
  };

  // ------------------------------------------------------------
  //  Water spray
  // ------------------------------------------------------------
  Game.prototype.raycastWall = function (x, y, ang, maxDist) {
    var lv = this.level;
    var step = TILE * 0.28;
    var cx = Math.cos(ang), cy = Math.sin(ang);
    var d = 0;
    while (d < maxDist) {
      d += step;
      var tx = Math.floor((x + cx * d) / TILE);
      var ty = Math.floor((y + cy * d) / TILE);
      if (tx < 0 || ty < 0 || tx >= lv.W || ty >= lv.H) return d;
      if (lv.grid[ty][tx] === WALL) return d - step * 0.5;
    }
    return maxDist;
  };

  Game.prototype.doSpray = function (dt) {
    var p = this.player, P = CFG.PLAYER;
    var ang = p.aimFacing;
    var wallDist = this.raycastWall(p.x, p.y, ang, P.SPRAY_RANGE);
    var range = Math.min(P.SPRAY_RANGE, wallDist);
    var nozX = p.x + Math.cos(ang) * 20;
    var nozY = p.y + Math.sin(ang) * 20;

    // droplets
    this._sprayAcc += dt * 78;
    while (this._sprayAcc >= 1) {
      this._sprayAcc -= 1;
      var a = ang + rand(-0.42, 0.42);
      var sp = rand(230, 400);
      var life = clamp(range / sp, 0.08, 0.55);
      this.fx.emit({
        x: nozX, y: nozY,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: life * rand(0.7, 1.1), size: rand(2.2, 4.4),
        col: 'rgba(165,230,255,0.95)', type: 'drop', grav: 150, drag: 0.99, alpha: 0.9
      });
      if (Math.random() < 0.28) this.fx.mist(nozX + Math.cos(ang) * rand(10, range), nozY + Math.sin(ang) * rand(10, range));
    }

    var arcHalf = P.SPRAY_ARC / 2;
    var i, f;

    // damage fires inside the cone
    for (i = 0; i < this.fires.length; i++) {
      f = this.fires[i];
      if (!f.alive) continue;
      var dx = f.x - p.x, dy = f.y - p.y;
      var d = hypot(dx, dy);
      if (d > range + f.radius * 0.9) continue;
      var toFire = Math.atan2(dy, dx);
      if (Math.abs(angDiff(toFire, ang)) > arcHalf) continue;
      var fall = clamp(1 - Math.max(0, d - 26) / (P.SPRAY_RANGE * 1.25), 0.35, 1);
      var dmg = P.SPRAY_DPS * dt * fall;
      if (Math.random() < 0.5) this.fx.splashBurst(f.x + rand(-8, 8), f.y + rand(-8, 8));
      if (f.damage(dmg, this)) this.onFireOut(f);
    }

    // cool barrels inside the cone (defuse the fuse)
    for (i = 0; i < this.barrels.length; i++) {
      var b = this.barrels[i];
      if (!b.alive || !b.primed) continue;
      var bd = hypot(b.x - p.x, b.y - p.y);
      if (bd > range + b.r) continue;
      if (Math.abs(angDiff(Math.atan2(b.y - p.y, b.x - p.x), ang)) > arcHalf) continue;
      b.cool(dt * 1.5, this);
    }
  };

  // ------------------------------------------------------------
  //  Events from entities
  // ------------------------------------------------------------
  Game.prototype.onFireOut = function (f) {
    this.player.extinguished++;
    this.audio.play('extinguish');
    this.fx.ring(f.x, f.y, 8, f.radius * 1.8, 'rgba(165,230,255,0.9)', 0.45);
    this.fx.text(f.x, f.y - 34, 'FIRE OUT', '#9fe4ff', 15);
    this.ui.hudToast('Fire extinguished', 'good');
    for (var i = 0; i < 10; i++) this.fx.steam(f.x + rand(-12, 12), f.y + rand(-12, 12), 0.8);
    this.checkObjectives();
  };

  Game.prototype.onVictimRescued = function (v) {
    this.player.rescued++;
    this.ui.hudToast('Civilian rescued  +5s', 'good');
    this.timeLeft = Math.min(this.totalTime, this.timeLeft + 5);
    this.vibrate(30);
    this.checkObjectives();
  };

  Game.prototype.onExplosion = function (x, y) {
    this.explosions++;
    var p = this.player;
    var d = hypot(p.x - x, p.y - y);
    if (d < CFG.EXPLOSION_RADIUS) {
      p.damage(CFG.EXPLOSION_DAMAGE * (1 - d / CFG.EXPLOSION_RADIUS), this);
      if (this.state !== 'playing') return;
    }
    // chain reaction
    for (var i = 0; i < this.barrels.length; i++) {
      var b = this.barrels[i];
      if (b.alive && !b.primed && hypot(b.x - x, b.y - y) < 130) {
        b.primed = true; b.fuse = 0.7;
      }
    }
    if (this.level.spec.noExplosion) {
      this.fail('objective');
      return;
    }
    this.checkObjectives();
  };

  Game.prototype.onPlayerDead = function () {
    if (this.state !== 'playing') return;
    this.fail('health');
  };

  Game.prototype.checkObjectives = function () {
    if (this.state !== 'playing') return;
    var all = this.allRequiredDone();
    if (all && !this._hintShownExit) {
      this._hintShownExit = true;
      this.ui.hudHint('All objectives complete - head to the EXIT!', 3);
      this.audio.play('unlock');
    }
  };

  Game.prototype.allRequiredDone = function () {
    var p = this.player, lv = this.level;
    if (p.rescued < this.initialVictimCount) return false;
    if (p.extinguished < this.initialFireCount) return false;
    if (lv.spec.noExplosion && this.explosions > 0) return false;
    return true;
  };

  Game.prototype.getObjectives = function () {
    var p = this.player, lv = this.level;
    var out = [];
    out.push({
      icon: 'fa-people-group', label: 'Rescue ' + Math.min(p.rescued, this.initialVictimCount) + ' / ' + this.initialVictimCount,
      done: p.rescued >= this.initialVictimCount
    });
    out.push({
      icon: 'fa-fire-extinguisher', label: 'Fires ' + Math.min(p.extinguished, this.initialFireCount) + ' / ' + this.initialFireCount,
      done: p.extinguished >= this.initialFireCount
    });
    if (lv.spec.noExplosion) {
      out.push({ icon: 'fa-bomb', label: 'No explosions', done: this.explosions === 0 });
    }
    out.push({
      icon: 'fa-door-open', label: 'Reach the EXIT',
      done: this.state === 'won' || this.exited === true
    });
    return out;
  };

  Game.prototype.checkExit = function () {
    var lv = this.level, p = this.player;
    if (!lv.exit) return;
    if (hypot(p.x - lv.exit.x, p.y - lv.exit.y) < lv.exit.size + p.radius) {
      if (this.allRequiredDone()) {
        this.win();
      } else if (!this._exitNag || this.elapsed - this._exitNag > 4) {
        this._exitNag = this.elapsed;
        var p2 = this.player;
        var need = [];
        if (p2.rescued < this.initialVictimCount) need.push((this.initialVictimCount - p2.rescued) + ' more rescued');
        if (p2.extinguished < this.initialFireCount) need.push((this.initialFireCount - p2.extinguished) + ' more fires');
        if (lv.spec.noExplosion && this.explosions > 0) need.push('avoid explosions');
        this.ui.hudHint('Finish your objectives first: ' + need.join(', '), 2.4);
        this.audio.play('blocked');
      }
    }
  };

  // ------------------------------------------------------------
  //  End states
  // ------------------------------------------------------------
  Game.prototype.fail = function (reason) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.endReason = reason;
    this.input.releaseAll();
    this.audio.play('gameover');
    this.vibrate(120);
    this.fx.flashScreen(0.45, 'rgba(255,40,50,1)');
    this.ui.hideHUD();
    // Endless run ends here: the best *cleared* wave was already saved on each win.
    if (this.endless) {
      var runRes = this.computeResult();
      runRes.endless = true;
      runRes.wave = this.wave;
      runRes.best = global.Save.endlessBest();
      runRes.newBest = false;
      this.ui.gameOver(this, reason, runRes);
      return;
    }
    this.ui.gameOver(this, reason);
  };

  Game.prototype.win = function () {
    if (this.state !== 'playing') return;
    this.state = 'won';
    this.exited = true;
    this.input.releaseAll();
    var res = this.computeResult();
    this.audio.play('victory');
    this.vibrate(40);
    for (var i = 0; i < 3; i++) {
      this.fx.ring(this.player.x, this.player.y, 10, 220 + i * 60, 'rgba(46,224,106,0.8)', 0.7);
    }
    for (var j = 0; j < 40; j++) {
      var a = Math.random() * 6.283;
      this.fx.emit({
        x: this.player.x, y: this.player.y,
        vx: Math.cos(a) * rand(80, 260), vy: Math.sin(a) * rand(80, 260),
        life: rand(0.6, 1.4), size: rand(3, 7),
        col: ['#ffd23f', '#2ee06a', '#59d2ff', '#ff8a3d'][j % 4], type: 'glow', grav: 120, drag: 0.93
      });
    }

    if (this.endless) {
      // Endless: record the cleared wave, then offer the next wave.
      var rec = global.Save.recordEndlessWave(this.wave, res.score);
      res.endless = true;
      res.wave = this.wave;
      res.newBest = rec.newBest;
      res.firstClear = false;
      res.hasNext = false;
      res.best = rec.best;
      res.bestScore = global.Save.endlessScore(this.wave);
    } else if (this.level.id > 0) {
      var saveRes = global.Save.completeLevel(this.level.id, res);
      res.newBest = saveRes.newBest;
      res.firstClear = saveRes.firstClear;
      res.newStars = saveRes.newStars;
    } else {
      global.Save.markTutorialDone();
    }
    if (!this.endless) res.hasNext = this.level.id < CFG.MAX_LEVELS;

    this.ui.hideHUD();
    this.ui.victory(this, res);
  };

  Game.prototype.computeResult = function () {
    var p = this.player, S = CFG.SCORE;
    var rescuedScore = p.rescued * S.VICTIM;
    var fireScore = p.extinguished * S.FIRE;
    var timeBonus = Math.round(this.timeLeft) * S.TIME_BONUS_PER_SEC;
    var waterBonus = Math.round(Math.max(0, p.water)) * S.WATER_BONUS_PER_UNIT;
    var healthBonus = Math.round(p.health) * S.HEALTH_BONUS_PER_HP;
    var penalty = this.explosions * 350;
    var score = Math.max(0, Math.round(rescuedScore + fireScore + timeBonus + waterBonus + healthBonus - penalty));
    var stars = 1;
    if (score >= this.level.star3) stars = 3;
    else if (score >= this.level.star2) stars = 2;
    return {
      score: score, stars: stars,
      rescued: p.rescued, totalVictims: this.initialVictimCount,
      firesOut: p.extinguished, totalFires: this.initialFireCount,
      timeRemaining: Math.max(0, this.timeLeft),
      waterRemaining: Math.max(0, p.water), maxWater: p.maxWater,
      health: p.health, explosions: this.explosions,
      hasNext: false, newBest: false, firstClear: false
    };
  };

  // ------------------------------------------------------------
  //  Tutorial
  // ------------------------------------------------------------
  Game.prototype.updateTutorial = function (dt) {
    if (!this.isTutorial) return;
    this.tutorialTimer += dt;
    var p = this.player, self = this, step = this.tutorialStep;

    function say(html) { self.ui.hudTutorial(html); }

    if (step === 0) {
      say('<b>STEP 1</b> - Drag the <b>joystick</b> (bottom-left) to move your firefighter.');
      if (hypot(p.x - this._spawnAt.x, p.y - this._spawnAt.y) > 70) this.setTutorial(1);
    } else if (step === 1) {
      say('<b>STEP 2</b> - Walk up to the <b>trapped person</b> and hold the green <b>RESCUE</b> button.');
      if (p.rescued >= 1) this.setTutorial(2);
    } else if (step === 2) {
      say('<b>STEP 3</b> - Face the <b>fire</b>, then hold the blue <b>WATER</b> button until it dies.');
      if (p.extinguished >= 1) this.setTutorial(3);
    } else if (step === 3) {
      say('<b>STEP 4</b> - Great work! Now walk into the glowing green <b>EXIT</b> to finish training.');
      if (this.state === 'won') this.setTutorial(4);
    } else if (step >= 4) {
      this.ui.hudTutorial('');
    }
  };

  Game.prototype.setTutorial = function (n) {
    this.tutorialStep = n;
    this.tutorialTimer = 0;
    this.audio.play('unlock');
    this.ui.hudToast('Step complete!', 'good');
  };

  // ------------------------------------------------------------
  //  Small helpers used by entities
  // ------------------------------------------------------------
  Game.prototype.hudHint = function (msg, secs) { this.ui.hudHint(msg, secs); };

  Game.prototype.vibrate = function (ms) {
    try {
      if (global.Save.getSettings().vibration && global.navigator && global.navigator.vibrate) {
        global.navigator.vibrate(ms);
      }
    } catch (e) {}
  };

  Game.prototype.pointFree = function (tx, ty) {
    var wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
    var i;
    for (i = 0; i < this.fires.length; i++) if (this.fires[i].alive && hypot(this.fires[i].x - wx, this.fires[i].y - wy) < TILE) return false;
    for (i = 0; i < this.victims.length; i++) if (hypot(this.victims[i].x - wx, this.victims[i].y - wy) < TILE) return false;
    for (i = 0; i < this.barrels.length; i++) if (this.barrels[i].alive && hypot(this.barrels[i].x - wx, this.barrels[i].y - wy) < TILE) return false;
    for (i = 0; i < this.waters.length; i++) if (hypot(this.waters[i].x - wx, this.waters[i].y - wy) < TILE) return false;
    for (i = 0; i < this.toxic.length; i++) if (hypot(this.toxic[i].x - wx, this.toxic[i].y - wy) < TILE * 1.2) return false;
    if (this.level.exit && hypot(this.level.exit.x - wx, this.level.exit.y - wy) < TILE) return false;
    if (hypot(this.player.x - wx, this.player.y - wy) < TILE * 1.1) return false;
    return true;
  };

  // ============================================================
  //  Floor pre-render (cached offscreen canvas)
  // ============================================================
  Game.prototype.buildFloor = function () {
    var lv = this.level;
    var c = document.createElement('canvas');
    c.width = lv.pxW; c.height = lv.pxH;
    var g = c.getContext('2d');
    var t = TILE;
    var types = lv.types;

    // floor base
    g.fillStyle = types.floor;
    g.fillRect(0, 0, lv.pxW, lv.pxH);

    // tile texture
    for (var y = 0; y < lv.H; y++) {
      for (var x = 0; x < lv.W; x++) {
        if (lv.grid[y][x] === WALL) continue;
        var shade = ((x + y) % 2 === 0);
        g.fillStyle = shade ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
        g.fillRect(x * t, y * t, t, t);
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        g.lineWidth = 1;
        g.strokeRect(x * t + 0.5, y * t + 0.5, t - 1, t - 1);
        // speckle
        if (((x * 31 + y * 17) % 5) === 0) {
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(x * t + 8 + (x * 7 % 30), y * t + 10 + (y * 11 % 28), 4, 4);
        }
      }
    }

    // exit pad
    if (lv.exit) {
      var ex = lv.exit.x, ey = lv.exit.y, r = lv.exit.size;
      g.save();
      g.globalAlpha = 0.9;
      var grd = g.createRadialGradient(ex, ey, 2, ex, ey, r * 1.5);
      grd.addColorStop(0, 'rgba(46,224,106,0.85)');
      grd.addColorStop(0.6, 'rgba(46,224,106,0.35)');
      grd.addColorStop(1, 'rgba(46,224,106,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(ex, ey, r * 1.5, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(120,255,170,0.95)'; g.lineWidth = 4;
      g.beginPath(); g.arc(ex, ey, r, 0, 6.283); g.stroke();
      g.fillStyle = 'rgba(10,40,20,0.5)';
      g.beginPath(); g.arc(ex, ey, r * 0.72, 0, 6.283); g.fill();
      g.fillStyle = '#eafff2';
      g.font = '900 ' + Math.round(r * 0.7) + 'px Nunito, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('EXIT', ex, ey + 1);
      g.restore();
    }

    this.floorCanvas = c;
  };

  // ============================================================
  //  Render
  // ============================================================
  Game.prototype.render = function (t) {
    var ctx = this.ctx;
    var lv = this.level;
    if (!lv) {
      // idle backdrop (before first level)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    var shakeX = 0, shakeY = 0;
    if (this.fx.shake > 0.1) {
      shakeX = (Math.random() - 0.5) * this.fx.shake;
      shakeY = (Math.random() - 0.5) * this.fx.shake;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.translate(this.viewW / 2 + shakeX, this.viewH / 2 + shakeY);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.drawFloor(ctx);
    ctx.save();
    this.fx.drawWorld(ctx);
    ctx.restore();

    this.drawToxic(ctx, t);
    this.drawWaterStations(ctx, t);
    this.drawProps(ctx);
    this.drawVictims(ctx, t);
    this.drawSpray(ctx, t);
    this.drawBarrels(ctx, t);
    this.drawFires(ctx, t);
    if (!this.player.dead) this.player.render(ctx, t);
    this.drawDinos(ctx, t);
    this.drawWallsTop(ctx);
    this.fx.drawOverlay(ctx);
    this.drawWorldUI(ctx);

    ctx.restore();
    this.drawVignette(ctx);
  };

  Game.prototype.drawFloor = function (ctx) {
    var lv = this.level;
    var z = this.camera.zoom;
    // Safety net: if the floor texture is missing for any reason, build it now
    // rather than letting drawImage(undefined) throw and blank the whole world.
    if (!this.floorCanvas) this.buildFloor();
    ctx.imageSmoothingEnabled = z < 0.9;
    if (this.floorCanvas) ctx.drawImage(this.floorCanvas, 0, 0);
  };

  Game.prototype.drawWallsTop = function (ctx) {
    var lv = this.level, t = TILE;
    // visible tile window (culled) - keeps large levels cheap
    var z = this.camera.zoom;
    var minX = Math.max(0, Math.floor((this.camera.x - this.viewW / (2 * z)) / t) - 1);
    var maxX = Math.min(lv.W - 1, Math.ceil((this.camera.x + this.viewW / (2 * z)) / t));
    var minY = Math.max(0, Math.floor((this.camera.y - this.viewH / (2 * z)) / t) - 1);
    var maxY = Math.min(lv.H - 1, Math.ceil((this.camera.y + this.viewH / (2 * z)) / t));
    ctx.save();
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        if (lv.grid[y][x] !== WALL) continue;
        var px = x * t, py = y * t;
        ctx.fillStyle = lv.types.wall;
        ctx.fillRect(px, py, t, t);
        if (y > 0 && lv.grid[y - 1][x] !== WALL) {
          ctx.fillStyle = lv.types.wallTop;
          ctx.fillRect(px, py, t, 7);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, t - 1, t - 1);
      }
    }
    ctx.restore();
  };

  Game.prototype.drawToxic = function (ctx, t) {
    for (var i = 0; i < this.toxic.length; i++) this.toxic[i].render(ctx, t);
  };
  Game.prototype.drawWaterStations = function (ctx, t) {
    for (var i = 0; i < this.waters.length; i++) this.waters[i].render(ctx, t);
  };

  Game.prototype.drawProps = function (ctx) {
    var lv = this.level;
    var props = lv.props;
    // cull offscreen
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (!this.inView(p.x, p.y, 60)) continue;
      this.drawProp(ctx, p);
    }
  };

  Game.prototype.inView = function (x, y, pad) {
    var z = this.camera.zoom;
    var halfW = this.viewW / (2 * z) + (pad || 0);
    var halfH = this.viewH / (2 * z) + (pad || 0);
    return Math.abs(x - this.camera.x) < halfW && Math.abs(y - this.camera.y) < halfH;
  };

  Game.prototype.drawProp = function (ctx, p) {
    var E = global.Entities;
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 12, 22, 8, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    var col = '#7a6a55', col2 = '#5a4d3c';
    switch (p.type) {
      case 'sofa':
        ctx.fillStyle = '#7d5a8f'; E.roundRect(ctx, p.x - 22, p.y - 12, 44, 24, 8); ctx.fill();
        ctx.fillStyle = '#8f6aa3'; E.roundRect(ctx, p.x - 22, p.y - 20, 44, 12, 8); ctx.fill();
        break;
      case 'bed':
        ctx.fillStyle = '#a9714b'; E.roundRect(ctx, p.x - 14, p.y - 22, 28, 44, 5); ctx.fill();
        ctx.fillStyle = '#e8e2d5'; E.roundRect(ctx, p.x - 12, p.y - 18, 24, 20, 4); ctx.fill();
        ctx.fillStyle = '#6ea8ff'; E.roundRect(ctx, p.x - 12, p.y + 2, 24, 16, 4); ctx.fill();
        break;
      case 'table': case 'desk':
        ctx.fillStyle = col; E.roundRect(ctx, p.x - 20, p.y - 12, 40, 24, 5); ctx.fill();
        ctx.fillStyle = '#8a7558'; E.roundRect(ctx, p.x - 20, p.y - 12, 40, 7, 4); ctx.fill();
        break;
      case 'chair':
        ctx.fillStyle = '#4a5568'; E.roundRect(ctx, p.x - 11, p.y - 11, 22, 22, 6); ctx.fill();
        ctx.fillStyle = '#5d6a80'; E.roundRect(ctx, p.x - 9, p.y - 6, 18, 8, 3); ctx.fill();
        break;
      case 'plant':
        ctx.fillStyle = '#8a5a3c'; E.roundRect(ctx, p.x - 8, p.y + 2, 16, 12, 3); ctx.fill();
        ctx.fillStyle = '#3fa85f';
        ctx.beginPath(); ctx.arc(p.x, p.y - 6, 12, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#4fc472';
        ctx.beginPath(); ctx.arc(p.x - 5, p.y - 10, 7, 0, 6.283); ctx.fill();
        break;
      case 'tv':
        ctx.fillStyle = '#2a2f3c'; E.roundRect(ctx, p.x - 20, p.y - 13, 40, 24, 4); ctx.fill();
        ctx.fillStyle = '#4d6fa8'; E.roundRect(ctx, p.x - 17, p.y - 10, 34, 18, 2); ctx.fill();
        break;
      case 'shelf':
        ctx.fillStyle = '#6a5540'; E.roundRect(ctx, p.x - 18, p.y - 22, 36, 44, 4); ctx.fill();
        ctx.fillStyle = '#8a7050';
        ctx.fillRect(p.x - 15, p.y - 14, 30, 3); ctx.fillRect(p.x - 15, p.y, 30, 3); ctx.fillRect(p.x - 15, p.y + 13, 30, 3);
        break;
      case 'fridge':
        ctx.fillStyle = '#c8d0dc'; E.roundRect(ctx, p.x - 14, p.y - 24, 28, 48, 5); ctx.fill();
        ctx.fillStyle = '#aab4c4'; ctx.fillRect(p.x - 14, p.y - 4, 28, 3);
        ctx.fillStyle = '#7a8496'; ctx.fillRect(p.x + 8, p.y - 18, 3, 12);
        break;
      case 'copier':
        ctx.fillStyle = '#d8dce4'; E.roundRect(ctx, p.x - 16, p.y - 16, 32, 32, 5); ctx.fill();
        ctx.fillStyle = '#9aa4b4'; E.roundRect(ctx, p.x - 12, p.y - 12, 24, 10, 3); ctx.fill();
        break;
      case 'board':
        ctx.fillStyle = '#2f6b4a'; E.roundRect(ctx, p.x - 24, p.y - 16, 48, 32, 3); ctx.fill();
        ctx.fillStyle = '#e8eef5'; ctx.fillRect(p.x - 20, p.y - 10, 20, 2); ctx.fillRect(p.x - 20, p.y - 4, 28, 2);
        break;
      case 'crate': case 'box':
        ctx.fillStyle = '#a97b46'; E.roundRect(ctx, p.x - 17, p.y - 17, 34, 34, 4); ctx.fill();
        ctx.strokeStyle = '#7d5a30'; ctx.lineWidth = 3; ctx.strokeRect(p.x - 15, p.y - 15, 30, 30);
        ctx.beginPath(); ctx.moveTo(p.x - 15, p.y - 15); ctx.lineTo(p.x + 15, p.y + 15);
        ctx.moveTo(p.x + 15, p.y - 15); ctx.lineTo(p.x - 15, p.y + 15); ctx.stroke();
        break;
      case 'forklift':
        ctx.fillStyle = '#e0a03a'; E.roundRect(ctx, p.x - 20, p.y - 16, 40, 32, 5); ctx.fill();
        ctx.fillStyle = '#2a2f3c'; ctx.fillRect(p.x + 10, p.y - 26, 5, 52);
        ctx.fillStyle = '#3a4050';
        ctx.beginPath(); ctx.arc(p.x - 12, p.y + 16, 8, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + 12, p.y + 16, 8, 0, 6.283); ctx.fill();
        break;
      case 'machine':
        ctx.fillStyle = '#5f6b7d'; E.roundRect(ctx, p.x - 22, p.y - 20, 44, 40, 6); ctx.fill();
        ctx.fillStyle = '#7d8898'; E.roundRect(ctx, p.x - 16, p.y - 14, 32, 14, 3); ctx.fill();
        ctx.fillStyle = '#ff4757'; ctx.beginPath(); ctx.arc(p.x + 14, p.y - 14, 3, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#2ee06a'; ctx.beginPath(); ctx.arc(p.x + 14, p.y - 6, 3, 0, 6.283); ctx.fill();
        break;
      case 'pipe':
        ctx.fillStyle = '#8a939f';
        E.roundRect(ctx, p.x - 26, p.y - 8, 52, 16, 8); ctx.fill();
        ctx.fillStyle = '#6b7480';
        E.roundRect(ctx, p.x - 6, p.y - 11, 12, 22, 3); ctx.fill();
        break;
      case 'tank':
        ctx.fillStyle = '#cfd6e4';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - 18, 20, 7, 0, 0, 6.283); ctx.fill();
        E.roundRect(ctx, p.x - 20, p.y - 18, 40, 36, 6); ctx.fill();
        ctx.fillStyle = '#eef2f8'; ctx.fillRect(p.x - 20, p.y - 4, 40, 5);
        ctx.fillStyle = '#9aa4b4';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 18, 20, 7, 0, 0, 6.283); ctx.fill();
        break;
      default:
        ctx.fillStyle = col; E.roundRect(ctx, p.x - 16, p.y - 16, 32, 32, 5); ctx.fill();
        ctx.fillStyle = col2; E.roundRect(ctx, p.x - 12, p.y - 12, 24, 24, 4); ctx.fill();
    }
    ctx.restore();
  };

  Game.prototype.drawVictims = function (ctx, t) {
    var arr = this.victims.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < arr.length; i++) {
      if (!this.inView(arr[i].x, arr[i].y, 70)) continue;
      arr[i].render(ctx, t);
    }
  };

  Game.prototype.drawBarrels = function (ctx, t) {
    for (var i = 0; i < this.barrels.length; i++) {
      var b = this.barrels[i];
      if (!b.alive || !this.inView(b.x, b.y, 60)) continue;
      b.render(ctx, t);
    }
  };

  Game.prototype.drawFires = function (ctx, t) {
    var arr = this.fires.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < arr.length; i++) {
      if (!this.inView(arr[i].x, arr[i].y, 120)) continue;
      arr[i].render(ctx, t);
    }
  };

  Game.prototype.drawDinos = function (ctx, t) {
    if (!this.dinos || !this.dinos.length) return;
    var arr = this.dinos.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < arr.length; i++) {
      if (!this.inView(arr[i].x, arr[i].y, 180)) continue;
      arr[i].render(ctx, t);
    }
  };

  Game.prototype.drawSpray = function (ctx, t) {
    var p = this.player;
    if (!p.spraying) return;
    var ang = p.aimFacing;
    var range = Math.min(CFG.PLAYER.SPRAY_RANGE, this.raycastWall(p.x, p.y, ang, CFG.PLAYER.SPRAY_RANGE));
    var arcHalf = CFG.PLAYER.SPRAY_ARC / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var grd = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, range);
    grd.addColorStop(0, 'rgba(180,235,255,0.5)');
    grd.addColorStop(0.6, 'rgba(120,205,255,0.22)');
    grd.addColorStop(1, 'rgba(90,190,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, range, ang - arcHalf, ang + arcHalf);
    ctx.closePath();
    ctx.fill();
    // core jet
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(ang) * 18, p.y + Math.sin(ang) * 18);
    ctx.lineTo(p.x + Math.cos(ang) * range * 0.85, p.y + Math.sin(ang) * range * 0.85);
    ctx.stroke();
    ctx.restore();
    this._drawAimGuide = p.spraying;
  };

  Game.prototype.drawWorldUI = function (ctx) {
    var p = this.player;

    // rescue progress ring + prompt
    if (this.nearVictim) {
      var v = this.nearVictim;
      if (p.rescuing === v && p.rescueProgress > 0) {
        var frac = Math.min(1, p.rescueProgress);
        ctx.save();
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(v.x, v.y, 30, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
        ctx.strokeStyle = '#2ee06a';
        ctx.beginPath(); ctx.arc(v.x, v.y, 30, -Math.PI / 2, -Math.PI / 2 + 6.283 * frac); ctx.stroke();
        ctx.restore();
      } else if (v.state !== 'rescued') {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.font = '900 12px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        var label = 'HOLD RESCUE';
        var w = ctx.measureText(label).width + 16;
        global.Entities.roundRect(ctx, v.x - w / 2, v.y + 24, w, 20, 10);
        ctx.fill();
        ctx.fillStyle = '#8ef0b4';
        ctx.fillText(label, v.x, v.y + 38);
        ctx.restore();
      }
    }

    // exit beacon if objectives done
    if (this.level.exit && this.allRequiredDone()) {
      var ex = this.level.exit.x, ey = this.level.exit.y;
      var bob = Math.sin(performance.now() / 300) * 5;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#2ee06a';
      ctx.font = '900 15px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EXIT', ex, ey - 44 + bob);
      ctx.beginPath();
      ctx.moveTo(ex, ey - 40 + bob);
      ctx.lineTo(ex - 8, ey - 52 + bob);
      ctx.lineTo(ex + 8, ey - 52 + bob);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  };

  Game.prototype.drawVignette = function (ctx) {
    var w = this.viewW, h = this.viewH;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // ---- dinosaur danger: red edge that swells as it closes in ----
    if (this.dinoThreat() && this.state === 'playing') {
      var D = CFG.DINO;
      var prox = 1 - clamp(this.dinoNearest / D.VIGNETTE_DIST, 0, 1);   // 0 far -> 1 close
      var beat = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / (200 - prox * 90)));
      var da = (0.10 + prox * 0.42) * beat;
      var dg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.30 - prox * 0.08), w / 2, h / 2, Math.max(w, h) * 0.68);
      dg.addColorStop(0, 'rgba(255,20,20,0)');
      dg.addColorStop(1, 'rgba(220,10,10,' + da.toFixed(3) + ')');
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, w, h);
    }

    // low-health warning
    if (this.player && this.player.health / this.player.maxHealth < 0.3 && this.state === 'playing') {
      var a = 0.12 + 0.10 * Math.sin(performance.now() / 260);
      var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.62);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, 'rgba(255,0,0,' + a.toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // smoke haze when many fires
    var fireRatio = this.level ? (this.aliveFireCount() / Math.max(1, this.initialFireCount)) : 0;
    if (fireRatio > 0.4) {
      ctx.globalAlpha = Math.min(0.16, (fireRatio - 0.4) * 0.4);
      ctx.fillStyle = '#3a1c0c';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  global.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
