/* =========================================================================
 * Sprocket Web Arena — Game Engine (2D top-down tank battles)
 * Depends on: js/parser.js (window.SprocketParser)
 * Entry point: window.SprocketArena
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- utilities */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angleDiff(target, from) {
    var d = (target - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ tank */
  function Tank(spec, id, accent) {
    this.spec = spec;
    this.id = id;                       // 0 = player 1, 1 = player 2 / AI
    this.accent = accent;               // css color for outlines/labels
    this.x = 0; this.y = 0;
    this.heading = 0;                   // radians, 0 = +x (east)
    this.turret = 0;                    // absolute radians
    this.speed = 0;                     // m/s along heading
    this.hp = spec.stats.hp;
    this.alive = true;
    this.selected = 0;
    this.reloads = spec.weapons.map(function () { return 0; });
    this.flash = 0;                     // damage flash timer
    this.recoil = 0;
    this.vel = { x: 0, y: 0 };          // for AI aim prediction
    this.muzzleFlash = 0;
  }

  Tank.prototype.place = function (x, y, heading) {
    this.x = x; this.y = y;
    this.heading = heading;
    this.turret = heading;
  };

  Tank.prototype.forward = function () {
    return { x: Math.cos(this.heading), y: Math.sin(this.heading) };
  };
  Tank.prototype.right = function () {
    return { x: -Math.sin(this.heading), y: Math.cos(this.heading) };
  };

  Tank.prototype.update = function (dt, input, world) {
    if (!this.alive) return;
    var s = this.spec.stats;

    /* drive */
    var throttle = clamp(input.throttle, -1, 1);
    var steer = clamp(input.steer, -1, 1);
    var maxF = s.topSpeed, maxR = s.topSpeed * s.reverseFactor;
    var target = throttle > 0 ? throttle * maxF : throttle * maxR;
    var rate = s.accel * (throttle !== 0 ? 1 : 1.6);
    this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    if (Math.abs(this.speed) < 0.03 && throttle === 0) this.speed = 0;

    /* turn: slightly slower while reversing */
    if (steer !== 0) {
      this.heading += steer * (s.turnRate * Math.PI / 180) * dt * (this.speed < -0.5 ? 0.75 : 1);
    }

    /* move */
    var f = this.forward();
    var nx = this.x + f.x * this.speed * dt;
    var ny = this.y + f.y * this.speed * dt;
    var rad = this.spec.dims.radius * 0.75;
    var hit = resolveCircle(nx, ny, rad, world);
    this.x = clamp(hit.x, rad, world.w - rad);
    this.y = clamp(hit.y, rad, world.h - rad);

    /* turret */
    var wantTurret;
    if (input.aimX != null && input.aimY != null) {
      wantTurret = Math.atan2(input.aimY - this.y, input.aimX - this.x);
    } else {
      wantTurret = this.turret + input.turretSteer * 2 * dt;
    }
    var d = angleDiff(wantTurret, this.turret);
    var maxRot = (s.turretTraverse * Math.PI / 180) * dt;
    this.turret += clamp(d, -maxRot, maxRot);

    /* weapons */
    var self = this;
    this.reloads = this.reloads.map(function (r) { return Math.max(0, r - dt); });
    if (input.switchWeapon) {
      this.selected = (this.selected + 1) % this.spec.weapons.length;
    }
    if (input.fire) this.tryFire(world);

    this.flash = Math.max(0, this.flash - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 6);
  };

  Tank.prototype.tryFire = function (world) {
    var w = this.spec.weapons[this.selected];
    if (!w || this.reloads[this.selected] > 0) return;
    this.reloads[this.selected] = w.reloadS;

    var tf = { x: Math.cos(this.turret), y: Math.sin(this.turret) };
    var tr = { x: -Math.sin(this.turret), y: Math.cos(this.turret) };
    var cx = this.x + tf.x * this.spec.turret.offset[1] + tr.x * this.spec.turret.offset[0];
    var cy = this.y + tf.y * this.spec.turret.offset[1] + tr.y * this.spec.turret.offset[0];
    var mz = w.barrelLengthM + w.origin[1];
    var mx = w.origin[0];
    var px = cx + tf.x * mz + tr.x * mx;
    var py = cy + tf.y * mz + tr.y * mx;

    var spread = ((w.spreadDeg || 1) * Math.PI / 180) * (Math.random() - 0.5);
    var a = this.turret + spread;
    world.shells.push({
      x: px, y: py,
      vx: Math.cos(a) * w.shellSpeed + f2v(this, 'x'),
      vy: Math.sin(a) * w.shellSpeed + f2v(this, 'y'),
      dmg: w.damage, tracer: w.tracer, owner: this, life: 3.2
    });
    this.muzzleFlash = 1;
    this.recoil = 1;
    world.shake = Math.min(6, world.shake + (w.caliber >= 60 ? 3 : 1.2));
  };

  function f2v(tank, k) {
    var f = tank.forward();
    return k === 'x' ? f.x * tank.speed : f.y * tank.speed;
  }

  Tank.prototype.damage = function (amount, world) {
    if (!this.alive) return;
    var dmg = amount * (1 - this.spec.stats.armourPct) * (0.9 + Math.random() * 0.2);
    this.hp -= dmg;
    this.flash = 1;
    for (var i = 0; i < 6; i++) {
      world.particles.push({
        x: this.x, y: this.y,
        vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14,
        life: 0.4 + Math.random() * 0.3, max: 0.7, size: 1.2, color: '#ffca6b'
      });
    }
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false;
      explode(this, world);
    }
  };

  function resolveCircle(x, y, r, world) {
    for (var i = 0; i < world.obstacles.length; i++) {
      var o = world.obstacles[i];
      var cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
      var dx = x - cx, dy = y - cy;
      var d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 === 0) { dx = 1; dy = 0; d2 = 1; }
        var d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        y = cy + (dy / d) * r;
      }
    }
    return { x: x, y: y };
  }

  function pointBlocked(x, y, world) {
    if (x < 0 || y < 0 || x > world.w || y > world.h) return true;
    for (var i = 0; i < world.obstacles.length; i++) {
      var o = world.obstacles[i];
      if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return true;
    }
    return false;
  }

  function losClear(x0, y0, x1, y1, world) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(dist / 2);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (pointBlocked(x0 + dx * t, y0 + dy * t, world)) return false;
    }
    return true;
  }

  function explode(tank, world) {
    for (var i = 0; i < 40; i++) {
      var a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 26;
      world.particles.push({
        x: tank.x, y: tank.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.8, max: 1.3,
        size: 1 + Math.random() * 2.6,
        color: Math.random() < 0.6 ? '#ff9a3d' : (Math.random() < 0.5 ? '#ffe08a' : '#555')
      });
    }
    world.shake = 10;
  }

  /* -------------------------------------------------------------------- AI */
  function AIController(tank, target) {
    this.tank = tank;
    this.target = target;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.noLos = 0;
    this.stuck = 0;
    this.escape = 0;
    this.escapeDir = 1;
    this.switchCd = 0;
    this.input = { throttle: 0, steer: 0, aimX: null, aimY: null, turretSteer: 0, fire: false, switchWeapon: false };
  }

  function rayClearDist(tank, ang, world) {
    var fx = Math.cos(ang), fy = Math.sin(ang);
    for (var d = 2; d <= 20; d += 2) {
      if (pointBlocked(tank.x + fx * d, tank.y + fy * d, world)) return d;
    }
    return 22;
  }

  AIController.prototype.update = function (dt, world) {
    var t = this.tank, e = this.target;
    var input = this.input;
    input.fire = false; input.switchWeapon = false;
    this.switchCd -= dt;
    this.escape = Math.max(0, this.escape - dt);

    if (!t.alive || !e.alive) { input.throttle = 0; input.steer = 0; return input; }

    var dx = e.x - t.x, dy = e.y - t.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var toEnemy = Math.atan2(dy, dx);
    var los = losClear(t.x, t.y, e.x, e.y, world);
    this.noLos = los ? 0 : this.noLos + dt;
    if (this.noLos > 6) { this.orbitDir = -this.orbitDir; this.noLos = 3; }

    /* pick weapon by range */
    var wantSmall = t.spec.weapons.length > 1 && dist < 45;
    var isSmall = t.selected === t.spec.weapons.length - 1;
    if (wantSmall !== isSmall && this.switchCd <= 0) {
      input.switchWeapon = true;
      this.switchCd = 1.5;
    }

    /* desired heading & throttle */
    var want = toEnemy, throttle = 1;
    if (los && this.noLos < 2) {
      if (dist > 80) { throttle = 1; }
      else if (dist < 26) { throttle = -0.8; }
      else { throttle = 0.7; want = toEnemy + Math.PI / 2 * this.orbitDir; }
    } else {
      /* close in to regain line of sight */
      throttle = dist > 30 ? 1 : 0.55;
    }

    /* stuck recovery */
    if (this.escape <= 0) {
      if (t.speed < 0.8 && throttle > 0.3) this.stuck += dt;
      else this.stuck = Math.max(0, this.stuck - dt * 2);
      if (this.stuck > 1.1) {
        this.escape = 1.2;
        this.escapeDir = Math.random() < 0.5 ? 1 : -1;
        this.stuck = 0;
      }
    }
    if (this.escape > 0) {
      input.throttle = -0.7;
      input.steer = this.escapeDir;
    } else {
      /* ray-based obstacle steering */
      var offs = [-0.75, -0.35, 0, 0.35, 0.75];
      var bestScore = -1e9, bestSteer = 0, bestClear = 0;
      for (var i = 0; i < offs.length; i++) {
        var rayAng = t.heading + offs[i];
        var clear = rayClearDist(t, rayAng, world);
        var score = Math.cos(angleDiff(want, rayAng)) * 12 + clear * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestSteer = clamp(angleDiff(rayAng, t.heading) * 3, -1, 1);
          bestClear = clear;
        }
      }
      input.steer = bestSteer;
      input.throttle = clamp(throttle * Math.min(1, bestClear / 10), -0.9, 1);
    }

    /* aim with lead */
    var w = t.spec.weapons[t.selected] || t.spec.weapons[0];
    var travel = dist / Math.max(1, w.shellSpeed);
    input.aimX = e.x + e.vel.x * travel * 0.85;
    input.aimY = e.y + e.vel.y * travel * 0.85;

    var aimAng = Math.atan2(input.aimY - t.y, input.aimX - t.x);
    var aimErr = Math.abs(angleDiff(aimAng, t.turret));
    if (aimErr < 0.09 && t.reloads[t.selected] <= 0 && dist < 170 && los) {
      input.fire = true;
    }
    return input;
  };

  /* ----------------------------------------------------------------- world */
  function makeWorld(seed, specA, specB, mode) {
    var rng = mulberry32(seed);
    var world = {
      w: 220, h: 150, obstacles: [], shells: [], particles: [],
      shake: 0, time: 0, mode: mode, over: false, countdown: 2.2
    };
    var tries = 0;
    var midY = world.h / 2;
    while (world.obstacles.length < 12 && tries++ < 300) {
      var ow = 6 + rng() * 26, oh = 6 + rng() * 26;
      var ox = 14 + rng() * (world.w - 28 - ow);
      var oy = 14 + rng() * (world.h - 28 - oh);
      var ok = true;
      for (var i = 0; i < world.obstacles.length; i++) {
        var o = world.obstacles[i];
        if (ox < o.x + o.w + 14 && ox + ow + 14 > o.x && oy < o.y + o.h + 14 && oy + oh + 14 > o.y) { ok = false; break; }
      }
      /* keep spawn lanes (left and right middle bands) clear */
      var inLeftLane = ox < 52 && oy < midY + 24 && oy + oh > midY - 24;
      var inRightLane = ox + ow > world.w - 52 && oy < midY + 24 && oy + oh > midY - 24;
      if (inLeftLane || inRightLane) ok = false;
      if (ok) world.obstacles.push({ x: ox, y: oy, w: ow, h: oh, tone: rng() });
    }

    var a = new Tank(specA, 0, '#7fd4ff');
    var b = new Tank(specB, 1, '#ff8d7f');
    a.place(24, world.h / 2, 0);
    b.place(world.w - 24, world.h / 2, Math.PI);
    world.tanks = [a, b];
    world.player = a;
    world.enemy = b;
    return world;
  }

  /* ----------------------------------------------------------------- input */
  function KeyState() {
    this.down = {};
    this.pressedOnce = {};
  }
  KeyState.prototype.isDown = function (code) { return !!this.down[code]; };
  KeyState.prototype.consume = function (code) {
    if (this.pressedOnce[code]) { this.pressedOnce[code] = false; return true; }
    return false;
  };

  /* ------------------------------------------------------------------ game */
  function Game(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    this.world = makeWorld(
      (options.seed || 1234) | 0,
      options.playerSpec, options.enemySpec,
      options.mode || 'ai');
    this.keys = new KeyState();
    this.mouse = { x: 0, y: 0, down: false };
    this.running = true;
    this.lastT = 0;
    this.ai = new AIController(this.world.enemy, this.world.player);

    var self = this;
    this._onKeyDown = function (e) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      if (!self.keys.down[e.code]) self.keys.pressedOnce[e.code] = true;
      self.keys.down[e.code] = true;
      if (e.code === 'KeyR' && self.world.over) self.restart();
    };
    this._onKeyUp = function (e) { self.keys.down[e.code] = false; };
    this._onMouseMove = function (e) {
      var r = self.canvas.getBoundingClientRect();
      self.mouse.x = e.clientX - r.left;
      self.mouse.y = e.clientY - r.top;
    };
    this._onMouseDown = function (e) { if (e.button === 0) self.mouse.down = true; };
    this._onMouseUp = function (e) { if (e.button === 0) self.mouse.down = false; };

    global.addEventListener('keydown', this._onKeyDown);
    global.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    global.addEventListener('mouseup', this._onMouseUp);

    this._raf = function (t) { if (self.running) { self.frame(t); requestAnimationFrame(self._raf); } };
    requestAnimationFrame(this._raf);
  }

  Game.prototype.stop = function () {
    this.running = false;
    global.removeEventListener('keydown', this._onKeyDown);
    global.removeEventListener('keyup', this._onKeyUp);
    global.removeEventListener('mouseup', this._onMouseUp);
  };

  Game.prototype.restart = function () {
    var seed = this.options.seed || 1234;
    this.options.seed = (seed + 1) | 0;
    this.world = makeWorld(this.options.seed, this.options.playerSpec, this.options.enemySpec, this.options.mode);
    this.ai = new AIController(this.world.enemy, this.world.player);
    this._lastP1 = null;
    if (this.options.onReset) this.options.onReset();
  };

  /* camera: screen px per meter */
  Game.prototype.camera = function () {
    var w = this.world;
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (w.mode === 'duo') {
      var s = Math.min(cw / (w.w + 12), ch / (w.h + 12));
      return { x: w.w / 2, y: w.h / 2, scale: s };
    }
    var scale = clamp(Math.min(cw / 70, ch / 48), 6, 18);
    var halfW = cw / scale / 2, halfH = ch / scale / 2;
    var cx = clamp(this.world.player.x, halfW, Math.max(halfW, w.w - halfW));
    var cy = clamp(this.world.player.y, halfH, Math.max(halfH, w.h - halfH));
    return { x: cx, y: cy, scale: scale };
  };

  Game.prototype.screenToWorld = function (sx, sy) {
    var cam = this.camera();
    return {
      x: cam.x + (sx - this.canvas.clientWidth / 2) / cam.scale,
      y: cam.y + (sy - this.canvas.clientHeight / 2) / cam.scale
    };
  };

  Game.prototype.readInput = function () {
    var k = this.keys, w = this.world;
    var locked = w.countdown > 0 || w.over;

    var p1 = {
      throttle: (k.isDown('KeyW') ? 1 : 0) + (k.isDown('KeyS') ? -1 : 0),
      steer: (k.isDown('KeyD') ? 1 : 0) + (k.isDown('KeyA') ? -1 : 0),
      aimX: null, aimY: null, turretSteer: 0,
      fire: this.mouse.down || k.isDown('Space'),
      switchWeapon: k.consume('Digit1') || k.consume('Digit2')
    };
    var m = this.screenToWorld(this.mouse.x, this.mouse.y);
    if (!locked) { p1.aimX = m.x; p1.aimY = m.y; }

    var p2 = null;
    if (w.mode === 'duo') {
      p2 = {
        throttle: (k.isDown('ArrowUp') ? 1 : 0) + (k.isDown('ArrowDown') ? -1 : 0),
        steer: (k.isDown('ArrowRight') ? 1 : 0) + (k.isDown('ArrowLeft') ? -1 : 0),
        aimX: null, aimY: null,
        turretSteer: (k.isDown('Period') ? 1 : 0) + (k.isDown('Comma') ? -1 : 0),
        fire: k.isDown('Slash') || k.isDown('ShiftRight'),
        switchWeapon: k.consume('KeyN')
      };
    }
    return { p1: p1, p2: p2, locked: locked };
  };

  Game.prototype.frame = function (tms) {
    var dt = clamp((tms - this.lastT) / 1000 || 0.016, 0.001, 0.05);
    this.lastT = tms;
    var w = this.world;
    w.time += dt;

    if (w.countdown > 0) w.countdown -= dt;

    var inputs = this.readInput();
    var p1 = inputs.p1, p2 = inputs.p2;

    if (!inputs.locked) {
      w.player.update(dt, p1, w);
      if (w.mode === 'duo' && p2) {
        w.enemy.update(dt, p2, w);
      } else if (w.mode === 'ai') {
        w.enemy.update(dt, this.ai.update(dt, w), w);
      }
    } else {
      w.player.update(dt, { throttle: 0, steer: 0, turretSteer: 0, fire: false, switchWeapon: false, aimX: null, aimY: null }, w);
      w.enemy.update(dt, { throttle: 0, steer: 0, turretSteer: 0, fire: false, switchWeapon: false, aimX: null, aimY: null }, w);
    }

    /* velocities for AI prediction */
    if (!this._lastP1) this._lastP1 = { x: w.player.x, y: w.player.y };
    w.player.vel.x = (w.player.x - this._lastP1.x) / dt;
    w.player.vel.y = (w.player.y - this._lastP1.y) / dt;
    this._lastP1 = { x: w.player.x, y: w.player.y };

    /* shells */
    for (var i = w.shells.length - 1; i >= 0; i--) {
      var s = w.shells[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      var dead = s.life <= 0 || s.x < 0 || s.y < 0 || s.x > w.w || s.y > w.h;
      if (!dead && pointBlocked(s.x, s.y, w)) {
        dead = true;
        for (var p = 0; p < 5; p++) {
          w.particles.push({
            x: s.x, y: s.y, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16,
            life: 0.3, max: 0.3, size: 0.9, color: '#cfc9b8'
          });
        }
      }
      if (!dead) {
        for (var ti = 0; ti < w.tanks.length; ti++) {
          var tk = w.tanks[ti];
          if (tk === s.owner || !tk.alive) continue;
          var ddx = s.x - tk.x, ddy = s.y - tk.y;
          /* hit test in hull-local frame (oriented box) */
          var fwd = tk.forward(), rgt = tk.right();
          var lx = ddx * fwd.x + ddy * fwd.y;
          var ly = ddx * rgt.x + ddy * rgt.y;
          var hl = tk.spec.dims.lengthM / 2 + 0.25;
          var hw = tk.spec.dims.widthM / 2 + 0.25;
          if (Math.abs(lx) < hl && Math.abs(ly) < hw) {
            tk.damage(s.dmg, w);
            dead = true;
            break;
          }
        }
      }
      if (dead) w.shells.splice(i, 1);
    }

    /* particles */
    for (var q = w.particles.length - 1; q >= 0; q--) {
      var pt = w.particles[q];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
      pt.life -= dt;
      if (pt.life <= 0) w.particles.splice(q, 1);
    }

    w.shake = Math.max(0, w.shake - dt * 14);

    /* win check */
    if (!w.over && (w.countdown <= 0)) {
      if (!w.player.alive || !w.enemy.alive) {
        w.over = true;
        if (this.options.onGameOver) {
          this.options.onGameOver(!w.player.alive ? 'enemy' : 'player');
        }
      }
    }

    this.render();
    if (this.options.onFrame) this.options.onFrame(w);
  };

  /* --------------------------------------------------------------- render */
  Game.prototype.render = function () {
    var canvas = this.canvas, ctx = this.ctx, w = this.world;
    var dpr = global.devicePixelRatio || 1;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr; canvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#141712';
    ctx.fillRect(0, 0, cw, ch);

    var cam = this.camera();
    var sh = w.shake;
    var shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;

    ctx.save();
    ctx.translate(cw / 2 + shx, ch / 2 + shy);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    /* ground */
    ctx.fillStyle = '#3b4232';
    ctx.fillRect(0, 0, w.w, w.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.12;
    for (var gx = 0; gx <= w.w; gx += 10) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, w.h); ctx.stroke(); }
    for (var gy = 0; gy <= w.h; gy += 10) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w.w, gy); ctx.stroke(); }

    /* obstacles */
    for (var i = 0; i < w.obstacles.length; i++) {
      var o = w.obstacles[i];
      var tone = 0.18 + o.tone * 0.1;
      ctx.fillStyle = 'rgba(' + Math.round(40 * tone * 4) + ',' + Math.round(38 * tone * 4) + ',' + Math.round(30 * tone * 4) + ',1)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(o.x, o.y, o.w, 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.3;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }

    /* particles under tanks */
    for (var q = 0; q < w.particles.length; q++) {
      var pt = w.particles[q];
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* tanks */
    for (var t = 0; t < w.tanks.length; t++) drawTank(ctx, w.tanks[t], w);

    /* shells */
    for (var s = 0; s < w.shells.length; s++) {
      var sh2 = w.shells[s];
      var sp = Math.sqrt(sh2.vx * sh2.vx + sh2.vy * sh2.vy) || 1;
      ctx.strokeStyle = sh2.tracer;
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      ctx.moveTo(sh2.x, sh2.y);
      ctx.lineTo(sh2.x - sh2.vx / sp * 3.2, sh2.y - sh2.vy / sp * 3.2);
      ctx.stroke();
    }

    /* world border */
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, 0, w.w, w.h);

    ctx.restore();

    /* minimap (single player) */
    if (w.mode !== 'duo') this.renderMinimap(ctx, cw);

    /* countdown */
    if (w.countdown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#ffe9b0';
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      var n = Math.ceil(w.countdown);
      ctx.fillText(n > 0 ? String(n) : 'GO', cw / 2, ch / 2 + 20);
    }
  };

  Game.prototype.renderMinimap = function (ctx, cw) {
    var w = this.world;
    var mw = 130, mh = mw * w.h / w.w;
    var x = cw - mw - 12, y = 12;
    ctx.fillStyle = 'rgba(10,12,8,0.7)';
    ctx.fillRect(x, y, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, mw, mh);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (var i = 0; i < w.obstacles.length; i++) {
      var o = w.obstacles[i];
      ctx.fillRect(x + o.x / w.w * mw, y + o.y / w.h * mh, Math.max(1, o.w / w.w * mw), Math.max(1, o.h / w.h * mh));
    }
    for (var t = 0; t < w.tanks.length; t++) {
      var tk = w.tanks[t];
      if (!tk.alive) continue;
      ctx.fillStyle = tk.accent;
      ctx.beginPath();
      ctx.arc(x + tk.x / w.w * mw, y + tk.y / w.h * mh, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /* ---------------------------------------------------- tank drawing (2D) */
  /* Mesh local coords: mx = width axis, mz = forward axis. Canvas local:
   * +x = forward, +y = right. So point (mx, mz) -> (mz, mx). */
  function pathLoops(ctx, loops) {
    for (var i = 0; i < loops.length; i++) {
      var pts = loops[i];
      ctx.beginPath();
      for (var j = 0; j < pts.length; j++) {
        var px = pts[j][1], py = pts[j][0];
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawTank(ctx, tank, world) {
    var spec = tank.spec;
    ctx.save();
    ctx.translate(tank.x, tank.y);

    if (!tank.alive) {
      /* wreck */
      ctx.globalAlpha = 0.75;
      ctx.rotate(tank.heading);
      ctx.fillStyle = '#23241f';
      ctx.fillRect(-spec.dims.lengthM / 2, -spec.dims.widthM / 2, spec.dims.lengthM, spec.dims.widthM);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    /* selection ring */
    ctx.beginPath();
    ctx.arc(0, 0, spec.dims.radius * 1.05, 0, Math.PI * 2);
    ctx.strokeStyle = tank.accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.14;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.rotate(tank.heading);

    /* tracks */
    var tr = spec.tracks;
    var halfSep = tr.separationM / 2, halfLen = tr.lengthM / 2;
    ctx.fillStyle = spec.color.track;
    [-halfSep, halfSep].forEach(function (side) {
      ctx.fillRect(-halfLen, side - tr.widthM / 2, tr.lengthM, tr.widthM);
    });
    ctx.fillStyle = '#3d3d40';
    [-halfSep, halfSep].forEach(function (side) {
      for (var i = 0; i < tr.wheels.length; i++) {
        ctx.beginPath();
        ctx.arc(tr.wheels[i], side, tr.wheelDiameterM / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    /* hull */
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.fillStyle = spec.color.hull;
    pathLoops(ctx, spec.hull.outline);

    /* turret */
    ctx.save();
    ctx.translate(spec.turret.offset[1], spec.turret.offset[0]);
    ctx.rotate(angleDiff(tank.turret, tank.heading));

    /* barrels */
    for (var i = 0; i < spec.weapons.length; i++) {
      var wpn = spec.weapons[i];
      var bw = Math.max(0.13, wpn.caliber / 1000 * 1.1);
      var bx = wpn.origin[1];
      var by = wpn.origin[0];
      var rec = tank.recoil * 0.22 * (tank.selected === i ? 1 : 0);
      ctx.fillStyle = '#26272a';
      ctx.fillRect(bx - rec, by - bw / 2, wpn.barrelLengthM + 0.35, bw);
      ctx.fillStyle = '#1b1c1f';
      ctx.fillRect(bx - rec + wpn.barrelLengthM + 0.1, by - bw * 0.75, 0.25, bw * 1.5);
    }

    ctx.fillStyle = spec.color.turret;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    pathLoops(ctx, spec.turret.outline);

    /* muzzle flash */
    if (tank.muzzleFlash > 0) {
      var w0 = spec.weapons[tank.selected];
      if (w0) {
        ctx.globalAlpha = tank.muzzleFlash;
        ctx.fillStyle = '#ffe9a0';
        ctx.beginPath();
        var fx = w0.origin[1] + w0.barrelLengthM + 0.45, fy = w0.origin[0];
        ctx.moveTo(fx - 0.4, fy - 0.55);
        ctx.lineTo(fx + 1.6, fy);
        ctx.lineTo(fx - 0.4, fy + 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    /* damage flash overlay */
    if (tank.flash > 0) {
      ctx.globalAlpha = tank.flash * 0.5;
      ctx.fillStyle = '#ff5030';
      ctx.beginPath();
      ctx.arc(0, 0, spec.dims.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    /* labels (screen-aligned) */
    ctx.save();
    ctx.translate(tank.x, tank.y);
    var barW = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-barW / 2, -spec.dims.radius - 2.1, barW, 0.55);
    ctx.fillStyle = tank.accent;
    ctx.fillRect(-barW / 2, -spec.dims.radius - 2.1, barW * (tank.hp / spec.stats.hp), 0.55);
    ctx.font = '0.9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(spec.name, 0, -spec.dims.radius - 2.5);
    ctx.restore();
  }

  /* ------------------------------------------------------ garage preview */
  function drawPreview(canvas, spec) {
    var ctx = canvas.getContext('2d');
    var dpr = global.devicePixelRatio || 1;
    var cw = canvas.clientWidth || 260, ch = canvas.clientHeight || 170;
    if (canvas.width !== cw * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    var bound = Math.max(spec.dims.lengthM + spec.weapons.reduce(function (m, w) { return Math.max(m, w.barrelLengthM + w.origin[1]); }, 0), spec.dims.widthM * 1.6) + 2;
    var scale = Math.min(cw, ch) / bound;

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.rotate(-Math.PI / 2); /* face up */

    var fake = new Tank(spec, 0, '#7fd4ff');
    fake.x = 0; fake.y = 0; fake.heading = 0; fake.turret = 0;
    var emptyWorld = { shells: [], particles: [], obstacles: [] };
    drawTank(ctx, fake, emptyWorld);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(spec.name + ' — ' + spec.massT.toFixed(1) + ' t', 8, ch - 8);
  }

  /* ------------------------------------------------------------- exports */
  var active = null;
  global.SprocketArena = {
    start: function (canvas, options) {
      if (active) active.stop();
      active = new Game(canvas, options);
      return active;
    },
    stop: function () { if (active) active.stop(); active = null; },
    drawPreview: drawPreview
  };

})(typeof window !== 'undefined' ? window : globalThis);