# 🐧 Linux Dojo — One-Page Cheat Sheet

> Every command the dojo teaches, grouped by topic. Keep this open while you train — it's also searchable inside `./play` (Cheat Sheet tab).


## Navigate

| Command | What it does |
|---|---|
| `pwd` | where am I |
| `cd - / cd ~ / cd ..` | previous dir / home / parent |
| `ls -lath` | long + hidden + by date + human sizes |
| `mkdir -p a/b/{c,d}` | build a whole tree at once |

## Files

| Command | What it does |
|---|---|
| `cp -r src dst` | copy (dirs need -r) |
| `mv old new` | move AND rename |
| `rm -r dir` | delete, no trash — respect it |
| `ln -s target link` | symbolic link (shortcut) |
| `file mystery` | what kind of file is this? |

## Read

| Command | What it does |
|---|---|
| `cat / less / head -n / tail -n` | dump / page / first / last lines |
| `tail -f app.log` | follow a log live (Ctrl+C quits) |
| `wc -l file` | count lines |

## Vim

| Command | What it does |
|---|---|
| `i · Esc · :wq · :q!` | insert · normal · save+quit · quit no-save |
| `dd yy p u` | delete line, yank, paste, undo |
| `/search  n  ·  :%s/a/b/g` | search/next · replace everywhere |
| `vimtutor` | the 15-minute tutorial that saves a year of pain |

## Permissions

| Command | What it does |
|---|---|
| `chmod u+x script.sh` | add execute for the owner |
| `chmod 755 / 700 / 644 / 600` | the four classics (r4 w2 x1) |
| `sudo chown user:group file` | change owner and group |
| `umask 027` | 666-027=640 files, 777-027=750 dirs |
| `id` | your uid, gid and groups |

## Pipes

| Command | What it does |
|---|---|
| `cmd1 \| cmd2` | stdout of one becomes stdin of the next |
| `> >> 2> 2>&1` | overwrite / append / errors only / all together |
| `sort \| uniq -c \| sort -rn` | the frequency-table idiom |
| `tee file` | show on screen AND save |
| `xargs cmd` | turn stdin into arguments |

## Hunt

| Command | What it does |
|---|---|
| `grep -rn 'pat' dir/` | search everything, with line numbers |
| `grep -i / -v / -c` | ignore case / invert / count |
| `find . -name '*.log'` | find by name |
| `find . -type f -size +10M -mtime -7` | by type, size, age |

## Transform

| Command | What it does |
|---|---|
| `sed -i.bak 's/old/new/g' f` | replace in place (portable, keeps .bak) |
| `tr a-z A-Z < f` | translate characters |
| `awk '{print $2}'` | print the 2nd column |
| `awk -F: '{print $1}' /etc/passwd` | custom field separator |
| `cut -d, -f1,3` | columns 1 and 3 of a CSV |

## Processes

| Command | What it does |
|---|---|
| `ps aux \| grep name` | find a process |
| `top / htop` | live dashboard (F9 kills in htop) |
| `kill PID / kill -9 PID` | ask nicely (TERM) / force (KILL) |
| `pkill -f 'pattern'` | signal by name/pattern |
| `cmd & · jobs · fg · bg · Ctrl+Z` | background · list · front · resume · suspend |
| `nohup cmd >log 2>&1 &` | survive logout, capture output |

## Services

| Command | What it does |
|---|---|
| `systemctl status svc` | state + last log lines |
| `sudo systemctl restart/enable svc` | restart / start on boot |
| `journalctl -u svc -n 50 -f` | a service's logs (50, live) |

## Packages

| Command | What it does |
|---|---|
| `sudo apt update && sudo apt upgrade` | refresh catalog + upgrade installed |
| `apt search / apt show pkg` | find / inspect a package |
| `dpkg -L pkg  /  dpkg -S path` | what it installed / who owns a file |
| `dnf … / pacman -S …` | Fedora/RHEL … / Arch equivalents |
| `which cmd` | where the executable lives |

## Scripts

| Command | What it does |
|---|---|
| `#!/usr/bin/env bash` | shebang: who runs this file |
| `set -euo pipefail` | strict mode: exit-on-error, no-unset, pipe-safe |
| `$1 $2 $# $? $@` | args, count, last exit code, all args |
| `if [ -d "$X" ]; then … fi` | test a dir (-f file, -e exists) |
| `for f in *.log; do … done` | loop over files |
| `VAR=${1:-default}` | argument with a default value |

## Cron

| Command | What it does |
|---|---|
| `crontab -e  /  crontab -l` | edit / list schedules |
| `*/5 * * * * command` | every 5 min (min h dom mon dow) |

## Network

| Command | What it does |
|---|---|
| `ip a` | interfaces and IPs |
| `ping -c 3 host` | can I reach it? |
| `dig domain +short` | does DNS resolve? |
| `curl -I url  /  curl -s url` | headers / silent body |
| `ss -tlnp` | listening ports + which process |
| `ssh-keygen -t ed25519` | generate a key pair |
| `ssh user@host  /  scp f user@host:~/` | remote shell / copy over ssh |

## Git & SSH

| Command | What it does |
|---|---|
| `git init / add / commit -m` | start a repo, stage, commit |
| `git checkout -- file` | restore a file — your time machine |
| `cat ~/.ssh/id_ed25519.pub` | the PUBLIC key (the one you share) |
| `ssh -T git@github.com` | test your GitHub SSH auth |

## Disk

| Command | What it does |
|---|---|
| `df -h` | free space per filesystem |
| `du -sh */ \| sort -rh` | what's taking the most space |
| `ncdu` | interactive disk explorer |
| `tar -czf x.tgz dir / tar -xzf x.tgz` | compress / extract (-tzf lists) |

## System

| Command | What it does |
|---|---|
| `free -h / uname -a / cat /etc/os-release` | RAM / kernel / distro |
| `/etc  /var/log  /proc  /tmp` | configs / logs / kernel x-ray / scratch |

## Env

| Command | What it does |
|---|---|
| `export VAR=v ; echo $PATH` | environment vars ; the command search path |
| `echo 'alias ll="ls -lah"' >> ~/.bashrc && source ~/.bashrc` | a permanent alias |

## Help

| Command | What it does |
|---|---|
| `man cmd · cmd --help · tldr cmd` | manual · summary · examples |

## WSL

| Command | What it does |
|---|---|
| `wsl --install  (PowerShell as admin)` | install WSL2 + Ubuntu in one command |
| `/mnt/c` | your Windows drive, seen from Linux |
| `wsl --shutdown  (PowerShell)` | restart the WSL engine |
| `\\wsl$\Ubuntu  (in Explorer)` | your Linux files, seen from Windows |

---

_Generated from `tools/content/extras.py` by `tools/generate.py`. The dojo is the practice; this page is the map._
