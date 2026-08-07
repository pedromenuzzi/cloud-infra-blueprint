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

from content import belt1, belt2, belt3, belt4, belt5, belt6, belt7, belt8, belt9  # noqa: E402

BELTS = [b.BELT for b in (belt1, belt2, belt3, belt4, belt5, belt6, belt7, belt8, belt9)]


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


def emit_cheatsheet():
    rows = []
    rows.append("# 🐧 Linux Dojo — One-Page Cheat Sheet\n")
    rows.append("> Every command the dojo teaches, grouped by belt. "
                "Keep this open while you train.\n")
    groups = [
        ("White · Getting around", [
            ("pwd", "print working directory (where am I)"),
            ("ls -la", "list all files, long format (perms, size, date)"),
            ("cd dir / cd .. / cd -", "move down / up / back to previous dir"),
            ("mkdir -p a/b/c", "create a directory path, parents included"),
            ("touch file", "create an empty file / update its timestamp"),
            ("cat / less / head -n / tail -n", "read whole / page / first N / last N lines"),
            ("wc -l file", "count lines"),
            ("echo text > file  /  >> file", "write (overwrite) / append to a file"),
        ]),
        ("Yellow · Moving matter", [
            ("cp -r src dst", "copy (recursively for dirs)"),
            ("mv src dst", "move or rename"),
            ("rm file  /  rm -r dir", "delete file / directory (no undo!)"),
            ("*.jpg  photo-*  ?.txt  [abc]", "glob patterns (expanded by the shell)"),
            ("mkdir -p x/{a,b,c}", "brace expansion"),
            ("find dir -name '*.conf' -type f -size +50k", "search the tree by predicate"),
            ("find dir -name '*.tmp' -delete", "act on results"),
        ]),
        ("Orange · Text power", [
            ("cmd1 | cmd2", "pipe: stdout of one → stdin of next"),
            ("sort | uniq -c | sort -nr | head", "the frequency-table idiom (top-N)"),
            ("grep -i / -c / -v / -n / -E 'pat' f", "search: insensitive/count/invert/numbered/regex"),
            ("cut -d, -f2 file", "slice column 2 (comma-delimited)"),
            ("tail -n +2 file", "skip the header line"),
            ("sort -t, -k3 -nr", "sort by column 3, numeric, reversed"),
            ("tr a-z A-Z < file", "translate characters"),
            ("sed 's/old/new/g' file", "substitute text"),
            ("sed -i.bak 's/a/b/g' file", "edit in place (portable, keeps backup)"),
        ]),
        ("Green · Permissions", [
            ("ls -l  →  -rwxr-xr--", "type + user/group/other × rwx"),
            ("rwx = 4+2+1 = 7", "octal: 644 file, 755 dir/exec, 600 private"),
            ("chmod 640 file  /  chmod +x file", "set octal / add execute"),
            ("chmod -R 755 dir  /  u+X", "recursive / smart-execute"),
            ("umask 027", "666-027=640 files, 777-027=750 dirs"),
            ("id / whoami / groups", "your identity and groups"),
            ("/etc/passwd  (7 : fields)", "user:x:uid:gid:name:home:shell"),
            ("sudo -l / sudo -u user cmd", "what may I run / run as another user"),
        ]),
        ("Blue · Processes", [
            ("ps aux  /  ps -ef", "snapshot of all processes (PPID in -ef)"),
            ("top / htop", "live process dashboard"),
            ("echo $$", "my shell's PID"),
            ("kill -15 PID  /  kill -9 PID", "TERM (ask) / KILL (force)"),
            ("pgrep -f name / pkill -f name", "find / signal by command name"),
            ("cmd &  /  jobs / fg / bg", "background / manage jobs"),
            ("Ctrl+Z then bg", "suspend then resume in background"),
            ("nohup cmd > log 2>&1 &", "survive logout, capture output"),
            ("df -h / du -sh * / free -h / uptime", "disk / dir size / memory / load"),
        ]),
        ("Purple · Networking", [
            ("ip addr  /  ip route", "interfaces & addresses / routing table"),
            ("ss -tlnp  /  netstat -tlnp", "listening TCP sockets + process"),
            ("0.0.0.0 vs 127.0.0.1", "world-reachable vs local-only bind"),
            ("curl -I / -s / -o / -w '%{http_code}'", "headers / silent / save / status only"),
            ("python3 -m http.server 8099", "serve current dir over HTTP"),
            ("ssh-keygen -t ed25519 -f key", "generate a keypair (600 the private key!)"),
            ("~/.ssh/config  Host nickname", "connect by nickname; never commit private keys"),
        ]),
        ("Brown · Scripting", [
            ("#!/usr/bin/env bash", "the shebang (first line)"),
            ("chmod +x s.sh ; ./s.sh", "make runnable, run it"),
            ("exit 0 / exit 1 ; echo $?", "success / failure ; last exit code"),
            ("name=\"v\" ; echo \"$name\"", "assign (no spaces) ; expand (quote it!)"),
            ("x=$(cmd) ; n=$(( a + b ))", "command substitution ; arithmetic"),
            ("$1 $2 $# $@ $0", "args / count / all / script name"),
            ("if [ -f f ]; then … elif … else … fi", "file test & branching"),
            ("[ = ] strings, [ -eq ] numbers, >&2", "compare ; errors to stderr"),
            ("for x in *; do … done ; while …", "loops"),
            ("name() { local v=\"$1\"; echo …; }", "functions"),
        ]),
        ("Red · System craft", [
            ("tar -czf / -tzf / -xzf a.tar.gz", "Create / lisT / eXtract (z=gzip, f=file)"),
            ("gzip / gunzip / zcat", "compress / decompress / read compressed"),
            ("export VAR=v ; env ; printenv", "environment variables"),
            ("echo $PATH ; which cmd ; type cmd", "search path ; where ; what kind"),
            ("source ~/.bashrc  (. file)", "run in current shell (affects it)"),
            ("crontab -e / -l   ·  min hr dom mon dow", "schedule ; the five fields"),
            ("*/15 * * * *  ·  30 18 * * 1", "every 15 min ; 18:30 Mondays"),
            ("apt / dnf / pacman  install|remove", "package managers by family"),
        ]),
        ("Black · Mastery", [
            ("set -euo pipefail", "strict mode: exit-on-error, no-unset, pipe-safe"),
            ("${1:-default}", "safe default under set -u"),
            ("ln -s target link ; readlink link", "create symlink ; show its target"),
            ("kill -0 PID", "liveness probe (no signal sent)"),
            ("printf '{\"k\":\"%s\"}' \"$v\"", "emit JSON without dependencies"),
            ("mkdir -p ; overwrite copies", "idempotency — safe to re-run"),
        ]),
    ]
    for title, items in groups:
        rows.append(f"\n## {title}\n")
        rows.append("| Command | What it does |")
        rows.append("|---|---|")
        for cmd, desc in items:
            rows.append(f"| `{cmd}` | {desc} |")
    rows.append("\n---\n")
    rows.append("_Generated from the curriculum by `tools/generate.py`. "
                "The dojo is the practice; this page is the map._\n")
    with open(os.path.join(ROOT, "CHEATSHEET.md"), "w") as f:
        f.write("\n".join(rows))


def main():
    os.makedirs(os.path.join(ROOT, "game"), exist_ok=True)
    n = emit_readmes()
    emit_missions_js()
    emit_manifest()
    emit_cheatsheet()
    belts = len(BELTS)
    missions = sum(len(b["missions"]) for b in BELTS)
    print(f"✓ {n} mission READMEs")
    print(f"✓ game/missions.js  ({belts} belts, {missions} missions)")
    print(f"✓ game/manifest.sh")
    print(f"✓ CHEATSHEET.md")
    print(f"✓ total XP available: {total_xp()}")
    # sanity: 45 missions, unique ids/slugs
    assert missions == 45, f"expected 45 missions, got {missions}"
    ids = [m["id"] for b in BELTS for m in b["missions"]]
    assert len(set(ids)) == 45, "duplicate mission ids!"
    print("✓ sanity checks passed (45 unique missions)")


if __name__ == "__main__":
    main()
