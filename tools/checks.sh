#!/usr/bin/env bash
# Linux Dojo — the 45 mission verifiers.
# Every m_<belt>_<mission> function runs with the current directory already set
# to that mission's folder (the dispatcher in ./check handles the cd). Checks
# inspect the artifacts you produced — the same files the mission asked for.

# ============================================================ WHITE BELT
m_1_1() {
  req_oneline_eq "hello.txt" "Hello, Tux!" "hello.txt says 'Hello, Tux!'"
  req_nonempty "whoami.txt" "whoami.txt has your username"
  req_count "whoami.txt" 1 "whoami.txt is a single line"
}

m_1_2() {
  req_oneline_eq "found.txt" "TUX_RULES_THE_KERNEL" "found.txt holds the treasure text"
  req_kv_has "answers.md" "treasure_dir" "shelf-2"
  req_kv_has "answers.md" "reveal_flag" "a"      # -a (or -la); we just want the 'a'
}

m_1_3() {
  req_dir "base-camp/bin"
  req_dir "base-camp/logs/archive"
  req_dir "base-camp/notes"
  req_file "base-camp/notes/ideas.txt"
  req_file "base-camp/notes/todo.txt"
  req_file "base-camp/logs/archive/.keep" "hidden .keep marker exists"
}

m_1_4() {
  local exp_first exp_last
  exp_first=$(head -n 5 logbook.txt 2>/dev/null)
  exp_last=$(tail -n 5 logbook.txt 2>/dev/null)
  req_file_eq_cmd "first5.txt" "$exp_first" "first5.txt = first 5 lines of the logbook"
  req_file_eq_cmd "last5.txt" "$exp_last" "last5.txt = last 5 lines of the logbook"
  req_kv_num "answers.md" "total_lines" 42
  req_kv_has "answers.md" "signal" "aurora-borealis-7"
}

m_1_5() {
  req_oneline_eq "trophy-room/passphrase.txt" "open source wins" "passphrase is the three shard words in order"
  req_kv_num "answers.md" "lines" 60
  req_kv_num "answers.md" "shards_found" 3
}

# ============================================================ YELLOW BELT
m_2_1() {
  req_file "backup/contract-final.txt" "contract renamed to contract-final.txt"
  req_file "backup/assets/logo.txt" "logo.txt moved into backup/assets/"
  req_absent "backup/logo.txt" "logo.txt no longer in backup/ root (it was moved)"
  # originals untouched
  req_file "originals/contract.txt" "original contract still intact"
  req_file "originals/logo.txt" "original logo still intact"
  req_file "originals/readme.txt" "original readme still intact"
}

m_2_2() {
  req_dir "site/junk" "site/junk survives"
  local n; n=$(ls site/junk/tmp*.txt 2>/dev/null | wc -l | tr -d ' ')
  if [ "${n:-0}" = "0" ]; then _ok "all tmp*.txt deleted from site/junk"; else _bad "site/junk still has $n tmp*.txt files"; fi
  req_absent "site/rubble" "site/rubble demolished"
  req_file "site/keep/gold.txt" "gold.txt preserved"
}

m_2_3() {
  _count_dir_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }
  local a; a=$(_count_dir_files sorted/images); [ "$a" = "6" ] && _ok "sorted/images has 6 files" || _bad "sorted/images should have 6 jpgs (has ${a:-0})"
  a=$(_count_dir_files sorted/audio);  [ "$a" = "5" ] && _ok "sorted/audio has 5 files" || _bad "sorted/audio should have 5 mp3s (has ${a:-0})"
  a=$(_count_dir_files sorted/docs);   [ "$a" = "4" ] && _ok "sorted/docs has 4 files" || _bad "sorted/docs should have 4 pdfs (has ${a:-0})"
  a=$(_count_dir_files sorted/text);   [ "$a" = "5" ] && _ok "sorted/text has 5 files" || _bad "sorted/text should have 5 txts (has ${a:-0})"
  a=$(_count_dir_files sorted/other);  [ "$a" = "4" ] && _ok "sorted/other has 4 files" || _bad "sorted/other should have the 4 leftovers (has ${a:-0})"
  a=$(_count_dir_files inbox);         [ "$a" = "0" ] && _ok "inbox is empty" || _bad "inbox should be empty (has ${a:-0} files)"
}

m_2_4() {
  req_count "conf-files.txt" 4 "conf-files.txt lists 4 .conf files (incl. the hidden one)"
  req_count "dragons.txt" 3 "dragons.txt lists 3 dragon paths"
  req_count "big-ones.txt" 1 "big-ones.txt lists the single >50k file"
  req_kv_has "answers.md" "empty_file" "void.dat"
}

