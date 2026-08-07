/* ═══════════════════════════════════════════════════════════════════════
   Linux Dojo — game board logic. Vanilla JS, no dependencies, no network
   except polling the local progress.json when served over http(s).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var DATA = window.DOJO_MISSIONS || { belts: [], totalXp: 6200 };
  var BELTS = DATA.belts || [];
  var TOTAL_XP = DATA.totalXp || 6200;

  // flat, ordered list of every mission with a back-reference to its belt
  var FLAT = [];
  BELTS.forEach(function (b) {
    (b.missions || []).forEach(function (m) { FLAT.push({ m: m, belt: b }); });
  });

  var BELT_ICONS = ["⚪", "🟡", "🟠", "🟢", "🔵", "🟣", "🟤", "🔴", "⚫"];

  // ---- progress state -------------------------------------------------------
  function emptyProgress() {
    return { version: 0, xp: 0, totalXp: TOTAL_XP, done: [], belts: {} };
  }
  var progress = window.DOJO_PROGRESS || emptyProgress();
  var doneSet = {};
  function rebuildDoneSet() {
    doneSet = {};
    (progress.done || []).forEach(function (id) { doneSet[id] = true; });
  }
  rebuildDoneSet();

  // ---- Tux mascot -----------------------------------------------------------
  // A friendly penguin whose belt band takes the color of the belt you're on.
  function tuxSVG(beltColor, knotDark) {
    var stroke = "#0a0d14";
    return '' +
'<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">' +
  '<ellipse cx="50" cy="104" rx="26" ry="5" fill="rgba(0,0,0,.25)"/>' +
  // feet
  '<path d="M34 96 q-8 8 -2 11 q10 3 14 -4 z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.5"/>' +
  '<path d="M66 96 q8 8 2 11 q-10 3 -14 -4 z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.5"/>' +
  // body (black)
  '<path d="M50 8 C28 8 20 30 20 54 C20 84 32 100 50 100 C68 100 80 84 80 54 C80 30 72 8 50 8 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="2"/>' +
  // belly (white)
  '<path d="M50 22 C36 22 31 40 31 58 C31 80 40 92 50 92 C60 92 69 80 69 58 C69 40 64 22 50 22 Z" fill="#f4f6fb"/>' +
  // wings
  '<path d="M22 46 C16 54 16 74 24 82 C26 74 24 58 26 50 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="1.5"/>' +
  '<path d="M78 46 C84 54 84 74 76 82 C74 74 76 58 74 50 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="1.5"/>' +
  // eyes
  '<ellipse cx="42" cy="40" rx="5.5" ry="6.5" fill="#fff"/>' +
  '<ellipse cx="58" cy="40" rx="5.5" ry="6.5" fill="#fff"/>' +
  '<circle cx="43" cy="41" r="2.6" fill="#12131a"/>' +
  '<circle cx="57" cy="41" r="2.6" fill="#12131a"/>' +
  // beak
  '<path d="M44 49 L56 49 L50 57 Z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.2"/>' +
  // BELT band (colored by current belt)
  '<rect x="27" y="70" width="46" height="9" rx="2" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.4"/>' +
  // belt knot
  '<rect x="46" y="67" width="8" height="15" rx="2" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.4"/>' +
  (knotDark ? '<rect x="46" y="67" width="8" height="15" rx="2" fill="rgba(255,255,255,.15)"/>' : '') +
  '<path d="M40 79 l-5 8 l6 -2 z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.2"/>' +
  '<path d="M60 79 l5 8 l-6 -2 z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.2"/>' +
'</svg>';
  }

  // ---- derived state --------------------------------------------------------
  function missionDone(id) { return !!doneSet[id]; }

  // linear unlock: mission is unlocked if it's first or the previous is done
  function unlockedIndex() {
    for (var i = 0; i < FLAT.length; i++) {
      if (!missionDone(FLAT[i].m.id)) return i;
    }
    return FLAT.length; // all done
  }
  function missionStatus(index) {
    var id = FLAT[index].m.id;
    if (missionDone(id)) return "done";
    if (index === unlockedIndex()) return "available";
    return index < unlockedIndex() ? "available" : "locked";
  }

  // which belt is Tux currently wearing? the belt of the next unlocked mission,
  // or black if everything is complete.
  function currentBelt() {
    var ui = unlockedIndex();
    if (ui >= FLAT.length) return BELTS[BELTS.length - 1];
    return FLAT[ui].belt;
  }
  function beltsComplete() {
    var n = 0;
    BELTS.forEach(function (b) {
      var all = (b.missions || []).every(function (m) { return missionDone(m.id); });
      if (all) n++;
    });
    return n;
  }

  // ---- HUD render -----------------------------------------------------------
  function renderHUD() {
    var cb = currentBelt();
    document.getElementById("mascot").innerHTML = tuxSVG(cb.color, cb.n === 9);

    var doneCount = (progress.done || []).length;
    var xp = progress.xp || 0;

    document.getElementById("rank").textContent =
      BELT_ICONS[cb.n - 1] + " " + cb.name + " · " + cb.rank;
    document.getElementById("stat-missions").innerHTML =
      doneCount + '<span class="stat-den">/45</span>';
    document.getElementById("stat-belts").innerHTML =
      beltsComplete() + '<span class="stat-den">/9</span>';
    document.getElementById("stat-xp").textContent = xp;
    document.getElementById("xpbar-fill").style.width =
      Math.max(0, Math.min(100, (xp / TOTAL_XP) * 100)) + "%";
  }

  // ---- path render ----------------------------------------------------------
  function renderPath() {
    var path = document.getElementById("path");
    path.innerHTML = "";
    var ui = unlockedIndex();

    BELTS.forEach(function (belt, bi) {
      var beltUnlockedBefore = FLAT.findIndex(function (x) { return x.belt === belt; });
      var beltLocked = ui < beltUnlockedBefore;

      var zone = document.createElement("section");
      zone.className = "zone" + (beltLocked ? " zone-locked" : "");

      var head = document.createElement("div");
      head.className = "zone-head";
      var doneInBelt = belt.missions.filter(function (m) { return missionDone(m.id); }).length;
      head.innerHTML =
        '<div class="zone-badge" style="background:' + belt.color + '">' + belt.n + '</div>' +
        '<div><div class="zone-title">' + esc(belt.name) + ' · ' + esc(belt.rank) +
          '</div><div class="zone-sub">' + doneInBelt + '/5 missions cleared</div></div>' +
        (beltLocked
          ? '<div class="zone-lockmsg">🔒 finish the previous belt to unlock</div>'
          : '<div class="zone-motto">' + esc(belt.motto) + '</div>');
      zone.appendChild(head);

      var row = document.createElement("div");
      row.className = "nodes";
      // serpentine: reverse every other belt row for visual flow
      var missions = belt.missions.slice();
      var reversed = bi % 2 === 1;
      if (reversed) missions.reverse();

      missions.forEach(function (m) {
        var flatIndex = FLAT.findIndex(function (x) { return x.m.id === m.id; });
        var status = missionStatus(flatIndex);
        var cell = document.createElement("div");
        cell.className = "node-cell";

        var btn = document.createElement("button");
        btn.className = "node " + status + (m.boss ? " boss" : "");
        btn.setAttribute("data-id", m.id);
        var glyph = m.boss ? "🥋" : (status === "done" ? "✓" : (status === "locked" ? "🔒" : beltEmojiFor(belt)));
        btn.innerHTML =
          '<span class="node-id">' + m.id + '</span>' +
          '<span class="node-glyph">' + glyph + '</span>' +
          '<span class="node-belt-dot" style="background:' + belt.color + '"></span>' +
          '<span class="node-xp">' + m.xp + ' XP</span>';
        btn.addEventListener("click", function () { openModal(m, belt, status); });
        cell.appendChild(btn);
        row.appendChild(cell);
      });
      zone.appendChild(row);
      path.appendChild(zone);
    });
  }

  function beltEmojiFor(belt) {
    // a small thematic glyph per belt for available/undone lessons
    var map = { 1: "◦", 2: "⌘", 3: "|", 4: "🔑", 5: "⚙", 6: "🌐", 7: "≡", 8: "📦", 9: "★" };
    return map[belt.n] || "◦";
  }

  // ---- modal ----------------------------------------------------------------
  var backdrop = document.getElementById("modal-backdrop");
  var modalBody = document.getElementById("modal-body");

  function openModal(m, belt, status) {
    var done = status === "done";
    var html = "";

    html += '<div class="m-head">';
    html += '<div class="m-medal" style="background:' + belt.color + '">' + (m.boss ? "🥋" : BELT_ICONS[belt.n - 1]) + '</div>';
    html += '<div class="m-titlewrap">';
    html += '<div class="m-kicker">Belt ' + belt.n + ' · ' + esc(belt.name) + (m.boss ? ' · Boss Trial' : '') + '</div>';
    html += '<div class="m-title">' + esc(m.title) + '</div>';
    html += '<div class="m-tagline">' + esc(m.tagline) + '</div>';
    html += '</div></div>';

    html += '<div class="m-meta">';
    html += '<span class="chip">Mission ' + m.id + '</span>';
    html += '<span class="chip xp">' + m.xp + ' XP</span>';
    html += '<span class="chip">~' + m.minutes + ' min</span>';
    if (m.boss) html += '<span class="chip boss">🥋 Boss</span>';
    if (done) html += '<span class="chip done">✓ Cleared</span>';
    html += '</div>';

    if (status === "locked") {
      html += '<div class="locked-banner">🔒 This mission is locked. Clear the earlier missions first — ' +
              'but you can read everything below to preview what\'s coming.</div>';
    }

    html += '<div class="m-intro">' + esc(m.intro) + '</div>';

    // LEARN
    html += '<div class="m-section-title">📖 Learn</div>';
    (m.learn || []).forEach(function (blk) { html += renderLearnBlock(blk); });

    // TASK
    html += '<div class="m-section-title">🎯 Your mission</div>';
    html += '<ol class="tasklist">';
    (m.task || []).forEach(function (t) {
      html += '<li>' + esc(t.step);
      if (t.code) html += renderCode(t.code, null);
      html += '</li>';
    });
    html += '</ol>';

    // ARTIFACTS
    html += '<div class="m-section-title">✅ What the checker looks for</div>';
    html += '<div class="artifacts">';
    (m.artifacts || []).forEach(function (a) {
      html += '<div class="artifact"><span class="a-name">' + esc(a[0]) + '</span>' +
              '<span class="a-desc">' + esc(a[1]) + '</span></div>';
    });
    html += '</div>';

    // HINTS
    html += '<details class="hints"><summary>💡 Stuck? Reveal hints (try on your own first!)</summary><ul>';
    (m.hints || []).forEach(function (h) { html += '<li>' + esc(h) + '</li>'; });
    html += '</ul></details>';

    // CHECK CTA
    html += '<div class="check-cta"><div class="cta-label">When you\'re done, grade this mission from the repo root:</div>';
    html += renderCode('./check ' + m.id, null);
    html += '</div>';

    modalBody.innerHTML = html;
    modalBody.scrollTop = 0;
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    wireCopyButtons(modalBody);
  }

  function closeModal() {
    backdrop.hidden = true;
    document.body.style.overflow = "";
  }
  document.getElementById("modal-close").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !backdrop.hidden) closeModal(); });

  function renderLearnBlock(blk) {
    var h = '<div class="learn-block">';
    if (blk.h) h += '<h4>' + esc(blk.h) + '</h4>';
    if (blk.p) h += '<p>' + mdInline(blk.p) + '</p>';
    if (blk.list) {
      h += '<ul>';
      blk.list.forEach(function (li) { h += '<li>' + mdInline(li) + '</li>'; });
      h += '</ul>';
    }
    if (blk.code) h += renderCode(blk.code, blk.label || null);
    if (blk.tip) h += '<div class="learn-tip"><b>💡 Sensei says:</b> ' + mdInline(blk.tip) + '</div>';
    h += '</div>';
    return h;
  }

  function renderCode(code, label) {
    var h = '<div class="codewrap"><button class="copy-btn" type="button">copy</button>' +
            '<pre><code>' + esc(code) + '</code></pre>';
    if (label) h += '<div class="code-label">' + esc(label) + '</div>';
    h += '</div>';
    return h;
  }

  function wireCopyButtons(root) {
    root.querySelectorAll(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = btn.parentElement.querySelector("code");
        var text = pre ? pre.textContent : "";
        copyText(text, function () {
          btn.textContent = "copied ✓";
          btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "copy"; btn.classList.remove("copied"); }, 1400);
        });
      });
    });
  }

  function copyText(text, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text, ok); });
    } else { fallbackCopy(text, ok); }
  }
  function fallbackCopy(text, ok) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      ok && ok();
    } catch (e) { /* clipboard blocked; ignore */ }
  }

  // ---- tiny markdown-inline (bold + code) & escaping ------------------------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function mdInline(s) {
    // escape first, then apply **bold** and `code`
    var e = esc(s);
    e = e.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
    return e;
  }

  // ---- theme toggle ---------------------------------------------------------
  var themeBtn = document.getElementById("theme-btn");
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("dojo-theme"); } catch (e) {}
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    try { localStorage.setItem("dojo-theme", cur); } catch (e) {}
  });

  // ---- confetti -------------------------------------------------------------
  var confettiCanvas = document.getElementById("confetti");
  var cctx = confettiCanvas.getContext("2d");
  var confettiPieces = [];
  function sizeCanvas() { confettiCanvas.width = window.innerWidth; confettiCanvas.height = window.innerHeight; }
  window.addEventListener("resize", sizeCanvas); sizeCanvas();
  function burstConfetti(n) {
    var colors = ["#5eead4", "#38bdf8", "#fbbf24", "#34d399", "#f472b6", "#a855f7"];
    for (var i = 0; i < n; i++) {
      confettiPieces.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * 80,
        r: 4 + Math.random() * 5,
        c: colors[(Math.random() * colors.length) | 0],
        vx: -2 + Math.random() * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * 6.28, vr: -0.2 + Math.random() * 0.4, life: 0
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiTick); }
  }
  var confettiRunning = false;
  function confettiTick() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (var i = confettiPieces.length - 1; i >= 0; i--) {
      var p = confettiPieces[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr; p.life++;
      cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.rot);
      cctx.fillStyle = p.c; cctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.5);
      cctx.restore();
      if (p.y > confettiCanvas.height + 30 || p.life > 400) confettiPieces.splice(i, 1);
    }
    if (confettiPieces.length > 0) { requestAnimationFrame(confettiTick); }
    else { confettiRunning = false; cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height); }
  }

  // ---- toast ----------------------------------------------------------------
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(html, ms) {
    toastEl.innerHTML = html;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 350);
    }, ms || 4200);
  }

  // ---- celebrations on progress change --------------------------------------
  function lastSeenDone() {
    try { return JSON.parse(localStorage.getItem("dojo-seen-done") || "[]"); } catch (e) { return []; }
  }
  function saveSeenDone(list) {
    try { localStorage.setItem("dojo-seen-done", JSON.stringify(list)); } catch (e) {}
  }

  function celebrateIfNew() {
    var seen = lastSeenDone();
    var seenMap = {}; seen.forEach(function (id) { seenMap[id] = true; });
    var fresh = (progress.done || []).filter(function (id) { return !seenMap[id]; });

    if (fresh.length && seen.length >= 0 && (progress.version || 0) > 0) {
      // only celebrate real new completions (not the very first load with nothing)
      var newlyCompletedBelts = [];
      BELTS.forEach(function (b) {
        var all = b.missions.every(function (m) { return doneSet[m.id]; });
        var wasAll = b.missions.every(function (m) { return seenMap[m.id]; });
        if (all && !wasAll && seen.length > 0) newlyCompletedBelts.push(b);
      });

      if (seen.length > 0) {
        burstConfetti(newlyCompletedBelts.length ? 220 : 90);
        if (newlyCompletedBelts.length) {
          var b = newlyCompletedBelts[newlyCompletedBelts.length - 1];
          toast('🥋 <span class="t-belt">Belt ' + b.n + ' complete!</span> Tux is now a ' + esc(b.name) + ' · ' + esc(b.rank), 5200);
        } else {
          var one = fresh[fresh.length - 1];
          var meta = FLAT.find(function (x) { return x.m.id === one; });
          var title = meta ? meta.m.title : one;
          toast('⭐ Mission ' + one + ' cleared — <b>' + esc(title) + '</b>! +' + (meta ? meta.m.xp : 0) + ' XP', 4200);
        }
      }
    }
    saveSeenDone(progress.done || []);
  }

  // ---- progress loading (http polling + file:// fallback) -------------------
  function applyProgress(p, animate) {
    progress = p || emptyProgress();
    rebuildDoneSet();
    renderHUD();
    renderPath();
    if (animate) celebrateIfNew();
    else saveSeenDone(progress.done || []); // first paint: don't fire confetti retroactively
  }

  var isHttp = location.protocol === "http:" || location.protocol === "https:";
  var lastVersion = -1;

  function pollProgress() {
    if (!isHttp) return; // file:// can't fetch; we already have window.DOJO_PROGRESS
    fetch("progress.json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (!p) return;
        // a successful fetch means the file is live, whether or not it changed
        document.getElementById("sync-note").className = "sync-note live";
        document.getElementById("sync-note").textContent =
          "Live — reading game/progress.json. Run ./check in your terminal and this board updates on its own.";
        if ((p.version || 0) !== lastVersion) {
          var first = lastVersion === -1;
          lastVersion = p.version || 0;
          applyProgress(p, !first);
        }
      })
      .catch(function () { /* no server / no file yet: ignore, keep current */ });
  }

  // ---- boot -----------------------------------------------------------------
  function boot() {
    // initial paint from whatever we have (window.DOJO_PROGRESS for file://,
    // or empty until the first poll for http)
    if (window.DOJO_PROGRESS) {
      lastVersion = window.DOJO_PROGRESS.version || 0;
      applyProgress(window.DOJO_PROGRESS, false);
    } else {
      applyProgress(emptyProgress(), false);
    }

    if (isHttp) {
      document.getElementById("sync-note").textContent = "Connecting to your progress file…";
      pollProgress();
      setInterval(pollProgress, 2500);
    } else {
      document.getElementById("sync-note").textContent =
        "Opened as a file — showing the progress saved in game/progress.js. For live updates, run ./play.";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
