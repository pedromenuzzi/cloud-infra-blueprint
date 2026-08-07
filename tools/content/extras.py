# Cross-cutting game content: the rules & pact, katas, trophies, rewards, and
# the searchable cheat sheet. Single source of truth — rendered by generate.py
# into game/extras.js, game/cheatsheet.js and CHEATSHEET.md.

# ── The spine: three rules + the pact (kept visible everywhere) ──────────────
RULES = [
    "Everything happens inside the repo. Never run a destructive command outside your dojo.",
    "Use `sudo` only when a mission tells you to — with sudo, Linux obeys even dumb orders.",
    "`rm` has no trash can: once it's deleted, it's gone. Respect it.",
]

PACT = [
    "Type everything by hand — no pasting. The memory goes to your fingers.",
    "Stuck? Reach for `man <cmd>` or `<cmd> --help` **before** any AI.",
    "Fumbling a command *is* the training. Every error is a rep.",
]

# ── Kata of the day (rotates deterministically by date) ──────────────────────
KATAS = [
    "Without looking anything up: create a tree of 3 folders with one command, a file in each, and list it all with `ls -R`.",
    "Find every file in the repo modified in the last 24h (`find . -mtime -1`).",
    "Build a pipeline that counts how many unique words a text file has.",
    "In vim, write 5 lines, duplicate the last (`yy p`), replace a word everywhere (`:%s`) and save.",
    "Start a `sleep` in the background, find its PID with a pipeline, and kill it without typing the number by hand.",
    "Translate to octal and apply: a file only you can read/write, and the group can only read.",
    "Find the 3 largest folders under your home with `du` + `sort`.",
    "Serve a folder with `python3 -m http.server`, confirm the port with `ss -tlnp`, `curl` it, then take it down.",
    "Write a one-liner that appends the date and time to `diary.log` every time it runs.",
    "Find which package owns the `grep` command (`which` + your distro's package query).",
    "Create a new alias in your shell rc, reload it with `source`, and use it.",
    "Read the last 20 log lines of a service with `journalctl -u <service>` (on a systemd box).",
    "Generate 100 lines of fake log and extract only the ones containing ERROR into a file.",
    "Compress a folder with `tar -czf` and list its contents without extracting (`-tzf`).",
    "In `man find`, discover an option you've never used and try it.",
    "Write an `if` in a script that checks a folder exists and complains on stderr if it doesn't.",
    "Rank your most-used commands (`history` + `awk` + `sort` + `uniq`).",
    "Diagnose a host: find your IP, test DNS with a lookup, and grab a site's headers with `curl -I`.",
    "Suspend a process with Ctrl+Z, list it with `jobs`, send it to the background with `bg`, bring it back with `fg`.",
    "Read a permission string like `-rwxr-x---` out loud, then write its octal from memory.",
]

# ── Trophies (derived from progress; `cond` interpreted by the frontend) ─────
# cond types: {"type":"first"} first mission done; {"type":"belt","n":N} belt N
# complete; {"type":"pct","v":P} at least P% of missions; {"type":"all"} 100%.
TROPHIES = [
    {"icon": "🐣", "title": "First Step",       "desc": "Cleared your very first mission",      "cond": {"type": "first"}},
    {"icon": "🌳", "title": "Gardener",         "desc": "White Belt complete — the file tree",  "cond": {"type": "belt", "n": 1}},
    {"icon": "📦", "title": "Wrangler",         "desc": "Yellow Belt complete — cp/mv/rm/find", "cond": {"type": "belt", "n": 2}},
    {"icon": "🪠", "title": "Unix Plumber",     "desc": "Orange Belt complete — pipes & text",  "cond": {"type": "belt", "n": 3}},
    {"icon": "🔐", "title": "Gatekeeper",       "desc": "Green Belt complete — permissions",    "cond": {"type": "belt", "n": 4}},
    {"icon": "💀", "title": "PID Tamer",        "desc": "Blue Belt complete — processes",       "cond": {"type": "belt", "n": 5}},
    {"icon": "🌐", "title": "Net Runner",       "desc": "Purple Belt complete — networking",    "cond": {"type": "belt", "n": 6}},
    {"icon": "🤖", "title": "Automator",        "desc": "Brown Belt complete — scripting",      "cond": {"type": "belt", "n": 7}},
    {"icon": "🗺️", "title": "Cartographer",     "desc": "Red Belt complete — system craft",     "cond": {"type": "belt", "n": 8}},
    {"icon": "🏁", "title": "Halfway There",    "desc": "Reached 50% of the dojo",              "cond": {"type": "pct", "v": 50}},
    {"icon": "👹", "title": "Boss Slayer",      "desc": "Cleared the final Black Belt trial",   "cond": {"type": "mission", "id": "9.5"}},
    {"icon": "🥋", "title": "BLACK BELT",       "desc": "100% — you finished the dojo",         "cond": {"type": "all"}},
]