m_2_5() {
  _cdf() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }
  local a
  a=$(_cdf organized/documents); [ "$a" = "5" ] && _ok "documents: 5 pdfs" || _bad "organized/documents should have 5 pdfs (has ${a:-0})"
  a=$(_cdf organized/images);    [ "$a" = "10" ] && _ok "images: 10 (jpg+png)" || _bad "organized/images should have 10 files — 6 jpg + 4 png (has ${a:-0})"
  a=$(_cdf organized/audio);     [ "$a" = "3" ] && _ok "audio: 3 mp3s" || _bad "organized/audio should have 3 mp3s (has ${a:-0})"
  a=$(_cdf organized/configs);   [ "$a" = "3" ] && _ok "configs: 3 confs" || _bad "organized/configs should have 3 confs (has ${a:-0})"
  req_file "organized/vault/old-wallet.dat" "the lost wallet is secured in vault/"
  # junk purged from the source drive
  local t; t=$(find chaos-drive -name '*.tmp' 2>/dev/null | wc -l | tr -d ' ')
  local w; w=$(find chaos-drive -name '*~' 2>/dev/null | wc -l | tr -d ' ')
  [ "${t:-0}" = "0" ] && _ok "no .tmp files left in chaos-drive" || _bad "chaos-drive still has $t .tmp files"
  [ "${w:-0}" = "0" ] && _ok "no ~ backups left in chaos-drive" || _bad "chaos-drive still has $w ~ files"
  req_kv_num "cleanup-report.md" "pdf_count" 5
  req_kv_num "cleanup-report.md" "jpg_count" 6
  req_kv_num "cleanup-report.md" "png_count" 4
  req_kv_num "cleanup-report.md" "mp3_count" 3
  req_kv_num "cleanup-report.md" "conf_count" 3
  req_kv_num "cleanup-report.md" "junk_deleted" 9
}

# ============================================================ ORANGE BELT
m_3_1() {
  local exp; exp=$(sort words.txt 2>/dev/null)
  req_file_eq_cmd "sorted.txt" "$exp" "sorted.txt = words.txt sorted"
  req_egrep "unique-count.txt" "(^|[^0-9])23([^0-9]|$)" "unique-count.txt reports 23 distinct words"
  req_oneline_eq "top-word.txt" "penguin" "top-word.txt is the most frequent word"
  req_kv_num "answers.md" "most_common_count" 9
}

m_3_2() {
  req_count "failed.txt" 20 "failed.txt has all 20 failed attempts"
  req_not_grep "failed.txt" "Accepted" "failed.txt contains no successful logins"
  local bad; bad=$(grep -cv "Failed password" failed.txt 2>/dev/null | tr -d ' ')
  [ "${bad:-1}" = "0" ] && _ok "every line in failed.txt is a Failed password line" || _bad "failed.txt has $bad lines that are not 'Failed password'"
  req_count "root-attempts.txt" 7 "root-attempts.txt has the 7 root attempts"
  req_kv_num "answers.md" "failed_count" 20
  req_kv_has "answers.md" "attacker_ip" "203.0.113.42"
  req_kv_num "answers.md" "accepted_count" 3
}

m_3_3() {
  req_count "regions.txt" 4 "regions.txt has one line per region (4)"
  req_oneline_eq "top-cpu.txt" "atlas-01" "top-cpu.txt names the highest-CPU machine"
  req_kv_num "answers.md" "eu_west_count" 6
  req_kv_num "answers.md" "total_machines" 20
}

m_3_4() {
  local exp; exp=$(tr a-z A-Z < shout.txt 2>/dev/null)
  req_file_eq_cmd "LOUD.txt" "$exp" "LOUD.txt is the shout uppercased"
  req_not_grep "release.md" "PROJECT-X" "release.md has no PROJECT-X left"
  req_egrep "release.md" "Nimbus" "release.md uses the new name Nimbus"
  local nc; nc=$(grep -o "Nimbus" release.md 2>/dev/null | wc -l | tr -d ' ')
  if [ -n "$nc" ] && [ "$nc" -ge 8 ] 2>/dev/null; then _ok "Nimbus appears $nc times (≥8)"; else _bad "release.md should mention Nimbus at least 8 times (found ${nc:-0})"; fi
  req_not_egrep "release.md" "(^|[^A-Za-z])linux([^A-Za-z]|$)" "no lowercase whole-word 'linux' remains (should be Linux)"
  req_absent "release.md.bak" "the sed backup .bak was cleaned up"
  req_kv_num "answers.md" "nimbus_count" 8
}

m_3_5() {
  req_dir "report"
  req_count "report/top-5-ips.txt" 5 "top-5-ips.txt has 5 lines"
  grep -q "198.51.100.23" report/top-5-ips.txt 2>/dev/null && _ok "the suspect IP is in the top 5" || _bad "top-5-ips.txt should include the top talker 198.51.100.23"
  req_count "report/status-404.txt" 37 "status-404.txt captured all 37 not-founds"
  req_kv_num "report/findings.md" "total_requests" 300
  req_kv_num "report/findings.md" "unique_ips" 12
  req_kv_num "report/findings.md" "errors_404" 37
  req_kv_has "report/findings.md" "suspect_ip" "198.51.100.23"
  req_kv_present "report/findings.md" "verdict" 8
}

