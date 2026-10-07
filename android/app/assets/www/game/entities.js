/* ============================================================
   entities.js - Player, Fire, Victim, Barrel, ToxicZone, WaterStation
   All gameplay objects with cartoon-style canvas rendering.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;
  var TILE = CFG.TILE;
  var L = global.Levels;
  var WALL = 0, FLOOR = 1, EXIT = 2;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  // ------------------------------------------------------------
  //  Collision helpers
  // ------------------------------------------------------------
  function blockedTile(grid, W, H, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    return grid[ty][tx] === WALL;
  }

  function circleHitsWall(x, y, r, grid, W, H) {
    var minTx = Math.floor((x - r) / TILE), maxTx = Math.floor((x + r) / TILE);
    var minTy = Math.floor((y - r) / TILE), maxTy = Math.floor((y + r) / TILE);
    for (var ty = minTy; ty <= maxTy; ty++) {
      for (var tx = minTx; tx <= maxTx; tx++) {
        if (!blockedTile(grid, W, H, tx, ty)) continue;
        var rx = tx * TILE, ry = ty * TILE;
        var cx = clamp(x, rx, rx + TILE), cy = clamp(y, ry, ry + TILE);
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r - 0.01) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------
  //  PLAYER
  // ------------------------------------------------------------
  function Player(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = CFG.PLAYER_RADIUS;
    this.health = CFG.PLAYER.MAX_HEALTH;
    this.maxHealth = CFG.PLAYER.MAX_HEALTH;
    this.water = CFG.PLAYER.MAX_WATER;
    this.maxWater = CFG.PLAYER.MAX_WATER;
    this.facing = -Math.PI / 2;
    this.aimFacing = -Math.PI / 2;
    this.moving = false;
    this.walkPhase = 0;
    this.speed = CFG.PLAYER.SPEED;
    this.spraying = false;
    this.rescueProgress = 0;
    this.rescuing = null;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.rescued = 0;
    this.extinguished = 0;
    this.waterUsed = 0;
    this.isTutorial = false;
    this._bobT = 0;
  }

  Player.prototype.moveTo = function (dx, dy, game) {
    var lv = game.level;
    var nx = this.x + dx, ny = this.y + dy;
    if (!circleHitsWall(nx, this.y, this.radius, lv.grid, lv.W, lv.H)) this.x = nx;
    else this.vx = 0;
    if (!circleHitsWall(this.x, ny, this.radius, lv.grid, lv.W, lv.H)) this.y = ny;
    else this.vy = 0;
    // barrels are solid
    for (var i = 0; i < game.barrels.length; i++) {
      var b = game.barrels[i];
      if (!b.alive) continue;
      var d = Math.sqrt(dist2(this.x, this.y, b.x, b.y));
      var min = this.radius + b.r;
      if (d < min && d > 0.001) {
        var push = (min - d);
        this.x += (this.x - b.x) / d * push;
        this.y += (this.y - b.y) / d * push;
      }
    }
  };

  Player.prototype.update = function (dt, game) {
    var P = CFG.PLAYER, input = game.input;
    if (this.dead) return;

    // --- movement ---
    var mv = input.getMoveVector();
    var mag = Math.sqrt(mv.x * mv.x + mv.y * mv.y);
    var spd = this.speed * (game.slowFactor || 1);
    if (mag > 0.06) {
      var ux = mv.x / (mag > 1 ? mag : 1);
      var uy = mv.y / (mag > 1 ? mag : 1);
      this.vx = ux * spd; this.vy = uy * spd;
      this.moveTo(this.vx * dt, this.vy * dt, game);
      this.moving = true;
      this.walkPhase += dt * 11;
      if (mag > 0.5) this.facing = Math.atan2(mv.y, mv.x);
    } else {
      this.moving = false;
      this.vx = this.vy = 0;
      this.walkPhase += dt * 2.2;
    }

    // --- spraying ---
    var wantSpray = input.isWaterHeld();
    this.spraying = false;
    if (wantSpray && this.water > 0.5 && !this.rescuing) {
      this.spraying = true;
      this.aimFacing = game.aimAngle;
      var drain = P.WATER_DRAIN * dt;
      this.water = Math.max(0, this.water - drain);
      this.waterUsed += drain;
      game.doSpray(dt);
    } else {
      this.aimFacing = this.facing;
      if (this.water < this.maxWater) {
        this.water = Math.min(this.maxWater, this.water + P.WATER_REGEN * dt);
      }
    }

    // --- rescue ---
    this.updateRescue(dt, game);

    // --- fire contact damage ---
    var dps = 0;
    for (var i = 0; i < game.fires.length; i++) {
      var f = game.fires[i];
      if (!f.alive) continue;
      var d = Math.sqrt(dist2(this.x, this.y, f.x, f.y));
      if (d < f.radius + this.radius * 0.6) {
        dps = Math.max(dps, f.dps * (1 - d / (f.radius + this.radius)));
      }
    }
    // --- barrel explosion / toxic ---
    for (var t = 0; t < game.toxic.length; t++) {
      var z = game.toxic[t];
      if (z.contains(this.x, this.y)) dps = Math.max(dps, P.HAZARD_DPS);
    }
    if (dps > 0) this.damage(dps * dt, game);

    // --- water station refill ---
    for (var w = 0; w < game.waters.length; w++) {
      var st = game.waters[w];
      if (dist2(this.x, this.y, st.x, st.y) < 54 * 54) {
        if (this.water < this.maxWater) {
          var before = this.water;
          this.water = Math.min(this.maxWater, this.water + 46 * dt);
          if (before < 1 && this.water >= 1) game.fx.text(this.x, this.y - 30, 'WATER', '#59d2ff', 13);
        }
      }
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this._bobT += dt;
  };

  Player.prototype.updateRescue = function (dt, game) {
    var P = CFG.PLAYER;
    var target = null, bestD = 1e9;
    for (var i = 0; i < game.victims.length; i++) {
      var v = game.victims[i];
      if (v.state === 'rescued') continue;
      var d = Math.sqrt(dist2(this.x, this.y, v.x, v.y));
      if (d < P.RESCUE_RANGE && d < bestD) { bestD = d; target = v; }
    }
    game.nearVictim = target;
    if (!target) { this.rescueProgress = 0; this.rescuing = null; return; }

    if (game.input.isRescueHeld()) {
      if (this.rescuing !== target) { this.rescuing = target; this.rescueProgress = 0; game.audio.play('rescueStart'); }
      this.rescueProgress += dt / P.RESCUE_TIME;
      var frac = Math.min(1, this.rescueProgress);
      this.aimFacing = Math.atan2(target.y - this.y, target.x - this.x);
      this.facing = this.aimFacing;
      game.rescueRing = { target: target, frac: frac };
      if (this.rescueProgress >= 1) {
        this.completeRescue(target, game);
      }
    } else {
      if (this.rescuing) { this.rescuing = null; this.rescueProgress = 0; }
      game.rescueRing = null;
    }
  };

  Player.prototype.completeRescue = function (v, game) {
    v.state = 'rescued';
    v.rescueAnim = 1;
    this.rescued++;
    this.rescueProgress = 0;
    this.rescuing = null;
    game.rescueRing = null;
    game.audio.play('rescue');
    game.fx.ring(v.x, v.y, 10, 70, 'rgba(46,224,106,0.9)', 0.5);
    game.fx.text(v.x, v.y - 36, '+RESCUED', '#2ee06a', 17);
    for (var i = 0; i < 12; i++) {
      game.fx.emit({ x: v.x, y: v.y, vx: rand(-70, 70), vy: rand(-90, -20), life: rand(0.4, 0.9), size: rand(3, 6), col: '#7ef0a8', type: 'glow', grav: 140 });
    }
    game.onVictimRescued(v);
  };

  Player.prototype.damage = function (amount, game) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = Math.max(this.hurtFlash, 0.35);
    if (this.health <= 0) {
      this.dead = true;
      game.onPlayerDead();
    }
  };

  Player.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y, r = this.radius;
    ctx.save();

    // shadow
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 1.0, r * 0.42, 0, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.translate(x, y);
    if (this.invuln > 0 && Math.floor(t * 12) % 2 === 0) ctx.globalAlpha = 0.55;
    ctx.rotate(this.facing + Math.PI / 2); // sprite front = -y

    var walk = this.moving ? Math.sin(this.walkPhase) : Math.sin(t * 2) * 0.18;
    var s = r / 19;

    // --- legs ---
    ctx.fillStyle = '#2b2f3a';
    roundRect(ctx, -7 * s + walk * 2.4 * s, 6 * s, 6 * s, 12 * s, 2.6 * s); ctx.fill();
    roundRect(ctx, 1 * s - walk * 2.4 * s, 6 * s, 6 * s, 12 * s, 2.6 * s); ctx.fill();

    // --- air tank (on the back = +y) ---
    ctx.fillStyle = '#8b93a3';
    roundRect(ctx, -6 * s, 6 * s, 12 * s, 8 * s, 3 * s); ctx.fill();
    ctx.fillStyle = '#cfd6e4';
    roundRect(ctx, -4.5 * s, 6.5 * s, 9 * s, 3 * s, 1.5 * s); ctx.fill();

    // --- torso / jacket ---
    var g = ctx.createLinearGradient(0, -12 * s, 0, 12 * s);
    g.addColorStop(0, '#ffd54a'); g.addColorStop(1, '#f0a91c');
    ctx.fillStyle = g;
    roundRect(ctx, -10 * s, -11 * s, 20 * s, 22 * s, 7 * s); ctx.fill();

    // reflective stripes
    ctx.fillStyle = 'rgba(230,240,255,0.92)';
    ctx.fillRect(-10 * s, -3 * s, 20 * s, 3 * s);
    ctx.fillRect(-10 * s, 3.5 * s, 20 * s, 3 * s);
    ctx.fillStyle = 'rgba(120,130,150,0.35)';
    ctx.fillRect(-10 * s, -0.4 * s, 20 * s, 0.9 * s);

    // --- arms ---
    ctx.fillStyle = '#f0a91c';
    var armSwing = this.moving ? Math.sin(this.walkPhase + Math.PI) * 2.2 * s : Math.sin(t * 2) * 1.2 * s;
    ctx.beginPath(); ctx.arc(-10 * s, 1 * s + armSwing, 4.2 * s, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(10 * s, 1 * s - armSwing, 4.2 * s, 0, 6.283); ctx.fill();

    // --- head + helmet ---
    ctx.fillStyle = '#f6c89a';
    ctx.beginPath(); ctx.arc(0, -12 * s, 6.2 * s, 0, 6.283); ctx.fill();
    // helmet dome
    var hg = ctx.createLinearGradient(0, -22 * s, 0, -8 * s);
    hg.addColorStop(0, '#ff6b4a'); hg.addColorStop(1, '#d5341b');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, -13 * s, 8 * s, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(-8 * s, -13 * s, 16 * s, 4.2 * s);
    // brim
    ctx.fillStyle = '#b32a14';
    roundRect(ctx, -8.6 * s, -9.4 * s, 17.2 * s, 3.2 * s, 1.4 * s); ctx.fill();
    // badge
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, -16 * s, 2.2 * s, 0, 6.283); ctx.fill();

    // --- nozzle when spraying ---
    if (this.spraying) {
      ctx.fillStyle = '#4a5162';
      roundRect(ctx, 5 * s, -20 * s, 4.5 * s, 12 * s, 2 * s); ctx.fill();
      ctx.fillStyle = '#7f8798';
      roundRect(ctx, 4.6 * s, -22 * s, 5.3 * s, 4 * s, 1.6 * s); ctx.fill();
    }

    ctx.restore();

    // hurt flash ring
    if (this.hurtFlash > 0) {
      ctx.globalAlpha = Math.min(0.8, this.hurtFlash * 1.6);
      ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  // ------------------------------------------------------------
  //  FIRE
  // ------------------------------------------------------------
  var FIRE_DEF = [
    null,
    { hp: 46, radius: 25, dps: 9, emit: 3, col: '#ffd23f' },
    { hp: 92, radius: 33, dps: 13, emit: 5, col: '#ff9d2f' },
    { hp: 172, radius: 45, dps: 17, emit: 7, col: '#ff6b2c' },
    { hp: 270, radius: 57, dps: 22, emit: 9, col: '#ff4d2e' }
  ];

  function Fire(x, y, size) {
    this.x = x; this.y = y;
    this.size = clamp(size || 1, 1, 4);
    var def = FIRE_DEF[this.size];
    this.maxHp = def.hp; this.hp = def.hp;
    this.radius = def.radius;
    this.dps = def.dps;
    this.alive = true;
    this.phase = Math.random() * 6.28;
    this.emitAcc = 0;
    this.spreadTimer = 0;
    this.flameSeed = Math.random() * 1000;
    this.justHit = 0;
    this.dying = 0;
  }

  Fire.prototype.update = function (dt, game) {
    if (!this.alive) {
      if (this.dying > 0) {
        this.dying -= dt;
        if (Math.random() < 0.5) game.fx.steam(this.x + rand(-14, 14), this.y + rand(-14, 14), 0.7);
      }
      return;
    }
    this.phase += dt * 6;
    if (this.justHit > 0) this.justHit -= dt;

    this.emitAcc += dt * this.emit * (1 + this.size * 0.35);
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      game.fx.flameWisp(this.x, this.y - this.radius * 0.4, this.size * 0.7);
    }
    if (Math.random() < dt * (3 + this.size)) game.fx.ember(this.x, this.y - this.radius * 0.5, this.size * 0.6);
    if (Math.random() < dt * (2 + this.size * 0.6)) game.fx.smoke(this.x, this.y - this.radius * 0.9, this.size * 0.6, this.size >= 3);

    // spread to nearby explosive barrels (fuse them)
    for (var i = 0; i < game.barrels.length; i++) {
      var b = game.barrels[i];
      if (b.alive && !b.primed && dist2(this.x, this.y, b.x, b.y) < (this.radius + 30) * (this.radius + 30)) {
        b.prime(game);
      }
    }

    // organic spread for large fires
    if (this.size >= 3) {
      this.spreadTimer -= dt;
      if (this.spreadTimer <= 0) {
        this.spreadTimer = rand(6, 10);
        if (game.fires.length < 26 && Math.random() < 0.5) {
          var a = Math.random() * 6.283;
          var nx = this.x + Math.cos(a) * (TILE * 1.4);
          var ny = this.y + Math.sin(a) * (TILE * 1.4);
          var tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
          if (tx > 0 && ty > 0 && tx < game.level.W - 1 && ty < game.level.H - 1 && game.level.grid[ty][tx] !== WALL) {
            if (game.pointFree(tx, ty)) {
              var nf = new Fire((tx + 0.5) * TILE, (ty + 0.5) * TILE, 1);
              game.fires.push(nf);
              game.fx.ring(nx, ny, 4, 26, 'rgba(255,140,60,0.8)', 0.4);
            }
          }
        }
      }
    }
  };

  Fire.prototype.damage = function (amount, game) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.justHit = 0.12;
    // extinguishing hiss / steam
    if (Math.random() < 0.6) game.fx.steam(this.x + rand(-12, 12), this.y + rand(-12, 12), 0.5 + this.size * 0.15);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dying = 0.6;
      return true;
    }
    // shrink radius a little as it dies down
    this.radius = FIRE_DEF[this.size].radius * clamp(0.55 + 0.45 * (this.hp / this.maxHp), 0.5, 1);
    return false;
  };

  Fire.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y;
    if (!this.alive) return;
    var r = this.radius * (1 + Math.sin(this.phase * 1.3) * 0.05);
    var s = this.size;
    ctx.save();

    // ground scorch
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#1c1712';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r * 0.95, r * 0.42, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    // outer glow
    ctx.globalCompositeOperation = 'lighter';
    var glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.3);
    glow.addColorStop(0, 'rgba(255,150,50,0.30)');
    glow.addColorStop(0.5, 'rgba(255,90,30,0.14)');
    glow.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 2.3, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // layered flames
    drawFlame(ctx, x, y + r * 0.35, r * 1.25, t * 1.0 + this.flameSeed, 'rgba(255,90,20,0.85)', 0.95);
    drawFlame(ctx, x, y + r * 0.3, r * 0.92, t * 1.25 + this.flameSeed + 1.7, 'rgba(255,150,40,0.92)', 0.9);
    drawFlame(ctx, x, y + r * 0.25, r * 0.62, t * 1.5 + this.flameSeed + 3.1, 'rgba(255,215,90,0.95)', 0.85);
    drawFlame(ctx, x, y + r * 0.2, r * 0.34, t * 1.8 + this.flameSeed + 4.4, 'rgba(255,250,200,0.9)', 0.8);

    // hit flash
    if (this.justHit > 0) {
      ctx.globalAlpha = this.justHit * 5;
      ctx.fillStyle = 'rgba(200,240,255,0.55)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // HP ring (only when damaged)
    if (this.hp < this.maxHp) {
      var frac = this.hp / this.maxHp;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, r + 8, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      ctx.strokeStyle = frac > 0.5 ? '#ffd23f' : (frac > 0.25 ? '#ff9d2f' : '#ff4757');
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + 6.283 * frac); ctx.stroke();
    }
    ctx.restore();
  };

  function drawFlame(ctx, x, y, size, t, col, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    var pts = 7;
    for (var i = 0; i <= pts; i++) {
      var a = (i / pts) * Math.PI * 2 - Math.PI / 2;
      var wob = Math.sin(t * 2.4 + i * 1.7) * 0.16 + Math.sin(t * 4.1 + i * 2.3) * 0.09;
      var taper = 1 + Math.cos(a) * 0.12 + Math.sin(a) * 0.42; // taller upward
      var rr = size * (0.72 + wob) * (0.85 + taper * 0.35);
      var px = x + Math.cos(a) * rr * 0.78;
      var py = y + Math.sin(a) * rr - size * 0.5 - Math.sin(a) * 0.0;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  VICTIM
  // ------------------------------------------------------------
  function Victim(x, y) {
    this.x = x; this.y = y;
    this.radius = 15;
    this.state = 'trapped';  // trapped | rescued
    this.phase = Math.random() * 6.28;
    this.rescueAnim = 0;
    this.skin = ['#f6c89a', '#e0a878', '#c98a5e', '#f7d2ad'][Math.floor(Math.random() * 4)];
    this.shirt = ['#6ea8ff', '#ff8fa3', '#8ce0a1', '#c79bff', '#ffd166'][Math.floor(Math.random() * 5)];
    this.hair = ['#3a2c23', '#5a3d24', '#1f1a17', '#8a5a2b'][Math.floor(Math.random() * 4)];
    this.hasHat = Math.random() < 0.3;
  }

  Victim.prototype.update = function (dt, game) {
    this.phase += dt * 3;
    if (this.rescueAnim > 0) this.rescueAnim = Math.max(0, this.rescueAnim - dt * 0.8);
    if (this.state === 'trapped' && Math.random() < dt * 1.6 && Math.random() < 0.5) {
      game.fx.emit({ x: this.x + rand(-14, 14), y: this.y - 22, vx: rand(-6, 6), vy: -22, life: 0.7, size: 9, col: 'rgba(220,225,235,0.5)', type: 'puff', grow: 10 });
    }
  };

  Victim.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y, s = 1;
    var rescued = this.state === 'rescued';
    ctx.save();

    // shadow
    ctx.globalAlpha = 0.26; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + 13, 15, 6, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    // distress beacon when trapped
    if (!rescued) {
      var pulse = 0.5 + 0.5 * Math.sin(this.phase * 2);
      ctx.globalAlpha = 0.35 + pulse * 0.35;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(x, y - 34, 13, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
      // "!" marker
      ctx.fillStyle = '#1b1f2a';
      ctx.font = '900 15px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y - 34);
      // help ring
      ctx.globalAlpha = 0.25 + pulse * 0.4;
      ctx.strokeStyle = 'rgba(255,210,63,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 22 + pulse * 4, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    var bob = Math.sin(this.phase) * 1.6;
    ctx.translate(x, y + (rescued ? -6 : bob));
    if (rescued) ctx.globalAlpha = 0.95;

    // legs
    ctx.fillStyle = '#37405a';
    roundRect(ctx, -7, 6, 6, 11, 2.4); ctx.fill();
    roundRect(ctx, 1, 6, 6, 11, 2.4); ctx.fill();

    // body
    var g = ctx.createLinearGradient(0, -12, 0, 12);
    g.addColorStop(0, this.shirt); g.addColorStop(1, shade(this.shirt, -0.22));
    ctx.fillStyle = g;
    roundRect(ctx, -9, -11, 18, 21, 6); ctx.fill();

    // arms (waving)
    var wave = rescued ? -0.5 : Math.sin(this.phase * 1.6) * 0.6;
    ctx.fillStyle = this.skin;
    ctx.beginPath(); ctx.arc(-9.5, -3 + Math.sin(this.phase * 2) * 1.5, 3.6, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(9.5, -5 - Math.abs(wave) * 4, 3.6, 0, 6.283); ctx.fill();

    // head
    ctx.fillStyle = this.skin;
    ctx.beginPath(); ctx.arc(0, -15, 6.6, 0, 6.283); ctx.fill();
    // hair / hat
    if (this.hasHat) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, -16.5, 7.2, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-7.2, -17, 14.4, 2.4);
    } else {
      ctx.fillStyle = this.hair;
      ctx.beginPath(); ctx.arc(0, -16.5, 6.7, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    }
    // eyes
    ctx.fillStyle = '#2a2f3c';
    ctx.beginPath(); ctx.arc(-2.2, -15, 1.15, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(2.2, -15, 1.15, 0, 6.283); ctx.fill();

    ctx.restore();

    // rescued: hearts + safe tag
    if (rescued) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = '900 12px Nunito, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#2ee06a';
      ctx.fillText('SAFE', x, y - 6);
      ctx.restore();
      if (this.rescueAnim > 0) {
        ctx.save();
        ctx.globalAlpha = this.rescueAnim;
        ctx.font = '800 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('\u2764\uFE0F', x, y - 26 - (1 - this.rescueAnim) * 20);
        ctx.restore();
      }
    }
  };

  // ------------------------------------------------------------
  //  BARREL (explosive)
  // ------------------------------------------------------------
  function Barrel(x, y) {
    this.x = x; this.y = y; this.r = 16;
    this.alive = true;
    this.primed = false;
    this.fuse = CFG.FUSE_TIME;
    this.exploded = false;
    this.phase = Math.random() * 6.28;
    this.cooled = false;
  }

  Barrel.prototype.prime = function (game) {
    if (!this.alive || this.primed) return;
    this.primed = true;
    this.fuse = CFG.FUSE_TIME;
    game.audio.play('warn');
    game.fx.text(this.x, this.y - 30, '!', '#ff4757', 22);
    game.hudHint('A barrel is about to blow - cool it with water!', 2.2);
  };

  Barrel.prototype.cool = function (amt, game) {
    if (!this.alive) return;
    if (this.primed) {
      this.fuse += amt * 0.9;
      if (Math.random() < 0.5) game.fx.steam(this.x, this.y - 6, 0.5);
      if (this.fuse > CFG.FUSE_TIME * 1.4) {
        this.primed = false;
        this.cooled = true;
        game.fx.text(this.x, this.y - 30, 'SAFE', '#59d2ff', 13);
      }
    }
  };

  Barrel.prototype.update = function (dt, game) {
    if (!this.alive) return;
    this.phase += dt * (this.primed ? 12 : 2);
    if (this.primed) {
      this.fuse -= dt;
      if (Math.random() < dt * 8) game.fx.ember(this.x + rand(-8, 8), this.y - 16, 0.5);
      if (Math.random() < dt * 6) game.fx.emit({ x: this.x, y: this.y, vx: 0, vy: -6, life: 0.3, size: 14, col: 'rgba(255,80,60,0.5)', type: 'glow' });
      if (this.fuse <= 0) this.explode(game);
    }
  };

  Barrel.prototype.explode = function (game) {
    if (!this.alive) return;
    this.alive = false;
    this.exploded = true;
    game.fx.explosion(this.x, this.y);
    game.audio.play('explosion');
    game.vibrate(60);
    game.onExplosion(this.x, this.y);
  };

  Barrel.prototype.render = function (ctx, t) {
    if (!this.alive) return;
    var x = this.x, y = this.y, r = this.r;
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 1.05, r * 0.4, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    if (this.primed) {
      var p = 0.5 + 0.5 * Math.sin(this.phase);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,60,40,' + (0.18 + p * 0.3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // barrel body
    var g = ctx.createLinearGradient(x - r, 0, x + r, 0);
    g.addColorStop(0, '#b03a2e'); g.addColorStop(0.45, '#e05a3a'); g.addColorStop(1, '#8e2b21');
    ctx.fillStyle = g;
    roundRect(ctx, x - r * 0.82, y - r, r * 1.64, r * 2, r * 0.34); ctx.fill();
    // bands
    ctx.fillStyle = 'rgba(255,240,200,0.85)';
    ctx.fillRect(x - r * 0.82, y - r * 0.45, r * 1.64, r * 0.22);
    ctx.fillRect(x - r * 0.82, y + r * 0.25, r * 1.64, r * 0.22);
    // hazard stripes
    ctx.save();
    ctx.beginPath(); roundRect(ctx, x - r * 0.82, y - r * 0.95, r * 1.64, r * 0.42, 4); ctx.clip();
    ctx.fillStyle = '#1b1f2a';
    for (var i = -3; i < 6; i++) {
      ctx.save(); ctx.translate(x + i * 9, y - r * 0.74); ctx.rotate(0.6);
      ctx.fillRect(-3, -14, 5, 28); ctx.restore();
    }
    ctx.restore();
    // top
    ctx.fillStyle = '#f6d24a';
    ctx.beginPath(); ctx.ellipse(x, y - r * 0.98, r * 0.8, r * 0.28, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#c0492e';
    ctx.beginPath(); ctx.ellipse(x, y - r * 1.02, r * 0.42, r * 0.15, 0, 0, 6.283); ctx.fill();

    if (this.primed) {
      ctx.fillStyle = '#fff';
      ctx.font = '900 16px Nunito, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', x, y - r - 10);
    }
    ctx.restore();
  };

  // ------------------------------------------------------------
  //  TOXIC ZONE
  // ------------------------------------------------------------
  function ToxicZone(x, y, r) {
    this.x = x; this.y = y; this.r = r;
    this.phase = Math.random() * 6.28;
  }
  ToxicZone.prototype.contains = function (x, y) {
    return dist2(x, y, this.x, this.y) < this.r * this.r * 0.8;
  };
  ToxicZone.prototype.update = function (dt, game) {
    this.phase += dt * 1.6;
    if (Math.random() < dt * 6) {
      var a = Math.random() * 6.283, rr = Math.random() * this.r * 0.8;
      game.fx.emit({
        x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr,
        vx: rand(-6, 6), vy: rand(-24, -8), life: rand(0.6, 1.3),
        size: rand(4, 9), col: 'rgba(150,230,90,0.45)', type: 'puff', grow: 12, alpha: 0.5
      });
    }
  };
  ToxicZone.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y, r = this.r;
    ctx.save();
    var p = 0.5 + 0.5 * Math.sin(this.phase);
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(140,220,70,' + (0.34 + p * 0.1) + ')');
    g.addColorStop(0.6, 'rgba(110,200,50,' + (0.22 + p * 0.08) + ')');
    g.addColorStop(1, 'rgba(90,180,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(140,230,80,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([7, 7]);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    // biohazard glyph
    ctx.globalAlpha = 0.55 + p * 0.25;
    ctx.font = '900 ' + Math.round(r * 0.7) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(40,90,20,0.9)';
    ctx.fillText('\u2623', x, y);
    ctx.restore();
  };

  // ------------------------------------------------------------
  //  WATER STATION
  // ------------------------------------------------------------
  function WaterStation(x, y) {
    this.x = x; this.y = y;
    this.r = 18;
    this.phase = Math.random() * 6.28;
  }
  WaterStation.prototype.update = function (dt) { this.phase += dt * 2; };
  WaterStation.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y;
    ctx.save();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + 14, 18, 7, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    var p = 0.5 + 0.5 * Math.sin(this.phase);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(50,180,255,' + (0.1 + p * 0.12) + ')';
    ctx.beginPath(); ctx.arc(x, y, 34 + p * 4, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // base
    ctx.fillStyle = '#2b6fa8';
    roundRect(ctx, x - 15, y - 16, 30, 32, 8); ctx.fill();
    ctx.fillStyle = '#1f5787';
    roundRect(ctx, x - 15, y + 6, 30, 10, 6); ctx.fill();
    // tank window
    ctx.fillStyle = 'rgba(150,225,255,0.9)';
    roundRect(ctx, x - 9, y - 11, 18, 14, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x - 7, y - 9, 3, 10);
    // droplet icon
    ctx.fillStyle = '#e9f8ff';
    ctx.font = '900 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F4A7}', x, y + 10);
    // side spouts
    ctx.fillStyle = '#4fd0ff';
    roundRect(ctx, x - 20, y - 8, 6, 16, 3); ctx.fill();
    roundRect(ctx, x + 14, y - 8, 6, 16, 3); ctx.fill();

    // floating refill label
    ctx.globalAlpha = 0.55 + p * 0.4;
    ctx.fillStyle = '#9fe4ff'; ctx.font = '900 11px Nunito, sans-serif';
    ctx.fillText('REFILL', x, y - 26);
    ctx.restore();
  };

  // ------------------------------------------------------------
  //  DINOSAUR  (lethal predator -- chases the player and cannot
  //  be killed or repelled. Run, and still finish the mission!)
  // ------------------------------------------------------------
  function Dino(x, y, opts) {
    opts = opts || {};
    var D = CFG.DINO;
    this.isDino = true;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = D.RADIUS;
    this.facing = opts.facing == null ? 0 : opts.facing;
    this.alive = true;
    this.gone = false;
    this.hp = Infinity;                    // invincible: water/attacks do nothing
    this.speedMult = opts.speedMult || 1;
    this.baseSpeed = D.SPEED * this.speedMult;
    this.state = 'warn';                   // warn -> chase -> retreat
    this.stateT = 0;
    this.warnTime = opts.warnTime == null ? D.WARN_TIME : opts.warnTime;
    this.chaseMax = opts.chaseTime == null ? D.CHASE_TIME : opts.chaseTime;
    this.attackCd = 0.6;
    this.lungeCd = 1.2;
    this.lungeT = 0;
    this.roarT = 0.35;
    this.stompT = 0.2;
    this.walkPhase = 0;
    this.phase = Math.random() * 6.28;
    this.dist = 99999;
    this.speedNow = 0;
    this.bites = 0;
  }

  // Move with wall collision + a slide fallback so it never wedges.
  Dino.prototype._step = function (ang, speed, dt, game) {
    // Hard guarantee: the predator can never move faster than the player,
    // so a running player always escapes (even at max level/wave scaling).
    var cap = CFG.PLAYER.SPEED * CFG.DINO.SPEED_CAP_MULT;
    if (speed > cap) speed = cap;
    var lv = game.level, r = this.radius * 0.78;
    var vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    this.vx = vx; this.vy = vy;
    var nx = this.x + vx * dt, ny = this.y + vy * dt;
    var hitX = circleHitsWall(nx, this.y, r, lv.grid, lv.W, lv.H);
    var hitY = circleHitsWall(this.x, ny, r, lv.grid, lv.W, lv.H);
    if (!hitX) this.x = nx;
    if (!hitY) this.y = ny;
    if (hitX && hitY) {
      var perp = ang + (Math.sin(this.phase) > 0 ? Math.PI / 2 : -Math.PI / 2);
      var px = this.x + Math.cos(perp) * speed * 0.8 * dt;
      var py = this.y + Math.sin(perp) * speed * 0.8 * dt;
      if (!circleHitsWall(px, this.y, r, lv.grid, lv.W, lv.H)) this.x = px;
      if (!circleHitsWall(this.x, py, r, lv.grid, lv.W, lv.H)) this.y = py;
    }
    this.walkPhase += dt * (speed / 34);
  };

  // Obstacle-aware steering: probe a few rays ahead and bend the
  // desired heading around walls so the predator never wedges.
  Dino.prototype._steer = function (toPlayer, game) {
    var lv = game.level;
    var probe = this.radius * 2.4;
    function clear(ang) {
      var px = this.x + Math.cos(ang) * probe;
      var py = this.y + Math.sin(ang) * probe;
      return !circleHitsWall(px, py, this.radius * 0.7, lv.grid, lv.W, lv.H);
    }
    if (clear.call(this, toPlayer)) return toPlayer;
    var offs = [0.5, -0.5, 0.95, -0.95, 1.5, -1.5, 2.1, -2.1];
    for (var i = 0; i < offs.length; i++) {
      var a = toPlayer + offs[i];
      if (clear.call(this, a)) return a;
    }
    return toPlayer;
  };

  Dino.prototype.update = function (dt, game) {
    if (this.gone) return;
    var D = CFG.DINO, p = game.player, i;
    this.phase += dt * 3.4;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.lungeCd > 0) this.lungeCd -= dt;
    if (this.roarT > 0) this.roarT -= dt;

    var dx = p.x - this.x, dy = p.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    this.dist = d;
    var toPlayer = Math.atan2(dy, dx);

    // ---- telegraph: it appears, roars, and gives you a beat to react ----
    if (this.state === 'warn') {
      this.stateT += dt;
      this.facing = toPlayer;
      this.speedNow = 0;
      // ground tremble
      this.x += Math.sin(this.phase * 22) * 0.7;
      this.y += Math.cos(this.phase * 19) * 0.7;
      if (game.fx && Math.random() < dt * 8) game.fx.stomp(this.x + rand(-14, 14), this.y + rand(-8, 8));
      if (this.stateT >= this.warnTime) {
        this.state = 'chase'; this.stateT = 0;
        this.roarT = 0.05; this.lungeCd = 1.0;
        game.audio.play('dinoRoar');
        if (game.fx) {
          game.fx.ring(this.x, this.y, 20, 200, 'rgba(255,60,60,0.75)', 0.7);
          game.fx.addShake(15);
          game.fx.flashScreen(0.22, 'rgba(255,40,40,1)');
        }
        if (game.vibrate) game.vibrate(90);
      }
      return;
    }

    // ---- giving up: lopes away and vanishes ----
    if (this.state === 'retreat') {
      this.stateT += dt;
      var away = toPlayer + Math.PI;
      this.facing = away;
      this.speedNow = this.baseSpeed * 1.15;
      this._step(away, this.speedNow, dt, game);
      if (this.stateT >= D.RETREAT_TIME) { this.gone = true; this.alive = false; }
      return;
    }

    // ---- CHASE ----
    this.stateT += dt;
    var desired = this._steer(toPlayer, game);
    var turn = Math.min(1, dt * 7);
    this.facing = this.facing + angDiff(desired, this.facing) * turn;

    var sp = this.baseSpeed;
    if (this.lungeT > 0) {
      this.lungeT -= dt;
      sp *= D.LUNGE_MULT;
    } else if (d < D.LUNGE_RANGE && this.lungeCd <= 0) {
      this.lungeT = D.LUNGE_TIME;
      this.lungeCd = D.LUNGE_COOLDOWN;
      game.audio.play('dinoRoar');
      if (game.fx) game.fx.addShake(7);
    }
    this.speedNow = sp;
    this._step(desired, sp, dt, game);

    // thundering footsteps
    this.stompT -= dt;
    if (this.stompT <= 0) {
      this.stompT = D.STOMP_INTERVAL * (this.lungeT > 0 ? 0.55 : 1);
      if (game.fx) game.fx.stomp(this.x + rand(-16, 16), this.y + rand(-10, 10));
      if (d < 560) game.audio.play('dinoStomp');
      if (game.fx) game.fx.addShake(2.4);
    }

    // smash any barrel it tramples (no explosion - it just crunches it)
    for (i = 0; i < game.barrels.length; i++) {
      var b = game.barrels[i];
      if (!b.alive) continue;
      if (Math.sqrt(dist2(this.x, this.y, b.x, b.y)) < this.radius + b.r + 4) {
        b.alive = false;
        game.audio.play('extinguish');
        if (game.fx) {
          for (var k = 0; k < 8; k++) game.fx.emit({ x: b.x, y: b.y, vx: rand(-90, 90), vy: rand(-120, -20), life: rand(0.3, 0.7), size: rand(3, 6), col: '#9aa4b2', type: 'glow', grav: 200 });
          game.fx.text(b.x, b.y - 20, 'CRUNCH', '#ffb27a', 14);
        }
      }
    }

    // bite!
    if (d < D.ATTACK_RANGE + p.radius && this.attackCd <= 0) {
      this.attackCd = D.ATTACK_COOLDOWN;
      this.bites++;
      game.onDinoBite(this);
    }

    // periodic roar while hunting
    if (this.roarT <= 0 && d < D.ROAR_RANGE) {
      this.roarT = D.ROAR_INTERVAL * (0.8 + Math.random() * 0.5);
      game.audio.play('dinoRoar');
      if (game.fx) game.fx.ring(this.x, this.y, 16, 130, 'rgba(255,80,60,0.45)', 0.5);
    }

    // eventually loses interest and leaves
    if (this.stateT >= this.chaseMax) {
      this.state = 'retreat'; this.stateT = 0;
      game.audio.play('dinoLeave');
    }
  };

  // Any damage attempt is absorbed: the dinosaur cannot be killed.
  Dino.prototype.damage = function () { return false; };

  Dino.prototype.render = function (ctx, t) {
    if (this.gone) return;
    var x = this.x, y = this.y, R = this.radius;
    var warn = this.state === 'warn';
    var fading = this.state === 'retreat' ? Math.max(0, 1 - this.stateT / (CFG.DINO.RETREAT_TIME * 0.9)) : 1;
    var lunge = this.lungeT > 0;
    ctx.save();
    ctx.globalAlpha = fading;

    // shadow
    ctx.globalAlpha = 0.3 * fading;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + R * 0.7, R * 1.05, R * 0.42, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = fading;

    // danger aura
    var pulse = 0.5 + 0.5 * Math.sin(this.phase * 2.2);
    ctx.globalCompositeOperation = 'lighter';
    var aur = ctx.createRadialGradient(x, y, R * 0.4, x, y, R * 2.6);
    aur.addColorStop(0, 'rgba(255,60,40,' + (0.20 + pulse * 0.14) + ')');
    aur.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = aur;
    ctx.beginPath(); ctx.arc(x, y, R * 2.6, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    if (warn) {
      // expanding warning ring on the ground
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.strokeStyle = 'rgba(255,70,60,0.9)';
      ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.phase * 10;
      ctx.beginPath(); ctx.arc(x, y, R * 1.6 + pulse * 8, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.globalAlpha = fading;
    }

    ctx.translate(x, y);
    ctx.rotate(this.facing);

    var skin = '#3f7d4a', skinD = '#2c5a35', skinL = '#56a062';
    var stride = lunge ? 1.5 : 1;
    var swing = Math.sin(this.walkPhase) * 0.5 * stride;

    // tail (behind = -x)
    ctx.fillStyle = skinD;
    ctx.beginPath();
    ctx.moveTo(-R * 0.3, -R * 0.34);
    ctx.quadraticCurveTo(-R * 1.6, -R * 0.2 + swing * 10, -R * 2.5, swing * 16);
    ctx.quadraticCurveTo(-R * 1.6, R * 0.28 + swing * 10, -R * 0.3, R * 0.34);
    ctx.closePath(); ctx.fill();

    // legs
    ctx.fillStyle = skinD;
    ctx.beginPath(); ctx.ellipse(-R * 0.1, -R * 0.62 + swing * 8, R * 0.34, R * 0.46, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-R * 0.1, R * 0.62 - swing * 8, R * 0.34, R * 0.46, 0, 0, 6.283); ctx.fill();

    // body
    if (!this._bodyGrad) {
      var bg = ctx.createLinearGradient(0, -R, 0, R);
      bg.addColorStop(0, skinL); bg.addColorStop(0.5, skin); bg.addColorStop(1, skinD);
      this._bodyGrad = bg;
    }
    ctx.fillStyle = this._bodyGrad;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.05, R * 0.78, 0, 0, 6.283); ctx.fill();

    // back stripes
    ctx.fillStyle = 'rgba(20,50,26,0.5)';
    for (var s = -1; s <= 1; s++) {
      ctx.beginPath(); ctx.ellipse(s * R * 0.36, 0, R * 0.1, R * 0.6, 0, 0, 6.283); ctx.fill();
    }

    // tiny forearms
    ctx.fillStyle = skinD;
    ctx.beginPath(); ctx.ellipse(R * 0.42, -R * 0.5, R * 0.2, R * 0.12, -0.5, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R * 0.42, R * 0.5, R * 0.2, R * 0.12, 0.5, 0, 6.283); ctx.fill();

    // neck
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(R * 0.72, 0, R * 0.5, R * 0.4, 0, 0, 6.283); ctx.fill();

    // head
    ctx.fillStyle = skinL;
    ctx.beginPath(); ctx.ellipse(R * 1.28, 0, R * 0.66, R * 0.46, 0, 0, 6.283); ctx.fill();

    // jaws (open wider when lunging)
    var gape = (lunge ? 0.62 : 0.26) + Math.sin(this.phase * 6) * (warn ? 0.05 : 0.14);
    ctx.fillStyle = '#6d1f1f';
    ctx.beginPath();
    ctx.moveTo(R * 1.5, 0);
    ctx.lineTo(R * 2.15, Math.sin(gape) * R * 0.5);
    ctx.lineTo(R * 2.15, -Math.sin(gape) * R * 0.5);
    ctx.closePath(); ctx.fill();
    // teeth
    ctx.fillStyle = '#f2f4f7';
    for (var ti = 0; ti < 3; ti++) {
      var tx = R * (1.62 + ti * 0.16);
      ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx + R * 0.08, Math.sin(gape) * R * 0.30); ctx.lineTo(tx + R * 0.15, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx + R * 0.08, -Math.sin(gape) * R * 0.30); ctx.lineTo(tx + R * 0.15, 0); ctx.closePath(); ctx.fill();
    }

    // glowing eye
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(R * 1.18, -R * 0.2, R * 0.12, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#e01b1b';
    ctx.beginPath(); ctx.arc(R * 1.2, -R * 0.2, R * 0.07, 0, 6.283); ctx.fill();

    // dorsal spines
    ctx.fillStyle = skinD;
    for (var sp2 = -1; sp2 <= 1; sp2++) {
      ctx.beginPath();
      ctx.moveTo(sp2 * R * 0.34 - R * 0.1, -R * 0.72);
      ctx.lineTo(sp2 * R * 0.34, -R * 1.05);
      ctx.lineTo(sp2 * R * 0.34 + R * 0.1, -R * 0.72);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // warning "!" marker above the head
    if (warn) {
      ctx.save();
      ctx.globalAlpha = 0.85 + pulse * 0.15;
      ctx.fillStyle = '#ff3b3b';
      ctx.font = '900 30px Nunito, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y - R * 2.4);
      ctx.restore();
    }
  };

  // ------------------------------------------------------------
  //  Shooting star / helper drawing utilities
  // ------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var num = parseInt(c, 16);
    var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = clamp(Math.round(r + r * amt), 0, 255);
    g = clamp(Math.round(g + g * amt), 0, 255);
    b = clamp(Math.round(b + b * amt), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  global.Entities = {
    Player: Player, Fire: Fire, Victim: Victim, Barrel: Barrel,
    ToxicZone: ToxicZone, WaterStation: WaterStation, Dino: Dino,
    roundRect: roundRect, shade: shade, circleHitsWall: circleHitsWall,
    blockedTile: blockedTile,
    FIRE_DEF: FIRE_DEF
  };
})(typeof window !== 'undefined' ? window : globalThis);
