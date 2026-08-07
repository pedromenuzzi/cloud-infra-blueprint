BELT = {
    "n": 5,
    "slug": "05-blue-belt",
    "name": "Blue Belt",
    "color": "#3b82f6",
    "rank": "Process Tamer",
    "motto": "Every command is a process. Learn to see them, signal them, and outlast them.",
    "notebook": "Explain SIGTERM vs SIGKILL with your own metaphor. Note the admin's triage trio you "
                "keep reaching for: check status → read the logs → restart.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 5.1
{
"id": "5.1", "slug": "01-see-the-machine", "title": "See the Machine",
"tagline": "ps and top — make the invisible running system visible.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Right now, dozens of processes are alive on your machine — shells, services, the very "
         "terminal you're reading this in. A Process Tamer's first skill is *sight*: listing "
         "what runs, who owns it, and what it's costing.",
"learn": [
{"h": "ps — a snapshot of processes",
 "code": "ps               # just YOUR processes in this terminal\nps aux           # EVERY process, detailed (the classic incantation)\nps -ef           # every process, different columns (PPID = parent!)\nps aux | grep nginx    # filter for what you care about",
 "label": "aux and -ef are the two you'll actually type"},
{"h": "Reading ps aux columns",
 "list": [
   "**USER** — who owns the process",
   "**PID** — process id, its unique handle (you signal processes by PID)",
   "**%CPU / %MEM** — current resource share",
   "**STAT** — state: `R` running, `S` sleeping, `Z` zombie, `T` stopped",
   "**COMMAND** — what's actually running",
 ]},
{"h": "PID 1 and the family tree",
 "p": "Every process has a parent (PPID). The chain climbs to **PID 1** — the init system "
      "(`systemd` on most distros) that the kernel starts first and that adopts orphans. "
      "`ps -ef` shows PPIDs so you can trace who launched what — vital when hunting something "
      "suspicious."},
{"h": "top / htop — the live dashboard",
 "code": "top       # live, refreshing view (press q to quit, M sort by memory, P by cpu)\nhtop      # friendlier colored version, if installed",
 "label": "ps is a photo; top is the video"},
{"h": "Zombies, briefly",
 "p": "A **zombie** (`Z`, `<defunct>`) is a finished process whose parent hasn't collected its "
      "exit status yet. It holds no resources but clutters the table; a pile of them signals a "
      "buggy parent. You can't kill a zombie — it's already dead."},
{"tip": "Your own shell has a PID too. `echo $$` prints it — the shell's special variable for "
        "'my own process id'."},
],
"task": [
{"step": "Capture a snapshot of all processes into `snapshot.txt`:",
 "code": "ps aux > snapshot.txt"},
{"step": "Record your current shell's PID into `my-shell-pid.txt`:",
 "code": "echo $$ > my-shell-pid.txt"},
{"step": "A captured `sample/ps.txt` is provided (so answers are identical for everyone). Study it and answer in `answers.md`:",
 "code": "biggest_memory_pid=PID_WITH_THE_HIGHEST_%MEM\nzombie_pid=PID_IN_STATE_Z\ninit_pid=PID_OF_/sbin/init"},
],
"artifacts": [
["snapshot.txt", "your real ps aux output (has a PID header + many lines)"],
["my-shell-pid.txt", "one number — your shell PID"],
["answers.md", "three PIDs read from sample/ps.txt"],
],
"hints": [
"In sample/ps.txt, %MEM is column 4. The java process is the memory hog.",
"The zombie is the line with STAT `Z` and `<defunct>`.",
"init is PID 1 by universal convention.",
],
},

# ─────────────────────────────────────────────────────────────── 5.2
{
"id": "5.2", "slug": "02-signal-path", "title": "The Signal Path",
"tagline": "kill, signals, and the difference between asking and forcing.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "`kill` is badly named — it really means 'send a signal'. Most signals are polite "
         "requests a program may handle or ignore; one cannot be refused. Today you meet a "
         "stubborn daemon and learn the whole spectrum from 'please stop' to 'stop NOW'.",
"learn": [
{"h": "Signals are messages, not murders",
 "code": "kill 4242            # send the DEFAULT signal (TERM) to PID 4242\nkill -15 4242        # TERM explicitly — 'please shut down cleanly'\nkill -TERM 4242      # same thing, by name\nkill -9 4242         # KILL — the un-ignorable, un-catchable hammer\nkill -2 4242         # INT — what Ctrl+C sends\nkill -1 4242         # HUP — often 'reload your config'",
 "label": "-15 asks nicely; -9 does not ask"},
{"h": "The three you must know",
 "list": [
   "**SIGTERM (15)** — the default. 'Please clean up and exit.' A well-behaved program flushes files, closes sockets, then quits. *Always try this first.*",
   "**SIGKILL (9)** — cannot be caught, blocked, or ignored. The kernel destroys the process instantly. No cleanup — risk of corrupt state. *Last resort.*",
   "**SIGHUP (1)** — historically 'terminal hung up'; today many daemons treat it as 'reload config without restarting'.",
 ]},
{"h": "Why a program can ignore TERM",
 "p": "Programs install *signal handlers* — code that runs when a signal arrives. A handler can "
      "catch TERM and decide to log it and keep running (databases do this to finish writing "
      "safely). SIGKILL is special precisely because the kernel never delivers it to the "
      "program at all — there's nothing to catch. That's why `-9` always wins."},
{"h": "Finding the PID to signal",
 "code": "pgrep -f naughty_daemon      # PIDs whose command matches\npkill -f naughty_daemon      # signal them by name (TERM by default)\npkill -9 -f naughty_daemon   # force by name",
 "label": "pgrep/pkill save you the ps|grep dance"},
{"tip": "Escalate, don't lead with force: TERM, wait a moment, and only then KILL. Leading "
        "with `-9` on a database is how you learn about corrupt data the hard way."},
],
"task": [
{"step": "Launch the stubborn daemon in the background:",
 "code": "./naughty_daemon.sh &"},
{"step": "Confirm it's alive and note its PID (it also writes `daemon.pid`):",
 "code": "cat daemon.pid\nps aux | grep naughty_daemon"},
{"step": "Politely ask it to stop with SIGTERM — then check `daemon.log`. You'll see it *ignored* you (it has a handler).",
 "code": "kill -15 $(cat daemon.pid)\ncat daemon.log"},
{"step": "Now end it for real with the un-ignorable signal:",
 "code": "kill -9 $(cat daemon.pid)"},
{"step": "Confirm it's gone (`ps aux | grep naughty_daemon` shows nothing but grep), then record in `answers.md`:",
 "code": "polite_signal=15                # the name TERM is also accepted\nunstoppable_signal=9"},
],
"artifacts": [
["daemon.log", "shows the daemon started AND logged ignoring SIGTERM"],
["daemon.pid", "the PID — and that process must NO LONGER be running"],
["answers.md", "polite_signal and unstoppable_signal"],
],
"hints": [
"The daemon writes its own PID to daemon.pid, so `kill $(cat daemon.pid)` always targets it.",
"If it won't die, you're sending TERM (which it ignores). Use `kill -9`.",
"`polite_signal` accepts either `15` or `TERM`; `unstoppable_signal` is `9`.",
],
},

# ─────────────────────────────────────────────────────────────── 5.3
{
"id": "5.3", "slug": "03-jobs-and-nohup", "title": "Jobs & Nohup",
"tagline": "Background, foreground, and surviving logout.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "One terminal, many tasks. Job control lets you pause a job, shove it to the "
         "background, pull it back — and `nohup`/`&` let a task outlive the terminal that "
         "started it. Essential the first time an SSH session drops mid-job.",
"learn": [
{"h": "Background and foreground",
 "code": "./slow_task.sh &     # start in the BACKGROUND (& = don't wait)\njobs                 # list this shell's jobs\nfg %1                # bring job 1 to the FOREGROUND\nbg %1                # resume a stopped job in the background",
 "label": "& detaches; jobs/fg/bg manage them"},
{"h": "The Ctrl+Z dance",
 "list": [
   "**Ctrl+C** — send INT, terminate the foreground job",
   "**Ctrl+Z** — send TSTP, *suspend* it (frozen, not dead)",
   "then **`bg`** — resume it in the background, or **`fg`** — resume in foreground",
 ]},
{"p": "So the rescue for 'oops, this is taking forever and blocking my terminal' is: "
      "**Ctrl+Z** to suspend, then **`bg`** to let it run detached while you keep working."},
{"h": "Surviving logout: nohup and &",
 "code": "nohup ./slow_task.sh &        # immune to HUP; keeps running after logout\n# stdout/stderr are saved to ./nohup.out automatically\nnohup ./slow_task.sh > run.log 2>&1 &   # send output where you want",
 "label": "nohup = no hangup"},
{"p": "When a terminal closes, the kernel sends **SIGHUP** to its jobs — normally killing "
      "them. `nohup` makes a command ignore HUP, so `nohup cmd &` keeps running after you log "
      "out. (`tmux`/`screen` solve this more richly, but nohup is everywhere and needs nothing "
      "installed.)"},
{"h": "Redirecting both streams",
 "code": "cmd > out.log 2>&1 &\n#          └ 2>&1 = 'send stderr to wherever stdout is going'",
 "label": "Capture normal output AND errors together"},
{"tip": "`2>&1` order matters: it means 'stderr follows stdout's current destination', so it "
        "must come *after* the `>`. A daily-driver idiom worth memorizing."},
],
"task": [
{"step": "Run the slow task with nohup in the background, capturing output to `slow.log` (the script writes there itself):",
 "code": "nohup ./slow_task.sh > /dev/null 2>&1 &"},
{"step": "While it runs, prove you understand job control: start a `sleep 30`, press Ctrl+Z to suspend it, then `bg` to background it, then confirm with `jobs`."},
{"step": "Wait for the task to finish (about 10s), then confirm `slow.log` ends with a `done` line: `tail slow.log`."},
{"step": "Record the concepts in `answers.md`:",
 "code": "pause_key=THE_KEY_COMBO_THAT_SUSPENDS_A_JOB    # e.g. ctrl+z\nresume_bg=THE_COMMAND_THAT_RESUMES_IN_BACKGROUND   # one word\nhup_immune=THE_COMMAND_THAT_SURVIVES_LOGOUT        # one word"},
],
"artifacts": [
["slow.log", "contains tick lines and a final 'done'"],
["answers.md", "pause_key, resume_bg, hup_immune"],
],
"hints": [
"pause_key is `ctrl+z` (case/spacing lenient); resume_bg is `bg`; hup_immune is `nohup`.",
"If slow.log has no 'done' yet, the task is still running — wait a few seconds and re-check.",
],
},

# ─────────────────────────────────────────────────────────────── 5.4
{
"id": "5.4", "slug": "04-vital-signs", "title": "Vital Signs",
"tagline": "df, du, free, uptime — read the machine's health.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "'The server is slow.' A Process Tamer doesn't guess — they check vital signs. Disk "
         "full? Memory exhausted? Load through the roof? Four commands turn vague panic into a "
         "diagnosis.",
"learn": [
{"h": "Disk: df and du",
 "code": "df -h              # disk FREE per filesystem, human-readable\ndf -h /            # just the root filesystem\ndu -sh .           # total SIZE of the current directory (summary)\ndu -sh * | sort -h # size of each item, smallest→largest (sort -h!)\ndu -h --max-depth=1 /var   # where's the space going under /var",
 "label": "df = whole disks; du = specific paths"},
{"p": "The classic 'disk full' hunt: `df -h` shows *which* filesystem is at 100%, then "
      "`du -sh * | sort -h` inside it walks you toward the culprit directory. `-h` on sort is "
      "the human-numeric sort that understands `K`, `M`, `G`."},
{"h": "Memory: free",
 "code": "free -h\n#   total  used  free  shared  buff/cache  available\n#                                         └ the number that matters",
 "label": "Look at 'available', not 'free'"},
{"p": "Linux deliberately uses 'free' RAM as disk cache — so a low `free` number is *healthy*, "
      "not alarming. The honest 'how much can a new program get' figure is **available**, which "
      "counts reclaimable cache. Beginners panic at `free`; pros read `available`."},
{"h": "Load: uptime",
 "code": "uptime\n#  ... load average: 0.52, 0.48, 0.44\n#                    1min  5min  15min",
 "label": "Three numbers = three time windows"},
{"p": "Load average is the number of processes wanting the CPU. The rough rule: compare to "
      "your core count. On a 4-core box, ~4.0 means fully busy; well above your core count "
      "means tasks are queuing (overloaded). The three numbers show the trend — rising or "
      "cooling off."},
{"tip": "First three commands in almost every 'server feels wrong' investigation: `df -h`, "
        "`free -h`, `uptime`. Thirty seconds to rule out the big three."},
],
"task": [
{"step": "Capture disk usage. Save the df line for your root filesystem into `disk.txt`:",
 "code": "df -h | grep -i filesystem > disk.txt   # header line (portable across systems)\ndf -h / | tail -n 1 >> disk.txt          # the root filesystem row"},
{"step": "Save the total size of THIS mission directory into `usage.txt`:",
 "code": "du -sh . > usage.txt"},
{"step": "A captured `sample/free.txt` and `sample/uptime.txt` are provided so answers are identical for everyone. Read them and fill `answers.md`:",
 "code": "mem_available=THE_available_VALUE_FROM_sample/free.txt   # e.g. 9.2Gi\nload_1min=THE_1_MINUTE_LOAD_FROM_sample/uptime.txt      # e.g. 3.05\noverloaded=IS_1MIN_LOAD_ABOVE_4_CORES?_yes_or_no"},
],
"artifacts": [
["disk.txt", "a filesystem header + your root fs line"],
["usage.txt", "one line — this directory's total size"],
["answers.md", "mem_available, load_1min, overloaded"],
],
"hints": [
"mem_available is the last number on the `Mem:` row of sample/free.txt.",
"The 1-minute load is the FIRST of the three load-average numbers in sample/uptime.txt.",
"The sample shows a 4-core box with load 5.10 — that's above 4, so overloaded=yes.",
],
},

# ─────────────────────────────────────────────────────────────── 5.5
{
"id": "5.5", "slug": "05-boss-process-detective", "title": "BOSS — The Process Detective",
"tagline": "A server is compromised. Read the evidence, name the culprit.",
"xp": 250, "minutes": 45, "boss": True,
"intro": "Alarms are firing: CPU pinned at 100%, a process nobody recognizes. You've been "
         "handed a casefile — snapshots of `ps`, `lsof`, and the crontab from the suspect box. "
         "Use everything from this belt to trace the intrusion and write the incident report.",
"learn": [
{"h": "Boss briefing — the casefile",
 "list": [
   "`casefile/ps-dump.txt` — full process tree (UID, PID, **PPID**, CPU time, CMD)",
   "`casefile/lsof-dump.txt` — open network connections (which process, which port, to where)",
   "`casefile/crontab-dump.txt` — scheduled jobs (how attackers survive reboots)",
 ]},
{"h": "How to think like the detective",
 "list": [
   "A process eating enormous CPU time with a weird name and an outbound connection to a random IP = a **cryptominer**.",
   "Trace its **PPID** in the ps dump — who launched it? That parent is the dropper.",
   "The **port** it talks to (in lsof) is the miner's pool connection.",
   "A **cron** entry re-running a script is the persistence mechanism — kill the process and it just comes back until you remove the cron.",
 ]},
{"h": "Tools you already own",
 "code": "grep -E \"miner|4444\" casefile/*.txt      # pull the suspicious lines together\ngrep \" 6060 \" casefile/ps-dump.txt         # find a PID's row\nsort -k? casefile/ps-dump.txt              # rank by a column",
 "label": "Filter, correlate, conclude"},
{"tip": "The remediation order matters and is worth stating in your report: remove the cron "
        "persistence FIRST, then kill the process — otherwise cron respawns it seconds later."},
],
"task": [
{"step": "Study all three files in `casefile/`. Correlate PID ↔ PPID ↔ open port."},
{"step": "Write your incident report `verdict.md` with exactly these keys:",
 "code": "miner_pid=PID_OF_THE_MINING_PROCESS\nminer_parent=PPID_THAT_LAUNCHED_IT\nevil_port=THE_REMOTE_POOL_PORT_IT_CONNECTS_TO\npersistence=HOW_IT_SURVIVES_REBOOT      # one word, e.g. cron\ncompromised_user=WHICH_USER_ACCOUNT_IS_RUNNING_IT\nkill_command=THE_EXACT_COMMAND_TO_FORCE-KILL_THE_MINER\nstory=ONE_OR_TWO_SENTENCES_EXPLAINING_THE_ATTACK"},
],
"artifacts": [
["verdict.md", "all seven keys; story is a real explanation"],
],
"hints": [
"The miner is the process burning hours of CPU TIME with a pool address in its command line.",
"kill_command should force-kill by PID, e.g. `kill -9 6060`.",
"persistence is one word — what mechanism re-launches it on schedule?",
"compromised_user is the USER column of the miner's row (a service account, not a human).",
],
},

    ],
}
