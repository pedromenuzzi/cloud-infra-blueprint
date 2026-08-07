BELT = {
    "n": 9,
    "slug": "09-black-belt",
    "name": "Black Belt",
    "color": "#111827",
    "rank": "Tux Sensei",
    "motto": "You no longer run commands. You compose systems.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 9.1
{
"id": "9.1", "slug": "01-incident-triage", "title": "Incident Triage",
"tagline": "A server is down and possibly breached. Stabilize it under pressure.",
"xp": 150, "minutes": 45, "boss": False,
"intro": "3 AM. A production box crashed and something looks planted. You have a captured "
         "`server-room/` to work in — logs, junk, secrets with wrong permissions, and a "
         "backdoor hiding in the dark. Black belts don't panic; they triage: find the cause, "
         "remove the threat, lock the doors, and write it up.",
"learn": [
{"h": "The triage mindset",
 "list": [
   "**Diagnose before you touch.** Read the logs; find the FATAL line that explains the crash.",
   "**Contain the threat.** A reverse-shell script and a malicious cron are active dangers — remove them.",
   "**Fix exposure.** Secrets and private keys must be `600`; a world-readable credential is an open door.",
   "**Clean the debris.** Junk and core dumps that filled the disk should go — carefully.",
   "**Document everything.** The report is how the team learns and how you cover the incident.",
 ]},
{"h": "Everything you've learned, at once",
 "code": "grep -c ERROR server-room/logs/app.log         # how bad was it?\ngrep FATAL server-room/logs/app.log             # WHY did it die?\nls -la server-room/                             # -a: reveal the hidden backdoor\nchmod 600 server-room/config/secrets.env        # lock the secret\nfind server-room -name '*.tmp' -o -name 'core.*' # the debris",
 "label": "Belts 1–8, applied under fire"},
{"h": "Spotting the backdoor",
 "p": "A file whose name starts with a dot (`ls -a` to see it) containing a line like "
      "`bash -i >& /dev/tcp/…/4444` is a **reverse shell** — it dials out to give an attacker a "
      "prompt on your box. A cron entry piping `curl … | bash` re-installs malware on a "
      "schedule. Both must be removed; the cron is the persistence, the script is the payload."},
{"tip": "Order of operations in a real breach: capture evidence, remove persistence (cron), "
        "remove payload (the script), rotate exposed secrets, THEN clean disk. This mission "
        "compresses that into a checklist — internalize the order."},
],
"task": [
{"step": "Diagnose: read `server-room/logs/app.log`. Count the ERROR lines and find the one FATAL line explaining the crash."},
{"step": "Contain: delete the hidden reverse-shell script (find it with `ls -la server-room/`) and remove the malicious `cron-dump.txt` backdoor file."},
{"step": "Lock down: set `server-room/config/secrets.env` and `server-room/config/deploy_key` to mode `600`."},
{"step": "Clean: delete the debris — every `*.tmp` file and the `core.*` dump under `server-room/`."},
{"step": "Report: write `triage.md` with exactly these keys:",
 "code": "fatal_reason=SHORT_PHRASE_FROM_THE_FATAL_LINE      # what filled up / broke\nerror_count=NUMBER_OF_ERROR_LINES\nbackdoor_file=NAME_OF_THE_HIDDEN_REVERSE_SHELL_SCRIPT\ncron_backdoor=THE_SUSPICIOUS_COMMAND_IN_THE_CRON_DUMP   # a word like curl\nfirst_action=ONE_SENTENCE:_WHAT_YOU_DID_FIRST_AND_WHY"},
],
"artifacts": [
["secrets.env + deploy_key", "both mode 600"],
["backdoor removed", "the hidden .sh reverse shell and cron-dump.txt are gone"],
["debris removed", "no *.tmp and no core.* remain under server-room/"],
["triage.md", "all five keys; fatal_reason and first_action are real sentences"],
],
"hints": [
"`ls -la server-room/` reveals the dot-file backdoor; its name starts with `.hidden`.",
"error_count: `grep -c ERROR server-room/logs/app.log`.",
"The FATAL line mentions the disk filling — 'disk full' is the fatal_reason.",
"cron_backdoor: the cron line pipes `curl ... | bash`, so the answer word is `curl`.",
],
},

# ─────────────────────────────────────────────────────────────── 9.2
{
"id": "9.2", "slug": "02-sysinfo-suite", "title": "The Sysinfo Suite",
"tagline": "Write a production-grade diagnostics tool, JSON and all.",
"xp": 150, "minutes": 45, "boss": False,
"intro": "Every ops team has a `sysinfo` script — the one you run first on any box to see what "
         "you're dealing with. Yours will be production-grade: strict mode, clean human output, "
         "and a `--json` flag for machines to consume. This is the tool you'll actually reuse "
         "after the dojo.",
"learn": [
{"h": "The professional script header",
 "code": "#!/usr/bin/env bash\nset -euo pipefail\n#     │││\n#     ││└ pipefail: a failing command mid-pipe fails the whole pipe\n#     │└ u: using an unset variable is an error (catches typos)\n#     └ e: exit immediately if any command fails",
 "label": "set -euo pipefail — the three words that make bash safe"},
{"p": "Without `set -e`, a script barrels on after a failed command, often making things worse. "
      "Without `-u`, a mistyped `$HOSTNAEM` silently expands to empty. Without `pipefail`, "
      "`false | true` looks like success. These three are the seatbelt of every serious script."},
{"h": "Gathering system facts portably",
 "code": "hostname                         # machine name\nuname -r                         # kernel release\nuname -s                         # OS (Linux, Darwin, …)\nwhoami                           # current user\ndate -u +%Y-%m-%dT%H:%M:%SZ      # UTC timestamp, ISO-8601",
 "label": "Prefer commands that exist everywhere"},
{"h": "Emitting JSON by hand",
 "code": "printf '{\"hostname\":\"%s\",\"user\":\"%s\",\"kernel\":\"%s\"}\\n' \\\n    \"$(hostname)\" \"$(whoami)\" \"$(uname -r)\"",
 "label": "printf with a template = valid JSON, no dependencies"},
{"p": "Real tools output *both* for humans and machines. A `--json` flag that emits a single "
      "compact JSON line lets your script feed dashboards, `jq` pipelines, and alerting — while "
      "the default stays readable. Designing for both consumers is a black-belt instinct."},
{"h": "Parsing your own flags",
 "code": "mode=human\nif [ \"${1:-}\" = \"--json\" ]; then mode=json; fi\n# ${1:-} = '$1 or empty if unset' — safe under set -u",
 "label": "${var:-default} keeps set -u happy"},
{"tip": "`${1:-}` is essential under `set -u`: a bare `$1` when no argument was passed would "
        "abort the script. The `:-` gives it a safe default. Memorize this pairing."},
],
"task": [
{"step": "Write `sysinfo.sh` starting with `#!/usr/bin/env bash` and `set -euo pipefail`."},
{"step": "Default (human) output must print these labelled lines (values from your system):",
 "code": "hostname=<hostname>\nkernel=<uname -r>\nuser=<whoami>\nshell_pid=<the script's PID, e.g. $$>\ndate_utc=<ISO-8601 UTC timestamp, starts YYYY-MM-DD>"},
{"step": "With `--json`, print a SINGLE line of valid JSON containing at least a `hostname` field, e.g. `{\"hostname\":\"...\",\"kernel\":\"...\",\"user\":\"...\"}`."},
{"step": "Make it executable and test both modes:",
 "code": "chmod +x sysinfo.sh\n./sysinfo.sh\n./sysinfo.sh --json"},
{"step": "Confirm it exits 0 in both modes (`echo $?`)."},
],
"artifacts": [
["sysinfo.sh", "executable; contains set -euo pipefail; human mode prints the 5 keys; --json prints one JSON line with hostname; exits 0"],
],
"hints": [
"shell_pid can just be `$$` (the script's own PID).",
"date_utc: `date -u +%Y-%m-%dT%H:%M:%SZ` — the checker only checks it starts with a YYYY-MM-DD date.",
"For --json, printf with a template is easiest and always valid. Keep it to ONE line.",
"The checker greps your file for `set -euo pipefail` (or the equivalent set -e/-u/-o pipefail) — include it.",
],
},

# ─────────────────────────────────────────────────────────────── 9.3
{
"id": "9.3", "slug": "03-the-deployer", "title": "The Deployer",
"tagline": "Ship a release the real way: build, render config, atomic layout.",
"xp": 150, "minutes": 50, "boss": False,
"intro": "Deployment is where all the belts converge: arguments, validation, directories, "
         "permissions, templating, and idempotency. You'll build a `deploy.sh` that lays out a "
         "release the way real systems do — a `current` release, shared logs, config rendered "
         "from a template — and that you can run twice without breaking anything.",
"learn": [
{"h": "Boss briefing — the deploy spec",
 "list": [
   "`./deploy.sh <target-dir> <port>` — two required arguments.",
   "No/one argument → usage on stderr, `exit 1`. Non-numeric port → error on stderr, `exit 2`.",
   "Build the layout under `<target-dir>/`: `current/` (the app) and `shared/logs/`.",
   "Copy the app from the provided `release/static/` and `release/run.sh` into `current/`.",
   "Render `release/app.conf.template` into `current/app.conf`, replacing `__PORT__` with the given port. The result must contain `port=<port>` and NO `__PORT__`.",
   "Set `current/app.conf` to mode `600` (it may hold secrets).",
   "Write a `<target-dir>/RELEASE` manifest with `version=` (from `release/VERSION`) and `port=`.",
   "Print `deployed <target-dir> on port <port>`, `exit 0`. Running it again must succeed (idempotent).",
 ]},
{"h": "Validating a numeric argument",
 "code": "case \"$2\" in\n    ''|*[!0-9]*) echo \"port must be a number\" >&2; exit 2 ;;\nesac",
 "label": "The portable 'is it all digits?' test"},
{"h": "Rendering a template with sed",
 "code": "sed \"s/__PORT__/$port/g\" release/app.conf.template > \"$target/current/app.conf\"",
 "label": "Substitute the placeholder — you learned this at orange belt"},
{"h": "Idempotency — safe to run twice",
 "code": "mkdir -p \"$target/current\" \"$target/shared/logs\"   # -p never complains if they exist\ncp -r release/static/. \"$target/current/\"           # refresh contents",
 "label": "mkdir -p and overwriting copies make re-runs harmless"},
{"p": "Idempotency is the deployment superpower: a script you can re-run any number of times "
      "and always end in the same correct state. `mkdir -p` (no error if exists) and copies "
      "that overwrite are the building blocks. A deploy that breaks on the second run is a "
      "deploy that pages you at 2 AM."},
{"tip": "The `current/` + `shared/` layout mirrors real tools (Capistrano, etc.): code is "
        "disposable and versioned, while logs and uploads live in `shared/` so they survive "
        "every deploy. You're building a real pattern in miniature."},
],
"task": [
{"step": "Write `deploy.sh` implementing every point in the spec. Use `set -euo pipefail`."},
{"step": "Handle the argument errors: wrong count → exit 1 (stderr usage); non-numeric port → exit 2 (stderr)."},
{"step": "Build the layout, copy the app, render the config (no `__PORT__` left), chmod the conf to 600, write the RELEASE manifest."},
{"step": "Test it — including running it twice:",
 "code": "chmod +x deploy.sh\n./deploy.sh; echo \"rc=$?\"                 # expect 1\n./deploy.sh ./out abc; echo \"rc=$?\"       # expect 2 (bad port)\n./deploy.sh ./out 8080; echo \"rc=$?\"      # expect 0\ncat out/current/app.conf out/RELEASE\n./deploy.sh ./out 8080                     # run AGAIN — must still succeed"},
],
"artifacts": [
["deploy.sh", "executable; exit 1/2 on bad args; builds current/ + shared/logs/"],
["out/current/app.conf", "mode 600; contains port=<port>; NO __PORT__ remains"],
["out/RELEASE", "manifest with version= and port="],
["idempotent", "second run with the same args also exits 0"],
],
"hints": [
"Numeric check: the `case \"$2\" in ''|*[!0-9]*) ... ;; esac` idiom rejects empties and non-digits.",
"Render with sed replacing __PORT__, then `chmod 600` the resulting app.conf.",
"version= comes from `cat release/VERSION` (it's 1.0.0).",
"For idempotency use `mkdir -p` and overwriting copies — never assume the dirs are absent.",
],
},

# ─────────────────────────────────────────────────────────────── 9.4
{
"id": "9.4", "slug": "04-the-watchdog", "title": "The Watchdog",
"tagline": "Keep a service alive: detect death, restart, log with timestamps.",
"xp": 150, "minutes": 50, "boss": False,
"intro": "Services crash. A watchdog notices and brings them back — the loop behind every "
         "'self-healing' system. You'll build one against a provided fake service you can start, "
         "stop, and kill at will, and prove your watchdog does the right thing whether the "
         "service is alive or dead.",
"learn": [
{"h": "Boss briefing — the pieces",
 "list": [
   "A `fake-service.sh` is provided with `start`, `stop`, and `status` subcommands. It tracks a PID in `service.pid` and its `status` exits 0 if alive, non-zero if not.",
   "Your `watchdog.sh` checks the service once per run: if alive, log an OK line; if dead, start it and log a RESTARTED line.",
   "Every log line must be **timestamped** and appended to `watchdog.log`.",
 ]},
{"h": "Checking liveness by exit code",
 "code": "if ./fake-service.sh status >/dev/null 2>&1; then\n    # exit 0 → it's alive\nelse\n    # non-zero → it's down\nfi",
 "label": "Let the service's own status command be the source of truth"},
{"h": "Timestamped logging",
 "code": "log() {\n    echo \"$(date +%Y-%m-%dT%H:%M:%S) $*\" >> watchdog.log\n}\nlog \"OK service alive pid=$(cat service.pid 2>/dev/null)\"\nlog \"RESTARTED service was down, started it\"",
 "label": "A log() helper keeps every line consistent"},
{"h": "The PID-file pattern",
 "p": "A service writes its process id to a *pidfile* (`service.pid`) when it starts. To check "
      "if it's really alive, you read the pidfile and test the process: `kill -0 \"$pid\"` sends "
      "no signal but succeeds only if the process exists and you may signal it. That's the "
      "idiomatic liveness probe — the fake service already does this internally for you."},
{"h": "Why watchdogs run on a timer",
 "p": "In production a watchdog runs from cron (`* * * * *`, every minute) or as a systemd "
      "timer. Each invocation is one check-and-maybe-restart. You're building that single "
      "invocation — the thing the scheduler calls. Keep it fast and idempotent: safe to run "
      "whether the service is up or down."},
{"tip": "Real systems use `systemd` with `Restart=always` for this, but understanding the "
        "manual watchdog loop is what lets you debug systemd when *it* misbehaves. Know the "
        "mechanism, not just the magic."},
],
"task": [
{"step": "Study the provided `fake-service.sh` — try `./fake-service.sh start`, `status`, `stop` and watch `service.pid`."},
{"step": "Write `watchdog.sh` that: checks the service via its `status`; if alive, appends a timestamped line containing `OK` and the pid to `watchdog.log`; if dead, runs `./fake-service.sh start` and appends a timestamped line containing `RESTARTED`."},
{"step": "Prove both branches. Scenario A — service already running:",
 "code": "chmod +x watchdog.sh\n./fake-service.sh start\n./watchdog.sh        # should log an OK line\ntail watchdog.log"},
{"step": "Scenario B — service down:",
 "code": "./fake-service.sh stop\n./watchdog.sh        # should START it and log a RESTARTED line\n./fake-service.sh status; echo \"rc=$?\"   # now rc=0 (alive again)\ntail watchdog.log"},
{"step": "Clean up when done: `./fake-service.sh stop`. The checker runs its own alive/dead scenarios against your watchdog."},
],
"artifacts": [
["watchdog.sh", "executable; logs OK when alive, RESTARTS + logs RESTARTED when dead"],
["watchdog.log", "timestamped lines; contains both OK and RESTARTED across the scenarios"],
],
"hints": [
"Use the service's own `status` exit code as truth — don't reinvent the liveness check.",
"Each log line needs a timestamp (a date at the front) and the keyword (OK / RESTARTED).",
"After a RESTARTED run, `./fake-service.sh status` must exit 0 — your watchdog actually started it.",
"The checker stops the service, runs your watchdog, and asserts the service is alive afterward.",
],
},

# ─────────────────────────────────────────────────────────────── 9.5
{
"id": "9.5", "slug": "05-final-black-belt-trial", "title": "BOSS — The Final Black Belt Trial",
"tagline": "One gauntlet. Every skill. Earn the black belt.",
"xp": 400, "minutes": 75, "boss": True,
"intro": "This is it, Sensei-to-be. A single sprawling `gauntlet/` that demands everything: "
         "navigation, globs and find, pipelines and forensics, permissions, a broken symlink to "
         "repair, and a script to tie it all together. No new concepts — only mastery. Finish "
         "this, and the black belt is yours. The dojo has no more to teach; from here you teach "
         "yourself.",
"learn": [
{"h": "The gauntlet, mapped",
 "list": [
   "`gauntlet/messy-data/` — 30 files of mixed types scattered across subdirectories. Sort them by type into `gauntlet/sorted/{text,images,docs,audio,configs}/`.",
   "`gauntlet/logs/access.log` — 500 requests to analyze with your forensic pipeline.",
   "`gauntlet/secrets/` — three credential files that must all be locked to `600`.",
   "`gauntlet/current` — a **broken symlink** pointing at a release that doesn't exist. Repair it to point at the real `releases/v1`.",
   "A final report and a report-generating script to write.",
 ]},
{"h": "Symlinks — creating and repairing",
 "code": "ls -l gauntlet/current                 # a dangling link shows its (missing) target\nrm gauntlet/current                    # remove the broken link\nln -s releases/v1 gauntlet/current     # point it at the real release\nreadlink gauntlet/current              # confirm the new target",
 "label": "ln -s TARGET LINKNAME  (target is relative to the link's location)"},
{"p": "A **symbolic link** is a pointer to another path. If the target vanishes, the link "
      "*dangles* — it still exists but points at nothing (`ls` shows it, following it fails). "
      "You fix it by removing the link and recreating it toward a real target. The `current → "
      "releases/vN` symlink is exactly how zero-downtime deploys flip between versions."},
{"h": "The forensic pipeline, one more time",
 "code": "cut -d' ' -f1 gauntlet/logs/access.log | sort | uniq -c | sort -nr | head   # top IPs\ngrep -c ' 500 ' gauntlet/logs/access.log                                      # server errors\ncut -d' ' -f1 gauntlet/logs/access.log | sort -u | wc -l                       # unique IPs",
 "label": "Everything from orange belt, on a bigger haystack"},
{"h": "Counting sorted results",
 "code": "find gauntlet/sorted -type f | wc -l           # total files sorted\nfind gauntlet/sorted/images -type f | wc -l    # per-category",
 "label": "Prove your sort with counts"},
{"tip": "Break the trial into the five areas and finish one completely before the next. A black "
        "belt's real skill isn't any single command — it's decomposing a big, messy problem "
        "into ordered, verifiable steps. Show that here."},
],
"task": [
{"step": "SORT: move all 30 files from `gauntlet/messy-data/` (any depth) into `gauntlet/sorted/{text,images,docs,audio,configs}/` by extension — `.txt`→text, `.jpg`→images, `.pdf`→docs, `.mp3`→audio, `.conf`→configs. (Hint: `find … -name '*.jpg' -exec mv {} gauntlet/sorted/images/ \\;` per type.)"},
{"step": "SECURE: set every file in `gauntlet/secrets/` to mode `600`."},
{"step": "REPAIR: fix the dangling `gauntlet/current` symlink so it points at `releases/v1` (which exists)."},
{"step": "ANALYZE + REPORT: study `gauntlet/logs/access.log` and write `gauntlet/TRIAL.md` with exactly these keys:",
 "code": "total_requests=NUMBER_OF_LOG_LINES\nunique_ips=HOW_MANY_DISTINCT_IPS\ntop_ip=THE_MOST_ACTIVE_IP\ntop_ip_hits=HOW_MANY_REQUESTS_FROM_THE_TOP_IP\nserver_errors=HOW_MANY_500_RESPONSES\nnot_found=HOW_MANY_404_RESPONSES\ni_am=tux-sensei"},
{"step": "AUTOMATE: write `gauntlet/gauntlet-report.sh` (executable, `set -euo pipefail`) that prints three lines — `files_sorted=<count in sorted/>`, `errors_found=<500 count from the log>`, and `status=all-clear`."},
],
"artifacts": [
["gauntlet/sorted/*", "all 30 files sorted by type into the five category dirs"],
["gauntlet/secrets/*", "every secret file mode 600"],
["gauntlet/current", "symlink now resolves to releases/v1 (no longer dangling)"],
["gauntlet/TRIAL.md", "seven keys incl. i_am=tux-sensei; log answers correct"],
["gauntlet/gauntlet-report.sh", "executable; prints files_sorted=30, errors_found=<500s>, status=all-clear"],
],
"hints": [
"Per-type moves from any depth: `find gauntlet/messy-data -name '*.txt' -exec mv {} gauntlet/sorted/text/ \\;` (repeat for each extension).",
"total_requests = `wc -l < gauntlet/logs/access.log`; unique_ips = `cut -d' ' -f1 ... | sort -u | wc -l`.",
"top_ip and top_ip_hits: the first line of `cut -d' ' -f1 ... | sort | uniq -c | sort -nr | head -1`.",
"server_errors = count of ' 500 ' lines; not_found = count of ' 404 ' lines.",
"i_am must be exactly `tux-sensei`. files_sorted should be 30 after you finish the sort.",
],
},

    ],
}
