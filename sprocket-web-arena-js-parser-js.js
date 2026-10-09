/* =========================================================================
 * Sprocket Web Arena — Blueprint Parser
 * Converts a Sprocket: Tank Design .blueprint file (plain JSON) into a
 * game-ready tank specification: stats, weapons and a top-down silhouette
 * extracted from the real hull / turret meshes stored in the file.
 * ========================================================================= */
(function (global) {
  'use strict';

  var API = {
    parseText: parseText,   // (jsonString) -> TankSpec
    parse: parse,          // (parsedJsonObject) -> TankSpec
    fallbackSpec: fallbackSpec
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  global.SprocketParser = API;

  /* -------------------------------------------------------------- helpers */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

  function parseText(text) {
    return parse(JSON.parse(text));
  }

  function parse(data) {
    try { return buildSpec(data); }
    catch (e) {
      if (typeof console !== 'undefined') { console.error('SprocketParser failed, using fallback:', e); }
      return fallbackSpec();
    }
  }

  function buildSpec(data) {
    var header = data.header || {};
    var bps = Array.isArray(data.blueprints) ? data.blueprints : [];
    var objects = Array.isArray(data.objects) ? data.objects : [];
    var meshes = Array.isArray(data.meshes) ? data.meshes : [];

    var byType = {}, bpById = {};
    for (var i = 0; i < bps.length; i++) {
      var bp = bps[i];
      if (!byType[bp.type]) byType[bp.type] = [];
      byType[bp.type].push(bp.blueprint || {});
      bpById[bp.id] = bp.blueprint || {};
    }
    var objById = {};
    for (var j = 0; j < objects.length; j++) objById[objects[j].vuid] = objects[j];

    /* ------------------------------------------------------------ identity */
    var massT = Math.max(0.5, num(header.mass, 20000) / 1000);
    var name = header.name || 'Unnamed Tank';
    var description = header.desc || '';

    /* --------------------------------------------------------------- engine */
    var engine = (byType.engine || [])[0] || {};
    var engDisplL = num(engine.cylinders, 0) * num(engine.cylinderDisplacement, 0);
    var engTech = num(engine.tech, 1);
    var maxRPM = num(engine.targetMaxRPM, 3000);
    var estTorque = engDisplL * 62 * engTech;          // rough Nm estimate
    var powerKW = estTorque * (maxRPM / 9549);
    var powerHP = powerKW * 1.341;
    var pwRatio = powerHP / massT;                      // hp per tonne

    var trans = (byType.transmission || [])[0] || {};
    var gears = (trans.d || []).length;

    /* ------------------------------------------------------------- chassis */
    var chassis = (byType.chassis || [])[0] || {};
    var track = (byType.track || [])[0] || {};
    var trackSepM = num(track.separation, num(chassis.width, 2000)) / 1000;
    var trackLenM = num(track.length, num(chassis.length, 5000)) / 1000;

    /* --------------------------------------------------------------- armour */
    var armourVol = 0;
    (byType.structure || []).forEach(function (s) { armourVol += num(s.armourVolume, 0); });
    var armourMass = armourVol * 7.85;                  // RHA density t/m^3
    var armourPct = clamp((armourMass / massT) * 0.55, 0, 0.25);

    /* --------------------------------------------------------------- weapon */
    var weapons = [];
    (byType.cannon || []).forEach(function (c) {
      var caliber = num(c.caliber, 75);
      var psi = num(c.PSI, 45000);
      var k = num(c.K, 1800);
      var breech = num(c.breechLength, 400);
      var segLen = 0;
      (c.segments || []).forEach(function (sg) {
        (sg.segments || []).forEach(function (s2) { segLen += num(s2.l, 0); });
      });
      var shell = c.shellID != null ? (bpById[c.shellID] || {}) : {};
      var barrelLenM = (breech + segLen) / 1000;
      weapons.push({
        name: caliber + ' mm',
        caliber: caliber,
        barrelLengthM: Math.max(1.8, barrelLenM),
        damage: Math.round(Math.pow(caliber / 8, 1.35) * (k / 1800) * Math.sqrt(psi / 45000)),
        reloadS: clamp(Math.pow(caliber / 18, 1.2), 0.9, 10),
        shellSpeed: clamp(Math.sqrt(psi) * (k / 1800) * 0.35, 55, 260),
        tracer: caliber >= 60 ? '#ffd27a' : '#9fe0ff',
        spreadDeg: caliber >= 60 ? 0.8 : 2.2
      });
    });
    weapons.sort(function (a, b) { return b.caliber - a.caliber; });
    if (!weapons.length) weapons.push(defaultWeapon());

    /* ------------------------------------------------------------- geometry */
    var meshById = {};
    meshes.forEach(function (m) { meshById[m.vuid] = m; });

    // Hull: the root object carrying a structure blueprint.
    var hullMeshId = null;
    for (var key in objById) {
      var o = objById[key];
      if (o.pvuid === -1 && o.structureBlueprintVuid != null) {
        var sb = bpById[o.structureBlueprintVuid] || {};
        if (sb.bodyMeshVuid != null) hullMeshId = sb.bodyMeshVuid;
      }
    }
    // Turret: chain  ring object -> turret structure object -> its mesh.
    var ringObj = null;
    objects.forEach(function (o) { if (o.turretRing != null && !ringObj) ringObj = o; });
    var turretStructObj = ringObj && ringObj.structureID != null ? objById[ringObj.structureID] : null;
    var turretMeshId = null;
    if (turretStructObj && turretStructObj.structureBlueprintVuid != null) {
      var tsb = bpById[turretStructObj.structureBlueprintVuid] || {};
      if (tsb.bodyMeshVuid != null) turretMeshId = tsb.bodyMeshVuid;
    }

    // Fallbacks: biggest / second biggest meshes.
    var meshAreas = {};
    meshes.forEach(function (m) {
      var md = m.meshData || {};
      var mm = md.mesh || {};
      var v = mm.vertices || [];
      var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (var i = 0; i + 2 < v.length; i += 3) {
        if (v[i] < minX) minX = v[i]; if (v[i] > maxX) maxX = v[i];
        if (v[i + 2] < minZ) minZ = v[i + 2]; if (v[i + 2] > maxZ) maxZ = v[i + 2];
      }
      meshAreas[m.vuid] = (maxX - minX) * (maxZ - minZ);
    });
    if (hullMeshId == null || !meshById[hullMeshId]) {
      var best = null;
      meshes.forEach(function (m) { if (best === null || meshAreas[m.vuid] > meshAreas[best]) best = m.vuid; });
      hullMeshId = best;
    }
    if (turretMeshId == null || !meshById[turretMeshId] || turretMeshId === hullMeshId) {
      var second = null;
      meshes.forEach(function (m) {
        if (m.vuid === hullMeshId) return;
        if (second === null || meshAreas[m.vuid] > meshAreas[second]) second = m.vuid;
      });
      turretMeshId = second;
    }

    var hull = hullMeshId != null ? meshById[hullMeshId] : null;
    var turret = turretMeshId != null ? meshById[turretMeshId] : null;

    var hullOutline = hull ? outlineFromMesh(hull.meshData.mesh, null) : null;
    var hullCenter = hullOutline ? hullOutline.center : [0, 0];

    var turretOutline = turret ? outlineFromMesh(turret.meshData.mesh, null) : null;
    var turretOffset = [0, 0.35];
    if (ringObj && ringObj.transform) {
      var p = ringObj.transform.pos || [0, 0, 0];
      turretOffset = [num(p[0], 0) - hullCenter[0], num(p[2], 0) - hullCenter[1]];
    }

    // Gun mount (mantlet) position, relative to the turret.
    var gunOrigin = [0, 0.55];
    if (turretStructObj) {
      var mantlet = findMantlet(objects, objById, turretStructObj.vuid);
      if (mantlet) {
        var acc = [0, 0], cur = mantlet, guard = 0;
        while (cur && cur.vuid !== turretStructObj.vuid && cur.pvuid !== -1 && guard++ < 12) {
          var tp = (cur.transform && cur.transform.pos) || [0, 0, 0];
          acc[0] += num(tp[0], 0); acc[1] += num(tp[2], 0);
          cur = objById[cur.pvuid];
        }
        gunOrigin = [clamp(acc[0], -1.2, 1.2), clamp(acc[1], 0.25, 1.6)];
      }
    }

    // Spread multiple barrels side by side around the mount.
    var spread = 0.45;
    weapons.forEach(function (w, idx) {
      w.origin = [
        gunOrigin[0] + (idx - (weapons.length - 1) / 2) * spread,
        gunOrigin[1]
      ];
    });

    /* ---------------------------------------------------------------- paint */
    var paint = (byType.paintJob || []).find(function (p) { return (p.name || '') === 'Primary'; }) ||
                (byType.paintJob || [])[0] || {};
    var hullColor = shadeColor(paint, 0.95);
    var turretColor = shadeColor(paint, 0.78);

    /* ---------------------------------------------------------------- stats */
    var dims = hullOutline ? hullOutline.size : [2.5, 5.5];
    var stats = {
      hp: Math.round(massT * 3 + armourMass * 2),
      massT: massT,
      powerHP: Math.round(powerHP),
      pwRatio: pwRatio,
      topSpeed: clamp(pwRatio * 1.0, 4.5, 22),           // m/s
      accel: clamp(pwRatio * 0.28, 1.2, 7),              // m/s^2
      reverseFactor: 0.45,
      turnRate: clamp(42 * Math.pow(20 / massT, 0.25), 12, 55), // deg/s
      turretTraverse: 30,
      armourPct: armourPct,
      gears: gears
    };
    var motor = (byType.motor || [])[0] || {};
    stats.turretTraverse = clamp(num(motor.torque, 600) / num(motor.ratio, 30), 6, 55);

    return {
      name: name,
      description: description,
      massT: massT,
      cost: num(header.cost, 0),
      stock: false,
      color: { hull: hullColor, turret: turretColor, track: '#2b2b2e' },
      dims: { lengthM: dims[1], widthM: dims[0], radius: Math.max(dims[0], dims[1]) * 0.5 },
      hull: { outline: hullOutline ? hullOutline.loops : [] },
      turret: { outline: turretOutline ? turretOutline.loops : [], offset: turretOffset },
      tracks: {
        lengthM: trackLenM,
        separationM: trackSepM,
        widthM: clamp(maxWheelWidth(byType.trackWheel) + 0.14, 0.4, 0.9),
        wheels: wheelPositions(byType.trackWheelArray, trackLenM).map(function (z) {
          return z - hullCenter[1];
        }),
        wheelDiameterM: clamp(maxWheelDiameter(byType.trackWheel), 0.3, 1.0)
      },
      weapons: weapons,
      stats: stats
    };
  }

  /* ------------------------------------------------------ mesh -> outline */
  function outlineFromMesh(mesh, _ignored) {
    var verts = mesh.vertices || [];
    var faces = (mesh.faces || []).map(function (f) { return f.v || []; }).filter(function (f) { return f.length >= 3; });
    if (!verts.length) return null;

    var count = new Map(), adj = new Map();
    faces.forEach(function (f) {
      for (var i = 0; i < f.length; i++) {
        var a = f[i], b = f[(i + 1) % f.length];
        var k = a < b ? a * 1000000 + b : b * 1000000 + a;
        count.set(k, (count.get(k) || 0) + 1);
      }
    });
    count.forEach(function (c, k) {
      if (c !== 1) return;
      var a = Math.floor(k / 1000000), b = k % 1000000;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    });

    var loops = [];
    var visited = new Set();
    adj.forEach(function (_nb, start) {
      if (visited.has(start)) return;
      var loop = [start], cur = start, prev = null, guard = 0;
      visited.add(start);
      while (guard++ < 10000) {
        var nb = (adj.get(cur) || []).filter(function (n) { return n !== prev; });
        var next = nb.find(function (n) { return !visited.has(n); });
        if (next === undefined) break;
        loop.push(next); visited.add(next); prev = cur; cur = next;
      }
      if (loop.length >= 3) loops.push(loop.map(function (vi) { return [verts[vi * 3], verts[vi * 3 + 2]]; }));
    });

    if (!loops.length) loops = [convexHull(verts)];

    // Keep loops by |area| descending; drop degenerate slivers.
    loops = loops.map(function (pts) { return { pts: pts, area: Math.abs(shoelace(pts)) }; })
      .filter(function (l) { return l.area > 1e-6; })
      .sort(function (a, b) { return b.area - a.area; })
      .map(function (l) { return l.pts; });
    if (!loops.length) loops = [convexHull(verts)];

    // Center on bounding box.
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    loops.forEach(function (pts) {
      pts.forEach(function (p) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
      });
    });
    var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    loops.forEach(function (pts) {
      pts.forEach(function (p) { p[0] -= cx; p[1] -= cz; });
    });
    return { loops: loops, center: [cx, cz], size: [maxX - minX, maxZ - minZ] };
  }

  function convexHull(verts) {
    var pts = [];
    for (var i = 0; i + 2 < verts.length; i += 3) pts.push([verts[i], verts[i + 2]]);
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lower = [], upper = [], l, u;
    for (l = 0; l < pts.length; l++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[l]) <= 0) lower.pop(); lower.push(pts[l]); }
    for (u = pts.length - 1; u >= 0; u--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[u]) <= 0) upper.pop(); upper.push(pts[u]); }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function shoelace(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /* ------------------------------------------------------------ sub-parts */
  function findMantlet(objects, objById, turretStructVuid) {
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (o.mantlet == null) continue;
      var cur = o, guard = 0;
      while (cur && cur.pvuid !== -1 && guard++ < 16) {
        if (cur.pvuid === turretStructVuid) return o;
        cur = objById[cur.pvuid];
      }
    }
    return null;
  }

  function maxWheelWidth(wheels) {
    var w = 0.3;
    (wheels || []).forEach(function (x) { w = Math.max(w, num(x.width, 0)); });
    return w;
  }
  function maxWheelDiameter(wheels) {
    var d = 0.6;
    (wheels || []).forEach(function (x) { d = Math.max(d, num(x.diameter, 0)); });
    return d;
  }
  function wheelPositions(arrays, trackLenM) {
    // Largest road-wheel array, spread evenly along the track.
    var best = null, bestCount = 0;
    (arrays || []).forEach(function (a) {
      var c = num(a.count, 0) * (num(a.perGroup, 1) || 1);
      if (c > bestCount) { bestCount = c; best = a; }
    });
    var n = clamp(bestCount, 3, 10);
    var half = trackLenM / 2, out = [];
    for (var i = 0; i < n; i++) {
      out.push(-half + (n === 1 ? half : (trackLenM * i / (n - 1))));
    }
    return out;
  }

  function defaultWeapon() {
    return {
      name: '75 mm', caliber: 75, barrelLengthM: 3.4,
      damage: 19, reloadS: 6.0, shellSpeed: 90, tracer: '#ffd27a', spreadDeg: 0.8,
      origin: [0, 0.55]
    };
  }

  function shadeColor(paint, mul) {
    var r = num(paint.r, 0.5), g = num(paint.g, 0.5), b = num(paint.b, 0.5);
    var sat = clamp(num(paint.saturation, 0.5), 0, 1);
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    function ch(c) { var v = (lum + (c - lum) * sat) * mul; return Math.round(clamp(v, 0, 1) * 255); }
    return 'rgb(' + ch(r) + ',' + ch(g) + ',' + ch(b) + ')';
  }

  /* ------------------------------------------------------- fallback tank */
  function fallbackSpec(name) {
    var outline = [[-1.05, -2.3], [1.05, -2.3], [1.05, 2.3], [-1.05, 2.3]];
    var turretOutline = [[-0.7, -0.75], [0.7, -0.75], [0.7, 0.9], [-0.7, 0.9]];
    var weapon = defaultWeapon();
    return {
      name: name || 'Stock Tank',
      description: 'Generic opponent (no blueprint loaded)',
      massT: 20, cost: 0, stock: true,
      color: { hull: 'rgb(96,102,88)', turret: 'rgb(76,82,70)', track: '#2b2b2e' },
      dims: { lengthM: 4.6, widthM: 2.1, radius: 2.3 },
      hull: { outline: [outline] },
      turret: { outline: [turretOutline], offset: [0, 0.1] },
      tracks: { lengthM: 4.4, separationM: 2.0, widthM: 0.5, wheels: [-1.6, -0.8, 0, 0.8, 1.6], wheelDiameterM: 0.7 },
      weapons: [weapon],
      stats: {
        hp: 65, massT: 20, powerHP: 380, pwRatio: 19, topSpeed: 14, accel: 4,
        reverseFactor: 0.45, turnRate: 38, turretTraverse: 32, armourPct: 0.15, gears: 6
      }
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);