# ── Real-life rewards (unlock by belt; text is editable in the board) ────────
# Off-screen prizes you promise yourself. Keyed by the belt whose completion
# unlocks them.
REWARDS = [
    {"belt": 2, "label": "Yellow Belt", "default": "a fancy açaí / your favorite treat 🍧"},
    {"belt": 3, "label": "Orange Belt", "default": "a guilt-free afternoon of your show 📺"},
    {"belt": 4, "label": "Green Belt",  "default": "a new game or a fresh skin 🎮"},
    {"belt": 5, "label": "Blue Belt",   "default": "your favorite pizza night 🍕"},
    {"belt": 6, "label": "Purple Belt", "default": "a totally free day 🏖️"},
    {"belt": 7, "label": "Brown Belt",  "default": "an upgrade for your setup 🖥️"},
    {"belt": 8, "label": "Red Belt",    "default": "a proper dinner out 🍜"},
    {"belt": 9, "label": "Black Belt",  "default": "a black-belt celebration — you decide 🏆"},
]

# ── Searchable cheat sheet (one source → CHEATSHEET.md + in-board search) ─────
# Each entry: [group, command, what it does]
CHEATSHEET = [
    ["Navigate", "pwd", "where am I"],
    ["Navigate", "cd - / cd ~ / cd ..", "previous dir / home / parent"],
    ["Navigate", "ls -lath", "long + hidden + by date + human sizes"],
    ["Navigate", "mkdir -p a/b/{c,d}", "build a whole tree at once"],
    ["Files", "cp -r src dst", "copy (dirs need -r)"],
    ["Files", "mv old new", "move AND rename"],
    ["Files", "rm -r dir", "delete, no trash — respect it"],
    ["Files", "ln -s target link", "symbolic link (shortcut)"],
    ["Files", "file mystery", "what kind of file is this?"],
    ["Read", "cat / less / head -n / tail -n", "dump / page / first / last lines"],
    ["Read", "tail -f app.log", "follow a log live (Ctrl+C quits)"],
    ["Read", "wc -l file", "count lines"],
    ["Vim", "i · Esc · :wq · :q!", "insert · normal · save+quit · quit no-save"],
    ["Vim", "dd yy p u", "delete line, yank, paste, undo"],
    ["Vim", "/search  n  ·  :%s/a/b/g", "search/next · replace everywhere"],
    ["Vim", "vimtutor", "the 15-minute tutorial that saves a year of pain"],
    ["Permissions", "chmod u+x script.sh", "add execute for the owner"],
    ["Permissions", "chmod 755 / 700 / 644 / 600", "the four classics (r4 w2 x1)"],
    ["Permissions", "sudo chown user:group file", "change owner and group"],
    ["Permissions", "umask 027", "666-027=640 files, 777-027=750 dirs"],
    ["Permissions", "id", "your uid, gid and groups"],
    ["Pipes", "cmd1 | cmd2", "stdout of one becomes stdin of the next"],
    ["Pipes", "> >> 2> 2>&1", "overwrite / append / errors only / all together"],
    ["Pipes", "sort | uniq -c | sort -rn", "the frequency-table idiom"],
    ["Pipes", "tee file", "show on screen AND save"],
    ["Pipes", "xargs cmd", "turn stdin into arguments"],
    ["Hunt", "grep -rn 'pat' dir/", "search everything, with line numbers"],
    ["Hunt", "grep -i / -v / -c", "ignore case / invert / count"],
    ["Hunt", "find . -name '*.log'", "find by name"],
    ["Hunt", "find . -type f -size +10M -mtime -7", "by type, size, age"],
    ["Transform", "sed -i.bak 's/old/new/g' f", "replace in place (portable, keeps .bak)"],
    ["Transform", "tr a-z A-Z < f", "translate characters"],
    ["Transform", "awk '{print $2}'", "print the 2nd column"],
    ["Transform", "awk -F: '{print $1}' /etc/passwd", "custom field separator"],
    ["Transform", "cut -d, -f1,3", "columns 1 and 3 of a CSV"],
    ["Processes", "ps aux | grep name", "find a process"],
    ["Processes", "top / htop", "live dashboard (F9 kills in htop)"],
    ["Processes", "kill PID / kill -9 PID", "ask nicely (TERM) / force (KILL)"],
    ["Processes", "pkill -f 'pattern'", "signal by name/pattern"],
    ["Processes", "cmd & · jobs · fg · bg · Ctrl+Z", "background · list · front · resume · suspend"],
    ["Processes", "nohup cmd >log 2>&1 &", "survive logout, capture output"],
    ["Services", "systemctl status svc", "state + last log lines"],
    ["Services", "sudo systemctl restart/enable svc", "restart / start on boot"],
    ["Services", "journalctl -u svc -n 50 -f", "a service's logs (50, live)"],
    ["Packages", "sudo apt update && sudo apt upgrade", "refresh catalog + upgrade installed"],
    ["Packages", "apt search / apt show pkg", "find / inspect a package"],
    ["Packages", "dpkg -L pkg  /  dpkg -S path", "what it installed / who owns a file"],
    ["Packages", "dnf … / pacman -S …", "Fedora/RHEL … / Arch equivalents"],
    ["Packages", "which cmd", "where the executable lives"],
    ["Scripts", "#!/usr/bin/env bash", "shebang: who runs this file"],
    ["Scripts", "set -euo pipefail", "strict mode: exit-on-error, no-unset, pipe-safe"],
    ["Scripts", "$1 $2 $# $? $@", "args, count, last exit code, all args"],
    ["Scripts", "if [ -d \"$X\" ]; then … fi", "test a dir (-f file, -e exists)"],
    ["Scripts", "for f in *.log; do … done", "loop over files"],
    ["Scripts", "VAR=${1:-default}", "argument with a default value"],
    ["Cron", "crontab -e  /  crontab -l", "edit / list schedules"],
    ["Cron", "*/5 * * * * command", "every 5 min (min h dom mon dow)"],
    ["Network", "ip a", "interfaces and IPs"],
    ["Network", "ping -c 3 host", "can I reach it?"],
    ["Network", "dig domain +short", "does DNS resolve?"],
    ["Network", "curl -I url  /  curl -s url", "headers / silent body"],
    ["Network", "ss -tlnp", "listening ports + which process"],
    ["Network", "ssh-keygen -t ed25519", "generate a key pair"],
    ["Network", "ssh user@host  /  scp f user@host:~/", "remote shell / copy over ssh"],
    ["Git & SSH", "git init / add / commit -m", "start a repo, stage, commit"],
    ["Git & SSH", "git checkout -- file", "restore a file — your time machine"],
    ["Git & SSH", "cat ~/.ssh/id_ed25519.pub", "the PUBLIC key (the one you share)"],
    ["Git & SSH", "ssh -T git@github.com", "test your GitHub SSH auth"],
    ["Disk", "df -h", "free space per filesystem"],
    ["Disk", "du -sh */ | sort -rh", "what's taking the most space"],
    ["Disk", "ncdu", "interactive disk explorer"],
    ["Disk", "tar -czf x.tgz dir / tar -xzf x.tgz", "compress / extract (-tzf lists)"],
    ["System", "free -h / uname -a / cat /etc/os-release", "RAM / kernel / distro"],
    ["System", "/etc  /var/log  /proc  /tmp", "configs / logs / kernel x-ray / scratch"],
    ["Env", "export VAR=v ; echo $PATH", "environment vars ; the command search path"],
    ["Env", "echo 'alias ll=\"ls -lah\"' >> ~/.bashrc && source ~/.bashrc", "a permanent alias"],
    ["Help", "man cmd · cmd --help · tldr cmd", "manual · summary · examples"],
    ["WSL", "wsl --install  (PowerShell as admin)", "install WSL2 + Ubuntu in one command"],
    ["WSL", "/mnt/c", "your Windows drive, seen from Linux"],
    ["WSL", "wsl --shutdown  (PowerShell)", "restart the WSL engine"],
    ["WSL", "\\\\wsl$\\Ubuntu  (in Explorer)", "your Linux files, seen from Windows"],
]
