<?php
/**
 * Sprocket Web Arena — main page
 * Serve with:  php -S 0.0.0.0:8080   (from the repository root)
 * Friends on the same network then visit http://<your-LAN-IP>:8080
 */
function sprocket_lan_ip() {
    $candidates = array();
    if (function_exists('gethostname')) {
        $hn = @gethostname();
        if ($hn) {
            $ip = @gethostbyname($hn);
            if ($ip && $ip !== $hn) $candidates[] = $ip;
        }
    }
    if (!empty($_SERVER['SERVER_ADDR'])) $candidates[] = $_SERVER['SERVER_ADDR'];
    $lan = '';
    foreach ($candidates as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP)) continue;
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE) === false) return $ip; // private LAN address
        if ($lan === '') $lan = $ip;
    }
    return $lan;
}
$lanIp = sprocket_lan_ip();
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprocket Web Arena</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>

<header>
  <div class="brand">
    <span class="brand-mark">⚙</span>
    <div>
      <h1>Sprocket Web Arena</h1>
      <p class="tagline">Upload your Sprocket tank blueprints and duel — no install, just a browser.</p>
    </div>
  </div>
  <?php if ($lanIp): ?>
  <div class="lan-note">
    <span class="lan-label">LAN</span>
    Friends on your network can join at
    <code>http://<?php echo htmlspecialchars($lanIp, ENT_QUOTES); ?>:8080</code>
  </div>
  <?php endif; ?>
</header>

<main>
  <!-- ======================= GARAGE ======================= -->
  <section class="panel" id="garage">
    <h2>Garage</h2>

    <div class="upload-box" id="dropZone">
      <input type="file" id="tankFile" accept=".blueprint,.json">
      <p class="hint">Drop or pick a <code>.blueprint</code> file from
        <code>Documents\My Games\Sprocket\Factions\...\Blueprints\Vehicles</code></p>
      <p id="uploadStatus" class="status"></p>
    </div>

    <div class="preview-wrap">
      <canvas id="previewCanvas"></canvas>
    </div>

    <div id="tankStats" class="stats hidden">
      <h3 id="statName">—</h3>
      <p class="tank-desc" id="statDesc"></p>
      <div class="stat-grid">
        <div><span>Mass</span><b id="stMass">–</b></div>
        <div><span>Power</span><b id="stPower">–</b></div>
        <div><span>Top speed</span><b id="stSpeed">–</b></div>
        <div><span>Hull points</span><b id="stHp">–</b></div>
        <div><span>Armour</span><b id="stArmour">–</b></div>
        <div><span>Turret speed</span><b id="stTraverse">–</b></div>
      </div>
      <div class="weapons" id="stWeapons"></div>
      <button id="saveBtn" class="btn">Save to server tank pool</button>
    </div>

    <h3>Server tank pool</h3>
    <p class="hint">Tanks saved here are shared with everyone on the network — load one as yours, or as the opponent.</p>
    <div id="serverList" class="server-list"><p class="hint dim">Loading…</p></div>
    <button id="refreshBtn" class="btn ghost">Refresh list</button>
  </section>

  <!-- ======================= ARENA ======================= -->
  <section class="panel wide" id="arenaPanel">
    <h2>Battle</h2>

    <div class="mode-row">
      <label><input type="radio" name="mode" value="ai" checked> vs AI</label>
      <label><input type="radio" name="mode" value="duo"> Local 2-player (one keyboard)</label>
      <button id="startBtn" class="btn primary">▶ Start battle</button>
    </div>

    <div id="arena">
      <canvas id="gameCanvas"></canvas>
      <div id="hud">
        <div class="hud-card" id="hudP1">
          <div class="hud-name" id="hudP1Name">Player</div>
          <div class="bar hp"><div id="hudP1Hp"></div></div>
          <div class="hud-weapons" id="hudP1Weapons"></div>
          <div class="hud-speed" id="hudP1Speed">0 km/h</div>
        </div>
        <div class="hud-card right" id="hudP2">
          <div class="hud-name" id="hudP2Name">Enemy</div>
          <div class="bar hp"><div id="hudP2Hp"></div></div>
        </div>
      </div>
      <div id="overlay" class="hidden">
        <div id="overlayText"></div>
        <div class="overlay-hint">Press <b>R</b> for a rematch on a new map</div>
      </div>
    </div>

    <div class="controls">
      <div class="ctrl-group">
        <h4>Player 1</h4>
        <ul>
          <li><b>W / S</b> — throttle / reverse</li>
          <li><b>A / D</b> — steer</li>
          <li><b>Mouse</b> — aim turret</li>
          <li><b>LMB / Space</b> — fire</li>
          <li><b>1 / 2</b> — switch weapon</li>
        </ul>
      </div>
      <div class="ctrl-group">
        <h4>Player 2 (local mode)</h4>
        <ul>
          <li><b>↑ / ↓</b> — throttle / reverse</li>
          <li><b>← / →</b> — steer</li>
          <li><b>, / .</b> — rotate turret</li>
          <li><b>/ or R-Shift</b> — fire</li>
          <li><b>N</b> — switch weapon</li>
        </ul>
      </div>
      <div class="ctrl-group">
        <h4>Match</h4>
        <ul>
          <li><b>R</b> — new map rematch</li>
          <li>Stats come from your blueprint: mass, engine power, armour, guns.</li>
        </ul>
      </div>
    </div>
  </section>
