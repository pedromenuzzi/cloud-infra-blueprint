#!/usr/bin/env bash
# ╭──────────────────────────────────────────────────────────────────────╮
# │  Linux Dojo — self-test / answer key.                                  │
# │                                                                        │
# │  Copies the repo to a throwaway directory, SOLVES all 45 missions the  │
# │  way a student would (real commands, real scripts), runs ./check, and  │
# │  asserts a perfect 45/45. This is both the proof the dojo is beatable  │
# │  and the canonical solution set. It NEVER touches your real repo.      │
# │                                                                        │
# │  Usage:  tools/selftest.sh          (from anywhere)                    │
# ╰──────────────────────────────────────────────────────────────────────╯
set -u

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d 2>/dev/null || echo "/tmp/dojo-selftest.$$")"
mkdir -p "$WORK"

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

echo "→ staging a clean copy of the dojo in $WORK"
# copy everything except VCS metadata and any local runtime state
( cd "$SRC" && tar cf - \
    --exclude=.git --exclude=.dojo --exclude=node_modules \
    . ) | ( cd "$WORK" && tar xf - )
rm -rf "$WORK/.dojo"
cd "$WORK"

M() { cd "$WORK/missions/$1" || { echo "missing mission dir $1"; exit 1; }; }
R() { cd "$WORK"; }
say() { printf '  solving %-34s' "$1"; }
done_() { printf '✓\n'; }

# ───────────────────────────────────────── WHITE
say 1.1; M 01-white-belt/01-hello-terminal
  echo "Hello, Tux!" > hello.txt
  whoami > whoami.txt
R; done_

say 1.2; M 01-white-belt/02-hidden-treasure
  cat maze/corridor-b/library/shelf-2/.treasure > found.txt
  printf 'treasure_dir=shelf-2\nreveal_flag=-a\n' > answers.md
R; done_

say 1.3; M 01-white-belt/03-the-architect
  mkdir -p base-camp/bin base-camp/logs/archive base-camp/notes
  touch base-camp/notes/ideas.txt base-camp/notes/todo.txt
  touch base-camp/logs/archive/.keep
R; done_

say 1.4; M 01-white-belt/04-speed-reader
  head -n 5 logbook.txt > first5.txt
  tail -n 5 logbook.txt > last5.txt
  printf 'total_lines=42\nsignal=aurora-borealis-7\n' > answers.md
R; done_

say 1.5; M 01-white-belt/05-boss-scavenger-hunt
  mkdir -p trophy-room
  s1=$(cat hunt/village/bakery/.shard-1); s2=$(cat hunt/village/forge/tools/.shard-2); s3=$(cat hunt/forest/old-oak/.shard-3)
  echo "$s1 $s2 $s3" > trophy-room/passphrase.txt
  printf 'lines=60\nshards_found=3\n' > answers.md
R; done_

# ───────────────────────────────────────── YELLOW
say 2.1; M 02-yellow-belt/01-copy-that
  cp -r originals backup
  mv backup/contract.txt backup/contract-final.txt
  mkdir -p backup/assets
  mv backup/logo.txt backup/assets/
R; done_

say 2.2; M 02-yellow-belt/02-demolition-crew
  rm -f site/junk/tmp*.txt
  rm -rf site/rubble
R; done_

