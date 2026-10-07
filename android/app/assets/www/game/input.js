/* ============================================================
   input.js - Unified input: virtual joystick + action buttons
   + keyboard (for desktop testing). Multi-touch safe.
   ============================================================ */
(function (global) {
  'use strict';

  var Input = {
    moveX: 0, moveY: 0,
    joyActive: false,
    _joyId: null,
    _sx: 0, _sy: 0,
    _waterHeld: false,
    _rescueHeld: false,
    keys: {},
    enabled: false,
    onPause: null,
    els: null,
    RADIUS: 54
  };

  Input.attach = function (els) {
    Input.els = els;
    var joyZone = els.joyZone, base = els.joyBase, knob = els.joyKnob;

    // ---------------- Joystick ----------------
    function joyStart(e) {
      if (Input._joyId !== null) return;
      Input._joyId = e.pointerId;
      Input._sx = e.clientX; Input._sy = e.clientY;
      Input.joyActive = true;
      Input.moveX = 0; Input.moveY = 0;
      try { joyZone.setPointerCapture(e.pointerId); } catch (err) {}
      // move the base to the touch position
      if (base) {
        base.style.left = (e.clientX - 59) + 'px';
        base.style.top = (e.clientY - 59) + 'px';
        base.style.bottom = 'auto';
        base.classList.add('active');
      }
      if (knob) { knob.style.left = '50%'; knob.style.top = '50%'; }
      e.preventDefault();
    }
    function joyMove(e) {
      if (e.pointerId !== Input._joyId) return;
      var dx = e.clientX - Input._sx;
      var dy = e.clientY - Input._sy;
      var RAD = Input.RADIUS;
      var mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > RAD) { dx = dx / mag * RAD; dy = dy / mag * RAD; mag = RAD; }
      Input.moveX = dx / RAD;
      Input.moveY = dy / RAD;
      if (knob) {
        knob.style.left = (50 + (dx / RAD) * 40) + '%';
        knob.style.top = (50 + (dy / RAD) * 40) + '%';
      }
      e.preventDefault();
    }
    function joyEnd(e) {
      if (e.pointerId !== Input._joyId) return;
      Input._joyId = null;
      Input.joyActive = false;
      Input.moveX = 0; Input.moveY = 0;
      if (base) base.classList.remove('active');
      if (knob) { knob.style.left = '50%'; knob.style.top = '50%'; }
      e.preventDefault();
    }

    if (joyZone) {
      joyZone.addEventListener('pointerdown', joyStart);
      joyZone.addEventListener('pointermove', joyMove);
      joyZone.addEventListener('pointerup', joyEnd);
      joyZone.addEventListener('pointercancel', joyEnd);
      joyZone.addEventListener('lostpointercapture', joyEnd);
    }

    // ---------------- Hold buttons ----------------
    function bindHold(el, onDown, onUp) {
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        el.classList.add('pressed');
        if (onDown) onDown();
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      function up(e) {
        el.classList.remove('pressed');
        if (onUp) onUp();
        e.preventDefault();
      }
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      // safety: release if pointer leaves
      el.addEventListener('pointerleave', function () { if (el.classList.contains('pressed')) { el.classList.remove('pressed'); if (onUp) onUp(); } });
    }

    bindHold(els.waterBtn,
      function () { Input._waterHeld = true; els.waterBtn.classList.add('pressed'); },
      function () { Input._waterHeld = false; });
    bindHold(els.rescueBtn,
      function () { Input._rescueHeld = true; },
      function () { Input._rescueHeld = false; });

    if (els.pauseBtn) {
      els.pauseBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (Input.onPause) Input.onPause();
      });
    }

    // ---------------- Keyboard (desktop) ----------------
    global.addEventListener('keydown', function (e) {
      Input.keys[e.key.toLowerCase()] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        if (Input.onPause) Input.onPause();
      }
    });
    global.addEventListener('keyup', function (e) {
      Input.keys[e.key.toLowerCase()] = false;
    });
    global.addEventListener('blur', function () { Input.reset(); });
  };

  Input.reset = function () {
    Input.moveX = 0; Input.moveY = 0;
    Input._waterHeld = false; Input._rescueHeld = false;
    Input.joyActive = false; Input._joyId = null;
    Input.keys = {};
    if (Input.els) {
      if (Input.els.waterBtn) Input.els.waterBtn.classList.remove('pressed');
      if (Input.els.rescueBtn) Input.els.rescueBtn.classList.remove('pressed');
      if (Input.els.joyBase) {
        Input.els.joyBase.classList.remove('active');
        // restore the resting position
        Input.els.joyBase.style.left = '';
        Input.els.joyBase.style.top = '';
        Input.els.joyBase.style.bottom = '';
      }
      if (Input.els.joyKnob) { Input.els.joyKnob.style.left = '50%'; Input.els.joyKnob.style.top = '50%'; }
    }
  };

  Input.enable = function (on) { Input.enabled = on; if (!on) Input.reset(); };

  Input.getMoveVector = function () {
    var x = Input.moveX, y = Input.moveY;
    // keyboard overlay
    var k = Input.keys;
    if (k['a'] || k['arrowleft']) x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    if (k['w'] || k['arrowup']) y -= 1;
    if (k['s'] || k['arrowdown']) y += 1;
    var m = Math.sqrt(x * x + y * y);
    if (m > 1) { x /= m; y /= m; }
    return { x: x, y: y };
  };

  Input.isWaterHeld = function () {
    return Input._waterHeld || !!Input.keys[' '] || !!Input.keys['j'];
  };
  Input.isRescueHeld = function () {
    return Input._rescueHeld || !!Input.keys['k'] || !!Input.keys['e'];
  };
  Input.releaseAll = function () { Input._waterHeld = false; Input._rescueHeld = false; };

  global.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
