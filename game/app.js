/* ═══════════════════════════════════════════════════════════════════════
   Linux Dojo — game board logic. Vanilla JS, no dependencies. Network is used
   only to poll the local progress.json when served over http(s).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var DATA = window.DOJO_MISSIONS || { belts: [], totalXp: 6200 };
  var BELTS = DATA.belts || [];
  var TOTAL_XP = DATA.totalXp || 6200;
  var EXTRAS = window.DOJO_EXTRAS || { rules: [], pact: [], katas: [], trophies: [], rewards: [] };
  var CHEAT = window.DOJO_CHEATSHEET || [];

  // main belts form the sequential path; side quests are always-open extras
  var MAIN_BELTS = BELTS.filter(function (b) { return !b.side; });
  var SIDE_BELTS = BELTS.filter(function (b) { return b.side; });

  var FLAT = [];
  MAIN_BELTS.forEach(function (b) {
    (b.missions || []).forEach(function (m) { FLAT.push({ m: m, belt: b }); });
  });
  var SIDE_FLAT = [];
  SIDE_BELTS.forEach(function (b) {
    (b.missions || []).forEach(function (m) { SIDE_FLAT.push({ m: m, belt: b }); });
  });

  var BELT_ICONS = ["⚪", "🟡", "🟠", "🟢", "🔵", "🟣", "🟤", "🔴", "⚫", "🗡️"];

  // ---- progress state -------------------------------------------------------
  function emptyProgress() { return { version: 0, xp: 0, totalXp: TOTAL_XP, done: [], belts: {} }; }
  var progress = window.DOJO_PROGRESS || emptyProgress();
  var doneSet = {};
  function rebuildDoneSet() { doneSet = {}; (progress.done || []).forEach(function (id) { doneSet[id] = true; }); }
  rebuildDoneSet();

  function missionDone(id) { return !!doneSet[id]; }
  function mainDoneCount() {
    return FLAT.filter(function (x) { return missionDone(x.m.id); }).length;
  }
  function sideDoneCount() {
    return SIDE_FLAT.filter(function (x) { return missionDone(x.m.id); }).length;
  }
  function pctDone() { return FLAT.length ? (mainDoneCount() / FLAT.length) * 100 : 0; }
  function beltComplete(b) { return (b.missions || []).every(function (m) { return missionDone(m.id); }); }
  function beltsComplete() { var n = 0; MAIN_BELTS.forEach(function (b) { if (beltComplete(b)) n++; }); return n; }

  function unlockedIndex() {
    for (var i = 0; i < FLAT.length; i++) if (!missionDone(FLAT[i].m.id)) return i;
    return FLAT.length;
  }
  function missionStatus(index) {
    var id = FLAT[index].m.id;
    if (missionDone(id)) return "done";
    return index <= unlockedIndex() ? "available" : "locked";
  }
  function currentBelt() {
    var ui = unlockedIndex();
    if (ui >= FLAT.length) return MAIN_BELTS[MAIN_BELTS.length - 1];
    return FLAT[ui].belt;
  }

  // ---- Tux mascot (belt color + cosmetics) ----------------------------------
  function tuxSVG(beltColor, opts) {
    opts = opts || {};
    var stroke = "#0a0d14";
    var shades = opts.shades
      ? '<g><rect x="35" y="36" width="13" height="9" rx="2" fill="#111" stroke="'+stroke+'" stroke-width="1"/>' +
        '<rect x="52" y="36" width="13" height="9" rx="2" fill="#111" stroke="'+stroke+'" stroke-width="1"/>' +
        '<rect x="48" y="39" width="4" height="2" fill="#111"/></g>'
      : '<ellipse cx="42" cy="40" rx="5.5" ry="6.5" fill="#fff"/>' +
        '<ellipse cx="58" cy="40" rx="5.5" ry="6.5" fill="#fff"/>' +
        '<circle cx="43" cy="41" r="2.6" fill="#12131a"/>' +
        '<circle cx="57" cy="41" r="2.6" fill="#12131a"/>';
    var bandana = opts.bandana
      ? '<path d="M28 30 Q50 20 72 30 L70 37 Q50 28 30 37 Z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.4"/>' +
        '<path d="M72 31 l10 -3 l-2 8 z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.2"/>'
      : '';
    return '' +
'<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">' +
  '<ellipse cx="50" cy="104" rx="26" ry="5" fill="rgba(0,0,0,.25)"/>' +
  '<path d="M34 96 q-8 8 -2 11 q10 3 14 -4 z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.5"/>' +
  '<path d="M66 96 q8 8 2 11 q-10 3 -14 -4 z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.5"/>' +
  '<path d="M50 8 C28 8 20 30 20 54 C20 84 32 100 50 100 C68 100 80 84 80 54 C80 30 72 8 50 8 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="2"/>' +
  '<path d="M50 22 C36 22 31 40 31 58 C31 80 40 92 50 92 C60 92 69 80 69 58 C69 40 64 22 50 22 Z" fill="#f4f6fb"/>' +
  '<path d="M22 46 C16 54 16 74 24 82 C26 74 24 58 26 50 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="1.5"/>' +
  '<path d="M78 46 C84 54 84 74 76 82 C74 74 76 58 74 50 Z" fill="#15161c" stroke="'+stroke+'" stroke-width="1.5"/>' +
  shades +
  '<path d="M44 49 L56 49 L50 57 Z" fill="#f6a821" stroke="'+stroke+'" stroke-width="1.2"/>' +
  '<rect x="27" y="70" width="46" height="9" rx="2" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.4"/>' +
  '<rect x="46" y="67" width="8" height="15" rx="2" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.4"/>' +
  '<path d="M40 79 l-5 8 l6 -2 z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.2"/>' +
  '<path d="M60 79 l5 8 l-6 -2 z" fill="'+beltColor+'" stroke="'+stroke+'" stroke-width="1.2"/>' +
  bandana +
'</svg>';
  }

  function tuxCosmetics() {
    var cb = currentBelt();
    return { bandana: cb.n >= 5, shades: cb.n >= 9 && mainDoneCount() === FLAT.length };
  }

  // ---- HUD ------------------------------------------------------------------
  function renderHUD() {
    var cb = currentBelt();
    document.getElementById("mascot").innerHTML = tuxSVG(cb.color, tuxCosmetics());
    document.getElementById("rank").textContent = BELT_ICONS[cb.n - 1] + " " + cb.name + " · " + cb.rank;
    document.getElementById("stat-missions").innerHTML = mainDoneCount() + '<span class="stat-den">/45</span>';
    document.getElementById("stat-belts").innerHTML = beltsComplete() + '<span class="stat-den">/9</span>';
    document.getElementById("stat-xp").textContent = progress.xp || 0;
    document.getElementById("xpbar-fill").style.width =
      Math.max(0, Math.min(100, ((progress.xp || 0) / TOTAL_XP) * 100)) + "%";
  }

  // ---- Home hero (rules, pact, kata of the day, setup) ----------------------
  function renderHero() {
    var hero = document.getElementById("hero");
    var kata = EXTRAS.katas.length
      ? EXTRAS.katas[Math.floor(Date.now() / 86400000) % EXTRAS.katas.length] : "";
    var rules = EXTRAS.rules.map(function (r) { return "<li>" + mdInline(r) + "</li>"; }).join("");
    var pact = EXTRAS.pact.map(function (p) { return "<li>" + mdInline(p) + "</li>"; }).join("");
    hero.innerHTML =
      '<div class="hero-grid">' +
        '<div class="hero-card rules"><h3>⚔️ The three rules of the dojo</h3><ol>' + rules + '</ol></div>' +
        '<div class="hero-card pact"><h3>🤝 The pact</h3><ul>' + pact + '</ul></div>' +
      '</div>' +
      '<div class="hero-kata"><span class="kata-tag">🥋 Kata of the day</span> ' + mdInline(kata) + '</div>';
  }

  // ---- The path -------------------------------------------------------------
  function beltEmojiFor(belt) {
    var map = { 1: "◦", 2: "⌘", 3: "|", 4: "🔑", 5: "⚙", 6: "🌐", 7: "≡", 8: "📦", 9: "★" };
    return map[belt.n] || "◦";
  }

  function renderPath() {
    var path = document.getElementById("path");
    path.innerHTML = "";
    var ui = unlockedIndex();

    MAIN_BELTS.forEach(function (belt, bi) {
      var firstFlat = FLAT.findIndex(function (x) { return x.belt === belt; });
      var beltLocked = ui < firstFlat;

      var zone = document.createElement("section");
      zone.className = "zone" + (beltLocked ? " zone-locked" : "");

      var doneInBelt = belt.missions.filter(function (m) { return missionDone(m.id); }).length;
      var head = document.createElement("div");
      head.className = "zone-head";
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
      var missions = belt.missions.slice();
      if (bi % 2 === 1) missions.reverse();

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

      if (belt.notebook) {
        var nb = document.createElement("div");
        nb.className = "zone-notebook";
        nb.innerHTML = '<span class="nb-tag">📓 In your notebook</span> ' + esc(belt.notebook);
        zone.appendChild(nb);
      }
      path.appendChild(zone);
    });

    // side quests: always open, outside the belt ladder
    SIDE_BELTS.forEach(function (belt) {
      var zone = document.createElement("section");
      zone.className = "zone zone-side";
      var doneInBelt = belt.missions.filter(function (m) { return missionDone(m.id); }).length;
      var head = document.createElement("div");
      head.className = "zone-head";
      head.innerHTML =
        '<div class="zone-badge" style="background:' + belt.color + '">🗡️</div>' +
        '<div><div class="zone-title">' + esc(belt.name) + ' · ' + esc(belt.rank) +
          '</div><div class="zone-sub">' + doneInBelt + '/' + belt.missions.length +
          ' cleared · always open — play these any time</div></div>' +
        '<div class="zone-motto">' + esc(belt.motto) + '</div>';
      zone.appendChild(head);

      var row = document.createElement("div");
      row.className = "nodes";
      row.style.gridTemplateColumns = "repeat(" + belt.missions.length + ", 1fr)";
      belt.missions.forEach(function (m) {
        var status = missionDone(m.id) ? "done" : "available";
        var cell = document.createElement("div");
        cell.className = "node-cell";
        var btn = document.createElement("button");
        btn.className = "node " + status;
        btn.setAttribute("data-id", m.id);
        var glyphs = { "10.1": "✎", "10.2": "⎇", "10.3": "♻" };
        btn.innerHTML =
          '<span class="node-id">' + m.id + '</span>' +
          '<span class="node-glyph">' + (status === "done" ? "✓" : (glyphs[m.id] || "★")) + '</span>' +
          '<span class="node-belt-dot" style="background:' + belt.color + '"></span>' +
          '<span class="node-xp">' + m.xp + ' XP</span>';
        btn.addEventListener("click", function () { openModal(m, belt, status); });
        cell.appendChild(btn);
        row.appendChild(cell);
      });
      zone.appendChild(row);

      if (belt.notebook) {
        var nb = document.createElement("div");
        nb.className = "zone-notebook";
        nb.innerHTML = '<span class="nb-tag">📓 In your notebook</span> ' + esc(belt.notebook);
        zone.appendChild(nb);
      }
      path.appendChild(zone);
    });
  }

  // ---- Trophies + Rewards ---------------------------------------------------
  function trophyEarned(cond) {
    switch (cond.type) {
      case "first": return (progress.done || []).length >= 1;
      case "belt": { var b = BELTS[cond.n - 1]; return b && beltComplete(b); }
      case "pct": return pctDone() >= cond.v;
      case "mission": return missionDone(cond.id);
      case "all": return mainDoneCount() === FLAT.length && FLAT.length > 0;
      default: return false;
    }
  }
  function renderTrophies() {
    var grid = document.getElementById("trophy-grid");
    grid.innerHTML = "";
    EXTRAS.trophies.forEach(function (t) {
      var earned = trophyEarned(t.cond);
      var el = document.createElement("div");
      el.className = "trophy" + (earned ? " earned" : "");
      el.innerHTML =
        '<div class="trophy-icon">' + t.icon + '</div>' +
        '<div class="trophy-text"><div class="trophy-title">' + esc(t.title) + '</div>' +
          '<div class="trophy-desc">' + esc(t.desc) + '</div></div>' +
        '<div class="trophy-state">' + (earned ? '✓' : '🔒') + '</div>';
      grid.appendChild(el);
    });
  }

  var REWARD_KEY = "dojo-rewards-v1";
  function loadRewardState() { try { return JSON.parse(localStorage.getItem(REWARD_KEY) || "{}"); } catch (e) { return {}; } }
  function saveRewardState(s) { try { localStorage.setItem(REWARD_KEY, JSON.stringify(s)); } catch (e) {} }

  function renderRewards() {
    var list = document.getElementById("reward-list");
    list.innerHTML = "";
    var state = loadRewardState();
    var anyClaimable = false;

    EXTRAS.rewards.forEach(function (rw) {
      var belt = BELTS[rw.belt - 1];
      var unlocked = belt && beltComplete(belt);
      var st = state[rw.belt] || {};
      var text = st.text || rw.default;
      var claimed = !!st.claimed;
      if (unlocked && !claimed) anyClaimable = true;

      var el = document.createElement("div");
      el.className = "reward" + (unlocked ? " unlocked" : " locked") + (claimed ? " claimed" : "");
      var btn = claimed
        ? '<span class="reward-claimed">claimed ✓</span>'
        : (unlocked ? '<button class="reward-claim" data-belt="' + rw.belt + '">claim 🎉</button>'
                    : '<span class="reward-lock">🔒 clear ' + esc(rw.label) + '</span>');
      el.innerHTML =
        '<div class="reward-dot" style="background:' + (belt ? belt.color : "#888") + '"></div>' +
        '<div class="reward-body">' +
          '<div class="reward-label">' + esc(rw.label) + '</div>' +
          '<button class="reward-text" data-belt="' + rw.belt + '" title="Tap to rename">' + esc(text) + '</button>' +
        '</div>' + btn;
      list.appendChild(el);
    });

    list.querySelectorAll(".reward-text").forEach(function (b) {
      b.addEventListener("click", function () {
        var beltN = b.getAttribute("data-belt");
        var s = loadRewardState(); var cur = (s[beltN] && s[beltN].text) || b.textContent;
        var next = window.prompt("Rename this reward to something you actually want:", cur);
        if (next !== null && next.trim()) {
          s[beltN] = s[beltN] || {}; s[beltN].text = next.trim(); saveRewardState(s); renderRewards();
        }
      });
    });
    list.querySelectorAll(".reward-claim").forEach(function (b) {
      b.addEventListener("click", function () {
        var beltN = b.getAttribute("data-belt");
        var s = loadRewardState(); s[beltN] = s[beltN] || {}; s[beltN].claimed = true; saveRewardState(s);
        burstConfetti(120); renderRewards(); updateRewardBadge();
      });
    });
    return anyClaimable;
  }

  function updateRewardBadge() {
    var state = loadRewardState(), any = false;
    EXTRAS.rewards.forEach(function (rw) {
      var belt = BELTS[rw.belt - 1];
      if (belt && beltComplete(belt) && !(state[rw.belt] && state[rw.belt].claimed)) any = true;
    });
    var badge = document.getElementById("reward-badge");
    if (badge) badge.hidden = !any;
  }

  // ---- Cheat sheet (searchable) ---------------------------------------------
  function renderCheats(filter) {
    var body = document.getElementById("cheat-body");
    filter = (filter || "").toLowerCase().trim();
    var order = [], groups = {};
    CHEAT.forEach(function (row) {
      if (filter && (row.cmd + " " + row.what + " " + row.group).toLowerCase().indexOf(filter) === -1) return;
      if (!groups[row.group]) { groups[row.group] = []; order.push(row.group); }
      groups[row.group].push(row);
    });
    if (!order.length) { body.innerHTML = '<p class="dim" style="padding:20px 0">No commands match “' + esc(filter) + '”.</p>'; return; }
    var html = "";
    order.forEach(function (g) {
      html += '<div class="cheat-group"><h4>' + esc(g) + '</h4><div class="cheat-rows">';
      groups[g].forEach(function (row) {
        html += '<div class="cheat-row"><code>' + esc(row.cmd) + '</code><span>' + esc(row.what) + '</span></div>';
      });
      html += '</div></div>';
    });
    body.innerHTML = html;
  }

  // ---- Mission modal --------------------------------------------------------
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

    html += '<div class="m-section-title">📖 Learn</div>';
    (m.learn || []).forEach(function (blk) { html += renderLearnBlock(blk); });

    html += '<div class="m-section-title">🎯 Your mission</div>';
    html += '<ol class="tasklist">';
    (m.task || []).forEach(function (t) {
      html += '<li>' + esc(t.step);
      if (t.code) html += renderCode(t.code, null);
      html += '</li>';
    });
    html += '</ol>';

    html += '<div class="m-section-title">✅ What the checker looks for</div>';
    html += '<div class="artifacts">';
    (m.artifacts || []).forEach(function (a) {
      html += '<div class="artifact"><span class="a-name">' + esc(a[0]) + '</span>' +
              '<span class="a-desc">' + esc(a[1]) + '</span></div>';
    });
    html += '</div>';

    html += '<details class="hints"><summary>💡 Stuck? Reveal hints (try on your own first!)</summary><ul>';
    (m.hints || []).forEach(function (h) { html += '<li>' + esc(h) + '</li>'; });
    html += '</ul></details>';

    html += '<div class="check-cta"><div class="cta-label">When you\'re done, grade this mission from the repo root:</div>';
    html += renderCode('./check ' + m.id, null);
    html += '</div>';

    modalBody.innerHTML = html;
    modalBody.scrollTop = 0;
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    wireCopyButtons(modalBody);
  }
  function closeModal() { backdrop.hidden = true; document.body.style.overflow = ""; }
  document.getElementById("modal-close").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !backdrop.hidden) closeModal(); });

  function renderLearnBlock(blk) {
    var h = '<div class="learn-block">';
    if (blk.h) h += '<h4>' + esc(blk.h) + '</h4>';
    if (blk.p) h += '<p>' + mdInline(blk.p) + '</p>';
    if (blk.list) { h += '<ul>'; blk.list.forEach(function (li) { h += '<li>' + mdInline(li) + '</li>'; }); h += '</ul>'; }
    if (blk.code) h += renderCode(blk.code, blk.label || null);
    if (blk.tip) h += '<div class="learn-tip"><b>💡 Sensei says:</b> ' + mdInline(blk.tip) + '</div>';
    h += '</div>';
    return h;
  }
  function renderCode(code, label) {
    var h = '<div class="codewrap"><button class="copy-btn" type="button">copy</button>' +
            '<pre><code>' + esc(code) + '</code></pre>';
    if (label) h += '<div class="code-label">' + esc(label) + '</div>';
    return h + '</div>';
  }
  function wireCopyButtons(root) {
    root.querySelectorAll(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pre = btn.parentElement.querySelector("code");
        copyText(pre ? pre.textContent : "", function () {
          btn.textContent = "copied ✓"; btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "copy"; btn.classList.remove("copied"); }, 1400);
        });
      });
    });
  }
  function copyText(text, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text, ok); });
    } else fallbackCopy(text, ok);
  }
  function fallbackCopy(text, ok) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta); ok && ok();
    } catch (e) {}
  }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function mdInline(s) {
    var e = esc(s);
    e = e.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
    return e;
  }

  // ---- theme ----------------------------------------------------------------
  var themeBtn = document.getElementById("theme-btn");
  try { var st = localStorage.getItem("dojo-theme"); if (st) document.documentElement.setAttribute("data-theme", st); } catch (e) {}
  themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    try { localStorage.setItem("dojo-theme", cur); } catch (e) {}
  });

  // ---- tabs -----------------------------------------------------------------
  var views = { path: document.getElementById("view-path"), trophies: document.getElementById("view-trophies"), cheats: document.getElementById("view-cheats") };
  function switchView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-view") === name); });
    if (name === "trophies") { renderTrophies(); renderRewards(); }
    if (name === "cheats") { renderCheats(document.getElementById("cheat-search").value); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { switchView(t.getAttribute("data-view")); });
  });
  document.getElementById("cheat-search").addEventListener("input", function (e) { renderCheats(e.target.value); });

  // ---- confetti -------------------------------------------------------------
  var confettiCanvas = document.getElementById("confetti");
  var cctx = confettiCanvas.getContext("2d");
  var confettiPieces = [], confettiRunning = false;
  function sizeCanvas() { confettiCanvas.width = window.innerWidth; confettiCanvas.height = window.innerHeight; }
  window.addEventListener("resize", sizeCanvas); sizeCanvas();
  function burstConfetti(n) {
    var colors = ["#5eead4", "#38bdf8", "#fbbf24", "#34d399", "#f472b6", "#a855f7"];
    for (var i = 0; i < n; i++) confettiPieces.push({
      x: Math.random() * confettiCanvas.width, y: -20 - Math.random() * 80, r: 4 + Math.random() * 5,
      c: colors[(Math.random() * colors.length) | 0], vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4,
      rot: Math.random() * 6.28, vr: -0.2 + Math.random() * 0.4, life: 0
    });
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiTick); }
  }
  function confettiTick() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (var i = confettiPieces.length - 1; i >= 0; i--) {
      var p = confettiPieces[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr; p.life++;
      cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.rot);
      cctx.fillStyle = p.c; cctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.5); cctx.restore();
      if (p.y > confettiCanvas.height + 30 || p.life > 400) confettiPieces.splice(i, 1);
    }
    if (confettiPieces.length) requestAnimationFrame(confettiTick);
    else { confettiRunning = false; cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height); }
  }

  // ---- toast ----------------------------------------------------------------
  var toastEl = document.getElementById("toast"), toastTimer = null;
  function toast(html, ms) {
    toastEl.innerHTML = html; toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); setTimeout(function () { toastEl.hidden = true; }, 350); }, ms || 4200);
  }

  // ---- celebrations ---------------------------------------------------------
  function lastSeenDone() { try { return JSON.parse(localStorage.getItem("dojo-seen-done") || "[]"); } catch (e) { return []; } }
  function saveSeenDone(list) { try { localStorage.setItem("dojo-seen-done", JSON.stringify(list)); } catch (e) {} }
  function celebrateIfNew() {
    var seen = lastSeenDone(), seenMap = {}; seen.forEach(function (id) { seenMap[id] = true; });
    var fresh = (progress.done || []).filter(function (id) { return !seenMap[id]; });
    if (fresh.length && seen.length > 0) {
      var newBelts = [];
      BELTS.forEach(function (b) {
        var all = b.missions.every(function (m) { return doneSet[m.id]; });
        var was = b.missions.every(function (m) { return seenMap[m.id]; });
        if (all && !was) newBelts.push(b);
      });
      burstConfetti(newBelts.length ? 220 : 90);
      if (newBelts.length) {
        var b = newBelts[newBelts.length - 1];
        if (b.side) {
          toast('🗡️ <span class="t-belt">Side quests complete!</span> vim · git · services — Tux earns the rank of ' + esc(b.rank), 5200);
        } else {
          toast('🥋 <span class="t-belt">Belt ' + b.n + ' complete!</span> Tux is now a ' + esc(b.name) + ' · ' + esc(b.rank), 5200);
        }
      } else {
        var one = fresh[fresh.length - 1];
        var meta = FLAT.concat(SIDE_FLAT).find(function (x) { return x.m.id === one; });
        toast('⭐ Mission ' + one + ' cleared — <b>' + esc(meta ? meta.m.title : one) + '</b>! +' + (meta ? meta.m.xp : 0) + ' XP', 4200);
      }
    }
    saveSeenDone(progress.done || []);
  }

  // ---- progress loading -----------------------------------------------------
  function applyProgress(p, animate) {
    progress = p || emptyProgress();
    rebuildDoneSet();
    renderHUD(); renderHero(); renderPath(); updateRewardBadge();
    if (!views.trophies.hidden) { renderTrophies(); renderRewards(); }
    if (animate) celebrateIfNew(); else saveSeenDone(progress.done || []);
  }

  var isHttp = location.protocol === "http:" || location.protocol === "https:";
  var lastVersion = -1;
  function pollProgress() {
    if (!isHttp) return;
    fetch("progress.json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (!p) return;
        document.getElementById("sync-note").className = "sync-note live";
        document.getElementById("sync-note").textContent =
          "Live — reading game/progress.json. Run ./check in your terminal and this board updates on its own.";
        if ((p.version || 0) !== lastVersion) { var first = lastVersion === -1; lastVersion = p.version || 0; applyProgress(p, !first); }
      })
      .catch(function () {});
  }

  // ---- boot -----------------------------------------------------------------
  function boot() {
    if (window.DOJO_PROGRESS) { lastVersion = window.DOJO_PROGRESS.version || 0; applyProgress(window.DOJO_PROGRESS, false); }
    else applyProgress(emptyProgress(), false);
    if (isHttp) {
      document.getElementById("sync-note").textContent = "Connecting to your progress file…";
      pollProgress(); setInterval(pollProgress, 2500);
    } else {
      document.getElementById("sync-note").textContent =
        "Opened as a file — showing progress saved in game/progress.js. For live updates, run ./play.";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