# ============================================================ GREEN BELT
m_4_1() {
  req_kv_has "answers.md" "mode_of_secret" "640"
  req_kv_has "answers.md" "owner_of_app" "deploy"
  req_kv_has "answers.md" "world_writable" "freeforall.txt"
  req_kv_has "answers.md" "sticky_dir" "tmp"
  req_kv_has "answers.md" "symbolic_770" "rwxrwx---"
}

m_4_2() {
  req_mode "vault.txt" 600
  req_mode "bulletin.txt" 644
  req_mode "runme.sh" 755
  req_exec "runme.sh"
  if [ -x runme.sh ]; then
    run_cap 5 ./runme.sh
    printf '%s' "$RUN_OUT" | grep -qi "it works" && _ok "runme.sh runs and prints 'it works'" || _bad "runme.sh should print 'it works' when run"
  fi
  req_mode "group-zone" 770
}

m_4_3() {
  req_mode "private-note.txt" 600
  req_mode "public-note.txt" 644
  req_mode "dropbox" 750
  req_kv_num "answers.md" "files_created_with_umask_027" 640
}

m_4_4() {
  req_nonempty "my-id.txt"
  req_grep "my-id.txt" "uid=" "my-id.txt has the id output (uid=…)"
  req_kv_num "answers.md" "root_uid" 0
  req_kv_has "answers.md" "tux_shell" "/bin/bash"
  req_kv_has "answers.md" "tux_home" "/home/tux"
  req_kv_num "answers.md" "ops_gid" 2001
  req_kv_num "answers.md" "nologin_users" 2
  req_kv_num "answers.md" "passwd_field_count" 7
}

m_4_5() {
  req_mode "app/config/secrets.env" 600
  req_mode "app/config/app.conf" 640
  req_mode "app/bin/start.sh" 755
  req_mode "app/bin/deploy.sh" 755
  req_mode "app/data" 750
  req_mode "app/public/index.html" 644
  if [ -x app/bin/start.sh ]; then
    run_cap 5 ./app/bin/start.sh
    printf '%s' "$RUN_OUT" | grep -qi "app started" && _ok "start.sh runs" || _bad "start.sh should print 'app started'"
  else _bad "app/bin/start.sh must be executable"; fi
  req_kv_num "app/SECURITY.md" "secrets_env" 600
  req_kv_num "app/SECURITY.md" "bin_scripts" 755
  req_kv_num "app/SECURITY.md" "data_dir" 750
  req_kv_present "app/SECURITY.md" "why" 10
}

# ============================================================ BLUE BELT
m_5_1() {
  req_nonempty "snapshot.txt"
  req_igrep "snapshot.txt" "PID" "snapshot.txt is a real ps listing (has a PID header)"
  req_count_min "snapshot.txt" 5 "snapshot.txt captured multiple processes"
  req_egrep "my-shell-pid.txt" "^[0-9]+$" "my-shell-pid.txt is a numeric PID" || req_egrep "my-shell-pid.txt" "[0-9]" "my-shell-pid.txt has a PID"
  req_kv_num "answers.md" "biggest_memory_pid" 4242
  req_kv_num "answers.md" "zombie_pid" 6666
  req_kv_num "answers.md" "init_pid" 1
}

