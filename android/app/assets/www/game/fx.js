/* ============================================================
   fx.js - Particles, floating text, screen shake, decals.
   Object-pooled to avoid GC churn on mid-range phones.
   ============================================================ */
(function (global) {
  'use strict';

  function rand(a, b) { return a + Math.random() * (b - a); }

  function FX() {
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.motes = [];
    this.shake = 0;
    this.shakeDecay = 3.4;
    this.flash = null; // {a, col}
    this._pool = [];
    this.maxParticles = 420;
  }

  FX.prototype._p = function () {
    if (this._pool.length) return this._pool.pop();
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 1, col: '#fff', type: 'dot', rot: 0, vr: 0, grav: 0, drag: 0.96, fade: 1 };
  };
  FX.prototype._release = function (p) {
    if (this._pool.length < 500) this._pool.push(p);
  };

  FX.prototype.emit = function (opt) {
    if (this.particles.length >= this.maxParticles) {
      // recycle oldest
      this._release(this.particles.shift());
    }
    var p = this._p();
    p.x = opt.x; p.y = opt.y;
    p.vx = opt.vx || 0; p.vy = opt.vy || 0;
    p.life = p.max = opt.life || 0.6;
    p.size = opt.size || 3;
    p.col = opt.col || '#fff';
    p.type = opt.type || 'dot';
    p.rot = opt.rot || 0; p.vr = opt.vr || 0;
    p.grav = opt.grav == null ? 0 : opt.grav;
    p.drag = opt.drag == null ? 0.96 : opt.drag;
    p.fade = opt.fade == null ? 1 : opt.fade;
    p.grow = opt.grow || 0;
    p.alpha = opt.alpha == null ? 1 : opt.alpha;
    this.particles.push(p);
    return p;
  };

  // Preset emitters -------------------------------------------------
  FX.prototype.smoke = function (x, y, scale, dark) {
    scale = scale || 1;
    this.emit({
      x: x + rand(-6, 6) * scale, y: y + rand(-4, 4) * scale,
      vx: rand(-14, 14), vy: rand(-40, -20) * scale,
      life: rand(0.9, 1.7), size: rand(6, 12) * scale,
      col: dark ? 'rgba(40,42,50,0.55)' : 'rgba(90,92,104,0.5)',
      type: 'puff', grow: 22 * scale, drag: 0.94, alpha: rand(0.4, 0.7)
    });
  };

  FX.prototype.ember = function (x, y, scale) {
    scale = scale || 1;
    this.emit({
      x: x + rand(-8, 8) * scale, y: y + rand(-6, 6) * scale,
      vx: rand(-30, 30), vy: rand(-90, -40) * scale,
      life: rand(0.4, 0.95), size: rand(1.6, 3.4) * scale,
      col: Math.random() < 0.5 ? '#ffd23f' : '#ff8a2b',
      type: 'glow', grav: 30, drag: 0.97
    });
  };

  FX.prototype.flameWisp = function (x, y, scale) {
    scale = scale || 1;
    this.emit({
      x: x + rand(-10, 10) * scale, y: y + rand(-6, 6) * scale,
      vx: rand(-16, 16), vy: rand(-70, -34) * scale,
      life: rand(0.28, 0.55), size: rand(5, 11) * scale,
      col: Math.random() < 0.5 ? 'rgba(255,120,40,0.85)' : 'rgba(255,190,60,0.85)',
      type: 'glow', grow: -6, drag: 0.95
    });
  };

  FX.prototype.drop = function (x, y, vx, vy) {
    this.emit({
      x: x, y: y, vx: vx, vy: vy,
      life: rand(0.35, 0.62), size: rand(2.2, 4.2),
      col: 'rgba(150,225,255,0.95)', type: 'drop',
      grav: 210, drag: 0.995, alpha: 0.9
    });
  };

  FX.prototype.mist = function (x, y) {
    this.emit({
      x: x, y: y, vx: 0, vy: rand(-10, -30),
      life: rand(0.25, 0.5), size: rand(4, 9),
      col: 'rgba(200,240,255,0.6)', type: 'puff', grow: 14, drag: 0.93, alpha: 0.6
    });
  };

  FX.prototype.steam = function (x, y, scale) {
    scale = scale || 1;
    this.emit({
      x: x, y: y, vx: rand(-10, 10), vy: rand(-50, -22),
      life: rand(0.5, 0.95), size: rand(5, 11) * scale,
      col: 'rgba(230,240,250,0.55)', type: 'puff', grow: 20, alpha: 0.6, drag: 0.94
    });
  };

  // Heavy footstep: a kick of dust + a small ground ring.
  FX.prototype.stomp = function (x, y) {
    this.emit({
      x: x, y: y, vx: rand(-30, 30), vy: rand(-16, -2),
      life: rand(0.35, 0.7), size: rand(7, 15),
      col: 'rgba(150,140,120,0.5)', type: 'puff', grow: 26, alpha: 0.5, drag: 0.9
    });
    this.ring(x, y, 4, 22, 'rgba(120,110,95,0.35)', 0.35);
  };

  FX.prototype.explosion = function (x, y) {
    var i, n = 34;
    for (i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      var sp = rand(120, 380);
      this.emit({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.35, 0.8), size: rand(4, 12),
        col: Math.random() < 0.5 ? '#ff8a2b' : (Math.random() < 0.5 ? '#ffd23f' : '#ff4d2e'),
        type: 'glow', drag: 0.9, grav: 60
      });
    }
    for (i = 0; i < 16; i++) {
      this.emit({
        x: x + rand(-20, 20), y: y + rand(-20, 20),
        vx: rand(-60, 60), vy: rand(-70, -10),
        life: rand(0.7, 1.5), size: rand(10, 22),
        col: 'rgba(60,58,66,0.5)', type: 'puff', grow: 34, alpha: 0.6
      });
    }
    this.ring(x, y, 18, 120, 'rgba(255,200,90,0.9)', 0.4);
    this.flashScreen(0.5, 'rgba(255,180,80,1)');
    this.addShake(16);
  };

  FX.prototype.splashBurst = function (x, y) {
    for (var i = 0; i < 6; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(20, 70);
      this.drop(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 30);
    }
  };

  // Text & rings -----------------------------------------------------
  FX.prototype.text = function (x, y, str, col, size) {
    this.texts.push({ x: x, y: y, str: str, col: col || '#fff', size: size || 16, life: 1.0, max: 1.0, vy: -38 });
    if (this.texts.length > 26) this.texts.shift();
  };

  FX.prototype.ring = function (x, y, r0, r1, col, life) {
    this.rings.push({ x: x, y: y, r0: r0, r1: r1, col: col, life: life || 0.4, max: life || 0.4 });
    if (this.rings.length > 40) this.rings.shift();
  };

  FX.prototype.addShake = function (amt) {
    this.shake = Math.min(26, this.shake + amt);
  };

  // NOTE: named flashScreen (not flash) because `this.flash` holds the
  // screen-flash state object and would otherwise shadow the method.
  FX.prototype.flashScreen = function (a, col) {
    this.flash = { a: a, col: col || 'rgba(255,255,255,1)' };
  };

  // Ambient motes (dust floating in rooms) ----------------------------
  FX.prototype.initMotes = function (level) {
    this.motes.length = 0;
    var n = Math.min(70, Math.floor(level.w * level.h / 26000));
    for (var i = 0; i < n; i++) {
      this.motes.push({
        x: Math.random() * level.pxW, y: Math.random() * level.pxH,
        vx: rand(-6, 6), vy: rand(-10, -3), size: rand(1, 2.6), a: rand(0.06, 0.2), ph: rand(0, 6.28)
      });
    }
  };

  FX.prototype.update = function (dt) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this._release(p); this.particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      var d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.grow) p.size = Math.max(0.6, p.size + p.grow * dt);
    }
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.life -= dt; t.y += t.vy * dt; t.vy *= Math.pow(0.94, dt * 60);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (i = this.rings.length - 1; i >= 0; i--) {
      var r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      m.ph += dt * 2;
      if (m.y < -10) { m.y = this._worldH || 600; m.x = Math.random() * (this._worldW || 600); }
    }
    if (this.shake > 0) {
      this.shake -= this.shakeDecay * dt * (1 + this.shake * 0.05);
      if (this.shake < 0) this.shake = 0;
    }
    if (this.flash) {
      this.flash.a -= dt * 2.4;
      if (this.flash.a <= 0) this.flash = null;
    }
  };

  FX.prototype.setWorldBounds = function (w, h) { this._worldW = w; this._worldH = h; };

  FX.prototype.drawWorld = function (ctx) {
    var i;
    // motes behind
    ctx.save();
    for (i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.ph));
      ctx.fillStyle = '#fffbe8';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.size, 0, 6.283); ctx.fill();
    }
    ctx.restore();

    for (i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var lf = p.life / p.max;
      var al = (p.fade ? Math.min(1, lf / p.fade) : lf) * (p.alpha == null ? 1 : p.alpha);
      ctx.globalAlpha = Math.max(0, al);
      if (p.type === 'puff') {
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      } else if (p.type === 'drop') {
        ctx.strokeStyle = p.col; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.type === 'glow') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = p.col;
        var s = p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  };

  FX.prototype.drawOverlay = function (ctx) {
    var i;
    for (i = 0; i < this.rings.length; i++) {
      var r = this.rings[i];
      var lf = r.life / r.max;
      ctx.globalAlpha = lf;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = 3 + 4 * lf;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - lf), 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      var lf2 = t.life / t.max;
      ctx.globalAlpha = Math.min(1, lf2 * 1.6);
      ctx.font = '900 ' + t.size + 'px Nunito, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,8,13,0.85)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.col;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    if (this.flash) {
      ctx.globalAlpha = Math.min(1, this.flash.a);
      ctx.fillStyle = this.flash.col;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalAlpha = 1;
    }
  };

  FX.prototype.reset = function () {
    this.particles.length = 0; this.texts.length = 0; this.rings.length = 0;
    this.shake = 0; this.flash = null;
  };

  global.FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