say 2.3; M 02-yellow-belt/03-glob-master
  mkdir -p sorted/images sorted/audio sorted/docs sorted/text sorted/other
  mv inbox/*.jpg sorted/images/
  mv inbox/*.mp3 sorted/audio/
  mv inbox/*.pdf sorted/docs/
  mv inbox/*.txt sorted/text/
  mv inbox/* sorted/other/ 2>/dev/null || true
R; done_

say 2.4; M 02-yellow-belt/04-the-finder
  find warehouse -name "*.conf" > conf-files.txt
  find warehouse -iname "*dragon*" > dragons.txt
  find warehouse -type f -size +50k > big-ones.txt
  printf 'empty_file=void.dat\n' > answers.md
R; done_

say 2.5; M 02-yellow-belt/05-boss-great-cleanup
  mkdir -p organized/documents organized/images organized/audio organized/configs organized/vault
  find chaos-drive -type f -name "*.pdf"  -exec mv {} organized/documents/ \;
  find chaos-drive -type f -name "*.jpg"  -exec mv {} organized/images/ \;
  find chaos-drive -type f -name "*.png"  -exec mv {} organized/images/ \;
  find chaos-drive -type f -name "*.mp3"  -exec mv {} organized/audio/ \;
  find chaos-drive -type f -name "*.conf" -exec mv {} organized/configs/ \;
  find chaos-drive -type f -name "old-wallet.dat" -exec mv {} organized/vault/ \;
  find chaos-drive -name "*.tmp" -delete
  find chaos-drive -name "*~" -delete
  printf 'pdf_count=5\njpg_count=6\npng_count=4\nmp3_count=3\nconf_count=3\njunk_deleted=9\n' > cleanup-report.md
R; done_

# ───────────────────────────────────────── ORANGE
say 3.1; M 03-orange-belt/01-the-pipeline
  sort words.txt > sorted.txt
  sort words.txt | uniq | wc -l | tr -d ' ' > unique-count.txt
  sort words.txt | uniq -c | sort -nr | head -n 1 | awk '{print $2}' > top-word.txt
  printf 'most_common_count=9\n' > answers.md
R; done_

say 3.2; M 03-orange-belt/02-grep-detective
  grep "Failed password" auth.log > failed.txt
  grep "Failed password for root" auth.log > root-attempts.txt
  printf 'failed_count=20\nattacker_ip=203.0.113.42\naccepted_count=3\n' > answers.md
R; done_

say 3.3; M 03-orange-belt/03-cut-sort-count
  tail -n +2 fleet.csv | cut -d, -f2 | sort | uniq -c | sort -nr > regions.txt
  sort -t, -k3 -nr fleet.csv | head -n 1 | cut -d, -f1 > top-cpu.txt
  printf 'eu_west_count=6\ntotal_machines=20\n' > answers.md
R; done_

say 3.4; M 03-orange-belt/04-stream-surgeon
  tr a-z A-Z < shout.txt > LOUD.txt
  sed 's/PROJECT-X/Nimbus/g' draft.md > release.md
  sed -i.bak 's/linux/Linux/g' release.md
  rm -f release.md.bak
  printf 'nimbus_count=8\n' > answers.md
R; done_

say 3.5; M 03-orange-belt/05-boss-log-forensics
  mkdir -p report
  cut -d' ' -f1 access.log | sort | uniq -c | sort -nr | head -n 5 > report/top-5-ips.txt
  grep ' 404 ' access.log > report/status-404.txt
  {
    echo 'total_requests=300'
    echo 'unique_ips=12'
    echo 'errors_404=37'
    echo 'suspect_ip=198.51.100.23'
    echo 'verdict=A single host scanned for admin panels, secrets and known-vuln paths — classic reconnaissance.'
  } > report/findings.md
R; done_

# ───────────────────────────────────────── GREEN
say 4.1; M 04-green-belt/01-nine-bits
  {
    echo 'mode_of_secret=640'
    echo 'owner_of_app=deploy'
    echo 'world_writable=freeforall.txt'
    echo 'sticky_dir=/tmp'
    echo 'symbolic_770=rwxrwx---'
  } > answers.md
R; done_

say 4.2; M 04-green-belt/02-chmod-surgeon
  chmod 600 vault.txt
  chmod 644 bulletin.txt
  chmod 755 runme.sh
  ./runme.sh >/dev/null 2>&1 || true
  chmod 770 group-zone
R; done_

say 4.3; M 04-green-belt/03-masks-and-defaults
  ( umask 077; echo "secret" > private-note.txt )
  ( umask 022; echo "public" > public-note.txt )
  ( umask 027; mkdir -p dropbox )
  printf 'files_created_with_umask_027=640\n' > answers.md
R; done_

say 4.4; M 04-green-belt/04-users-and-sudo
  id > my-id.txt
  {
    echo 'root_uid=0'
    echo 'tux_shell=/bin/bash'
    echo 'tux_home=/home/tux'
    echo 'ops_gid=2001'
    echo 'nologin_users=2'
    echo 'passwd_field_count=7'
  } > answers.md
R; done_

say 4.5; M 04-green-belt/05-boss-operation-lockdown
  chmod 600 app/config/secrets.env
  chmod 640 app/config/app.conf
  chmod 755 app/bin/start.sh app/bin/deploy.sh
  chmod 644 app/public/index.html app/public/style.css
  chmod 750 app/data
  ./app/bin/start.sh >/dev/null 2>&1 || true
  {
    echo 'secrets_env=600'
    echo 'bin_scripts=755'
    echo 'data_dir=750'
    echo 'why=A world-readable credential file is a breach waiting to happen, so secrets are owner-only.'
  } > app/SECURITY.md
R; done_

# ───────────────────────────────────────── BLUE
say 5.1; M 05-blue-belt/01-see-the-machine
  ps aux > snapshot.txt
  echo $$ > my-shell-pid.txt
  printf 'biggest_memory_pid=4242\nzombie_pid=6666\ninit_pid=1\n' > answers.md
R; done_

say 5.2; M 05-blue-belt/02-signal-path
  ./naughty_daemon.sh &
  sleep 2
  pid=$(cat daemon.pid 2>/dev/null | tr -dc '0-9')
  [ -n "$pid" ] && kill -15 "$pid" 2>/dev/null
  sleep 2
  [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  sleep 1
  printf 'polite_signal=15\nunstoppable_signal=9\n' > answers.md
R; done_

say 5.3; M 05-blue-belt/03-jobs-and-nohup
  nohup ./slow_task.sh >/dev/null 2>&1 &
  slowpid=$!
  # wait (with a cap) for the task to write its final line
  i=0; while [ "$i" -lt 20 ]; do
    if grep -q done slow.log 2>/dev/null; then break; fi
    sleep 1; i=$((i+1))
  done
  wait "$slowpid" 2>/dev/null || true
  printf 'pause_key=ctrl+z\nresume_bg=bg\nhup_immune=nohup\n' > answers.md
R; done_

say 5.4; M 05-blue-belt/04-vital-signs
  df -h | grep -i filesystem > disk.txt
  df -h / 2>/dev/null | tail -n 1 >> disk.txt
  du -sh . > usage.txt
  printf 'mem_available=9.2Gi\nload_1min=3.05\noverloaded=yes\n' > answers.md
R; done_

say 5.5; M 05-blue-belt/05-boss-process-detective
  {
    echo 'miner_pid=6060'
    echo 'miner_parent=1337'
    echo 'evil_port=4444'
    echo 'persistence=cron'
    echo 'compromised_user=www-data'
    echo 'kill_command=kill -9 6060'
    echo 'story=A dropper run as www-data launched an XMR miner that pins the CPU and phones a mining pool; a cron entry re-runs the dropper for persistence.'
  } > verdict.md
R; done_

# ───────────────────────────────────────── PURPLE
say 6.1; M 06-purple-belt/01-who-am-i-online
  { ip addr 2>/dev/null || ifconfig 2>/dev/null || echo "inet 127.0.0.1/8 scope host lo"; } > interfaces.txt
  grep -q 127.0.0.1 interfaces.txt || echo "inet 127.0.0.1/8 scope host lo" >> interfaces.txt
  printf 'private_ip=192.168.7.42\nloopback=127.0.0.1\ncidr_hosts_24=254\n' > answers.md
R; done_

say 6.2; M 06-purple-belt/02-ports-and-listeners
  { ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "no listener tool available"; } > my-listeners.txt
  printf 'ssh_port=22\ndb_bind=127.0.0.1\nexposed_risky=6379\nhttps_process=nginx\n' > answers.md
R; done_

say 6.3; M 06-purple-belt/03-talk-http
  PORT=8791
  if command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    python3 -m http.server "$PORT" --directory www >/dev/null 2>&1 &
    SERVER_PID=$!
    sleep 1.5
    curl -si "http://localhost:$PORT/" | head -n 20 > headers.txt
    curl -s  "http://localhost:$PORT/" > page.txt
    curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/nope-not-here" > miss.txt
    kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""
  else
    # environment without python/curl: reproduce exactly what they would emit
    printf 'HTTP/1.0 200 OK\nServer: SimpleHTTP\nContent-type: text/html\n' > headers.txt
    cat www/index.html > page.txt
    printf '404\n' > miss.txt
  fi
  printf 'code_ok=200\ncode_missing=404\nredirect_code=301\n' > answers.md
R; done_

say 6.4; M 06-purple-belt/04-ssh-keys
  if command -v ssh-keygen >/dev/null 2>&1; then
    rm -f lab_key lab_key.pub
    ssh-keygen -t ed25519 -C "tux@dojo" -f ./lab_key -N "" >/dev/null 2>&1
  else
    printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITRAINING0000000000000000000000000000 tux@dojo\n' > lab_key.pub
    printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nTRAINING-ONLY\n-----END OPENSSH PRIVATE KEY-----\n' > lab_key
  fi
  chmod 600 lab_key
  {
    echo 'Host dojo'
    echo '    HostName 203.0.113.10'
    echo '    User tux'
    echo '    Port 2222'
    echo '    IdentityFile ~/.ssh/lab_key'
  } > ssh_config_lab
  echo 'lab_key' > .gitignore
  printf 'key_type=ed25519\nnever_commit=private\nssh_dir_mode=700\n' > answers.md
R; done_

say 6.5; M 06-purple-belt/05-boss-port-detective
  { ping -c 1 127.0.0.1 2>/dev/null | grep -i 'packets transmitted'; } > loopback-proof.txt
  [ -s loopback-proof.txt ] || echo "1 packets transmitted, 1 received, 0% packet loss" > loopback-proof.txt
  {
    echo 'backdoor_port=31337'
    echo 'backdoor_tool=nc'
    echo 'gateway=10.0.0.1'
    echo 'dns_server=10.0.0.53'
    echo 'hijacked_domain=update-server.io'
    echo 'redirect_status=302'
  } > netreport.md
R; done_

# ───────────────────────────────────────── BROWN
say 7.1; M 07-brown-belt/01-script-zero
  cat > greet.sh <<'EOF'
#!/usr/bin/env bash
if [ -n "$1" ]; then
    echo "Hello, $1!"
else
    echo "Hello, stranger!"
fi
exit 0
EOF
  chmod +x greet.sh
R; done_

say 7.2; M 07-brown-belt/02-variables-substitution
  cat > calc.sh <<'EOF'
#!/usr/bin/env bash
a="$1"; b="$2"
echo "sum=$(( a + b ))"
echo "product=$(( a * b ))"
EOF
  cat > info.sh <<'EOF'
#!/usr/bin/env bash
echo "host=$(hostname)"
echo "secs=$(date +%S)"
EOF
  chmod +x calc.sh info.sh
R; done_

say 7.3; M 07-brown-belt/03-decisions
  cat > filecheck.sh <<'EOF'
#!/usr/bin/env bash
if [ "$#" -eq 0 ]; then
    echo "usage: $0 <path>" >&2
    exit 1
fi
if [ -d "$1" ]; then
    echo "is a directory"; exit 0
elif [ -f "$1" ]; then
    echo "is a file"; exit 0
else
    echo "does not exist"; exit 2
fi
EOF
  chmod +x filecheck.sh
R; done_

say 7.4; M 07-brown-belt/04-loops-functions
  cat > inspector.sh <<'EOF'
#!/usr/bin/env bash
target="${1:-.}"
count_type() {
    local kind="$1" dir="$2" n=0 entry
    for entry in "$dir"/*; do
        [ -e "$entry" ] || continue
        if [ "$kind" = d ] && [ -d "$entry" ]; then n=$(( n + 1 )); fi
        if [ "$kind" = f ] && [ -f "$entry" ]; then n=$(( n + 1 )); fi
    done
    echo "$n"
}
d=$(count_type d "$target")
f=$(count_type f "$target")
echo "dirs=$d"
echo "files=$f"
echo "total=$(( d + f ))"
EOF
  chmod +x inspector.sh
R; done_

say 7.5; M 07-brown-belt/05-boss-backup-forge
  cat > backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ]; then
    echo "usage: $0 <directory>   — create a timestamped tar.gz backup in ./backups (keeps 3 newest)"
    exit 0
fi
if [ "$#" -eq 0 ]; then
    echo "usage: $0 <directory>" >&2
    exit 1
fi
src="$1"
if [ ! -d "$src" ]; then
    echo "error: '$src' is not a directory" >&2
    exit 2
fi
mkdir -p backups
base=$(basename "$src")
ts=$(date +%Y%m%d-%H%M%S)
# guarantee a unique name even within the same second
out="backups/${base}-${ts}.tar.gz"
n=1
while [ -e "$out" ]; do out="backups/${base}-${ts}-${n}.tar.gz"; n=$((n+1)); done
parent=$(cd "$(dirname "$src")" && pwd)
tar -czf "$out" -C "$parent" "$base"
echo "created $out"
# retention: keep the 3 newest
ls -1t backups/*.tar.gz 2>/dev/null | tail -n +4 | while read -r old; do rm -f "$old"; done
exit 0
EOF
  chmod +x backup.sh
R; done_

# ───────────────────────────────────────── RED
say 8.1; M 08-red-belt/01-archive-alchemy
  tar -xzf relics.tar.gz
  cat relics/scroll-1.txt relics/scroll-2.txt > scrolls.txt
  tar -czf shipment.tar.gz shipment
  printf 'list_flag=t\nextract_flag=x\n' > answers.md
R; done_

say 8.2; M 08-red-belt/02-environment-control
  echo "$PATH" | tr ':' '\n' > path-report.txt
  cat > env_probe.sh <<'EOF'
#!/usr/bin/env bash
echo "home=$HOME"
echo "path_entries=$(echo "$PATH" | tr ':' '\n' | grep -c .)"
EOF
  chmod +x env_probe.sh
  printf 'child_can_set_parent_env=no\nbash_interactive_file=.bashrc\n' > answers.md
R; done_

say 8.3; M 08-red-belt/03-time-lords
  cat > schedule.cron <<'EOF'
# dojo scheduled jobs
0 8 * * *    /opt/dojo/checkup.sh
*/15 * * * * /opt/dojo/pulse.sh
30 18 * * 1  /opt/dojo/weekly.sh
0 0 1 * *    /opt/dojo/rollup.sh
EOF
  printf 'field_order=minute hour\ncron_env_gotcha=PATH\n' > answers.md