</main>

<footer>
  <p>Fan project for Sprocket: Tank Design. Blueprint files are parsed in your browser; saved tanks are stored in <code>data/tanks/</code> on the host.</p>
</footer>

<script src="js/parser.js"></script>
<script src="js/game.js"></script>
<script>
(function () {
  'use strict';

  var playerSpec = null, enemySpec = null, game = null;
  var els = {
    file: document.getElementById('tankFile'),
    status: document.getElementById('uploadStatus'),
    stats: document.getElementById('tankStats'),
    preview: document.getElementById('previewCanvas'),
    saveBtn: document.getElementById('saveBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    serverList: document.getElementById('serverList'),
    startBtn: document.getElementById('startBtn'),
    canvas: document.getElementById('gameCanvas'),
    overlay: document.getElementById('overlay'),
    overlayText: document.getElementById('overlayText'),
    dropZone: document.getElementById('dropZone')
  };

  /* ------------------------------------------------ blueprint loading */
  function loadBlueprintText(text, source) {
    var spec;
    try {
      spec = SprocketParser.parseText(text);
    } catch (e) {
      els.status.textContent = 'Could not parse ' + source + ': ' + e.message;
      els.status.className = 'status error';
      return;
    }
    if (spec.stock) {
      els.status.textContent = 'Parsed ' + source + ', but it looked incomplete — using a stock tank.';
      els.status.className = 'status warn';
    } else {
      els.status.textContent = 'Loaded "' + spec.name + '" (' + spec.massT.toFixed(1) + ' t) from ' + source + '.';
      els.status.className = 'status ok';
    }
    playerSpec = spec;
    showSpec(spec);
  }

  function showSpec(spec) {
    els.stats.classList.remove('hidden');
    document.getElementById('statName').textContent = spec.name;
    document.getElementById('statDesc').textContent = spec.description || '';
    document.getElementById('stMass').textContent = spec.massT.toFixed(1) + ' t';
    document.getElementById('stPower').textContent = spec.stats.powerHP + ' hp (' + spec.stats.pwRatio.toFixed(0) + ' hp/t)';
    document.getElementById('stSpeed').textContent = (spec.stats.topSpeed * 3.6).toFixed(0) + ' km/h';
    document.getElementById('stHp').textContent = spec.stats.hp;
    document.getElementById('stArmour').textContent = (spec.stats.armourPct * 100).toFixed(0) + '% reduction';
    document.getElementById('stTraverse').textContent = spec.stats.turretTraverse.toFixed(0) + '°/s';
    var w = '';
    spec.weapons.forEach(function (wpn) {
      w += '<span class="weapon-chip">' + wpn.name + ' · ' + wpn.damage + ' dmg · ' + wpn.reloadS.toFixed(1) + 's</span>';
    });
    document.getElementById('stWeapons').innerHTML = w;
    SprocketArena.drawPreview(els.preview, spec);
  }

  els.file.addEventListener('change', function () {
    var f = els.file.files && els.file.files[0];
    if (!f) return;
    readAndLoad(f);
  });

  function readAndLoad(f) {
    var reader = new FileReader();
    reader.onload = function () { loadBlueprintText(String(reader.result), f.name); };
    reader.onerror = function () {
      els.status.textContent = 'Could not read file.';
      els.status.className = 'status error';
    };
    reader.readAsText(f);
  }

  /* drag & drop (extension is irrelevant — content is JSON) */
  ['dragover', 'dragenter'].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) { e.preventDefault(); els.dropZone.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) { e.preventDefault(); els.dropZone.classList.remove('over'); });
  });
  els.dropZone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readAndLoad(f);
  });

  /* ------------------------------------------------ server tank pool */
  function refreshServerList() {
    fetch('api.php?action=list').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) throw new Error(data.error || 'list failed');
      renderServerList(data.tanks || []);
    }).catch(function (e) {
      els.serverList.innerHTML = '<p class="hint dim">Server pool unavailable (' + e.message + '). You can still play with locally uploaded tanks.</p>';
    });
  }

  function renderServerList(tanks) {
    if (!tanks.length) {
      els.serverList.innerHTML = '<p class="hint dim">No tanks saved yet. Upload a blueprint above and hit “Save to server tank pool”.</p>';
      return;
    }
    var html = '';
    tanks.forEach(function (t) {
      html += '<div class="server-row" data-file="' + t.file + '">' +
        '<div class="server-name"><b>' + escapeHtml(t.name) + '</b><span class="dim">' + t.massT + ' t · ' + t.guns + ' gun(s)</span></div>' +
        '<div class="server-actions">' +
        '<button class="btn small" data-act="player">Use as my tank</button>' +
        '<button class="btn small ghost" data-act="enemy">Use as opponent</button>' +
        '<button class="btn small danger" data-act="delete">×</button>' +
        '</div></div>';
    });
    els.serverList.innerHTML = html;
  }

  els.serverList.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var row = e.target.closest('.server-row');
    var file = row && row.getAttribute('data-file');
    var act = btn.getAttribute('data-act');
    if (act === 'delete') {
      fetch('api.php?action=delete&name=' + encodeURIComponent(file), { method: 'POST' })
        .then(function () { refreshServerList(); });
      return;
    }
    fetch('api.php?action=get&name=' + encodeURIComponent(file))
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var spec = SprocketParser.parseText(text);
        if (act === 'player') { playerSpec = spec; showSpec(spec); }
        else { enemySpec = spec; }
        els.status.textContent = '"' + spec.name + '" loaded as ' + (act === 'player' ? 'your tank' : 'the opponent') + '.';
        els.status.className = 'status ok';
      });
  });

  els.refreshBtn.addEventListener('click', refreshServerList);

  els.saveBtn.addEventListener('click', function () {
    var f = els.file.files && els.file.files[0];
    if (!f) {
      els.status.textContent = 'Pick a blueprint file first, then save.';
      els.status.className = 'status warn';
      return;
    }
    var fd = new FormData();
    fd.append('tank', f, f.name);
    els.saveBtn.disabled = true;
    fetch('api.php?action=save', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        els.saveBtn.disabled = false;
        if (data.ok) {
          els.status.textContent = 'Saved "' + data.name + '" to the server pool.';
          els.status.className = 'status ok';
          refreshServerList();
        } else {
          els.status.textContent = 'Save failed: ' + data.error;
          els.status.className = 'status error';
        }
      })
      .catch(function (e) {
        els.saveBtn.disabled = false;
        els.status.textContent = 'Save failed: ' + e.message;
        els.status.className = 'status error';
      });
  });

  /* ------------------------------------------------ battle lifecycle */
  function startGame() {
    var modeEl = document.querySelector('input[name="mode"]:checked');
    var mode = modeEl ? modeEl.value : 'ai';
    var pSpec = playerSpec || SprocketParser.fallbackSpec('Recruit Tank');
    var eSpec = enemySpec || SprocketParser.fallbackSpec(mode === 'duo' ? 'Challenger Tank' : 'Stock Opponent');

    els.overlay.classList.add('hidden');
    game = SprocketArena.start(els.canvas, {
      mode: mode,
      playerSpec: pSpec,
      enemySpec: eSpec,
      seed: (Date.now() % 99991) | 0,
      onGameOver: function (who) {
        els.overlayText.textContent = who === 'player' ? 'Victory! Enemy destroyed.' : 'Your tank was destroyed.';
        els.overlay.classList.remove('hidden');
      },
      onReset: function () { els.overlay.classList.add('hidden'); },
      onFrame: updateHud
    });
    buildHud(pSpec, eSpec);
  }

  function buildHud(pSpec, eSpec) {
    document.getElementById('hudP1Name').textContent = pSpec.name;
    document.getElementById('hudP2Name').textContent = eSpec.name;
    var w = '';
    pSpec.weapons.forEach(function (wpn, i) {
      w += '<div class="hud-weapon" data-i="' + i + '"><span>' + wpn.name + '</span><div class="bar"><div class="reload"></div></div></div>';
    });
    document.getElementById('hudP1Weapons').innerHTML = w;
  }

  function updateHud(world) {
    var p = world.player, e = world.enemy;
    document.getElementById('hudP1Hp').style.width = (100 * p.hp / p.spec.stats.hp) + '%';
    document.getElementById('hudP2Hp').style.width = (100 * e.hp / e.spec.stats.hp) + '%';
    document.getElementById('hudP1Speed').textContent = Math.abs(p.speed * 3.6).toFixed(0) + ' km/h';
    var rows = document.querySelectorAll('#hudP1Weapons .hud-weapon');
    for (var i = 0; i < rows.length && i < p.reloads.length; i++) {
      var wpn = p.spec.weapons[i];
      var frac = 1 - p.reloads[i] / wpn.reloadS;
      rows[i].querySelector('.reload').style.width = (100 * Math.max(0, Math.min(1, frac))) + '%';
      rows[i].classList.toggle('active', p.selected === i);
    }
  }

  els.startBtn.addEventListener('click', startGame);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  refreshServerList();
})();
</script>
</body>
</html>