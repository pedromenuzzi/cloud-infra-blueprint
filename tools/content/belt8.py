BELT = {
    "n": 8,
    "slug": "08-red-belt",
    "name": "Red Belt",
    "color": "#ef4444",
    "rank": "System Craftsman",
    "motto": "The system is yours to shape: archives, environment, time, and software.",
    "notebook": "Draw the system map as a neighborhood — each directory a building with a job. Where do "
                "logs live? Where do configs live? Note the `apt update` vs `apt upgrade` gotcha for your past self.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 8.1
{
"id": "8.1", "slug": "01-archive-alchemy", "title": "Archive Alchemy",
"tagline": "tar and gzip — bundle, compress, and unpack anything.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Every release, backup, and log rotation on Earth passes through `tar`. Its flags "
         "confuse beginners for years — today you break that spell for good with one mnemonic "
         "and a lot of practice.",
"learn": [
{"h": "The mnemonic that ends the confusion",
 "code": "tar -czf archive.tar.gz stuff/     # Create Zipped File\ntar -tzf archive.tar.gz            # lisT Zipped File (peek inside, extract nothing)\ntar -xzf archive.tar.gz            # eXtract Zipped File",
 "label": "Create / lisT / eXtract — each with z (gzip) and f (file)"},
{"p": "Read the letters: **c**reate, **t** = lis**t**, e**x**tract. Add **z** for gzip "
      "compression and **f** to name the file (the `f` must come last, right before the "
      "filename). Nearly every tar you'll ever type is one of `czf`, `tzf`, `xzf`."},
{"h": "Controlling paths with -C",
 "code": "tar -czf logs.tar.gz -C /var/log .    # archive the CONTENTS of /var/log\ntar -xzf logs.tar.gz -C /tmp/restore   # extract INTO a chosen directory",
 "label": "-C = cd there first"},
{"p": "`-C` avoids ugly absolute paths inside archives and lets you extract wherever you want. "
      "Good archives contain *relative* paths (`shipment/manifest.txt`), not `/home/you/...` — "
      "so they unpack cleanly on any machine."},
{"h": "Verbose and inspection",
 "code": "tar -czvf a.tar.gz dir/    # v = verbose: print each file as it's added\ntar -tzf a.tar.gz | wc -l  # how many entries in this archive?\nfile mystery.gz            # what IS this thing? (file inspects any file's type)",
 "label": "v to watch it work; tzf to look before you leap"},
{"h": "gzip on its own",
 "code": "gzip big.log        # → big.log.gz  (replaces the original)\ngunzip big.log.gz   # → big.log     (back again)\nzcat big.log.gz     # read a .gz WITHOUT unpacking it",
 "label": "gzip compresses single files; tar bundles many"},
{"tip": "Always `tar -tzf` an unknown archive before extracting. A malicious or sloppy archive "
        "can scatter files across your directory ('tar bomb'); listing first shows you exactly "
        "what — and where — it will write."},
],
"task": [
{"step": "A `relics.tar.gz` archive is provided. FIRST list its contents (don't extract yet): `tar -tzf relics.tar.gz`."},
{"step": "Extract it, then combine the two scrolls' text into `scrolls.txt` — scroll-1's line then scroll-2's line:",
 "code": "tar -xzf relics.tar.gz\ncat relics/scroll-1.txt relics/scroll-2.txt > scrolls.txt"},
{"step": "Now go the other way: create a gzipped archive `shipment.tar.gz` of the provided `shipment/` directory. Make sure the paths inside are relative (contain `shipment/manifest.txt`).",
 "code": "tar -czf shipment.tar.gz shipment"},
{"step": "Record the flags in `answers.md`:",
 "code": "list_flag=THE_SINGLE_LETTER_THAT_LISTS_AN_ARCHIVE\nextract_flag=THE_SINGLE_LETTER_THAT_EXTRACTS"},
],
"artifacts": [
["scrolls.txt", "two lines: 'wax on' then 'wax off'"],
["shipment.tar.gz", "gzipped tar; `tar -tzf` shows shipment/manifest.txt"],
["answers.md", "list_flag=t, extract_flag=x"],
],
"hints": [
"list = t, extract = x, create = c. Each pairs with z (gzip) and f (file).",
"Verify your new archive: `tar -tzf shipment.tar.gz` should list shipment/manifest.txt and friends.",
],
},

# ─────────────────────────────────────────────────────────────── 8.2
{
"id": "8.2", "slug": "02-environment-control", "title": "Environment Control",
"tagline": "PATH, export, and the variables every process inherits.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "Why does typing `ls` find the program, but `./script.sh` needs the dots? Why do some "
         "variables survive into programs you launch and others vanish? The answer is the "
         "*environment* — and controlling it is what separates users from craftsmen.",
"learn": [
{"h": "Shell variables vs environment variables",
 "code": "name=\"Tux\"          # a SHELL variable — this shell only\nexport name         # now it's an ENVIRONMENT variable — inherited by children\nexport city=\"Oslo\"  # set and export in one line\nenv                 # list all environment variables\nprintenv PATH       # print one",
 "label": "export promotes a variable so child processes inherit it"},
{"p": "When you run a program, it gets a *copy* of the exported environment. It can change its "
      "own copy freely, but **cannot** change the parent shell's variables — children never "
      "affect parents. That's why a script can't `cd` your interactive shell for you (unless "
      "you `source` it). Inheritance flows one way: down."},
{"h": "PATH — the search list",
 "code": "echo \"$PATH\"        # colon-separated list of directories\n# /usr/local/bin:/usr/bin:/bin:...\nwhich ls            # WHERE bash found 'ls' along PATH\ntype ls             # is it a program, builtin, alias, or function?",
 "label": "PATH is why you type `ls` not `/bin/ls`"},
{"p": "When you type a bare command, bash searches each PATH directory in order and runs the "
      "first match. `.` (the current directory) is deliberately NOT on PATH — otherwise a "
      "malicious `ls` dropped in a folder you `cd` into would hijack the real one. That safety "
      "choice is exactly why you must write `./script.sh` to run something in the current dir."},
{"h": "Adding to PATH",
 "code": "export PATH=\"$HOME/bin:$PATH\"     # prepend your own bin dir (wins over system)\nexport PATH=\"$PATH:$HOME/bin\"     # append (system wins on conflicts)",
 "label": "Prepend for priority, append for fallback — put it in ~/.bashrc to persist"},
{"h": "Where settings live",
 "list": [
   "`~/.bashrc` — runs for each interactive non-login shell (most terminals). Aliases, PATH, prompt.",
   "`~/.profile` / `~/.bash_profile` — login shells.",
   "`export` in a shell — this session only; put it in `.bashrc` to make it permanent.",
 ]},
{"tip": "`source file` (or `. file`) runs a script *in your current shell* instead of a child — "
        "so its `export`s and `cd`s affect you. That's how `source ~/.bashrc` reloads your "
        "config without opening a new terminal."},
],
"task": [
{"step": "Capture your PATH, one directory per line, into `path-report.txt`:",
 "code": "echo \"$PATH\" | tr ':' '\\n' > path-report.txt"},
{"step": "Write a script `env_probe.sh` that prints where HOME points and how many entries PATH has:",
 "code": "#!/usr/bin/env bash\necho \"home=$HOME\"\necho \"path_entries=$(echo \"$PATH\" | tr ':' '\\n' | grep -c .)\""},
{"step": "Prove children get a COPY of the environment: run your probe with a modified HOME just for that one command, and confirm your real shell's HOME is unchanged:",
 "code": "chmod +x env_probe.sh\nHOME=/tmp/fakehome ./env_probe.sh    # prints home=/tmp/fakehome\necho \"$HOME\"                          # your REAL home — unchanged"},
{"step": "Record the concepts in `answers.md`:",
 "code": "child_can_set_parent_env=CAN_A_CHILD_PROCESS_CHANGE_ITS_PARENT_SHELL_VARS?_yes_or_no\nbash_interactive_file=WHICH_DOTFILE_CONFIGURES_INTERACTIVE_SHELLS   # the ~/.___ file"},
],
"artifacts": [
["path-report.txt", "3+ lines, PATH split one dir per line"],
["env_probe.sh", "executable; HOME=/tmp/fakehome ./env_probe.sh → home=/tmp/fakehome, path_entries=<digits>"],
["answers.md", "child_can_set_parent_env=no, bash_interactive_file=.bashrc"],
],
"hints": [
"`VAR=value command` sets VAR just for that one command's environment — the perfect demo.",
"Children get a COPY, so they can't change the parent → the answer is `no`.",
"The interactive-shell dotfile is `.bashrc`.",
],
},

# ─────────────────────────────────────────────────────────────── 8.3
{
"id": "8.3", "slug": "03-time-lords", "title": "Time Lords",
"tagline": "cron — schedule work to run itself, forever.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "The final promotion of automation: work that runs with nobody watching. `cron` is "
         "the scheduler behind backups, report emails, and cleanup jobs on nearly every server "
         "alive. Its five-field syntax looks cryptic for about ten minutes, then never again.",
"learn": [
{"h": "The five fields",
 "code": "# ┌─ minute (0-59)\n# │ ┌─ hour (0-23)\n# │ │ ┌─ day of month (1-31)\n# │ │ │ ┌─ month (1-12)\n# │ │ │ │ ┌─ day of week (0-7, 0 and 7 = Sunday)\n# │ │ │ │ │\n  0 8 * * *   /opt/dojo/checkup.sh    # every day at 08:00\n",
 "label": "min hour dom month dow  command"},
{"h": "The special characters",
 "list": [
   "`*` — every value ('every hour', 'every day')",
   "`*/15` — every 15 units (in the minute field: every 15 minutes)",
   "`1-5` — a range (in day-of-week: Mon–Fri)",
   "`1,15` — a list (1st and 15th)",
   "day-of-week accepts `mon tue wed …` names too",
 ]},
{"h": "Reading real schedules",
 "code": "0 8 * * *        # daily at 08:00\n*/15 * * * *     # every 15 minutes, all day\n30 18 * * 1      # 18:30 every Monday (1 = Mon)\n0 0 1 * *        # midnight on the 1st of every month\n0 2 * * 0        # 02:00 every Sunday",
 "label": "Practice reading these until they're obvious"},
{"h": "Managing your crontab",
 "code": "crontab -l       # list your scheduled jobs\ncrontab -e       # edit them (opens your editor)\ncrontab -r       # remove ALL of them (careful!)",
 "label": "Per-user schedules, edited safely"},
{"h": "The #1 cron gotcha",
 "p": "Cron runs jobs with a **minimal environment** — a bare PATH, no `~/.bashrc`, often no "
      "`HOME` you expect. Scripts that work in your terminal fail under cron because a command "
      "isn't on cron's PATH. The fix: use **absolute paths** for everything (`/usr/bin/find`, "
      "`/opt/app/run.sh`), or set PATH explicitly at the top of the script. Also redirect "
      "output (`>> /var/log/job.log 2>&1`) — cron emails it into the void otherwise."},
{"tip": "Test the *command* by hand first, with the exact absolute paths cron will use. 'Works "
        "in my shell' is not 'works in cron' — the environment is the difference."},
],
"task": [
{"step": "Write a crontab file `schedule.cron` with exactly four job lines (comments allowed but they don't count), scheduling these absolute-path scripts:"},
{"step": "• `/opt/dojo/checkup.sh` — every day at **08:00**"},
{"step": "• `/opt/dojo/pulse.sh` — **every 15 minutes**"},
{"step": "• `/opt/dojo/weekly.sh` — **18:30 every Monday**"},
{"step": "• `/opt/dojo/rollup.sh` — **midnight on the 1st of each month**"},
{"step": "Reference shape (fill the fields in yourself before peeking at the hints):",
 "code": "0 8 * * *    /opt/dojo/checkup.sh\n*/15 * * * * /opt/dojo/pulse.sh\n30 18 * * 1  /opt/dojo/weekly.sh\n0 0 1 * *    /opt/dojo/rollup.sh"},
{"step": "Record two facts in `answers.md`:",
 "code": "field_order=THE_FIRST_TWO_FIELD_NAMES_IN_ORDER    # e.g. minute hour\ncron_env_gotcha=THE_ONE_WORD_MOST_LIKELY_TO_BE_WRONG_UNDER_CRON   # hint: it's an env variable"},
],
"artifacts": [
["schedule.cron", "four correct cron lines for the four scripts"],
["answers.md", "field_order and cron_env_gotcha"],
],
"hints": [
"'every 15 minutes' is `*/15` in the minute field, `*` everywhere else.",
"Monday is day-of-week 1; 18:30 is minute 30, hour 18.",
"field_order: the fields start minute then hour. cron_env_gotcha: the classic culprit is PATH.",
],
},

# ─────────────────────────────────────────────────────────────── 8.4
{
"id": "8.4", "slug": "04-package-wisdom", "title": "Package Wisdom",
"tagline": "apt, dnf, pacman — install software the right way, everywhere.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Software doesn't come from random `curl | bash` incantations — it comes from package "
         "managers that track versions, dependencies, and files. Different distro families speak "
         "different dialects; a Craftsman knows the Rosetta Stone.",
"learn": [
{"h": "The three big families",
 "list": [
   "**Debian/Ubuntu** → `apt` (packages are `.deb`)",
   "**RHEL/Fedora/Rocky** → `dnf` (older: `yum`; packages are `.rpm`)",
   "**Arch** → `pacman`",
 ]},
{"h": "The same tasks, three dialects",
 "code": "# update the package index (do this first!)\napt update            dnf check-update       pacman -Sy\n# install a package\napt install nginx     dnf install nginx      pacman -S nginx\n# remove a package\napt remove nginx      dnf remove nginx       pacman -R nginx\n# search\napt search nginx      dnf search nginx       pacman -Ss nginx\n# what package owns this file?\ndpkg -S /usr/bin/nginx   rpm -qf /usr/bin/nginx   pacman -Qo /usr/bin/nginx",
 "label": "Learn the concepts; the commands are just translations"},
{"h": "update vs upgrade (the trap)",
 "p": "On Debian/Ubuntu, `apt update` only refreshes the *list* of available versions — it "
      "installs nothing. `apt upgrade` then actually installs the newer versions. Beginners run "
      "`update` and wonder why nothing upgraded. Always: `apt update && apt upgrade`."},
{"h": "remove vs purge",
 "p": "`apt remove pkg` deletes the program but *keeps* its config files (so a reinstall "
      "remembers your settings). `apt purge pkg` removes the program **and** its "
      "system-wide config. When you want it truly gone, purge."},
{"h": "Why not just download binaries?",
 "p": "Package managers verify signatures, resolve dependencies, let you cleanly uninstall, and "
      "receive security updates. A binary you `curl`ed into `/usr/local/bin` does none of that "
      "and becomes an untracked liability. Prefer the package manager; reach outside it only "
      "when you must, and document it."},
{"tip": "`apt-get` vs `apt`: `apt` is the friendlier modern front-end for interactive use; "
        "`apt-get` is the stable interface for scripts. Same underlying system."},
],
"task": [
{"step": "Survey what package tooling exists on YOUR machine (any that are missing simply won't print — that's fine) into `tool-census.txt`:",
 "code": "{ echo \"=== which package managers are present ===\"\n  for pm in apt apt-get dnf yum pacman zypper apk brew; do\n      if command -v \"$pm\" >/dev/null 2>&1; then echo \"present: $pm\"; else echo \"absent:  $pm\"; fi\n  done\n} > tool-census.txt"},
{"step": "Fill the cross-distro Rosetta Stone in `answers.md`:",
 "code": "debian_install=THE_COMMAND_WORD_TO_INSTALL_ON_DEBIAN    # apt (or apt-get)\nredhat_family=THE_PACKAGE_MANAGER_ON_FEDORA/RHEL         # dnf (yum also accepted)\narch_pm=THE_PACKAGE_MANAGER_ON_ARCH                      # pacman\nq_update=WHICH_apt_SUBCOMMAND_REFRESHES_THE_INDEX?      # update or upgrade\nremove_config_too=THE_apt_SUBCOMMAND_THAT_ALSO_DELETES_CONFIG   # remove or purge"},
],
"artifacts": [
["tool-census.txt", "3+ lines reporting present/absent package managers"],
["answers.md", "five keys of cross-distro knowledge"],
],
"hints": [
"`command -v pm` is the portable 'is this installed?' test.",
"q_update is `update` (refreshes the index; upgrade installs). remove_config_too is `purge`.",
"redhat_family accepts dnf or yum; arch_pm is pacman.",
],
},

# ─────────────────────────────────────────────────────────────── 8.5
{
"id": "8.5", "slug": "05-boss-log-rotation", "title": "BOSS — The Log Rotation Engine",
"tagline": "Build the tool that keeps servers from filling their disks.",
"xp": 250, "minutes": 55, "boss": True,
"intro": "Unrotated logs are the #1 way servers silently die: `/var/log` fills, writes fail, "
         "everything topples. `logrotate` solves this in production — but tonight you build a "
         "miniature of it yourself, and understand forever what it does. This is the System "
         "Craftsman's masterwork.",
"learn": [
{"h": "Boss briefing — what rotation means",
 "p": "Rotation caps a growing log by shifting old copies down a numbered ladder and starting "
      "fresh. `app.log` becomes `app.log.1`; the old `app.log.1` becomes `app.log.2` (usually "
      "gzipped as `app.log.2.gz`), and so on. Beyond a retention limit, the oldest is deleted. "
      "The live log is truncated back to empty so the app keeps writing to the same path."},
{"h": "The spec for logkeeper.sh",
 "code": "./logkeeper.sh <logfile> <keep>\n#   <logfile> : path to the active log\n#   <keep>    : how many rotated copies to retain",
 "label": "Two required arguments"},
{"list": [
   "Missing arguments → usage on **stderr**, `exit 2`.",
   "Shift existing rotations DOWN: `.1`→`.2`, `.2`→`.3`, … (work from highest number downward so you don't clobber).",
   "Move the current log to `.1`, then **gzip** the rotations except the freshest (`.1` stays plain so it's easy to read; `.2`, `.3`, … are `.gz`). *(Simpler accepted variant: gzip every rotation — the checker accepts either as long as `.1` exists after one rotation.)*",
   "Recreate the active log as a new **empty** file.",
   "Delete rotations beyond `<keep>`.",
   "Print a `rotated <logfile>` line on success, `exit 0`.",
 ]},
{"h": "Shifting safely (highest first!)",
 "code": "# to avoid overwriting, move the HIGHEST numbers first\ni=\"$keep\"\nwhile [ \"$i\" -ge 1 ]; do\n    if [ -f \"$log.$i\" ]; then mv \"$log.$i\" \"$log.$((i+1))\"; fi\n    if [ -f \"$log.$i.gz\" ]; then mv \"$log.$i.gz\" \"$log.$((i+1)).gz\"; fi\n    i=$((i-1))\ndone\nmv \"$log\" \"$log.1\"\n: > \"$log\"          # truncate/recreate empty (the : builtin does nothing, > empties)",
 "label": "Descend the ladder, then rotate in the live log"},
{"h": "Trimming to the retention limit",
 "code": "# delete anything numbered above <keep>\nn=$((keep+1))\nwhile [ -f \"$log.$n\" ] || [ -f \"$log.$n.gz\" ]; do\n    rm -f \"$log.$n\" \"$log.$n.gz\"\n    n=$((n+1))\ndone",
 "label": "Prune the tail"},
{"tip": "Test by running it repeatedly against a log you keep re-filling: after each run, "
        "`ls -1 <log>*` should show the ladder growing then capping at `<keep>` rotations. "
        "Watching the ladder behave is how you know it's right."},
],
"task": [
{"step": "Write `logkeeper.sh` implementing the full spec. Start from the header `#!/usr/bin/env bash` and `set -euo pipefail`."},
{"step": "Handle the argument errors first (missing args → stderr + exit 2)."},
{"step": "Implement the shift-down, rotate-current, truncate, gzip, and prune logic."},
{"step": "Test the whole lifecycle yourself:",
 "code": "chmod +x logkeeper.sh\nprintf 'line1\\nline2\\n' > app.log\n./logkeeper.sh app.log 3; echo \"rc=$?\"    # creates app.log.1, empties app.log\nls -1 app.log*\nprintf 'more\\n' > app.log\n./logkeeper.sh app.log 3                    # now app.log.1 fresh, older shifted\nls -1 app.log*\n./logkeeper.sh; echo \"rc=$?\"               # missing args → rc=2"},
{"step": "Run it enough times to confirm it never keeps more than `<keep>` rotations."},
],
"artifacts": [
["logkeeper.sh", "executable; usage+exit 2 on missing args; correct rotation lifecycle; caps at <keep>"],
],
"hints": [
"Shift from the HIGHEST number down, or you'll overwrite .2 with .1 before saving it.",
"`: > \"$log\"` recreates the active log as empty (the app would keep writing to it).",
"After one rotation there must be an `app.log.1` and `app.log` must exist and be empty.",
"The checker fills+rotates several times and asserts the count of rotated files never exceeds <keep>.",
],
},

    ],
}