m_5_2() {
  req_file "daemon.log"
  req_igrep "daemon.log" "started" "daemon.log shows the daemon started"
  req_igrep "daemon.log" "ignoring" "daemon.log shows it ignored the polite signal"
  if [ -f daemon.pid ]; then
    local pid; pid=$(tr -dc '0-9' < daemon.pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      _bad "the daemon (pid $pid) is STILL running — finish it with kill -9"
    else
      _ok "the stubborn daemon has been force-killed"
    fi
  else _bad "daemon.pid missing — did you launch the daemon?"; fi
  req_kv_any "answers.md" "polite_signal" "15" "term" "sigterm"
  req_kv_any "answers.md" "unstoppable_signal" "9" "kill" "sigkill"
}

m_5_3() {
  req_file "slow.log"
  req_igrep "slow.log" "tick" "slow.log shows the task ran (tick lines)"
  req_igrep "slow.log" "done" "slow.log ends with 'done' (task finished)"
  req_kv_any "answers.md" "pause_key" "ctrl+z" "ctrl-z" "c-z" "^z" "ctrlz"
  req_kv_any "answers.md" "resume_bg" "bg"
  req_kv_any "answers.md" "hup_immune" "nohup"
}

m_5_4() {
  req_nonempty "disk.txt"
  req_igrep "disk.txt" "filesystem" "disk.txt has the df header/rows"
  req_nonempty "usage.txt"
  req_count "usage.txt" 1 "usage.txt is a single du -sh line"
  req_kv_has "answers.md" "mem_available" "9.2"
  req_kv_has "answers.md" "load_1min" "3.05"
  req_kv_any "answers.md" "overloaded" "yes" "true"
}

m_5_5() {
  req_kv_num "verdict.md" "miner_pid" 6060
  req_kv_num "verdict.md" "miner_parent" 1337
  req_kv_num "verdict.md" "evil_port" 4444
  req_kv_any "verdict.md" "persistence" "cron" "crontab"
  req_kv_has "verdict.md" "compromised_user" "www-data"
  req_kv_has "verdict.md" "kill_command" "6060"     # some kill … 6060
  req_kv_present "verdict.md" "story" 15
}

# ============================================================ PURPLE BELT
m_6_1() {
  req_nonempty "interfaces.txt"
  req_grep "interfaces.txt" "127.0.0.1" "interfaces.txt shows the loopback address"
  req_kv_has "answers.md" "private_ip" "192.168.7.42"
  req_kv_has "answers.md" "loopback" "127.0.0.1"
  req_kv_num "answers.md" "cidr_hosts_24" 254
}

m_6_2() {
  req_nonempty "my-listeners.txt"
  req_kv_num "answers.md" "ssh_port" 22
  req_kv_has "answers.md" "db_bind" "127.0.0.1"
  req_kv_num "answers.md" "exposed_risky" 6379
  req_kv_has "answers.md" "https_process" "nginx"
}

m_6_3() {
  req_file "headers.txt"
  req_grep "headers.txt" "HTTP/" "headers.txt has an HTTP status line"
  req_grep "headers.txt" "200" "headers.txt shows a 200 for the home page"
  req_igrep "page.txt" "hello" "page.txt is the served page body"
  req_grep "miss.txt" "404" "miss.txt captured the 404 for a missing page"
  req_kv_num "answers.md" "code_ok" 200
  req_kv_num "answers.md" "code_missing" 404
  req_kv_num "answers.md" "redirect_code" 301
}

m_6_4() {
  req_file "lab_key" "private key generated"
  req_file "lab_key.pub" "public key generated"
  req_grep "lab_key.pub" "ssh-ed25519 " "public key is an ed25519 key"
  req_mode "lab_key" 600
  req_grep "ssh_config_lab" "Host dojo" "ssh config defines Host dojo"
  req_igrep "ssh_config_lab" "HostName" "ssh config has a HostName"
  req_igrep "ssh_config_lab" "IdentityFile" "ssh config points at the key"
  req_grep ".gitignore" "lab_key" ".gitignore protects the private key"
  req_kv_has "answers.md" "key_type" "ed25519"
  req_kv_any "answers.md" "never_commit" "private"
  req_kv_num "answers.md" "ssh_dir_mode" 700
}

m_6_5() {
  req_nonempty "loopback-proof.txt"
  req_igrep "loopback-proof.txt" "packets transmitted" "loopback-proof.txt has a real ping summary"
  req_kv_num "netreport.md" "backdoor_port" 31337
  req_kv_has "netreport.md" "backdoor_tool" "nc"
  req_kv_has "netreport.md" "gateway" "10.0.0.1"
  req_kv_has "netreport.md" "dns_server" "10.0.0.53"
  req_kv_has "netreport.md" "hijacked_domain" "update-server.io"
  req_kv_num "netreport.md" "redirect_status" 302
}

# ============================================================ BROWN BELT
m_7_1() {
  req_exec "greet.sh"
  req_grep "greet.sh" "#!" "greet.sh has a shebang"
  run_cap 5 ./greet.sh Tux
  printf '%s' "$RUN_OUT" | grep -qi "hello, tux" && _ok "greet.sh Tux → Hello, Tux!" || _bad "greet.sh Tux should print 'Hello, Tux!' (got '${RUN_OUT}')"
  [ "$RUN_RC" = "0" ] && _ok "greet.sh exits 0" || _bad "greet.sh should exit 0 (got $RUN_RC)"
  run_cap 5 ./greet.sh
  printf '%s' "$RUN_OUT" | grep -qi "hello, stranger" && _ok "greet.sh (no arg) → Hello, stranger!" || _bad "greet.sh with no argument should print 'Hello, stranger!' (got '${RUN_OUT}')"
}

m_7_2() {
  req_exec "calc.sh"
  run_cap 5 ./calc.sh 3 5
  printf '%s' "$RUN_OUT" | grep -q "sum=8" && _ok "calc.sh 3 5 → sum=8" || _bad "calc.sh 3 5 should print sum=8 (got '${RUN_OUT}')"
  printf '%s' "$RUN_OUT" | grep -q "product=15" && _ok "calc.sh 3 5 → product=15" || _bad "calc.sh 3 5 should print product=15"
  run_cap 5 ./calc.sh 10 10
  printf '%s' "$RUN_OUT" | grep -q "sum=20" && _ok "calc.sh 10 10 → sum=20" || _bad "calc.sh 10 10 should print sum=20 (args must be read, not hardcoded)"
  printf '%s' "$RUN_OUT" | grep -q "product=100" && _ok "calc.sh 10 10 → product=100" || _bad "calc.sh 10 10 should print product=100"
  req_exec "info.sh"
  run_cap 5 ./info.sh
  printf '%s' "$RUN_OUT" | grep -qE "host=.+" && _ok "info.sh prints host=…" || _bad "info.sh should print host=<something>"
  printf '%s' "$RUN_OUT" | grep -qE "secs=[0-9]+" && _ok "info.sh prints secs=<digits>" || _bad "info.sh should print secs=<digits> via command substitution"
}

m_7_3() {
  req_exec "filecheck.sh"
  run_cap 5 ./filecheck.sh
  [ "$RUN_RC" = "1" ] && _ok "no-arg exits 1" || _bad "filecheck.sh with no arg should exit 1 (got $RUN_RC)"
  printf '%s' "$RUN_ERR" | grep -qi "usage" && _ok "usage goes to stderr" || _bad "the usage message must go to STDERR (>&2)"
  run_cap 5 ./filecheck.sh .
  printf '%s' "$RUN_OUT" | grep -qi "is a directory" && [ "$RUN_RC" = "0" ] && _ok "a directory → 'is a directory', exit 0" || _bad "filecheck.sh on a directory should print 'is a directory' and exit 0"
  run_cap 5 ./filecheck.sh filecheck.sh
  printf '%s' "$RUN_OUT" | grep -qi "is a file" && [ "$RUN_RC" = "0" ] && _ok "a file → 'is a file', exit 0" || _bad "filecheck.sh on a file should print 'is a file' and exit 0"
  run_cap 5 ./filecheck.sh definitely-not-here-xyz
  printf '%s' "$RUN_OUT" | grep -qi "does not exist" && [ "$RUN_RC" = "2" ] && _ok "missing → 'does not exist', exit 2" || _bad "filecheck.sh on a missing path should print 'does not exist' and exit 2 (got rc=$RUN_RC)"
}

m_7_4() {
  req_exec "inspector.sh"
  req_egrep "inspector.sh" "(^|[^A-Za-z])(for|while)([^A-Za-z]|$)" "inspector.sh uses a loop"
  req_egrep "inspector.sh" "[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\\(\\)" "inspector.sh defines a function"
  # build a fresh fixture and test
  local fx; fx=$(mktemp -d 2>/dev/null || echo "./._fx.$$"); mkdir -p "$fx"
  mkdir -p "$fx/alpha" "$fx/beta"; : > "$fx/one.txt"; : > "$fx/two.txt"; : > "$fx/three.txt"
  run_cap 5 ./inspector.sh "$fx"
  printf '%s' "$RUN_OUT" | grep -q "dirs=2"  && _ok "reports dirs=2 on the fixture"  || _bad "inspector.sh should report dirs=2 (got '${RUN_OUT}')"
  printf '%s' "$RUN_OUT" | grep -q "files=3" && _ok "reports files=3 on the fixture" || _bad "inspector.sh should report files=3"
  printf '%s' "$RUN_OUT" | grep -q "total=5" && _ok "reports total=5 on the fixture" || _bad "inspector.sh should report total=5"
  rm -rf "$fx"
}

m_7_5() {
  req_exec "backup.sh"
  run_cap 10 ./backup.sh --help
  [ "$RUN_RC" = "0" ] && _ok "--help exits 0" || _bad "backup.sh --help should exit 0"
  printf '%s' "$RUN_OUT$RUN_ERR" | grep -qi "usage" && _ok "--help shows usage" || _bad "backup.sh --help should print usage"
  run_cap 10 ./backup.sh
  [ "$RUN_RC" = "1" ] && _ok "no-arg exits 1" || _bad "backup.sh with no args should exit 1 (got $RUN_RC)"
  run_cap 10 ./backup.sh /no/such/place-xyz
  [ "$RUN_RC" = "2" ] && _ok "missing dir exits 2" || _bad "backup.sh on a missing dir should exit 2 (got $RUN_RC)"
  # happy path
  rm -rf _srcdata backups; mkdir -p _srcdata; echo "hello" > _srcdata/a.txt; echo "world" > _srcdata/b.txt
  run_cap 15 ./backup.sh _srcdata
  [ "$RUN_RC" = "0" ] && _ok "valid dir → exit 0" || _bad "backup.sh on a valid dir should exit 0 (got $RUN_RC)"
  printf '%s' "$RUN_OUT" | grep -qi "created" && _ok "prints a 'created …' line" || _bad "backup.sh should print a 'created …' line"
  local arch; arch=$(ls backups/*.tar.gz 2>/dev/null | head -1)
  if [ -n "$arch" ]; then
    _ok "an archive landed in backups/"
    tar -tzf "$arch" >/dev/null 2>&1 && _ok "the archive is a valid tar.gz" || _bad "the created archive is not a valid tar.gz"
    tar -tzf "$arch" 2>/dev/null | grep -q "a.txt" && _ok "the archive contains the source files" || _bad "the archive should contain the backed-up files"
  else _bad "no .tar.gz was created in backups/"; fi
  # retention: run several times, expect at most 3
  run_cap 15 ./backup.sh _srcdata; run_cap 15 ./backup.sh _srcdata
  run_cap 15 ./backup.sh _srcdata; run_cap 15 ./backup.sh _srcdata
  local cnt; cnt=$(ls backups/*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  if [ -n "$cnt" ] && [ "$cnt" -le 3 ] 2>/dev/null && [ "$cnt" -ge 1 ] 2>/dev/null; then _ok "retention keeps at most 3 archives (found $cnt)"; else _bad "retention should keep at most 3 archives (found ${cnt:-0})"; fi
  rm -rf _srcdata backups
}

# ============================================================ RED BELT
m_8_1() {
  req_oneline_eq "scrolls.txt" "wax on wax off" "scrolls.txt combines both scrolls"
  req_file "shipment.tar.gz" "you created shipment.tar.gz"
  if [ -f shipment.tar.gz ]; then
    tar -tzf shipment.tar.gz >/dev/null 2>&1 && _ok "shipment.tar.gz is a valid gzip tar" || _bad "shipment.tar.gz is not a valid tar.gz"
    tar -tzf shipment.tar.gz 2>/dev/null | grep -q "shipment/manifest.txt" && _ok "archive holds shipment/manifest.txt (relative paths)" || _bad "shipment.tar.gz should contain shipment/manifest.txt"
  fi
  req_kv "answers.md" "list_flag" "t"
  req_kv "answers.md" "extract_flag" "x"
}

m_8_2() {
  req_count_min "path-report.txt" 3 "path-report.txt split PATH into lines"
  req_igrep "path-report.txt" "bin" "PATH contains bin directories"
  req_exec "env_probe.sh"
  run_cap 5 env HOME=/tmp/fakehome ./env_probe.sh
  printf '%s' "$RUN_OUT" | grep -q "home=/tmp/fakehome" && _ok "env_probe honors an overridden HOME" || _bad "HOME=/tmp/fakehome ./env_probe.sh should print home=/tmp/fakehome (got '${RUN_OUT}')"
  printf '%s' "$RUN_OUT" | grep -qE "path_entries=[0-9]+" && _ok "env_probe prints path_entries=<digits>" || _bad "env_probe.sh should print path_entries=<number>"
  req_kv_any "answers.md" "child_can_set_parent_env" "no" "false"
  req_kv_has "answers.md" "bash_interactive_file" ".bashrc"
}

m_8_3() {
  req_file "schedule.cron"
  # daily 08:00
  req_egrep "schedule.cron" "^[[:space:]]*0[[:space:]]+8[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+.*checkup" "08:00 daily → checkup.sh"
  # every 15 min
  req_egrep "schedule.cron" "^[[:space:]]*\\*/15[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+.*pulse" "every 15 min → pulse.sh"
  # 18:30 Monday (1 or mon)
  req_egrep "schedule.cron" "^[[:space:]]*30[[:space:]]+18[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+(1|mon)[[:space:]]+.*weekly" "18:30 Monday → weekly.sh"
  # midnight on the 1st
  req_egrep "schedule.cron" "^[[:space:]]*0[[:space:]]+0[[:space:]]+1[[:space:]]+\\*[[:space:]]+\\*[[:space:]]+.*rollup" "00:00 on the 1st → rollup.sh"
  req_kv_has "answers.md" "field_order" "minute"
  req_kv_any "answers.md" "cron_env_gotcha" "path"
}

m_8_4() {
  req_count_min "tool-census.txt" 3 "tool-census.txt surveyed package managers"
  req_kv_any "answers.md" "debian_install" "apt" "apt-get" "apt install"
  req_kv_any "answers.md" "redhat_family" "dnf" "yum"
  req_kv_has "answers.md" "arch_pm" "pacman"
  req_kv_any "answers.md" "q_update" "update"
  req_kv_any "answers.md" "remove_config_too" "purge"
}

m_8_5() {
  req_exec "logkeeper.sh"
  run_cap 10 ./logkeeper.sh
  [ "$RUN_RC" = "2" ] && _ok "missing args → exit 2" || _bad "logkeeper.sh with no args should exit 2 (got $RUN_RC)"
  printf '%s' "$RUN_ERR" | grep -qi "usage" && _ok "usage on stderr" || _bad "usage should go to stderr"
  # lifecycle
  rm -f app.log app.log.*
  printf 'l1\nl2\n' > app.log
  run_cap 10 ./logkeeper.sh app.log 3
  [ "$RUN_RC" = "0" ] && _ok "first rotation exits 0" || _bad "rotation should exit 0 (got $RUN_RC)"
  [ -e app.log.1 ] || [ -e app.log.1.gz ] && _ok "created a .1 rotation" || _bad "after rotating there should be an app.log.1 (or .1.gz)"
  [ -f app.log ] && _ok "the live log was recreated" || _bad "the active log app.log should be recreated (empty) after rotation"
  if [ -f app.log ]; then
    local sz; sz=$(_line_count app.log)
    [ "${sz:-0}" = "0" ] && _ok "the recreated log is empty" || _bad "the recreated app.log should be empty (has ${sz} lines)"
  fi
  # rotate several more times, retention capped at 3
  local i=0
  while [ "$i" -lt 6 ]; do printf 'more%s\n' "$i" > app.log; run_cap 10 ./logkeeper.sh app.log 3; i=$((i+1)); done
  local rc; rc=$(ls app.log.* 2>/dev/null | wc -l | tr -d ' ')
  if [ -n "$rc" ] && [ "$rc" -le 3 ] 2>/dev/null && [ "$rc" -ge 1 ] 2>/dev/null; then _ok "retention holds at most 3 rotations (found $rc)"; else _bad "retention should cap rotations at 3 (found ${rc:-0})"; fi
  rm -f app.log app.log.*
}

# ============================================================ BLACK BELT
m_9_1() {
  req_mode "server-room/config/secrets.env" 600
  req_mode "server-room/config/deploy_key" 600
  local bd; bd=$(find server-room -name '.hidden*' 2>/dev/null | wc -l | tr -d ' ')
  [ "${bd:-1}" = "0" ] && _ok "the hidden reverse-shell backdoor is removed" || _bad "the hidden .hidden-reverse.sh backdoor must be deleted"
  req_absent "server-room/cron-dump.txt" "the malicious cron dump is removed"
  local tmp; tmp=$(find server-room -name '*.tmp' 2>/dev/null | wc -l | tr -d ' ')
  local core; core=$(find server-room -name 'core.*' 2>/dev/null | wc -l | tr -d ' ')
  [ "${tmp:-1}" = "0" ] && _ok "no .tmp debris left" || _bad "server-room still has $tmp .tmp files"
  [ "${core:-1}" = "0" ] && _ok "no core dumps left" || _bad "server-room still has a core dump"
  req_kv_any "triage.md" "fatal_reason" "disk full" "disk-full" "disk" "no space"
  req_kv_num "triage.md" "error_count" 37
  req_kv_has "triage.md" "backdoor_file" ".hidden-reverse.sh"
  req_kv_any "triage.md" "cron_backdoor" "curl" "curl|bash" "curl | bash"
  req_kv_present "triage.md" "first_action" 12
}

m_9_2() {
  req_exec "sysinfo.sh"
  if grep -q 'pipefail' sysinfo.sh 2>/dev/null && grep -qE 'set[[:space:]]+-[a-z]*e' sysinfo.sh 2>/dev/null; then
    _ok "sysinfo.sh uses strict mode (set -e… + pipefail)"
  else
    _bad "sysinfo.sh should start with 'set -euo pipefail'"
  fi
  run_cap 8 ./sysinfo.sh
  [ "$RUN_RC" = "0" ] && _ok "human mode exits 0" || _bad "sysinfo.sh should exit 0 (got $RUN_RC)"
  printf '%s' "$RUN_OUT" | grep -qE "hostname=.+"  && _ok "prints hostname=" || _bad "sysinfo.sh should print hostname=<name>"
  printf '%s' "$RUN_OUT" | grep -qE "kernel=.+"    && _ok "prints kernel="   || _bad "sysinfo.sh should print kernel=<release>"
  printf '%s' "$RUN_OUT" | grep -qE "user=.+"      && _ok "prints user="     || _bad "sysinfo.sh should print user=<name>"
  printf '%s' "$RUN_OUT" | grep -qE "shell_pid=[0-9]+" && _ok "prints shell_pid=<digits>" || _bad "sysinfo.sh should print shell_pid=<pid>"
  printf '%s' "$RUN_OUT" | grep -qE "date_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}" && _ok "prints an ISO date_utc" || _bad "sysinfo.sh should print date_utc=<YYYY-MM-DD…>"
  run_cap 8 ./sysinfo.sh --json
  [ "$RUN_RC" = "0" ] && _ok "--json exits 0" || _bad "sysinfo.sh --json should exit 0"
  printf '%s' "$RUN_OUT" | grep -qE '^[[:space:]]*\{.*"hostname".*\}[[:space:]]*$' && _ok "--json prints one JSON line with hostname" || _bad "--json should print a single JSON line containing a \"hostname\" field (got '${RUN_OUT}')"
}

m_9_3() {
  req_exec "deploy.sh"
  run_cap 8 ./deploy.sh
  [ "$RUN_RC" = "1" ] && _ok "no/one arg → exit 1" || _bad "deploy.sh with too few args should exit 1 (got $RUN_RC)"
  run_cap 8 ./deploy.sh ./out notaport
  [ "$RUN_RC" = "2" ] && _ok "non-numeric port → exit 2" || _bad "deploy.sh with a non-numeric port should exit 2 (got $RUN_RC)"
  rm -rf out
  run_cap 8 ./deploy.sh ./out 8080
  [ "$RUN_RC" = "0" ] && _ok "valid deploy → exit 0" || _bad "deploy.sh ./out 8080 should exit 0 (got $RUN_RC)"
  req_dir "out/current"
  req_dir "out/shared/logs"
  req_file "out/current/app.conf"
  req_not_grep "out/current/app.conf" "__PORT__" "the template placeholder was rendered away"
  req_grep "out/current/app.conf" "port=8080" "app.conf has port=8080"
  req_mode "out/current/app.conf" 600
  req_grep "out/RELEASE" "port=" "RELEASE manifest records the port"
  req_igrep "out/RELEASE" "version=" "RELEASE manifest records a version"
  printf '%s' "$RUN_OUT" | grep -qi "deployed" && _ok "prints a 'deployed …' line" || _bad "deploy.sh should print a 'deployed …' confirmation"
  # idempotency
  run_cap 8 ./deploy.sh ./out 8080
  [ "$RUN_RC" = "0" ] && _ok "re-running the deploy still exits 0 (idempotent)" || _bad "deploy.sh should be idempotent (second run also exits 0)"
  rm -rf out
}

m_9_4() {
  req_exec "watchdog.sh"
  [ -x fake-service.sh ] || chmod +x fake-service.sh 2>/dev/null
  # Scenario A: service already up → OK line, no restart needed
  ./fake-service.sh stop >/dev/null 2>&1
  ./fake-service.sh start >/dev/null 2>&1
  : > watchdog.log
  run_cap 10 ./watchdog.sh
  grep -qi "ok" watchdog.log 2>/dev/null && _ok "logs an OK line when the service is alive" || _bad "watchdog.sh should log an OK line when the service is up"
  # Scenario B: service down → restart + RESTARTED line + service alive after
  ./fake-service.sh stop >/dev/null 2>&1
  run_cap 15 ./watchdog.sh
  grep -qi "restart" watchdog.log 2>/dev/null && _ok "logs a RESTARTED line when the service was down" || _bad "watchdog.sh should log a RESTARTED line when it revives the service"
  if ./fake-service.sh status >/dev/null 2>&1; then _ok "the service is alive again after the watchdog ran" || true; else _bad "after restarting, ./fake-service.sh status should report it alive"; fi
  # timestamps
  grep -qE "[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}:[0-9]{2}:[0-9]{2}" watchdog.log 2>/dev/null && _ok "log lines are timestamped" || _bad "watchdog.log lines should carry a timestamp"
  ./fake-service.sh stop >/dev/null 2>&1
  rm -f watchdog.log service.pid
}

m_9_5() {
  # sort: 30 files distributed by type
  _cdf() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }
  local total; total=$(_cdf gauntlet/sorted)
  [ "${total:-0}" = "30" ] && _ok "all 30 files sorted into gauntlet/sorted/" || _bad "gauntlet/sorted should hold all 30 files (found ${total:-0})"
  local left; left=$(find gauntlet/messy-data -type f 2>/dev/null | wc -l | tr -d ' ')
  [ "${left:-1}" = "0" ] && _ok "messy-data emptied" || _bad "gauntlet/messy-data should be empty after sorting (has ${left} files)"
  # secrets locked
  local bad=0 f
  for f in gauntlet/secrets/*; do
    [ -f "$f" ] || continue
    [ "$(perm_octal "$f")" = "600" ] || bad=$((bad+1))
  done
  [ "$bad" = "0" ] && _ok "every secret file is mode 600" || _bad "$bad secret file(s) are not mode 600"
  # symlink repaired
  req_symlink_to "gauntlet/current" "releases/v1"
  # report
  req_kv_num "gauntlet/TRIAL.md" "total_requests" 500
  req_kv_num "gauntlet/TRIAL.md" "unique_ips" 25
  req_kv_has "gauntlet/TRIAL.md" "top_ip" "203.0.113.66"
  req_kv_num "gauntlet/TRIAL.md" "top_ip_hits" 87
  req_kv_num "gauntlet/TRIAL.md" "server_errors" 21
  req_kv_num "gauntlet/TRIAL.md" "not_found" 40
  req_kv "gauntlet/TRIAL.md" "i_am" "tux-sensei"
  # automation script
  req_exec "gauntlet/gauntlet-report.sh"
  if [ -x gauntlet/gauntlet-report.sh ]; then
    run_cap 8 sh -c 'cd gauntlet && ./gauntlet-report.sh'
    printf '%s' "$RUN_OUT" | grep -q "files_sorted=30" && _ok "report prints files_sorted=30" || _bad "gauntlet-report.sh should print files_sorted=30 (got '${RUN_OUT}')"
    printf '%s' "$RUN_OUT" | grep -q "errors_found=21" && _ok "report prints errors_found=21" || _bad "gauntlet-report.sh should print errors_found=21"
    printf '%s' "$RUN_OUT" | grep -q "status=all-clear" && _ok "report prints status=all-clear" || _bad "gauntlet-report.sh should print status=all-clear"
  fi
}
