BELT = {
    "n": 4,
    "slug": "04-green-belt",
    "name": "Green Belt",
    "color": "#22c55e",
    "rank": "Gatekeeper",
    "motto": "Permissions are not bureaucracy. They are the locks on every door.",
    "notebook": "Make the permissions table: r=4, w=2, x=1, and the four classics — 755, 700, 644, 600 — "
                "with when to use each. In one line: why is `chmod 777` a crime?",
    "missions": [

# ─────────────────────────────────────────────────────────────── 4.1
{
"id": "4.1", "slug": "01-nine-bits", "title": "The Nine Bits",
"tagline": "Read any permission string on sight.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "`-rwxr-xr--`. To a beginner it's line noise. To a Gatekeeper it's a sentence: who "
         "owns this, who's in its group, and exactly what each may do. Today you learn to read "
         "that sentence instantly — no new commands, just literacy.",
"learn": [
{"h": "The ten-character string",
 "code": "-rwxr-xr--\n│└┬┘└┬┘└┬┘\n│ │  │  └ OTHER  (everyone else)\n│ │  └──── GROUP\n│ └─────── USER  (the owner)\n└───────── type: - file   d directory   l symlink",
 "label": "1 type bit + 3 groups of 3"},
{"h": "Each triad: r, w, x",
 "list": [
   "**r** (read) = 4 — view file contents / list a directory",
   "**w** (write) = 2 — modify a file / create+delete entries in a directory",
   "**x** (execute) = 1 — run a file as a program / *enter* (cd into) a directory",
   "a `-` means that permission is absent",
 ]},
{"h": "The octal shorthand",
 "p": "Add the values per triad. `rwx` = 4+2+1 = **7**. `rw-` = 4+2 = **6**. `r-x` = 4+1 = **5**. "
      "`r--` = **4**. So `-rwxr-xr--` = **754**. Three digits describe all nine bits. "
      "Memorize the common ones: 644 (rw-r--r--, normal file), 755 (rwxr-xr-x, program/dir), "
      "600 (rw-------, private), 640 (rw-r-----, group-readable secret), 700 (private dir)."},
{"h": "x on directories is special",
 "p": "On a directory, `x` doesn't mean 'run' — it means 'traverse': you can `cd` in and access "
      "known paths, but without `r` you can't *list* it. A `755` directory is the norm: everyone "
      "can enter and list; only the owner can add or remove files."},
{"h": "The special bits you'll spot",
 "list": [
   "`s` in the user slot (e.g. `-rwsr-xr-x`) — **setuid**: run as the file's owner (how `passwd` edits root-owned files)",
   "`t` at the end of a directory (e.g. `drwxrwxrwt`) — **sticky bit**: in a shared-writable dir, only owners can delete their own files (that's `/tmp`)",
 ]},
{"tip": "`ls -l` prints these strings all day. Reading them fluently is a daily-use skill, "
        "not trivia."},
],
"task": [
{"step": "Study `listing.txt` — a captured `ls -l` output. Decode each line by hand."},
{"step": "Answer these in `answers.md` (exact keys):",
 "code": "mode_of_secret=OCTAL_OF_secret.env         # e.g. 640\nowner_of_app=USER_WHO_OWNS_THE_app_FILE\nworld_writable=NAME_OF_THE_FILE_ANYONE_CAN_WRITE\nsticky_dir=THE_DIRECTORY_WITH_THE_STICKY_BIT   # answer with its name\nsymbolic_770=THE_rwx_STRING_FOR_OCTAL_770"},
{"step": "For `symbolic_770`: convert 770 back to the nine-character rwx form (no leading type char)."},
],
"artifacts": [
["answers.md", "all five keys correct"],
],
"hints": [
"secret.env shows `-rw-r-----` → user rw (6), group r (4), other none (0) → 640.",
"The sticky bit is the `t` at the very end of one directory's mode string.",
"770 = rwx (7) rwx (7) --- (0) = `rwxrwx---`.",
],
},

# ─────────────────────────────────────────────────────────────── 4.2
{
"id": "4.2", "slug": "02-chmod-surgeon", "title": "Chmod Surgeon",
"tagline": "Set permissions with precision — octal and symbolic.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Reading locks was 4.1. Now you cut new ones. `chmod` speaks two dialects — octal "
         "(absolute) and symbolic (relative) — and a real Gatekeeper is fluent in both, because "
         "each wins in different moments.",
"learn": [
{"h": "Octal mode — set everything at once",
 "code": "chmod 600 vault.txt      # rw-------  (private)\nchmod 644 notes.txt      # rw-r--r--  (normal file)\nchmod 755 script.sh      # rwxr-xr-x  (runnable)\nchmod 770 group-zone/    # rwxrwx---  (owner+group full, others out)"},
{"h": "Symbolic mode — adjust relative to what's there",
 "code": "chmod +x script.sh       # add execute for everyone\nchmod u+x script.sh      # add execute for USER only\nchmod g-w file           # remove write from GROUP\nchmod o= file            # set OTHER to nothing\nchmod u=rw,g=r,o= file   # spell each class out (= 640)",
 "label": "u=user g=group o=other a=all  •  + add  - remove  = set exactly"},
{"p": "Use **octal** when you know the final state you want ('make it 600'). Use **symbolic** "
      "when you want a delta without disturbing the rest ('just add execute'). `chmod +x deploy.sh` "
      "is the most-typed chmod on Earth — it makes a script runnable without touching read bits."},
{"h": "Making a script executable, then running it",
 "code": "chmod +x runme.sh\n./runme.sh          # the ./ says 'run the file right here'",
 "label": "Why ./ ? Because '.' isn't on your PATH — a security default"},
{"h": "Recursive, carefully",
 "code": "chmod -R 755 dir/          # every file AND dir under it\nchmod -R u+X dir/          # capital X = x only where it makes sense (dirs, already-exec files)",
 "label": "-R descends; capital X is the smart-execute trick"},
{"tip": "`chmod -R 755` on a tree makes *data files* executable too, which is sloppy. Capital "
        "`X` adds execute only to directories and files that already had some execute bit — "
        "exactly what you usually mean."},
],
"task": [
{"step": "Set `vault.txt` to `600` (owner read/write only)."},
{"step": "Set `bulletin.txt` to `644` (owner writes, everyone reads)."},
{"step": "Make `runme.sh` executable at `755`, then run it with `./runme.sh` — it should print a success line."},
{"step": "Set the directory `group-zone/` to `770`."},
{"step": "Verify with `ls -l` and `ls -ld group-zone`. The checker parses the exact modes."},
],
"artifacts": [
["vault.txt", "mode 600"],
["bulletin.txt", "mode 644"],
["runme.sh", "mode 755 and runs"],
["group-zone/", "mode 770"],
],
"hints": [
"`ls -ld group-zone` shows a directory's own mode (without -d it lists the contents).",
"If `./runme.sh` says 'Permission denied', the execute bit isn't set — recheck the 755.",
],
},

# ─────────────────────────────────────────────────────────────── 4.3
{
"id": "4.3", "slug": "03-masks-and-defaults", "title": "Masks and Defaults",
"tagline": "umask — why new files are born 644.",
"xp": 100, "minutes": 20, "boss": False,
"intro": "Ever wondered why every file you create starts at 644 and every directory at 755, "
         "without you asking? A quiet gatekeeper called `umask` decides. Understand it and you "
         "control the defaults instead of fighting them.",
"learn": [
{"h": "The base and the mask",
 "p": "The system *wants* to create files as 666 (rw for all) and directories as 777. The "
      "`umask` then **subtracts** permission bits from that base. The common umask `022` "
      "removes write from group and other: 666 − 022 = **644** for files, 777 − 022 = **755** "
      "for directories. That's the default you've been seeing all along."},
{"h": "Seeing and setting it",
 "code": "umask            # show current mask (e.g. 0022)\numask -S         # show it symbolically (u=rwx,g=rx,o=rx)\numask 077        # new files → 600, new dirs → 700 (private-by-default)\numask 027        # new files → 640, new dirs → 750 (group-friendly, others out)"},
{"p": "It's a *mask*, not a subtraction in the arithmetic sense — it clears bits. But for the "
      "everyday values (022, 027, 077) the 'base minus mask' mental model gives the right "
      "answer every time. `x` is never added to plain files regardless, which is why a new "
      "file under umask 022 is 644, not 755."},
{"h": "Scope and persistence",
 "p": "`umask` set in a shell affects only files created *afterward*, in *that* shell and its "
      "children. To make it permanent, add the `umask` line to your `~/.bashrc`. Servers often "
      "set `027` or `077` so freshly written files aren't world-readable by accident."},
{"tip": "umask changes the *future*, never the past. Files that already exist keep their modes "
        "— use chmod for those."},
],
"task": [
{"step": "In your shell, set a private-by-default mask:",
 "code": "umask 077"},
{"step": "Create `private-note.txt` with a redirect (`echo \"secret\" > private-note.txt`) — under umask 077 it's born 600."},
{"step": "Now switch to a normal mask and create a public file:",
 "code": "umask 022\necho \"public\" > public-note.txt   # born 644"},
{"step": "Create a directory `dropbox/` under umask 027 so it lands at 750:",
 "code": "umask 027\nmkdir dropbox"},
{"step": "Reason it out and record in `answers.md`:",
 "code": "files_created_with_umask_027=THE_OCTAL_MODE_A_NEW_FILE_GETS   # (666 minus 027)"},
],
"artifacts": [
["private-note.txt", "mode 600 (created under umask 077)"],
["public-note.txt", "mode 644 (created under umask 022)"],
["dropbox/", "mode 750 (created under umask 027)"],
["answers.md", "files_created_with_umask_027=…"],
],
"hints": [
"Set the umask, THEN create the file — order matters, umask only affects future creations.",
"666 − 027 = 640. That's the answer for the last key.",
"If a file has the wrong mode, you set the umask after creating it — recreate it (or just chmod it to the target).",
],
},

# ─────────────────────────────────────────────────────────────── 4.4
{
"id": "4.4", "slug": "04-users-and-sudo", "title": "Users, Groups & Sudo",
"tagline": "Who are you, who can you become, and how the system knows.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Permissions mean nothing without identity. Today: how Linux stores users and groups "
         "in plain text files, what your identity actually *is*, and the careful art of "
         "borrowing root's power with `sudo`.",
"learn": [
{"h": "Who am I, really",
 "code": "whoami        # just the username\nid            # uid, gid, and ALL your groups — the full identity\ngroups        # the groups you belong to\nid -u         # numeric user id only (root is always 0)"},
{"h": "/etc/passwd — the user registry (7 colon-separated fields)",
 "code": "tux:x:1000:1000:Tux the Penguin:/home/tux:/bin/bash\n│   │ │    │    │                │          └ login shell\n│   │ │    │    │                └ home directory\n│   │ │    │    └ comment / full name (GECOS)\n│   │ │    └ primary group id (GID)\n│   │ └ user id (UID)\n│   └ password placeholder ('x' = it's in /etc/shadow)\n└ username",
 "label": "Despite the name, no passwords live here anymore"},
{"p": "UID 0 is root — absolute power. Regular humans usually start at 1000. A login shell of "
      "`/usr/sbin/nologin` or `/bin/false` marks a *service account* that isn't meant to log in "
      "(databases, daemons). `/etc/group` maps group names to GIDs and lists extra members."},
{"h": "sudo — borrow root for one command",
 "code": "sudo apt update           # run THIS command as root\nsudo -u postgres psql     # run as a specific other user\nsudo -l                   # list what you're allowed to run\nsudo -i                   # start an interactive root shell (careful)"},
{"p": "`sudo` beats logging in as root because it's *scoped* (one command), *audited* (every "
      "use is logged), and *revocable* (managed in `/etc/sudoers`, edited only via `visudo`). "
      "The rule of the craft: use the least power that gets the job done."},
{"tip": "This mission reads *sample* copies of passwd/group in `sample/` — you won't touch the "
        "real system files. But the format is identical to the real `/etc/passwd`."},
],
"task": [
{"step": "Record your own identity: `id > my-id.txt` (must contain a `uid=` field)."},
{"step": "Study `sample/passwd` and `sample/group`, then answer in `answers.md`:",
 "code": "root_uid=THE_UID_OF_root\ntux_shell=THE_LOGIN_SHELL_OF_tux\ntux_home=THE_HOME_DIRECTORY_OF_tux\nops_gid=THE_GID_OF_THE_ops_GROUP\nnologin_users=HOW_MANY_ACCOUNTS_USE_nologin_AS_SHELL\npasswd_field_count=HOW_MANY_COLON_SEPARATED_FIELDS_PER_LINE"},
],
"artifacts": [
["my-id.txt", "output of id, containing uid="],
["answers.md", "all six keys correct"],
],
"hints": [
"Fields per line: count the colons and add one — `head -1 sample/passwd` then count.",
"nologin users: `grep -c nologin sample/passwd`.",
"ops group GID is the number in the `ops:` line of sample/group.",
],
},

# ─────────────────────────────────────────────────────────────── 4.5
{
"id": "4.5", "slug": "05-boss-operation-lockdown", "title": "BOSS — Operation Lockdown",
"tagline": "Secure a real app directory to production standards.",
"xp": 250, "minutes": 40, "boss": True,
"intro": "A developer shipped an app folder with everything world-readable — secrets included. "
         "Your job, Gatekeeper: lock it down to production hygiene. Right permissions on the "
         "right files, scripts runnable, secrets unreadable, and a written rationale.",
"learn": [
{"h": "Boss briefing — the hardening standard",
 "list": [
   "Secrets (`config/secrets.env`) → **600**: only the owner may read. A leaked secret is the whole game.",
   "Config that services read (`config/app.conf`) → **640**: owner writes, group reads, others blind.",
   "Executables (`bin/*.sh`) → **755**: everyone may run, only owner may edit.",
   "Public assets (`public/*`) → **644**: readable by all, that's their job.",
   "Data directory (`data/`) → **750**: owner full, group may enter, others out.",
 ]},
{"h": "Doing it efficiently",
 "code": "chmod 755 app/bin/*.sh          # glob hits every script at once\nchmod 644 app/public/*         # all public assets\nchmod 750 app/data             # the directory itself\nls -lR app                     # audit the whole tree afterward",
 "label": "Glob per class, then verify"},
{"tip": "The written 'why' matters as much as the chmod. In a real review, 'secrets are 600 "
        "because a world-readable credential is a breach' is the sentence that gets you hired."},
],
"task": [
{"step": "Apply the standard above to everything under `app/`."},
{"step": "Make `app/bin/start.sh` runnable and execute it (`./app/bin/start.sh`) — it prints a startup line proving the execute bit works."},
{"step": "Write `app/SECURITY.md` documenting your decisions:",
 "code": "secrets_env=600\nbin_scripts=755\ndata_dir=750\nwhy=ONE_SENTENCE_ON_WHY_SECRETS_ARE_600"},
{"step": "Audit with `ls -lR app` and confirm every mode matches the standard."},
],
"artifacts": [
["app/config/secrets.env", "mode 600"],
["app/config/app.conf", "mode 640"],
["app/bin/*.sh", "mode 755, and start.sh runs"],
["app/public/*", "mode 644"],
["app/data/", "mode 750"],
["app/SECURITY.md", "four keys, why is a non-empty sentence"],
],
"hints": [
"Do the scripts with a glob: `chmod 755 app/bin/*.sh`.",
"`ls -ld app/data` to check the directory's own mode is 750.",
"'why' just needs to be a real sentence — e.g. 'A world-readable credential file is a breach waiting to happen.'",
],
},

    ],
}
