/* ============================================================
   config.js - Global constants, tunables and palettes
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    VERSION: '1.0.0',

    // ---- World / rendering ----
    TILE: 64,                 // world units per tile (also canvas scale base)
    PLAYER_RADIUS: 19,

    // ---- Player ----
    PLAYER: {
      SPEED: 178,             // px/sec
      MAX_HEALTH: 100,
      MAX_WATER: 100,
      WATER_DRAIN: 26,        // water per second while spraying
      WATER_REGEN: 8,         // water per second regenerated when not spraying
      SPRAY_RANGE: 132,       // world px
      SPRAY_ARC: Math.PI / 3, // ~60 degrees total cone
      SPRAY_DPS: 46,          // damage/sec at close range
      RESCUE_RANGE: 62,
      RESCUE_TIME: 0.85,      // seconds holding rescue
      HAZARD_DPS: 26,
      FIRE_TOUCH_DPS: 19,
      INVULN_TIME: 0.9
    },

    // ---- Dinosaur (lethal predator - cannot be killed or repelled) ----
    DINO: {
      RADIUS: 30,
      SPEED: 118,              // base chase speed (px/s) - below player speed on purpose
      SPEED_PER_LEVEL: 0.045,  // campaign: speed scaling per level past INTRO_LEVEL
      SPEED_PER_WAVE: 0.02,    // endless: speed scaling per wave past INTRO_WAVE
      SPEED_MAX_MULT: 1.5,     // hard cap so the player can always (just) outrun
      INTRO_LEVEL: 3,          // campaign: first level that can spawn a dinosaur
      INTRO_WAVE: 4,           // endless: first wave that can spawn a dinosaur
      WARN_TIME: 2.0,          // roar/telegraph at spawn before it starts hunting
      PREWARN: 2.6,            // heads-up warning shown BEFORE it materialises
      FIRST_DELAY: 22,         // campaign first spawn, seconds into the mission
      FIRST_MIN: 12,
      FIRST_DELAY_WAVE: 55,    // endless wave-1 baseline (later waves come sooner)
      WAVE_FIRST_MIN: 18,
      INTERVAL: 30,            // gap between spawns (s)
      MIN_GAP: 14,
      MAX_ACTIVE: 2,           // most dinos hunting at once
      LUNGE_RANGE: 250,        // starts a short burst when this close
      LUNGE_MULT: 1.7,
      LUNGE_TIME: 0.55,
      LUNGE_COOLDOWN: 5.5,
      ATTACK_RANGE: 40,        // bite reach (world px from centres)
      ATTACK_DAMAGE: 34,       // damage per bite
      ATTACK_COOLDOWN: 1.15,
      KNOCKBACK: 240,
      CHASE_TIME: 38,          // gives up and leaves after this long
      RETREAT_TIME: 2.6,
      ROAR_INTERVAL: 6.5,
      ROAR_RANGE: 900,
      STOMP_INTERVAL: 0.55,
      VIGNETTE_DIST: 340       // danger vignette shows within this range
    },

    // ---- Fire ----
    FIRE: {
      SMALL:  { hp: 46,  radius: 26, dpsToPlayer: 9,  spread: 0     },
      MEDIUM: { hp: 92,  radius: 34, dpsToPlayer: 13, spread: 0     },
      LARGE:  { hp: 172, radius: 46, dpsToPlayer: 17, spread: 0.06  },
      HUGE:   { hp: 270, radius: 58, dpsToPlayer: 22, spread: 0.11  }
    },

    // ---- Scoring ----
    SCORE: {
      VICTIM: 320,
      FIRE: 140,
      TIME_BONUS_PER_SEC: 6,
      WATER_BONUS_PER_UNIT: 3,
      HEALTH_BONUS_PER_HP: 2,
      STAR_2: 0.62,   // fraction of max achievable-ish
      STAR_3: 0.86
    },
    // ---- Misc ----
    MAX_LEVELS: 20,

    // ---- Endless mode (infinite waves with escalating difficulty tasks) ----
    ENDLESS: {
      START_W: 13, START_H: 13, GROW: 1, MAX_W: 30, MAX_H: 30,
      ROOMS_BASE: 4, ROOMS_PER_WAVE: 0.6, MAX_ROOMS: 16,
      TIME_BASE: 150, TIME_MAX: 420, TIME_MIN: 85,
      WATER_BASE: 100, WATER_MIN: 80,
      FIRES_BASE: 3, FIRES_PER_WAVE: 0.85, FIRES_MAX: 24,
      VICTIMS_BASE: 1, VICTIMS_PER_WAVE: 0.55, VICTIMS_MAX: 18,
      BARRELS_PER_WAVE: 0.45, BARRELS_MAX: 14,
      TOXIC_PER_WAVE: 0.40, TOXIC_MAX: 12,
      WATERS_BASE: 2, WATERS_MAX: 6,
      BIG_FIRE_FROM: 4, HUGE_FIRE_FROM: 9
    },
    EXPLOSION_RADIUS: 96,
    EXPLOSION_DAMAGE: 38,
    FUSE_TIME: 4.5,        // seconds before a primed barrel explodes

    // ---- Palette (cartoon) ----
    COL: {
      floor: '#c8a877', floorAlt: '#bfa06e', floorLine: '#a9885a',
      wall: '#3b4256', wallTop: '#4b546c', wallEdge: '#2a3040',
      wallConcrete: '#5a6273',
      carpet: '#8d6e63',
      exit: '#2ee06a',
      water: '#2fb6ff',
      waterLight: '#9fe4ff',
      smoke: 'rgba(70,74,84,1)',
      danger: '#c0392b',
      toxic: '#7bd63f'
    }
  };

  CFG.LEVEL_TYPES = {
    house:    { name: 'House',      icon: '\u{1F3E0}', floor: '#c8a877', wall: '#3b4256' },
    apartment:{ name: 'Apartment',  icon: '\u{1F3E2}', floor: '#b9a07c', wall: '#463f5e' },
    office:   { name: 'Office',     icon: '\u{1F3E2}', floor: '#9fb0c0', wall: '#3a4a5e' },
    school:   { name: 'School',     icon: '\u{1F3EB}', floor: '#d6c39a', wall: '#4a5a3e' },
    warehouse:{ name: 'Warehouse',  icon: '\u{1F3ED}', floor: '#8f8f8f', wall: '#4a4a52' },
    factory:  { name: 'Factory',    icon: '\u{1F3ED}', floor: '#7d8391', wall: '#3c424f' },
    industrial:{name: 'Industrial', icon: '\u2699\u{FE0F}', floor: '#6f7686', wall: '#353b48' },
    hotel:    { name: 'Hotel',      icon: '\u{1F3E8}', floor: '#cbb79a', wall: '#5a4634' },
    mall:     { name: 'Shopping Mall', icon: '\u{1F3EC}', floor: '#cfd3da', wall: '#4a5060' },
    subway:   { name: 'Subway',     icon: '\u{1F687}', floor: '#9aa0a6', wall: '#3a3f47' },
    hospital: { name: 'Hospital',   icon: '\u{1F3E5}', floor: '#cfe3ee', wall: '#3f6a86' }
  };

  global.CFG = CFG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CFG;
})(typeof window !== 'undefined' ? window : globalThis);
