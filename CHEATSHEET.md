# 🐧 Linux Dojo — One-Page Cheat Sheet

> Every command the dojo teaches, grouped by belt. Keep this open while you train.


## White · Getting around

| Command | What it does |
|---|---|
| `pwd` | print working directory (where am I) |
| `ls -la` | list all files, long format (perms, size, date) |
| `cd dir / cd .. / cd -` | move down / up / back to previous dir |
| `mkdir -p a/b/c` | create a directory path, parents included |
| `touch file` | create an empty file / update its timestamp |
| `cat / less / head -n / tail -n` | read whole / page / first N / last N lines |
| `wc -l file` | count lines |
| `echo text > file  /  >> file` | write (overwrite) / append to a file |

## Yellow · Moving matter

| Command | What it does |
|---|---|
| `cp -r src dst` | copy (recursively for dirs) |
| `mv src dst` | move or rename |
| `rm file  /  rm -r dir` | delete file / directory (no undo!) |
| `*.jpg  photo-*  ?.txt  [abc]` | glob patterns (expanded by the shell) |
| `mkdir -p x/{a,b,c}` | brace expansion |
| `find dir -name '*.conf' -type f -size +50k` | search the tree by predicate |
| `find dir -name '*.tmp' -delete` | act on results |

## Orange · Text power

| Command | What it does |
|---|---|
| `cmd1 | cmd2` | pipe: stdout of one → stdin of next |
| `sort | uniq -c | sort -nr | head` | the frequency-table idiom (top-N) |
| `grep -i / -c / -v / -n / -E 'pat' f` | search: insensitive/count/invert/numbered/regex |
| `cut -d, -f2 file` | slice column 2 (comma-delimited) |
| `tail -n +2 file` | skip the header line |
| `sort -t, -k3 -nr` | sort by column 3, numeric, reversed |
| `tr a-z A-Z < file` | translate characters |
| `sed 's/old/new/g' file` | substitute text |
| `sed -i.bak 's/a/b/g' file` | edit in place (portable, keeps backup) |

## Green · Permissions

| Command | What it does |
|---|---|
| `ls -l  →  -rwxr-xr--` | type + user/group/other × rwx |
| `rwx = 4+2+1 = 7` | octal: 644 file, 755 dir/exec, 600 private |
| `chmod 640 file  /  chmod +x file` | set octal / add execute |
| `chmod -R 755 dir  /  u+X` | recursive / smart-execute |
| `umask 027` | 666-027=640 files, 777-027=750 dirs |
| `id / whoami / groups` | your identity and groups |
| `/etc/passwd  (7 : fields)` | user:x:uid:gid:name:home:shell |
| `sudo -l / sudo -u user cmd` | what may I run / run as another user |

## Blue · Processes

| Command | What it does |
|---|---|
| `ps aux  /  ps -ef` | snapshot of all processes (PPID in -ef) |
| `top / htop` | live process dashboard |
| `echo $$` | my shell's PID |
| `kill -15 PID  /  kill -9 PID` | TERM (ask) / KILL (force) |
| `pgrep -f name / pkill -f name` | find / signal by command name |
| `cmd &  /  jobs / fg / bg` | background / manage jobs |
| `Ctrl+Z then bg` | suspend then resume in background |
| `nohup cmd > log 2>&1 &` | survive logout, capture output |
| `df -h / du -sh * / free -h / uptime` | disk / dir size / memory / load |

## Purple · Networking

| Command | What it does |
|---|---|
| `ip addr  /  ip route` | interfaces & addresses / routing table |
| `ss -tlnp  /  netstat -tlnp` | listening TCP sockets + process |
| `0.0.0.0 vs 127.0.0.1` | world-reachable vs local-only bind |
| `curl -I / -s / -o / -w '%{http_code}'` | headers / silent / save / status only |
| `python3 -m http.server 8099` | serve current dir over HTTP |
| `ssh-keygen -t ed25519 -f key` | generate a keypair (600 the private key!) |
| `~/.ssh/config  Host nickname` | connect by nickname; never commit private keys |

## Brown · Scripting

| Command | What it does |
|---|---|
| `#!/usr/bin/env bash` | the shebang (first line) |
| `chmod +x s.sh ; ./s.sh` | make runnable, run it |
| `exit 0 / exit 1 ; echo $?` | success / failure ; last exit code |
| `name="v" ; echo "$name"` | assign (no spaces) ; expand (quote it!) |
| `x=$(cmd) ; n=$(( a + b ))` | command substitution ; arithmetic |
| `$1 $2 $# $@ $0` | args / count / all / script name |
| `if [ -f f ]; then … elif … else … fi` | file test & branching |
| `[ = ] strings, [ -eq ] numbers, >&2` | compare ; errors to stderr |
| `for x in *; do … done ; while …` | loops |
| `name() { local v="$1"; echo …; }` | functions |

## Red · System craft

| Command | What it does |
|---|---|
| `tar -czf / -tzf / -xzf a.tar.gz` | Create / lisT / eXtract (z=gzip, f=file) |
| `gzip / gunzip / zcat` | compress / decompress / read compressed |
| `export VAR=v ; env ; printenv` | environment variables |
| `echo $PATH ; which cmd ; type cmd` | search path ; where ; what kind |
| `source ~/.bashrc  (. file)` | run in current shell (affects it) |
| `crontab -e / -l   ·  min hr dom mon dow` | schedule ; the five fields |
| `*/15 * * * *  ·  30 18 * * 1` | every 15 min ; 18:30 Mondays |
| `apt / dnf / pacman  install|remove` | package managers by family |

## Black · Mastery

| Command | What it does |
|---|---|
| `set -euo pipefail` | strict mode: exit-on-error, no-unset, pipe-safe |
| `${1:-default}` | safe default under set -u |
| `ln -s target link ; readlink link` | create symlink ; show its target |
| `kill -0 PID` | liveness probe (no signal sent) |
| `printf '{"k":"%s"}' "$v"` | emit JSON without dependencies |
| `mkdir -p ; overwrite copies` | idempotency — safe to re-run |

---

_Generated from the curriculum by `tools/generate.py`. The dojo is the practice; this page is the map._
