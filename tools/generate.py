#!/usr/bin/env python3
"""Linux Dojo content generator — the single source of truth.

Reads tools/content/belt*.py and emits (all committed to git):
  • missions/<belt>/<mission>/README.md   — the printed lesson for each mission
  • game/missions.js                       — window.DOJO_MISSIONS for the frontend
  • game/manifest.sh                        — belt/mission/xp/title table for ./check
  • CHEATSHEET.md                           — a one-page command reference

Run:  python3 tools/generate.py
Idempotent: same content in → identical files out.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from content import belt1, belt2, belt3, belt4, belt5, belt6, belt7, belt8, belt9, belt10  # noqa: E402
from content import extras  # noqa: E402

BELTS = [b.BELT for b in (belt1, belt2, belt3, belt4, belt5, belt6, belt7, belt8, belt9, belt10)]


def total_xp():
    return sum(m["xp"] for b in BELTS for m in b["missions"])


# ───────────────────────────────────────────────────────── README rendering
def render_learn_block(blk):
    out = []
    if "h" in blk:
        out.append(f"#### {blk['h']}\n")
    if "p" in blk:
        out.append(blk["p"] + "\n")
    if "list" in blk:
        out.append("\n".join(f"- {item}" for item in blk["list"]) + "\n")
    if "code" in blk:
        label = f"\n_{blk['label']}_\n" if "label" in blk else ""
        out.append(f"```bash\n{blk['code']}\n```{label}")
    if "tip" in blk:
        out.append(f"> 💡 **Sensei says:** {blk['tip']}\n")
    return "\n".join(out)


def render_readme(belt, m, idx, prev_id, next_id):
    boss = m.get("boss")
    kind = "🥋 BOSS TRIAL" if boss else f"Lesson {idx}"
    lines = []
    lines.append(f"# {'🥋 ' if boss else ''}{m['title']}")
    lines.append("")
    lines.append(f"> _{m['tagline']}_")
    lines.append("")
    lines.append(
        f"**Belt {belt['n']} · {belt['name']}** · Mission `{m['id']}` · {kind} · "
        f"**{m['xp']} XP** · ~{m['minutes']} min"
    )
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(m["intro"])
    lines.append("")
    lines.append("## 📖 Learn")
    lines.append("")
    for blk in m["learn"]:
        lines.append(render_learn_block(blk))
    lines.append("## 🎯 Your Mission")
    lines.append("")
    for i, t in enumerate(m["task"], 1):
        lines.append(f"{i}. {t['step']}")
        if "code" in t:
            lines.append("")
            lines.append(f"   ```bash\n{indent(t['code'], 3)}\n   ```")
        lines.append("")
    lines.append("## ✅ What the checker looks for")
    lines.append("")
    for name, desc in m["artifacts"]:
        lines.append(f"- **`{name}`** — {desc}")
    lines.append("")
    lines.append("<details>")
    lines.append("<summary>💡 Stuck? Open for hints (try on your own first!)</summary>")
    lines.append("")
    for h in m["hints"]:
        lines.append(f"- {h}")
    lines.append("")
    lines.append("</details>")
    lines.append("")
    lines.append("## 🧪 Check your work")
    lines.append("")
    lines.append("From the repository root, run:")
    lines.append("")
    lines.append(f"```bash\n./check {m['id']}\n```")
    lines.append("")
    lines.append(
        "It tells you exactly which requirements pass and which need another pass. "
        "When it goes green, your progress and the game board update automatically."
    )
    lines.append("")
    lines.append("---")
    nav = []
    if prev_id:
        nav.append(f"⬅️ Previous: `{prev_id}`")
    nav.append("[🏠 Dojo map](../../../README.md)")
    if next_id:
        nav.append(f"Next: `{next_id}` ➡️")
    lines.append(" · ".join(nav))
    lines.append("")
    return "\n".join(lines)


def indent(code, spaces):
    pad = " " * spaces
    return "\n".join(pad + ln if ln else ln for ln in code.split("\n"))


# ───────────────────────────────────────────────────────── emit
def emit_readmes():
    flat = [(b, m) for b in BELTS for m in b["missions"]]
    ids = [m["id"] for _, m in flat]
    count = 0
    for i, (belt, m) in enumerate(flat):
        prev_id = ids[i - 1] if i > 0 else None
        next_id = ids[i + 1] if i < len(ids) - 1 else None
        idx = belt["missions"].index(m) + 1
        d = os.path.join(ROOT, "missions", belt["slug"], m["slug"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "README.md"), "w") as f:
            f.write(render_readme(belt, m, idx, prev_id, next_id))
        count += 1
    return count


def emit_missions_js():
    data = {
        "totalXp": total_xp(),
        "belts": [
            {
                "n": b["n"],
                "slug": b["slug"],
                "name": b["name"],
                "color": b["color"],
                "rank": b["rank"],
                "motto": b["motto"],
                "notebook": b.get("notebook", ""),
                "side": bool(b.get("side")),
                "missions": [
                    {
                        "id": m["id"],
                        "slug": m["slug"],
                        "title": m["title"],
                        "tagline": m["tagline"],
                        "xp": m["xp"],
                        "minutes": m["minutes"],
                        "boss": bool(m.get("boss")),
                        "path": f"missions/{b['slug']}/{m['slug']}/README.md",
                        "intro": m["intro"],
                        "learn": m["learn"],
                        "task": m["task"],
                        "artifacts": m["artifacts"],
                        "hints": m["hints"],
                    }
                    for m in b["missions"]
                ],
            }
            for b in BELTS
        ],
    }
    js = (
        "// AUTO-GENERATED by tools/generate.py — do not edit by hand.\n"
        "// Regenerate with:  python3 tools/generate.py\n"
        "window.DOJO_MISSIONS = "
        + json.dumps(data, indent=2, ensure_ascii=False)
        + ";\n"
    )
    with open(os.path.join(ROOT, "game", "missions.js"), "w") as f:
        f.write(js)


def emit_manifest():
    lines = [
        "# AUTO-GENERATED by tools/generate.py — do not edit by hand.",
        "# Format: belt_n|belt_slug|belt_name|mission_id|mission_slug|xp|boss|title",
        "# Consumed by ./check and tools/lib.sh",
    ]
    for b in BELTS:
        for m in b["missions"]:
            title = m["title"].replace("|", "/")
            lines.append(
                f"{b['n']}|{b['slug']}|{b['name']}|{m['id']}|{m['slug']}|"
                f"{m['xp']}|{1 if m.get('boss') else 0}|{title}"
            )
    with open(os.path.join(ROOT, "game", "manifest.sh"), "w") as f:
        f.write("\n".join(lines) + "\n")


def _cheatsheet_groups():
    """Group extras.CHEATSHEET rows by their group, preserving first-seen order."""
    order = []
    groups = {}
    for group, cmd, what in extras.CHEATSHEET:
        if group not in groups:
            groups[group] = []
            order.append(group)
        groups[group].append((cmd, what))
    return [(g, groups[g]) for g in order]


def emit_cheatsheet():
    rows = []
    rows.append("# 🐧 Linux Dojo — One-Page Cheat Sheet\n")
    rows.append("> Every command the dojo teaches, grouped by topic. "
                "Keep this open while you train — it's also searchable inside `./play` (Cheat Sheet tab).\n")
    for title, items in _cheatsheet_groups():
        rows.append(f"\n## {title}\n")
        rows.append("| Command | What it does |")
        rows.append("|---|---|")
        for cmd, desc in items:
            safe = cmd.replace("|", "\\|")
            rows.append(f"| `{safe}` | {desc} |")
    rows.append("\n---\n")
    rows.append("_Generated from `tools/content/extras.py` by `tools/generate.py`. "
                "The dojo is the practice; this page is the map._\n")
    with open(os.path.join(ROOT, "CHEATSHEET.md"), "w") as f:
        f.write("\n".join(rows))


def emit_extras_js():
    data = {
        "rules": extras.RULES,
        "pact": extras.PACT,
        "katas": extras.KATAS,
        "trophies": extras.TROPHIES,
        "rewards": extras.REWARDS,
    }
    js = (
        "// AUTO-GENERATED by tools/generate.py — do not edit by hand.\n"
        "window.DOJO_EXTRAS = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"
    )
    with open(os.path.join(ROOT, "game", "extras.js"), "w") as f:
        f.write(js)


def emit_cheatsheet_js():
    data = [{"group": g, "cmd": c, "what": w} for g, c, w in extras.CHEATSHEET]
    js = (
        "// AUTO-GENERATED by tools/generate.py — do not edit by hand.\n"
        "window.DOJO_CHEATSHEET = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"
    )
    with open(os.path.join(ROOT, "game", "cheatsheet.js"), "w") as f:
        f.write(js)


def emit_flavor_sh():
    """Katas + sensei fortunes for the terminal (./check). Quoted heredocs keep
    the text literal — no shell expansion of backticks/quotes inside."""
    for line in extras.KATAS + extras.FORTUNES:
        assert "\n" not in line and "EOF" not in line, f"flavor line unsafe: {line!r}"
    body = [
        "# AUTO-GENERATED by tools/generate.py — do not edit by hand.",
        "# Sourced by ./check for the kata of the day and sensei fortunes.",
        "DOJO_KATAS=$(cat <<'EOF'",
        *extras.KATAS,
        "EOF",
        ")",
        "DOJO_FORTUNES=$(cat <<'EOF'",
        *extras.FORTUNES,
        "EOF",
        ")",
    ]
    with open(os.path.join(ROOT, "game", "flavor.sh"), "w") as f:
        f.write("\n".join(body) + "\n")


def emit_hints_sh():
    """Tab-delimited 'id<TAB>hint' lines for ./check --hint, plus id|title map."""
    hint_lines, title_lines = [], []
    for b in BELTS:
        for m in b["missions"]:
            title_lines.append(f"{m['id']}\t{m['title']}")
            for h in m["hints"]:
                assert "\n" not in h and "\t" not in h and "EOF" not in h
                hint_lines.append(f"{m['id']}\t{h}")
    body = [
        "# AUTO-GENERATED by tools/generate.py — do not edit by hand.",
        "# Sourced by ./check for the --hint command.",
        "DOJO_HINTS=$(cat <<'EOF'",
        *hint_lines,
        "EOF",
        ")",
        "DOJO_TITLES=$(cat <<'EOF'",
        *title_lines,
        "EOF",
        ")",
    ]
    with open(os.path.join(ROOT, "game", "hints.sh"), "w") as f:
        f.write("\n".join(body) + "\n")



def main():
    os.makedirs(os.path.join(ROOT, "game"), exist_ok=True)
    n = emit_readmes()
    emit_missions_js()
    emit_manifest()
    emit_cheatsheet()
    emit_extras_js()
    emit_cheatsheet_js()
    emit_flavor_sh()
    emit_hints_sh()
    belts = len(BELTS)
    missions = sum(len(b["missions"]) for b in BELTS)
    print(f"✓ {n} mission READMEs")
    print(f"✓ game/missions.js  ({belts} belts, {missions} missions)")
    print(f"✓ game/manifest.sh")
    print(f"✓ game/extras.js  ({len(extras.KATAS)} katas, {len(extras.TROPHIES)} trophies, {len(extras.REWARDS)} rewards)")
    print(f"✓ game/cheatsheet.js  ({len(extras.CHEATSHEET)} commands)")
    print(f"✓ CHEATSHEET.md")
    print(f"✓ total XP available: {total_xp()}")
    # sanity: 45 main-path missions + 3 side quests, all ids unique
    main = sum(len(b["missions"]) for b in BELTS if not b.get("side"))
    assert main == 45, f"expected 45 main missions, got {main}"
    assert missions == 48, f"expected 48 total missions, got {missions}"
    ids = [m["id"] for b in BELTS for m in b["missions"]]
    assert len(set(ids)) == 48, "duplicate mission ids!"
    assert total_xp() == 6500, f"expected 6500 total XP, got {total_xp()}"
    print("✓ sanity checks passed (45 main + 3 side quests, unique ids)")


if __name__ == "__main__":
    main()
