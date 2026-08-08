BELT = {
    "n": 10,
    "slug": "10-side-quests",
    "name": "Side Quests",
    "color": "#f472b6",
    "rank": "Ronin",
    "motto": "Off the main path, sharpening the blade: vim, git, and services.",
    "side": True,
    "notebook": "Your personal vim crib sheet: the ten commands you actually used today. "
                "That page will be worth gold every time you SSH into a server.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 10.1
{
"id": "10.1", "slug": "01-vim-gauntlet", "title": "The Vim Gauntlet",
"tagline": "Survive — then quietly start liking — the editor on every server.",
"xp": 100, "minutes": 35, "boss": False,
"intro": "One day you'll SSH into a box that has no VS Code, no nano, no mercy — only `vim`. "
         "Every admin has lived it. This quest makes vim a tool instead of a trap: the modes, "
         "the survival keys, and one real editing gauntlet on a scroll.",
"learn": [
{"h": "The big idea: modes",
 "p": "vim is a *modal* editor. In **NORMAL** mode, keys are commands (move, delete, copy). "
      "Press `i` to enter **INSERT** mode and type like a regular editor; press `Esc` to return "
      "to NORMAL. Beginners suffer because they type commands while in INSERT — when lost, "
      "press `Esc` (twice, for confidence) and you're back on solid ground."},
{"h": "Minimum viable vim",
 "code": "vim scroll.txt\ni        # INSERT mode — type freely\nEsc      # back to NORMAL\n:wq      # write (save) and quit\n:q!      # quit WITHOUT saving (your panic button)",
 "label": "Enough to never be trapped again"},
{"h": "The NORMAL-mode moves you'll use forever",
 "list": [
   "`dd` — delete the current line · `yy` — copy (yank) it · `p` — paste below",
   "`u` — undo · `Ctrl+r` — redo",
   "`gg` / `G` — jump to first / last line · `5G` — jump to line 5",
   "`/text` then Enter — search; `n` jumps to the next match",
   "`:%s/old/new/g` — replace `old` with `new` in the whole file",
 ]},
{"h": "Do vimtutor. Seriously.",
 "code": "vimtutor    # ships with vim — a guided 15-minute lesson\n# no vim yet?  sudo apt install -y vim   (Debian/Ubuntu)",
 "label": "15 minutes that repay a year of suffering"},
{"p": "Lessons 1 and 2 of `vimtutor` cover everything this gauntlet needs. Type it by hand — "
      "that's the pact — and your fingers will remember when it matters."},
{"tip": "vim is on every Linux server built in the last 30 years. Being merely *comfortable* "
        "in it is a professional superpower that takes one afternoon to acquire."},
],
"task": [
{"step": "Run `vimtutor` and complete at least lessons 1 and 2 (honor system — the pact is with yourself)."},
{"step": "Open the provided scroll in vim: `vim scroll.txt`. Then, using only NORMAL-mode commands:"},
{"step": "Delete line 5 (the one begging for it): `5G` then `dd`."},
{"step": "Copy line 2 and paste it at the very end: `2G`, `yy`, `G`, `p`."},
{"step": "Replace every lowercase word `line` with `step` in the whole file: `:%s/line/step/g`."},
{"step": "Save and quit with `:wq`, then create `answers.md`:",
 "code": "insert_key=THE_KEY_THAT_ENTERS_INSERT_MODE\nsave_quit=THE_COMMAND_THAT_SAVES_AND_QUITS\nquit_no_save=THE_PANIC_BUTTON_COMMAND\nundo_key=THE_UNDO_KEY"},
],
"artifacts": [
["scroll.txt", "edited exactly: line 5 gone, old line 2 duplicated at the end, every 'line' → 'step'"],
["answers.md", "insert_key=i, save_quit=:wq, quit_no_save=:q!, undo_key=u"],
],
"hints": [
"Do the steps in the listed order and the result is deterministic — the checker compares the exact final scroll.",
"Typed a wrong command? `u` undoes it. Truly lost? `:q!` and reopen the file (restore the original with `git restore scroll.txt` if needed).",
"`:%s/line/step/g` is case-sensitive — capitalized words are untouched, which is exactly what you want here.",
],
},

# ─────────────────────────────────────────────────────────────── 10.2
{
"id": "10.2", "slug": "02-git-time-machine", "title": "Git Time Machine",
"tagline": "status, log, restore, branch, commit — git as a survival skill.",
"xp": 100, "minutes": 35, "boss": False,
"intro": "This whole dojo lives in git — which means you've been carrying a time machine the "
         "entire journey. Today you learn to drive it: see what changed, resurrect a deleted "
         "file, branch safely, and write your first proper commit.",
"learn": [
{"h": "Tell git who you are (once per machine)",
 "code": "git config --global user.name \"Your Name\"\ngit config --global user.email \"you@example.com\"\n# commits are signed with this identity — git refuses to commit without it",
 "label": "Skip this and your first commit will complain"},
{"h": "Reading the present and the past",
 "code": "git status                 # what changed since the last commit?\ngit status --short         # the compact view you'll grow to prefer\ngit log --oneline -10      # the last 10 commits, one line each\ngit diff                   # exactly WHAT changed, line by line",
 "label": "The three commands you'll run 50 times a day"},
{"h": "The resurrection drill (why git is your safety net)",
 "code": "rm precious.txt             # oops. gone. no trash can, remember?\ngit status                  # git noticed: 'deleted: precious.txt'\ngit restore precious.txt    # ...and it's BACK. (older git: git checkout -- precious.txt)",
 "label": "Deleted ≠ lost, as long as it was committed"},
{"p": "This is why the dojo told you from day one: *git is your time machine*. Anything "
      "committed can be resurrected. Anything **not** committed is one `rm` from oblivion — "
      "which is the whole argument for committing early and often."},
{"h": "Branches: parallel timelines",
 "code": "git branch                    # where am I?\ngit branch training/dojo      # create a new branch (timeline)\ngit switch training/dojo      # jump onto it (older git: git checkout)\ngit switch -                  # jump back",
 "label": "Branches are free — use them for every experiment"},
{"h": "A commit worth reading",
 "code": "git add missions/10-side-quests/02-git-time-machine/git-notes.md\ngit commit -m \"dojo: complete the git time machine side quest\"\n#            └ a good message: short prefix + what it does",
 "label": "Stage, then commit with a message future-you will thank"},
{"tip": "Never commit secrets: private keys, `.env`, tokens. You proved this reflex at purple "
        "belt with `.gitignore` + `git check-ignore` — it applies to every repo you'll ever touch."},
],
"task": [
{"step": "Make sure git knows you: `git config --global user.name` / `user.email` (set them if empty)."},
{"step": "From the repo root, read the machine: `git status`, then `git log --oneline -5`."},
{"step": "THE DRILL — in this mission folder, delete `precious.txt` with `rm`, confirm it's gone with `ls`, then resurrect it:",
 "code": "rm precious.txt\nls\ngit restore precious.txt    # or: git checkout -- precious.txt\ncat precious.txt             # back from the dead"},
{"step": "Create a training branch (no need to switch): `git branch training/dojo`."},
{"step": "Write `git-notes.md` in this folder:",
 "code": "restore_cmd=THE_COMMAND_THAT_RESURRECTED_THE_FILE   # one word is enough\nbranch_created=training/dojo\nnever_commit=WHAT_MUST_NEVER_ENTER_A_REPO   # think purple belt"},
{"step": "Stage and commit it with a message that starts with `dojo:`:",
 "code": "git add missions/10-side-quests/02-git-time-machine/git-notes.md\ngit commit -m \"dojo: complete the git time machine side quest\""},
],
"artifacts": [
["precious.txt", "present and intact (resurrected, not recreated by hand)"],
["a branch", "`git branch --list 'training/*'` shows training/dojo"],
["a commit", "`git log` contains a commit message starting with dojo:"],
["git-notes.md", "restore_cmd, branch_created, never_commit"],
],
"hints": [
"If `git commit` complains about identity, run the two `git config --global` lines first.",
"`git restore` is the modern spelling; `git checkout -- <file>` does the same on older git. The checker accepts either word in restore_cmd.",
"The commit can include other work too — the checker only looks for the `dojo:` message in your history.",
],
},

# ─────────────────────────────────────────────────────────────── 10.3
{
"id": "10.3", "slug": "03-service-commander", "title": "Service Commander",
"tagline": "systemctl & journalctl — command the daemons like an admin.",
"xp": 100, "minutes": 35, "boss": False,
"intro": "Real servers run *services*: nginx, postgres, your app — supervised by systemd. "
         "When something breaks at 3 AM, the admin ritual is always the same trio: check the "
         "status, read the logs, restart. Today you learn the ritual on captured evidence, "
         "so it grades the same on any machine.",
"learn": [
{"h": "The systemd model",
 "p": "systemd is the manager that starts and supervises services (*units*). `systemctl` gives "
      "orders; `journalctl` reads their logs. A unit can be **active (running)**, **inactive**, "
      "or **failed** — and separately **enabled** (starts on boot) or **disabled**. `enable` and "
      "`start` are different questions: *from now on* vs *right now*."},
{"h": "The commands",
 "code": "systemctl status nginx          # state, PID, memory, last log lines — the first look\nsudo systemctl start nginx      # start it now\nsudo systemctl restart nginx    # stop + start (after a config change)\nsudo systemctl enable nginx     # start automatically on boot\njournalctl -u nginx -n 50       # last 50 log lines of THAT unit\njournalctl -u nginx -f          # follow live (the service's tail -f)\nsystemctl list-units --type=service   # everything running",
 "label": "The admin's daily bread"},
{"h": "Reading a status block",
 "code": "● nginx.service - A high performance web server...\n     Loaded: loaded (...; enabled; ...)     ← starts on boot\n     Active: active (running) since ...     ← alive right now\n   Main PID: 1200 (nginx)                   ← the process to trace",
 "label": "Three lines tell you almost everything"},
{"h": "The triage ritual (memorize the order)",
 "list": [
   "1. **status** — is it running? since when? what did it say last?",
   "2. **logs** — `journalctl -u <unit> -n 50`: WHY did it fail? (exit code 127 = command not found; 1 = generic error; 137 = killed)",
   "3. **restart** — only after you understand; then status again to confirm.",
 ]},
{"p": "Restarting *before* reading logs destroys evidence and often just reproduces the crash. "
      "Status → logs → restart. That order is the difference between an operator and a "
      "button-pusher — and it's exactly what the samples in this mission let you practice."},
{"tip": "WSL2 ships with systemd enabled these days, so these commands work in your dojo. "
        "Containers usually don't have it — that's why this mission grades on captured "
        "evidence, plus one live probe that adapts to your machine."},
],
"task": [
{"step": "Study `sample/systemctl-status.txt` (a healthy nginx), `sample/systemctl-failed.txt` (a crashed unit) and `sample/journal.txt` (its logs)."},
{"step": "Answer the triage in `answers.md`:",
 "code": "nginx_state=ACTIVE_STATE_OF_NGINX          # one word from the Active: line\nnginx_main_pid=THE_MAIN_PID\nnginx_enabled=DOES_IT_START_ON_BOOT           # the word from Loaded:\nfailed_unit=THE_NAME_OF_THE_BROKEN_SERVICE    # without .service is fine\nexit_status=THE_NUMERIC_EXIT_CODE_OF_THE_CRASH\nroot_cause=THE_MISSING_COMMAND_IN_THE_LOGS    # one word"},
{"step": "Write your `runbook.md` — the ritual you'd run on a real box, in order, with real commands (status first, logs second, restart third). Include the literal commands `systemctl status`, `journalctl -u` and `systemctl restart`, plus:",
 "code": "first_step=status"},
{"step": "One live probe — works with or without systemd on your machine (note the `||` fallback doing the graceful degradation):",
 "code": "{ systemctl list-units --type=service 2>/dev/null || echo \"no systemd on this machine\"; } | head -20 > systemctl-live.txt"},
],
"artifacts": [
["answers.md", "six triage answers from the captured evidence"],
["runbook.md", "the trio in order: systemctl status → journalctl -u → systemctl restart, plus first_step=status"],
["systemctl-live.txt", "your machine's live probe (or the graceful fallback line)"],
],
"hints": [
"exit_status: the failed unit's Process line ends with `status=NNN` — that number.",
"root_cause: the journal's last lines name the command that was not found.",
"The runbook is prose + commands — the checker greps for the three commands and the first_step key.",
],
},

    ],
}