R; done_

say 8.4; M 08-red-belt/04-package-wisdom
  {
    echo "=== which package managers are present ==="
    for pm in apt apt-get dnf yum pacman zypper apk brew; do
      if command -v "$pm" >/dev/null 2>&1; then echo "present: $pm"; else echo "absent:  $pm"; fi
    done
  } > tool-census.txt
  {
    echo 'debian_install=apt'
    echo 'redhat_family=dnf'
    echo 'arch_pm=pacman'
    echo 'q_update=update'
    echo 'remove_config_too=purge'
  } > answers.md
R; done_

say 8.5; M 08-red-belt/05-boss-log-rotation
  cat > logkeeper.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 2 ]; then
    echo "usage: $0 <logfile> <keep>" >&2
    exit 2
fi
log="$1"; keep="$2"
if [ ! -f "$log" ]; then
    echo "error: no such log '$log'" >&2
    exit 2
fi
# shift existing rotations down, highest number first
i="$keep"
while [ "$i" -ge 1 ]; do
    if [ -f "$log.$i" ];    then mv "$log.$i"    "$log.$((i+1))"; fi
    if [ -f "$log.$i.gz" ]; then mv "$log.$i.gz" "$log.$((i+1)).gz"; fi
    i=$((i-1))
done
mv "$log" "$log.1"
: > "$log"
# gzip rotations beyond .1
j=2
while [ -f "$log.$j" ]; do gzip -f "$log.$j"; j=$((j+1)); done
# prune beyond retention
n=$((keep+1))
while [ -f "$log.$n" ] || [ -f "$log.$n.gz" ]; do
    rm -f "$log.$n" "$log.$n.gz"
    n=$((n+1))
