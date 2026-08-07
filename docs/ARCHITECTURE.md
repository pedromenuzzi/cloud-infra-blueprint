# 🏗️ Architecture

How Linux Dojo is built, so future-you can extend it with confidence.

## Design goals

1. **Works on first touch, forever.** A fresh clone runs with zero setup. No package installs, no
   build step, no network. Bash for the grader; Python 3 *optionally* for the local board server.
2. **Cross-platform & deterministic.** The grader is **artifact-based**: it only inspects files and
   runs scripts *you* produced inside a mission folder. It never reads host OS internals, so a
   mission grades identically on macOS (bash 3.2) and Linux. Practice data is generated with fixed
   seeds, so every learner sees the exact same numbers and every answer is stable.
3. **Single source of truth.** The curriculum is authored once in Python; everything else
   (mission pages, the board's data, the grader's manifest, the cheat sheet) is generated from it.
4. **Provably beatable.** A self-test solves all 45 missions and asserts 45/45 on every change.

## The pieces

```
tools/content/belt1.py … belt9.py     ← the curriculum (authored by hand)
            │
            ▼  tools/generate.py
   ┌────────┴─────────────────────────────────────────────┐
   ▼                     ▼                    ▼             ▼
missions/**/README.md   game/missions.js   game/manifest.sh   CHEATSHEET.md
(human lessons)         (board data)       (grader table)     (reference)
```

- **`tools/content/belt*.py`** — one module per belt. Each mission is a dict: intro, `learn` blocks
  (headings, prose, code, bullet lists, sensei tips), `task` steps, expected `artifacts`, and `hints`.
  This is the *only* place prose lives.
- **`tools/generate.py`** — renders the mission `README.md` files, `game/missions.js`
  (`window.DOJO_MISSIONS`), `game/manifest.sh` (the pipe-delimited belt/mission/xp table the grader
  reads), and `CHEATSHEET.md`. Idempotent: same input → identical output. Regenerate with
  `python3 tools/generate.py`.

- **Practice assets** under `missions/**/` — generated deterministically (see the seeded builder that
  produced them). Every statistic the grader or answer key relies on (line counts, top IPs, file
  sizes, permission puzzles) is asserted at build time, so the content can never silently drift from
  the checks.

- **The grader** — three files:
  - `check` (repo root) — the CLI. Parses args, reads `game/manifest.sh`, `cd`s into each mission
    folder, runs its verifier, renders the terminal dojo board, and writes progress.
  - `tools/lib.sh` — the engine: colored output, and a library of requirement primitives
    (`req_file`, `req_mode`, `req_grep`, `req_kv*`, `run_cap` for timeout-guarded script execution,
    `perm_octal` for portable permission reading via `ls -ld`, etc.). Written to bash 3.2: no
    associative arrays, no `mapfile`, no `${var,,}`.
  - `tools/checks.sh` — 45 functions `m_<belt>_<mission>()`, one per mission, each a sequence of
    requirement calls. This is where "what counts as solved" is defined.

- **`play`** (repo root) — serves `game/` over `python3 -m http.server` and opens the browser.
  Degrades gracefully: no browser opener → prints the URL; no Python → points you at the `file://`
  path (the board still works, reading `progress.js`).

- **`game/`** — the board. Vanilla HTML/CSS/JS, **no dependencies**, no external assets (Tux is
  inline SVG). `app.js` reads `window.DOJO_MISSIONS`, computes belt/unlock state, renders the
  serpentine path, and wires the mission modal. Progress loads two ways:
  - **served over http** (`./play`): it `fetch`es `game/progress.json` every 2.5s, so the board
    refreshes live as you run `./check` in another terminal.
  - **opened as a `file://`**: `fetch` is blocked by the browser, so it falls back to
    `window.DOJO_PROGRESS` from the committed `game/progress.js`.

## Progress format

`./check` writes both `game/progress.json` and `game/progress.js` (same payload, two delivery
mechanisms) plus `.dojo/state` (a simple `done <id>` list, git-ignored). Shape:

```json
{ "version": 12, "updatedAt": "…Z", "xp": 2150, "totalXp": 6200,
  "done": ["1.1","1.2", "…"],
  "belts": { "1": {"done":5,"total":5,"complete":true}, "…": {} } }
```

`version` increments each run; the board only re-renders (and fires confetti) when it changes.

## XP model

Belts 1–8: four lessons at 100 XP + one boss at 250 = **650 XP/belt**.
Belt 9 (Black): four missions at 150 XP + the final trial at 400 = **1000 XP**.
Total: **6200 XP**, 45 missions.

## Extending it

- **Tune a mission's wording or hints:** edit its dict in `tools/content/belt*.py`, then
  `python3 tools/generate.py`. Don't hand-edit generated files (`missions/**/README.md`,
  `game/missions.js`, `game/manifest.sh`, `CHEATSHEET.md`) — they're overwritten.
- **Change what "solved" means:** edit the matching `m_<belt>_<mission>` in `tools/checks.sh`.
- **Add a mission or belt:** add it to the content module and give it a matching verifier in
  `tools/checks.sh` and a solver in `tools/selftest.sh`; regenerate; run the self-test.
- **Always finish with** `bash tools/selftest.sh` — if it isn't 45/45, a check and its solver
  disagree, and the message tells you which mission.

## What deliberately isn't here

- **No CI / GitHub Actions.** Nothing that could show a red ✗ on a fresh clone. The self-test is the
  quality gate, run locally on demand.
- **No runtime dependencies.** Adding an npm/pip dependency would break "works on first touch."
  Keep it vanilla.
