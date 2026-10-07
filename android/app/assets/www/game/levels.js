/* ============================================================
   levels.js - Level definitions + deterministic map generator
   ------------------------------------------------------------
   Maps are generated with a seeded BSP room-splitter so that
   every level is guaranteed connected and playable, yet each
   level keeps its own hand-tuned spec (size, fires, victims,
   hazards, time, water) and a stable layout across sessions.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;
  var TILE = CFG.TILE;

  // ---------- seeded RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Tile codes
  var WALL = 0, FLOOR = 1, EXIT = 2;

  // ============================================================
  //  Dinosaur spawn configuration
  //  Dinosaurs are a lethal predator: they cannot be killed or
  //  repelled. They appear from level 3 onward (campaign) and from
  //  wave 4 onward (endless), getting faster and more frequent.
  // ============================================================
  function dinoPlan(spec, endless) {
    var D = CFG.DINO;
    var stage = endless ? (spec.wave || 1) : (spec.id || 1);
    var intro = endless ? D.INTRO_WAVE : D.INTRO_LEVEL;
    // tutorial (id 0) and pre-intro levels never spawn one
    if (spec.tutorial || stage < intro) {
      return { enabled: false, first: Infinity, interval: Infinity, maxActive: 0, speedMult: 1, chaseTime: D.CHASE_TIME, stage: stage };
    }
    var steps = stage - intro;
    var speedMult = Math.min(D.SPEED_MAX_MULT, 1 + steps * (endless ? D.SPEED_PER_WAVE : D.SPEED_PER_LEVEL));

    var first, interval, maxActive;
    if (endless) {
      first = Math.max(D.WAVE_FIRST_MIN, Math.round(D.FIRST_DELAY_WAVE - steps * 3));
      interval = Math.max(D.MIN_GAP, Math.round(D.INTERVAL - steps * 1.5));
      maxActive = stage >= 12 ? 2 : 1;
    } else {
      first = Math.max(D.FIRST_MIN, Math.round(D.FIRST_DELAY - steps * 1.2));
      interval = Math.max(D.MIN_GAP, Math.round(D.INTERVAL - steps * 1.1));
      maxActive = spec.id >= 9 ? 2 : 1;
      if (spec.difficulty === 'Extreme') maxActive = 2;
    }
    // an explicit spec override always wins
    if (spec.dino) {
      if (spec.dino.speedMult != null) speedMult = spec.dino.speedMult;
      if (spec.dino.first != null) first = spec.dino.first;
      if (spec.dino.interval != null) interval = spec.dino.interval;
      if (spec.dino.maxActive != null) maxActive = spec.dino.maxActive;
    }
    return {
      enabled: true, first: first, interval: interval,
      maxActive: Math.min(CFG.DINO.MAX_ACTIVE, maxActive),
      speedMult: speedMult, chaseTime: D.CHASE_TIME, stage: stage
    };
  }

  // ============================================================
  //  BSP map generator
  // ============================================================
  function MapGen(seed, W, H, minRoom, targetRooms) {
    this.W = W; this.H = H;
    this.rng = mulberry32(seed);
    this.minRoom = minRoom || 4;
    this.rooms = [];
    this.grid = [];
    for (var y = 0; y < H; y++) {
      var row = [];
      for (var x = 0; x < W; x++) row.push(WALL);
      this.grid.push(row);
    }
    var depth = Math.max(1, Math.ceil(Math.log(Math.max(2, targetRooms)) / Math.LN2));
    this.root = this._split(1, 1, W - 2, H - 2, depth);
    this._connect(this.root);
    this._carveRooms(this.root);
  }

  MapGen.prototype._canSplitX = function (w) { return w >= 2 * (this.minRoom + 2); };
  MapGen.prototype._canSplitY = function (h) { return h >= 2 * (this.minRoom + 2); };

  MapGen.prototype._split = function (x, y, w, h, depth) {
    var node = { x: x, y: y, w: w, h: h, a: null, b: null, room: null };
    var canX = this._canSplitX(w);
    var canY = this._canSplitY(h);
    if (depth <= 0 || (!canX && !canY)) {
      node.room = this._makeRoom(node);
      return node;
    }
    var vertical = w > h;
    if (!canX) vertical = false;
    else if (!canY) vertical = true;
    else if (this.rng() < 0.35) vertical = !vertical;

    var lo = this.minRoom + 2;
    if (vertical) {
      var hi = w - (this.minRoom + 2);
      var cut = lo + Math.floor(this.rng() * Math.max(1, hi - lo + 1));
      cut = Math.max(lo, Math.min(hi, cut));
      node.a = this._split(x, y, cut, h, depth - 1);
      node.b = this._split(x + cut, y, w - cut, h, depth - 1);
    } else {
      var hi2 = h - (this.minRoom + 2);
      var cut2 = lo + Math.floor(this.rng() * Math.max(1, hi2 - lo + 1));
      cut2 = Math.max(lo, Math.min(hi2, cut2));
      node.a = this._split(x, y, w, cut2, depth - 1);
      node.b = this._split(x, y + cut2, w, h - cut2, depth - 1);
    }
    return node;
  };

  MapGen.prototype._makeRoom = function (node) {
    var maxW = Math.max(1, node.w - 2);
    var maxH = Math.max(1, node.h - 2);
    var rw = Math.max(1, maxW - Math.floor(this.rng() * 2));
    var rh = Math.max(1, maxH - Math.floor(this.rng() * 2));
    if (maxW >= 3) rw = Math.max(3, rw);
    if (maxH >= 3) rh = Math.max(3, rh);
    rw = Math.min(rw, maxW); rh = Math.min(rh, maxH);
    var rx = node.x + 1 + Math.floor(this.rng() * Math.max(0, maxW - rw + 1));
    var ry = node.y + 1 + Math.floor(this.rng() * Math.max(0, maxH - rh + 1));
    var room = { x: rx, y: ry, w: rw, h: rh };
    this.rooms.push(room);
    return room;
  };

  function center(r) { return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }; }
  function collectRooms(node, arr) {
    if (!node) return;
    if (node.room) { arr.push(node.room); return; }
    collectRooms(node.a, arr); collectRooms(node.b, arr);
  }

  MapGen.prototype._connect = function (node) {
    if (!node || !node.a || !node.b) return;
    this._connect(node.a);
    this._connect(node.b);
    var ra = [], rb = [];
    collectRooms(node.a, ra); collectRooms(node.b, rb);
    if (!ra.length || !rb.length) return;
    var best = null, bd = 1e9;
    for (var i = 0; i < ra.length; i++) {
      var ca = center(ra[i]);
      for (var j = 0; j < rb.length; j++) {
        var cb = center(rb[j]);
        var d = Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
        if (d < bd) { bd = d; best = [ra[i], rb[j]]; }
      }
    }
    if (best) this._carveCorridor(best[0], best[1]);
  };

  MapGen.prototype._carveCorridor = function (r1, r2) {
    var a = center(r1), b = center(r2);
    if (this.rng() < 0.5) {
      this._carveH(a.x, b.x, a.y);
      this._carveV(a.y, b.y, b.x);
    } else {
      this._carveV(a.y, b.y, a.x);
      this._carveH(a.x, b.x, b.y);
    }
  };

  MapGen.prototype._carveH = function (x1, x2, y) {
    var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    for (var x = lo; x <= hi; x++) {
      for (var dy = 0; dy < 2; dy++) {
        var yy = y + dy;
        if (x >= 1 && x <= this.W - 2 && yy >= 1 && yy <= this.H - 2) this.grid[yy][x] = FLOOR;
      }
    }
  };
  MapGen.prototype._carveV = function (y1, y2, x) {
    var lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    for (var y = lo; y <= hi; y++) {
      for (var dx = 0; dx < 2; dx++) {
        var xx = x + dx;
        if (xx >= 1 && xx <= this.W - 2 && y >= 1 && y <= this.H - 2) this.grid[y][xx] = FLOOR;
      }
    }
  };

  MapGen.prototype._carveRooms = function (node) {
    if (!node) return;
    if (node.room) {
      var r = node.room;
      for (var y = r.y; y < r.y + r.h; y++) {
        for (var x = r.x; x < r.x + r.w; x++) {
          if (x >= 1 && x <= this.W - 2 && y >= 1 && y <= this.H - 2) this.grid[y][x] = FLOOR;
        }
      }
      return;
    }
    this._carveRooms(node.a); this._carveRooms(node.b);
  };

  // ============================================================
  //  Level specs (hand tuned)
  // ============================================================
  var SPECS = [
    { id: 1, name: 'First Alarm', type: 'house', W: 14, H: 16, minRoom: 4, rooms: 4,
      fireCounts: { 1: 3 }, victims: 2, barrels: 0, toxic: 0, waters: 1,
      time: 150, water: 100, difficulty: 'Easy',
      hint: 'Rescue every person, put out every fire, then reach the green EXIT.' },

    { id: 2, name: 'Kitchen Blaze', type: 'house', W: 16, H: 18, minRoom: 4, rooms: 4,
      fireCounts: { 1: 3, 2: 1 }, victims: 3, barrels: 0, toxic: 0, waters: 1,
      time: 160, water: 100, difficulty: 'Easy',
      hint: 'Bigger fires need more water. Grab a refill at a water station.' },

    { id: 3, name: 'Apartment Block', type: 'apartment', W: 18, H: 20, minRoom: 4, rooms: 6,
      fireCounts: { 1: 3, 2: 2 }, victims: 4, barrels: 0, toxic: 0, waters: 2,
      time: 180, water: 100, difficulty: 'Medium',
      hint: 'Search every room - trapped people are easy to miss.' },

    { id: 4, name: 'Office Inferno', type: 'office', W: 18, H: 22, minRoom: 4, rooms: 6,
      fireCounts: { 1: 2, 2: 3 }, victims: 4, barrels: 0, toxic: 0, waters: 2,
      time: 180, water: 100, difficulty: 'Medium',
      hint: 'Offices are a maze. Keep one eye on the timer.' },

    { id: 5, name: 'School Evacuation', type: 'school', W: 20, H: 22, minRoom: 4, rooms: 8,
      fireCounts: { 1: 3, 2: 4 }, victims: 5, barrels: 0, toxic: 0, waters: 2,
      time: 200, water: 100, difficulty: 'Medium',
      hint: 'Five students are counting on you. Be quick.' },

    { id: 6, name: 'Warehouse Alert', type: 'warehouse', W: 20, H: 22, minRoom: 4, rooms: 6,
      fireCounts: { 1: 2, 2: 5 }, victims: 5, barrels: 6, toxic: 0, waters: 2,
      time: 200, water: 100, difficulty: 'Hard', noExplosion: true,
      hint: 'Barrels EXPLODE if fire reaches them. Cool them with water!' },

    { id: 7, name: 'Factory Hazard', type: 'factory', W: 22, H: 24, minRoom: 4, rooms: 8,
      fireCounts: { 2: 5, 3: 1 }, victims: 6, barrels: 5, toxic: 4, waters: 2,
      time: 220, water: 100, difficulty: 'Hard', noExplosion: true,
      hint: 'Toxic zones poison you. Barrels explode. Stay sharp.' },

    { id: 8, name: 'High-Rise Rescue', type: 'apartment', W: 22, H: 24, minRoom: 4, rooms: 10,
      fireCounts: { 2: 6, 3: 2 }, victims: 6, barrels: 3, toxic: 0, waters: 3,
      time: 220, water: 100, difficulty: 'Hard',
      hint: 'Many fires burn at once. Prioritise the trapped.' },

    { id: 9, name: 'Industrial Plant', type: 'industrial', W: 24, H: 26, minRoom: 4, rooms: 10,
      fireCounts: { 2: 6, 3: 3 }, victims: 7, barrels: 6, toxic: 5, waters: 3,
      time: 240, water: 100, difficulty: 'Extreme', noExplosion: true,
      hint: 'Everything is on fire. Use water stations wisely.' },

    { id: 10, name: 'The Last Alarm', type: 'industrial', W: 26, H: 28, minRoom: 4, rooms: 12,
      fireCounts: { 2: 6, 3: 4, 4: 1 }, victims: 8, barrels: 8, toxic: 5, waters: 3,
      time: 260, water: 90, difficulty: 'Extreme', noExplosion: true,
      hint: 'The final emergency. Save them all.' },

    // ---- Second tour: levels 11-20 (escalating from Hard to Extreme) ----
    { id: 11, name: 'Hotel Blaze', type: 'hotel', W: 20, H: 24, minRoom: 4, rooms: 8,
      fireCounts: { 2: 6, 3: 2 }, victims: 7, barrels: 0, toxic: 3, waters: 3,
      time: 240, water: 100, difficulty: 'Hard',
      hint: 'Guest floors go up in smoke fast. Keep moving.' },

    { id: 12, name: 'Shopping Mall Fire', type: 'mall', W: 22, H: 24, minRoom: 4, rooms: 10,
      fireCounts: { 2: 6, 3: 3 }, victims: 8, barrels: 4, toxic: 0, waters: 3,
      time: 250, water: 100, difficulty: 'Hard',
      hint: 'Wide open floors mean fires spread across the whole level.' },

    { id: 13, name: 'Subway Inferno', type: 'subway', W: 24, H: 24, minRoom: 4, rooms: 10,
      fireCounts: { 2: 5, 3: 4 }, victims: 8, barrels: 5, toxic: 5, waters: 3,
      time: 260, water: 100, difficulty: 'Extreme', noExplosion: true,
      hint: 'Long tunnels, no shortcuts. Watch the barrels in the dark.' },

    { id: 14, name: 'Hospital Rescue', type: 'hospital', W: 22, H: 26, minRoom: 4, rooms: 10,
      fireCounts: { 2: 6, 3: 4, 4: 1 }, victims: 10, barrels: 0, toxic: 6, waters: 3,
      time: 270, water: 100, difficulty: 'Extreme',
      hint: 'Ten patients. Oxygen and toxic fumes make every room a hazard.' },

    { id: 15, name: 'City Hall', type: 'office', W: 24, H: 26, minRoom: 4, rooms: 12,
      fireCounts: { 2: 7, 3: 4 }, victims: 9, barrels: 6, toxic: 4, waters: 3,
      time: 270, water: 100, difficulty: 'Extreme', noExplosion: true,
      hint: 'A bureaucratic maze. Plan your route before you run dry.' },

    { id: 16, name: 'Airport Terminal', type: 'mall', W: 26, H: 26, minRoom: 4, rooms: 12,
      fireCounts: { 2: 8, 3: 4, 4: 1 }, victims: 10, barrels: 8, toxic: 6, waters: 4,
      time: 290, water: 100, difficulty: 'Extreme', noExplosion: true,
      hint: 'Fuel everywhere. One explosion could cost you the mission.' },

    { id: 17, name: 'Ring of Fire', type: 'industrial', W: 26, H: 28, minRoom: 4, rooms: 12,
      fireCounts: { 3: 8, 4: 2 }, victims: 11, barrels: 10, toxic: 8, waters: 4,
      time: 300, water: 100, difficulty: 'Extreme', noExplosion: true,
      hint: 'Nothing but large fires. Big ones spread on their own.' },

    { id: 18, name: 'Towering Inferno', type: 'apartment', W: 26, H: 28, minRoom: 4, rooms: 14,
      fireCounts: { 3: 9, 4: 3 }, victims: 12, barrels: 6, toxic: 8, waters: 4,
      time: 310, water: 95, difficulty: 'Extreme', noExplosion: true,
      hint: 'Floor after floor of flames. Conserve water.' },

    { id: 19, name: 'Megastructure', type: 'factory', W: 28, H: 30, minRoom: 4, rooms: 14,
      fireCounts: { 3: 10, 4: 3 }, victims: 13, barrels: 10, toxic: 10, waters: 4,
      time: 320, water: 95, difficulty: 'Extreme', noExplosion: true,
      hint: 'The largest site yet. Every barrel you fail to cool is a loss.' },

    { id: 20, name: "Inferno's End", type: 'industrial', W: 28, H: 30, minRoom: 4, rooms: 16,
      fireCounts: { 3: 11, 4: 4 }, victims: 14, barrels: 12, toxic: 10, waters: 5,
      time: 340, water: 90, difficulty: 'Extreme', noExplosion: true,
      hint: 'The last stand. Bring everyone home.' }
  ];

  // ---------- hand-authored tutorial map ----------
  var TUTORIAL_ROWS = [
    '#############',
    '#...........#',
    '#.P....1....#',
    '#...........#',
    '#.....##....#',
    '#.....##....#',
    '#..v........#',
    '#...........#',
    '#.........E.#',
    '#...........#',
    '#############'
  ];

  var TUTORIAL_SPEC = {
    id: 0, name: 'Training Day', type: 'house', W: 13, H: 11, minRoom: 4, rooms: 1,
    fireCounts: { 1: 1 }, victims: 1, barrels: 0, toxic: 0, waters: 0,
    time: 180, water: 100, difficulty: 'Tutorial', tutorial: true,
    hint: 'Follow the on-screen instructions, rookie.'
  };

  // ============================================================
  //  Placement helpers
  // ============================================================
  function roomTiles(room) {
    var out = [];
    for (var y = room.y; y < room.y + room.h; y++) {
      for (var x = room.x; x < room.x + room.w; x++) out.push({ x: x, y: y });
    }
    return out;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Greedily pick `count` tiles spaced >= minDist apart, respecting a filter. */
  function pickSpaced(candidates, count, minDist, rng, filter) {
    shuffle(candidates, rng);
    var picked = [];
    for (var i = 0; i < candidates.length && picked.length < count; i++) {
      var c = candidates[i];
      if (filter && !filter(c)) continue;
      var ok = true;
      for (var j = 0; j < picked.length; j++) {
        var dx = picked[j].x - c.x, dy = picked[j].y - c.y;
        if (Math.sqrt(dx * dx + dy * dy) < minDist) { ok = false; break; }
      }
      if (ok) picked.push(c);
    }
    // relax spacing if we couldn't place enough
    if (picked.length < count) {
      for (var k = 0; k < candidates.length && picked.length < count; k++) {
        var cc = candidates[k];
        if (filter && !filter(cc)) continue;
        var dup = false;
        for (var m = 0; m < picked.length; m++) if (picked[m].x === cc.x && picked[m].y === cc.y) { dup = true; break; }
        if (!dup) picked.push(cc);
      }
    }
    return picked;
  }

  // BFS over floor tiles (treats blocked tiles as impassable)
  function bfs(grid, W, H, start, blocked) {
    var dist = {};
    var q = [start];
    var startKey = start.y * W + start.x;
    dist[startKey] = 0;
    var head = 0;
    while (head < q.length) {
      var c = q[head++];
      var d = dist[c.y * W + c.x];
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var nx = c.x + dirs[i][0], ny = c.y + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (grid[ny][nx] === WALL) continue;
        var k = ny * W + nx;
        if (dist[k] !== undefined) continue;
        if (blocked && blocked[k]) continue;
        dist[k] = d + 1;
        q.push({ x: nx, y: ny });
      }
    }
    return dist;
  }

  function tileOf(world, t) { return Math.floor(world / t); }
  function worldOf(tile) { return tile * TILE; }
  function centerOf(tile) { return (tile + 0.5) * TILE; }

  // ============================================================
  //  Build a playable level object
  // ============================================================
  function buildFromGrid(grid, W, H, spec, rooms) {
    var types = CFG.LEVEL_TYPES[spec.type] || CFG.LEVEL_TYPES.house;
    var level = {
      id: spec.id, spec: spec, name: spec.name, type: spec.type, types: types,
      tile: TILE, W: W, H: H, pxW: W * TILE, pxH: H * TILE,
      grid: grid, rooms: rooms || [],
      spawn: null, exit: null, exitTiles: [],
      fires: [], victims: [], barrels: [], toxic: [], waters: [], props: [],
      dinoSpawns: []
    };
    return level;
  }

  // Compute score thresholds from a realistic "par" for an excellent run.
  function computeThresholds(level, spec, fireCount, victimCount) {
    var S = CFG.SCORE;
    var base = victimCount * S.VICTIM + fireCount * S.FIRE;
    var timeUnit = spec.time * S.TIME_BONUS_PER_SEC;
    var waterUnit = spec.water * S.WATER_BONUS_PER_UNIT;
    // 3 stars: finish with ~45% time, ~35% water and ~90% health remaining
    var star3 = base + timeUnit * 0.45 + waterUnit * 0.35 + 88 * S.HEALTH_BONUS_PER_HP;
    // 2 stars: finish with ~18% time, ~12% water and ~55% health remaining
    var star2 = base + timeUnit * 0.18 + waterUnit * 0.12 + 55 * S.HEALTH_BONUS_PER_HP;
    var maxScore = base + timeUnit + waterUnit + CFG.PLAYER.MAX_HEALTH * S.HEALTH_BONUS_PER_HP;
    level.maxScore = Math.round(maxScore);
    level.star3 = Math.round(star3);
    level.star2 = Math.round(star2);
    return level;
  }

  function placeTutorial(level) {
    var W = level.W, H = level.H;
    var P = { x: 2, y: 2 }, fires = [], victims = [], exit = null;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (level.grid[y][x] === FLOOR && y < TUTORIAL_ROWS.length && x < TUTORIAL_ROWS[y].length) {
          var ch = TUTORIAL_ROWS[y][x];
          if (ch === 'P') P = { x: x, y: y };
          else if (ch === 'E') exit = { x: x, y: y };
          else if (ch === 'v') victims.push({ x: x, y: y });
          else if (ch >= '1' && ch <= '4') fires.push({ x: x, y: y, size: parseInt(ch, 10) });
        }
      }
    }
    level.spawn = { x: centerOf(P.x), y: centerOf(P.y) };
    if (exit) {
      level.grid[exit.y][exit.x] = EXIT;
      level.exitTiles = [{ x: exit.x, y: exit.y }];
      level.exit = { x: centerOf(exit.x), y: centerOf(exit.y), size: TILE * 0.75 };
    }
    level.fires = fires.map(function (f) { return { x: centerOf(f.x), y: centerOf(f.y), size: f.size }; });
    level.victims = victims.map(function (v) { return { x: centerOf(v.x), y: centerOf(v.y) }; });

    computeThresholds(level, level.spec, level.fires.length, level.victims.length);
    return level;
  }

  function populate(level, spec, rng) {
    var W = level.W, H = level.H, grid = level.grid;
    var rooms = level.rooms;

    // --- spawn: room closest to top-left corner ---
    var spawnRoom = rooms[0];
    var bestSpawn = 1e9;
    rooms.forEach(function (r) {
      var c = center(r);
      var d = c.x + c.y;
      if (d < bestSpawn) { bestSpawn = d; spawnRoom = r; }
    });
    var sc = center(spawnRoom);
    // spawn at a corner-ish interior tile of the spawn room
    var spTile = { x: spawnRoom.x, y: spawnRoom.y };
    level.spawn = { x: centerOf(spTile.x), y: centerOf(spTile.y) };

    // --- BFS from spawn ---
    var dist = bfs(grid, W, H, spTile, null);
    function distOf(t) { var d = dist[t.y * W + t.x]; return d === undefined ? 99999 : d; }

    // --- exit: room farthest from spawn ---
    var exitRoom = rooms[0], bestD = -1;
    rooms.forEach(function (r) {
      var c = center(r);
      var d = distOf(c);
      if (d > bestD) { bestD = d; exitRoom = r; }
    });
    var ec = center(exitRoom);
    // put exit on the far edge tile of that room
    var exitTile = { x: Math.max(exitRoom.x, Math.min(exitRoom.x + exitRoom.w - 1, ec.x)), y: ec.y };
    level.grid[exitTile.y][exitTile.x] = EXIT;
    level.exitTiles = [{ x: exitTile.x, y: exitTile.y }];
    level.exit = { x: centerOf(exitTile.x), y: centerOf(exitTile.y), size: TILE * 0.8 };

    // --- candidate tiles (room interiors, away from spawn) ---
    var all = [];
    rooms.forEach(function (r) { all = all.concat(roomTiles(r)); });
    var spawnTile = spTile;

    var nearSpawn = function (t) {
      var dx = t.x - spawnTile.x, dy = t.y - spawnTile.y;
      return Math.sqrt(dx * dx + dy * dy) < 3.2;
    };

    var used = {};
    function mark(t) { used[t.y * W + t.x] = true; }
    function free(t) { return !used[t.y * W + t.x] && !nearSpawn(t) && t.x !== exitTile.x || false; }
    mark(spawnTile); mark(exitTile);

    // --- fires ---
    var fireSizes = [];
    Object.keys(spec.fireCounts).forEach(function (k) {
      for (var i = 0; i < spec.fireCounts[k]; i++) fireSizes.push(parseInt(k, 10));
    });
    var fireTiles = pickSpaced(all.slice(), fireSizes.length, 3.4, rng,
      function (t) { return !used[t.y * W + t.x] && !nearSpawn(t); });
    fireSizes.forEach(function (sz, i) {
      if (!fireTiles[i]) return;
      mark(fireTiles[i]);
      level.fires.push({ x: centerOf(fireTiles[i].x), y: centerOf(fireTiles[i].y), size: sz });
    });

    // --- victims ---
    var vicTiles = pickSpaced(all.slice(), spec.victims, 3.6, rng,
      function (t) { return !used[t.y * W + t.x] && !nearSpawn(t); });
    vicTiles.forEach(function (t) {
      mark(t);
      level.victims.push({ x: centerOf(t.x), y: centerOf(t.y) });
    });

    // --- water stations ---
    var waterTiles = pickSpaced(all.slice(), spec.waters, 6, rng,
      function (t) { return !used[t.y * W + t.x]; });
    waterTiles.forEach(function (t) {
      mark(t);
      level.waters.push({ x: centerOf(t.x), y: centerOf(t.y) });
    });

    // --- barrels (blocking + explosive) ---
    var barrelTiles = pickSpaced(all.slice(), spec.barrels, 3, rng,
      function (t) { return !used[t.y * W + t.x] && !nearSpawn(t); });
    barrelTiles.forEach(function (t) {
      mark(t);
      level.barrels.push({ x: centerOf(t.x), y: centerOf(t.y), r: 16 });
    });

    // --- toxic zones ---
    var toxTiles = pickSpaced(all.slice(), spec.toxic, 5, rng,
      function (t) { return !used[t.y * W + t.x] && !nearSpawn(t); });
    toxTiles.forEach(function (t) {
      mark(t);
      level.toxic.push({ x: centerOf(t.x), y: centerOf(t.y), r: TILE * 1.15 });
    });

    // --- dinosaur spawn plan + candidate spawn tiles ---
    // Predators appear away from the player and inside the map, so they
    // never materialise on top of the player's start position.
    level.dinoPlan = dinoPlan(spec, !!(spec.endless || spec.wave));
    if (level.dinoPlan.enabled) {
      var dinoTiles = pickSpaced(all.slice(), 6, 5.5, rng, function (t) {
        var dx = t.x - spawnTile.x, dy = t.y - spawnTile.y;
        return (dx * dx + dy * dy) > 36 && !used[t.y * W + t.x];
      });
      level.dinoSpawns = dinoTiles.map(function (t) {
        return { x: centerOf(t.x), y: centerOf(t.y) };
      });
    }

    // --- decorative props ---
    var PROPS = {
      house: ['sofa', 'bed', 'table', 'plant', 'tv', 'shelf'],
      apartment: ['bed', 'sofa', 'plant', 'table', 'fridge', 'tv'],
      office: ['desk', 'chair', 'plant', 'copier', 'shelf', 'table'],
      school: ['desk', 'chair', 'board', 'shelf', 'table'],
      warehouse: ['crate', 'box', 'shelf', 'crate', 'forklift'],
      factory: ['machine', 'pipe', 'crate', 'tank', 'pipe'],
      industrial: ['machine', 'tank', 'pipe', 'crate', 'tank']
    };
    var palette = PROPS[spec.type] || PROPS.house;
    rooms.forEach(function (r) {
      var tiles = roomTiles(r);
      var n = Math.min(tiles.length, 1 + Math.floor(rng() * 3));
      var picks = pickSpaced(tiles, n, 2.2, rng, function (t) { return !used[t.y * W + t.x]; });
      picks.forEach(function (t) {
        mark(t);
        level.props.push({
          x: centerOf(t.x) + (rng() - 0.5) * 10,
          y: centerOf(t.y) + (rng() - 0.5) * 10,
          type: palette[Math.floor(rng() * palette.length)],
          seed: rng()
        });
      });
    });

    // --- connectivity validation: ensure objectives reachable ---
    var blocked = {};
    level.barrels.forEach(function (b) { blocked[tileOf(b.y, TILE) * W + tileOf(b.x, TILE)] = true; });
    var reach = bfs(grid, W, H, spTile, blocked);
    function reachable(wx, wy) { return reach[tileOf(wy, TILE) * W + tileOf(wx, TILE)] !== undefined; }

    // If a barrel seals something, remove barrels until all is reachable.
    var guard = 0;
    while (guard++ < level.barrels.length + 2) {
      var need = !reachable(level.exit.x, level.exit.y);
      level.fires.forEach(function (f) { if (!reachable(f.x, f.y)) need = true; });
      level.victims.forEach(function (v) { if (!reachable(v.x, v.y)) need = true; });
      level.waters.forEach(function (w) { if (!reachable(w.x, w.y)) need = true; });
      if (!need) break;
      level.barrels.pop();
      blocked = {};
      level.barrels.forEach(function (b) { blocked[tileOf(b.y, TILE) * W + tileOf(b.x, TILE)] = true; });
      reach = bfs(grid, W, H, spTile, blocked);
    }

    // --- scoring thresholds (use the *initial* fire count from the spec) ---
    var initialFireCount = 0;
    Object.keys(spec.fireCounts).forEach(function (k) { initialFireCount += spec.fireCounts[k]; });
    computeThresholds(level, spec, initialFireCount, level.victims.length);

    return level;
  }

  // ============================================================
  //  Endless mode: infinite waves with escalating difficulty tasks
  // ============================================================
  var ENDLESS_TYPES = ['house', 'apartment', 'office', 'school', 'warehouse',
                       'factory', 'hotel', 'mall', 'subway', 'hospital', 'industrial'];

  // A rotating "difficulty task" that raises the bar each wave.
  function pickTask(wave) {
    var tasks = [
      { key: 'blaze',  label: 'All-out blaze', icon: 'fa-fire',
        desc: 'Extra fires this wave - control the spread.' },
      { key: 'time',   label: 'Against the clock', icon: 'fa-stopwatch',
        desc: 'Tighter timer. Be fast.' },
      { key: 'noBoom', label: 'No explosions', icon: 'fa-bomb',
        desc: 'Zero explosions allowed this wave.' },
      { key: 'noWater', label: 'Sparse water', icon: 'fa-droplet',
        desc: 'Very little water. Refill often.' },
      { key: 'toxic',  label: 'Toxic air', icon: 'fa-biohazard',
        desc: 'Heavy toxic zones everywhere.' }
    ];
    return tasks[(Math.max(1, wave) - 1) % tasks.length];
  }

  /** Deterministic difficulty spec for endless wave `wave` (1-based). */
  function endlessSpec(wave) {
    var E = CFG.ENDLESS;
    wave = Math.max(1, parseInt(wave, 10) || 1);
    var task = pickTask(wave);
    var type = ENDLESS_TYPES[(wave - 1) % ENDLESS_TYPES.length];

    var W = Math.min(E.MAX_W, E.START_W + (wave - 1) * E.GROW);
    var H = Math.min(E.MAX_H, E.START_H + (wave - 1) * E.GROW);
    var rooms = Math.min(E.MAX_ROOMS, E.ROOMS_BASE + Math.floor(wave * E.ROOMS_PER_WAVE));

    var fires = Math.min(E.FIRES_MAX, E.FIRES_BASE + Math.floor(wave * E.FIRES_PER_WAVE));
    var victims = Math.min(E.VICTIMS_MAX, E.VICTIMS_BASE + Math.floor(wave * E.VICTIMS_PER_WAVE));
    var barrels = Math.min(E.BARRELS_MAX, Math.floor(wave * E.BARRELS_PER_WAVE));
    var toxic = Math.min(E.TOXIC_MAX, Math.floor(wave * E.TOXIC_PER_WAVE));
    var waters = Math.min(E.WATERS_MAX, E.WATERS_BASE + Math.floor(wave / 4));

    var time = Math.min(E.TIME_MAX, E.TIME_BASE + (wave - 1) * 9);
    var water = Math.max(E.WATER_MIN, E.WATER_BASE - Math.floor(wave * 0.8));

    // fires get bigger as waves progress
    var fireCounts = {};
    var big = wave >= E.BIG_FIRE_FROM ? Math.floor(fires * 0.35) : 0;
    var large = wave >= E.HUGE_FIRE_FROM ? Math.floor(fires * 0.15) : 0;
    var small = Math.max(0, fires - big - large);
    if (small) fireCounts[1] = small;
    if (big) fireCounts[2] = big;
    if (large) fireCounts[3] = large;
    if (!Object.keys(fireCounts).length) fireCounts[1] = 1;

    // apply the wave's task modifiers
    var noExplosion = false;
    if (task.key === 'time') {
      time = Math.max(E.TIME_MIN, Math.round(time * 0.8));
    } else if (task.key === 'noBoom') {
      noExplosion = true;
      barrels = Math.min(barrels, 4);
    } else if (task.key === 'noWater') {
      water = Math.max(45, Math.round(water * 0.6));
    } else if (task.key === 'toxic') {
      toxic = Math.min(E.TOXIC_MAX, toxic + 4);
    } else if (task.key === 'blaze') {
      fireCounts[1] = (fireCounts[1] || 0) + 3;
    }

    return {
      id: 'E' + wave, wave: wave, endless: true,
      name: 'Endless Wave ' + wave,
      type: type, W: W, H: H, minRoom: 4, rooms: rooms,
      fireCounts: fireCounts, victims: victims,
      barrels: barrels, toxic: toxic, waters: waters,
      time: time, water: water,
      difficulty: 'Endless',
      noExplosion: noExplosion,
      task: task,
      hint: task.desc
    };
  }

  /** Build a playable endless wave. Never throws. */
  function buildEndless(wave) {
    wave = Math.max(1, parseInt(wave, 10) || 1);
    var spec = endlessSpec(wave);
    // Deterministic per wave, distinct from the campaign levels.
    var seed = ((wave * 2654435761) ^ 0x9E3779B1) >>> 0;
    try {
      var gen = new MapGen(seed, spec.W, spec.H, spec.minRoom, spec.rooms);
      var lv = buildFromGrid(gen.grid, spec.W, spec.H, spec, gen.rooms);
      var rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
      return populate(lv, spec, rng);
    } catch (e) {
      var fb = Levels.build(1);
      fb.id = spec.id; fb.wave = wave; fb.endless = true; fb.spec = spec;
      fb.name = spec.name; fb.task = spec.task;
      return fb;
    }
  }

  // ============================================================
  //  Public API
  // ============================================================
  var Levels = {
    WALL: WALL, FLOOR: FLOOR, EXIT: EXIT,
    TUTORIAL: 0,
    count: SPECS.length,

    specs: SPECS,
    tutorialSpec: TUTORIAL_SPEC,

    getSpec: function (id) {
      if (id === 0) return TUTORIAL_SPEC;
      return SPECS[id - 1] || null;
    },

    // ---- Endless mode ----
    endlessSpec: endlessSpec,
    pickTask: pickTask,
    buildEndless: buildEndless,

    // ---- Dinosaurs ----
    dinoPlan: dinoPlan,

    /** Build a fully populated, playable level. Never throws. */
    build: function (id) {
      try {
        id = parseInt(id, 10);
        if (isNaN(id) || id < 0 || id > SPECS.length) id = 1;
        var spec = this.getSpec(id);
        if (!spec) { spec = SPECS[0]; id = 1; }

        var grid, rooms = [];
        if (id === 0) {
          grid = [];
          for (var y = 0; y < TUTORIAL_ROWS.length; y++) {
            var row = [];
            for (var x = 0; x < TUTORIAL_ROWS[y].length; x++) {
              row.push(TUTORIAL_ROWS[y][x] === '#' ? WALL : FLOOR);
            }
            grid.push(row);
          }
          var level = buildFromGrid(grid, TUTORIAL_ROWS[0].length, TUTORIAL_ROWS.length, spec, rooms);
          return placeTutorial(level);
        }

        var rng = mulberry32(7919 * id + 31);
        var gen = new MapGen(7919 * id + 31, spec.W, spec.H, spec.minRoom, spec.rooms);
        var lv = buildFromGrid(gen.grid, spec.W, spec.H, spec, gen.rooms);
        return populate(lv, spec, rng);
      } catch (e) {
        // Absolute fallback: a tiny but valid safe room so the game never crashes.
        var fd = [];
        for (var yy = 0; yy < 12; yy++) {
          var rr = [];
          for (var xx = 0; xx < 12; xx++) rr.push((yy === 0 || xx === 0 || yy === 11 || xx === 11) ? WALL : FLOOR);
          fd.push(rr);
        }
        var fb = buildFromGrid(fd, 12, 12, SPECS[0], []);
        fb.spawn = { x: centerOf(2), y: centerOf(2) };
        fb.grid[9][9] = EXIT;
        fb.exitTiles = [{ x: 9, y: 9 }];
        fb.exit = { x: centerOf(9), y: centerOf(9), size: TILE * 0.8 };
        fb.fires = [{ x: centerOf(6), y: centerOf(6), size: 1 }];
        fb.victims = [{ x: centerOf(4), y: centerOf(8) }];
        fb.maxScore = 4000; fb.star2 = 1800; fb.star3 = 3200;
        fb.error = e && e.message;
        return fb;
      }
    },

    /** Debug helper: verify every level is connected. */
    validateAll: function () {
      var report = [];
      for (var i = 0; i <= SPECS.length; i++) {
        var lv = this.build(i);
        var W = lv.W, H = lv.H, grid = lv.grid;
        var st = { x: tileOf(lv.spawn.x, TILE), y: tileOf(lv.spawn.y, TILE) };
        var blocked = {};
        lv.barrels.forEach(function (b) { blocked[tileOf(b.y, TILE) * W + tileOf(b.x, TILE)] = true; });
        var reach = bfs(grid, W, H, st, blocked);
        var ok = true, issues = [];
        function chk(px, py, label) {
          var k = tileOf(py, TILE) * W + tileOf(px, TILE);
          if (reach[k] === undefined) { ok = false; issues.push(label); }
        }
        chk(lv.exit.x, lv.exit.y, 'exit');
        lv.fires.forEach(function (f, n) { chk(f.x, f.y, 'fire' + n); });
        lv.victims.forEach(function (v, n) { chk(v.x, v.y, 'victim' + n); });
        lv.waters.forEach(function (w, n) { chk(w.x, w.y, 'water' + n); });
        report.push({
          id: lv.id, name: lv.name, W: W, H: H,
          rooms: lv.rooms.length, fires: lv.fires.length, victims: lv.victims.length,
          barrels: lv.barrels.length, waters: lv.waters.length, props: lv.props.length,
          dinos: (lv.dinoSpawns || []).length, dinoEnabled: !!(lv.dinoPlan && lv.dinoPlan.enabled),
          maxScore: lv.maxScore, ok: ok, issues: issues
        });
      }
      return report;
    }
  };

  global.Levels = Levels;
  if (typeof module !== 'undefined' && module.exports) module.exports = Levels;
})(typeof window !== 'undefined' ? window : globalThis);