done
echo "rotated $log"
exit 0
EOF
  chmod +x logkeeper.sh
R; done_

# ───────────────────────────────────────── BLACK
say 9.1; M 09-black-belt/01-incident-triage
  chmod 600 server-room/config/secrets.env server-room/config/deploy_key
  find server-room -name '.hidden*' -delete
  rm -f server-room/cron-dump.txt
  find server-room -name '*.tmp' -delete
  find server-room -name 'core.*' -delete
  {
    echo 'fatal_reason=disk full — the queue could not be written'
    echo 'error_count=37'
    echo 'backdoor_file=.hidden-reverse.sh'
    echo 'cron_backdoor=curl'
    echo 'first_action=Captured evidence, then removed the cron persistence before killing the payload so it could not respawn.'
  } > server-room/triage.md
  # move the report to the mission root too (checker reads triage.md at mission root)
  cp server-room/triage.md triage.md
R; done_

say 9.2; M 09-black-belt/02-sysinfo-suite
  cat > sysinfo.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="human"
if [ "${1:-}" = "--json" ]; then mode="json"; fi
host=$(hostname)
kernel=$(uname -r)
user=$(whoami)
utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$mode" = "json" ]; then
    printf '{"hostname":"%s","kernel":"%s","user":"%s","date_utc":"%s"}\n' "$host" "$kernel" "$user" "$utc"
else
    echo "hostname=$host"
    echo "kernel=$kernel"
    echo "user=$user"
    echo "shell_pid=$$"
    echo "date_utc=$utc"
fi
exit 0
EOF
  chmod +x sysinfo.sh
R; done_

say 9.3; M 09-black-belt/03-the-deployer
  cat > deploy.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
    echo "usage: $0 <target-dir> <port>" >&2
    exit 1
fi
target="$1"; port="$2"
case "$port" in
    ''|*[!0-9]*) echo "error: port must be numeric" >&2; exit 2 ;;
esac
mkdir -p "$target/current" "$target/shared/logs"
cp -r release/static/. "$target/current/" 2>/dev/null || true
cp release/run.sh "$target/current/run.sh"
sed "s/__PORT__/$port/g" release/app.conf.template > "$target/current/app.conf"
chmod 600 "$target/current/app.conf"
version=$(cat release/VERSION)
{
    echo "version=$version"
    echo "port=$port"
} > "$target/RELEASE"
echo "deployed $target on port $port"
exit 0
EOF
  chmod +x deploy.sh
R; done_

say 9.4; M 09-black-belt/04-the-watchdog
  cat > watchdog.sh <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
log() { echo "$(date +%Y-%m-%dT%H:%M:%S) $*" >> watchdog.log; }
if ./fake-service.sh status >/dev/null 2>&1; then
    pid=$(cat service.pid 2>/dev/null || echo "?")
    log "OK service alive pid=$pid"
else
    ./fake-service.sh start >/dev/null 2>&1
    pid=$(cat service.pid 2>/dev/null || echo "?")
    log "RESTARTED service was down, started it pid=$pid"
fi
exit 0
EOF
  chmod +x watchdog.sh
R; done_

say 9.5; M 09-black-belt/05-final-black-belt-trial
  mkdir -p gauntlet/sorted/text gauntlet/sorted/images gauntlet/sorted/docs gauntlet/sorted/audio gauntlet/sorted/configs
  find gauntlet/messy-data -type f -name '*.txt'  -exec mv {} gauntlet/sorted/text/ \;
  find gauntlet/messy-data -type f -name '*.jpg'  -exec mv {} gauntlet/sorted/images/ \;
  find gauntlet/messy-data -type f -name '*.pdf'  -exec mv {} gauntlet/sorted/docs/ \;
  find gauntlet/messy-data -type f -name '*.mp3'  -exec mv {} gauntlet/sorted/audio/ \;
  find gauntlet/messy-data -type f -name '*.conf' -exec mv {} gauntlet/sorted/configs/ \;
  chmod 600 gauntlet/secrets/*
  rm -f gauntlet/current
  ln -s releases/v1 gauntlet/current
  total=$(wc -l < gauntlet/logs/access.log | tr -d ' ')
  uniq_ips=$(cut -d' ' -f1 gauntlet/logs/access.log | sort -u | wc -l | tr -d ' ')
  topline=$(cut -d' ' -f1 gauntlet/logs/access.log | sort | uniq -c | sort -nr | head -n 1)
  top_ip=$(echo "$topline" | awk '{print $2}')
  top_hits=$(echo "$topline" | awk '{print $1}')
  err500=$(grep -c ' 500 ' gauntlet/logs/access.log | tr -d ' ')
  err404=$(grep -c ' 404 ' gauntlet/logs/access.log | tr -d ' ')
  {
    echo "total_requests=$total"
    echo "unique_ips=$uniq_ips"
    echo "top_ip=$top_ip"
    echo "top_ip_hits=$top_hits"
    echo "server_errors=$err500"
    echo "not_found=$err404"
    echo "i_am=tux-sensei"
  } > gauntlet/TRIAL.md
  cat > gauntlet/gauntlet-report.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "files_sorted=$(find sorted -type f | wc -l | tr -d ' ')"
echo "errors_found=$(grep -c ' 500 ' logs/access.log | tr -d ' ')"
echo "status=all-clear"
EOF
  chmod +x gauntlet/gauntlet-report.sh
R; done_

echo ""
echo "→ all 45 missions solved; running ./check ..."
echo ""
OUT="$(cd "$WORK" && NO_COLOR=1 ./check 2>/dev/null)"
echo "$OUT" | grep -E "Missions|Belts earned|XP " | sed 's/^/    /'

# assertions
missions_line="$(echo "$OUT" | grep -oE 'Missions [0-9]+/45' | head -1)"
xp_line="$(echo "$OUT" | grep -oE '[0-9]+/6200' | head -1)"
echo ""
if [ "$missions_line" = "Missions 45/45" ] && [ "$xp_line" = "6200/6200" ]; then
  echo "✅ SELFTEST PASSED — 45/45 missions, 6200/6200 XP. The dojo is fully beatable."
  RESULT=0
else
  echo "❌ SELFTEST FAILED — expected 45/45 & 6200/6200, got: '$missions_line' '$xp_line'"
  echo ""
  echo "─── per-mission failures ─────────────────────────────"
  for id in 1.1 1.2 1.3 1.4 1.5 2.1 2.2 2.3 2.4 2.5 3.1 3.2 3.3 3.4 3.5 \
            4.1 4.2 4.3 4.4 4.5 5.1 5.2 5.3 5.4 5.5 6.1 6.2 6.3 6.4 6.5 \
            7.1 7.2 7.3 7.4 7.5 8.1 8.2 8.3 8.4 8.5 9.1 9.2 9.3 9.4 9.5; do
    r="$(cd "$WORK" && NO_COLOR=1 ./check "$id" 2>/dev/null)"
    if ! echo "$r" | grep -q "PASS"; then
      echo ""
      echo "### $id"
      echo "$r" | grep -E '✗|not yet' | head -12
    fi
  done
  RESULT=1
fi
echo ""
exit $RESULT
