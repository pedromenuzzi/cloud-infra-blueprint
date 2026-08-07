BELT = {
    "n": 7,
    "slug": "07-brown-belt",
    "name": "Brown Belt",
    "color": "#a16207",
    "rank": "Script Smith",
    "motto": "Do it once by hand. Do it twice, write a script. Do it thrice, you already have one.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 7.1
{
"id": "7.1", "slug": "01-script-zero", "title": "Script Zero",
"tagline": "Shebang, chmod +x, exit codes — a real script from scratch.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Everything you've typed by hand, a script can do on demand, forever. A shell script "
         "is just commands in a file — plus three rituals that turn a text file into a real "
         "program: the shebang, the execute bit, and an exit code.",
"learn": [
{"h": "The shebang line",
 "code": "#!/usr/bin/env bash\n# ^ MUST be the very first line. Tells the OS which interpreter runs this file.",
 "label": "#! + interpreter path"},
{"p": "`#!/usr/bin/env bash` finds bash via your PATH — more portable than a hardcoded "
      "`#!/bin/bash` (bash lives in different places on different systems). The line looks like "
      "a comment but the kernel reads those first two bytes specially."},
{"h": "From file to program",
 "code": "vim greet.sh          # or nano, or your editor of choice\nchmod +x greet.sh     # grant the execute bit\n./greet.sh            # run it (./ = 'right here')",
 "label": "Three steps: write, chmod, run"},
{"h": "Comments and echo",
 "code": "#!/usr/bin/env bash\n# This is a comment — ignored by bash, read by humans.\necho \"Hello, Tux!\"    # print a line",
 "label": "# starts a comment anywhere on a line"},
{"h": "Exit codes — how programs report success",
 "code": "exit 0     # success (0 = OK, ALWAYS)\nexit 1     # generic failure\nexit 2     # a different failure (your choice of meaning)\n# after any command:\necho $?    # the exit code of the LAST command",
 "label": "0 = success; non-zero = something went wrong"},
{"p": "Exit codes are how scripts talk to each other and to `&&`/`||`. `cmd && echo ok` runs "
      "the echo only if cmd succeeded (exit 0); `cmd || echo failed` runs it only on failure. "
      "A script with no explicit `exit` returns the code of its last command — usually fine, "
      "but being explicit with `exit 0` signals intent."},
{"tip": "Run `bash -n script.sh` to syntax-check a script *without executing it*. Catching a "
        "typo before it runs is a Script Smith habit."},
],
"task": [
{"step": "Write a script `greet.sh` in this folder that: starts with the bash shebang, and prints exactly `Hello, Tux!` when given a name argument OR `Hello, stranger!` when given none."},
{"step": "Full example to adapt:",
 "code": "#!/usr/bin/env bash\nif [ -n \"$1\" ]; then\n    echo \"Hello, $1!\"\nelse\n    echo \"Hello, stranger!\"\nfi\nexit 0"},
{"step": "Wait — read that carefully: the checker wants `Hello, Tux!` specifically when you pass `Tux`, and `Hello, stranger!` with no argument. Make it executable and test both:",
 "code": "chmod +x greet.sh\n./greet.sh Tux      # → Hello, Tux!\n./greet.sh          # → Hello, stranger!"},
{"step": "Confirm the exit code is 0: `./greet.sh Tux; echo $?`."},
],
"artifacts": [
["greet.sh", "executable, has a shebang, prints Hello, Tux! / Hello, stranger!, exits 0"],
],
"hints": [
"`[ -n \"$1\" ]` is true when the first argument is non-empty. Quote $1 to survive spaces.",
"If './greet.sh' says permission denied, you forgot `chmod +x greet.sh`.",
"The checker runs `./greet.sh Tux` and `./greet.sh` — match both outputs exactly.",
],
},

# ─────────────────────────────────────────────────────────────── 7.2
{
"id": "7.2", "slug": "02-variables-substitution", "title": "Variables & Substitution",
"tagline": "Store values, capture command output, do arithmetic.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "A script without variables is a fancy way to retype constants. Today: naming values, "
         "the quoting rules that separate working scripts from haunted ones, capturing a "
         "command's output into a variable, and doing math in bash.",
"learn": [
{"h": "Setting and using variables",
 "code": "name=\"Tux\"          # NO spaces around = (name = \"Tux\" is an error!)\necho \"$name\"        # use with $ ; quotes preserve spaces\necho \"${name}_v2\"    # braces when the name touches other text",
 "label": "assign without spaces, expand with $"},
{"h": "The quoting rules that bite everyone",
 "list": [
   "**\"double quotes\"** — expand variables (`\"$name\"` → Tux) but keep the value as one word",
   "**'single quotes'** — literal, NO expansion (`'$name'` → the text $name)",
   "**no quotes** — expands AND splits on spaces and globs (source of most bugs)",
 ]},
{"p": "Rule of thumb: **quote every variable expansion** (`\"$var\"`) unless you have a specific "
      "reason not to. Unquoted `$file` with a space in it becomes two arguments and breaks "
      "silently. This one habit prevents more bugs than any other."},
{"h": "Command substitution — capture output",
 "code": "today=$(date +%Y-%m-%d)      # run date, store its output\nfiles=$(ls | wc -l)          # count files into a variable\necho \"There are $files files, today is $today\"",
 "label": "$( ... ) runs a command and gives back its output"},
{"h": "Arithmetic",
 "code": "a=3; b=5\nsum=$(( a + b ))         # 8  — $(( )) does integer math\nproduct=$(( a * b ))     # 15\ncount=$(( count + 1 ))   # the classic increment",
 "label": "$(( )) for integers"},
{"h": "Positional and special parameters",
 "list": [
   "`$1 $2 $3 …` — the script's arguments",
   "`$#` — how many arguments were given",
   "`$0` — the script's own name",
   "`$@` — all arguments (quote it: `\"$@\"`)",
 ]},
{"tip": "`set -u` at the top of a script makes it error on any *unset* variable instead of "
        "silently using empty string — catching typo'd variable names early. You'll adopt it "
        "as standard at black belt."},
],
"task": [
{"step": "Write `calc.sh` that takes two number arguments and prints two lines: `sum=<a+b>` and `product=<a*b>`. Example: `./calc.sh 3 5` prints `sum=8` then `product=15`.",
 "code": "#!/usr/bin/env bash\na=\"$1\"; b=\"$2\"\necho \"sum=$(( a + b ))\"\necho \"product=$(( a * b ))\""},
{"step": "Write `info.sh` that prints your hostname and a number of seconds, using command substitution:",
 "code": "#!/usr/bin/env bash\necho \"host=$(hostname)\"\necho \"secs=$(date +%S)\""},
{"step": "Make both executable and test: `./calc.sh 3 5`, `./calc.sh 10 10`, `./info.sh`."},
],
"artifacts": [
["calc.sh", "executable; 3 5 → sum=8/product=15; 10 10 → sum=20/product=100"],
["info.sh", "executable; prints host=<nonempty> and secs=<digits>"],
],
"hints": [
"Assignment has NO spaces: `a=\"$1\"` not `a = \"$1\"`.",
"Arithmetic needs the double parens: `$(( a + b ))`.",
"The checker runs calc.sh with two different pairs — make sure it reads $1 and $2, not hardcoded numbers.",
],
},

# ─────────────────────────────────────────────────────────────── 7.3
{
"id": "7.3", "slug": "03-decisions", "title": "Decisions",
"tagline": "if/test, exit codes, and talking to stderr.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "Scripts that can't decide are just macros. Today your scripts gain judgment: testing "
         "files, comparing values, branching, and — the mark of a pro — reporting errors on "
         "stderr with meaningful exit codes.",
"learn": [
{"h": "The if statement",
 "code": "if [ \"$x\" = \"yes\" ]; then\n    echo \"affirmative\"\nelif [ \"$x\" = \"no\" ]; then\n    echo \"negative\"\nelse\n    echo \"unclear\"\nfi",
 "label": "if … then … elif … else … fi"},
{"h": "File test operators",
 "list": [
   "`[ -e path ]` — exists (any type)",
   "`[ -f path ]` — exists and is a regular **f**ile",
   "`[ -d path ]` — exists and is a **d**irectory",
   "`[ -r path ]` / `-w` / `-x` — readable / writable / executable",
   "`[ -s path ]` — exists and is non-empty (has **s**ize)",
 ]},
{"h": "String and number tests",
 "code": "[ \"$a\" = \"$b\" ]    # strings equal        [ \"$a\" != \"$b\" ]  # not equal\n[ -z \"$s\" ]        # string is empty       [ -n \"$s\" ]       # string is non-empty\n[ \"$m\" -eq \"$n\" ]  # numbers: -eq -ne -lt -le -gt -ge",
 "label": "= for strings, -eq for numbers (mixing them is a classic bug)"},
{"h": "stderr and exit codes — professional error reporting",
 "code": "if [ \"$#\" -eq 0 ]; then\n    echo \"usage: $0 <path>\" >&2    # errors go to STDERR (>&2)\n    exit 1                          # non-zero = failure\nfi",
 "label": "Errors on stderr, distinct exit codes"},
{"p": "Why `>&2`? So error messages don't pollute the *data* a script prints on stdout. A user "
      "can do `./script > results.txt` and still SEE the errors on screen. Different exit codes "
      "(1, 2, …) let callers distinguish failure *reasons* — the checker relies on exactly this."},
{"h": "The [[ ]] upgrade",
 "p": "Bash also offers `[[ ... ]]` — same idea, but safer (no word-splitting surprises) and "
      "with extras like `&&`, `||`, and pattern matching. Prefer `[[ ]]` in bash scripts; "
      "`[ ]` is the portable POSIX form. Both are taught here; the checker accepts either."},
],
"task": [
{"step": "Write `filecheck.sh` that inspects its first argument and behaves EXACTLY like this:"},
{"step": "• No argument → print `usage: ...` to **stderr** and `exit 1`."},
{"step": "• Argument is a directory → print `is a directory` and `exit 0`."},
{"step": "• Argument is a regular file → print `is a file` and `exit 0`."},
{"step": "• Argument names something that doesn't exist → print `does not exist` and `exit 2`."},
{"step": "Skeleton to complete:",
 "code": "#!/usr/bin/env bash\nif [ \"$#\" -eq 0 ]; then\n    echo \"usage: $0 <path>\" >&2\n    exit 1\nfi\nif [ -d \"$1\" ]; then\n    echo \"is a directory\"; exit 0\nelif [ -f \"$1\" ]; then\n    echo \"is a file\"; exit 0\nelse\n    echo \"does not exist\"; exit 2\nfi"},
{"step": "Test all four paths and check `$?` each time: no-arg, a dir (like `.`), a file (like the script itself), and a made-up name."},
],
"artifacts": [
["filecheck.sh", "executable; four behaviors with exit codes 1/0/0/2 and stderr usage"],
],
"hints": [
"Order matters: test -d before -f, and both before the 'does not exist' else.",
"`>&2` redirects that echo to stderr. The checker verifies the usage text is NOT on stdout.",
"Verify exit codes: `./filecheck.sh; echo $?` should print 1 (no arg).",
],
},

# ─────────────────────────────────────────────────────────────── 7.4
{
"id": "7.4", "slug": "04-loops-functions", "title": "Loops & Functions",
"tagline": "for, while, and reusable functions.",
"xp": 100, "minutes": 30, "boss": False,
"intro": "Repetition is the whole reason scripts exist. Loops let one instruction process a "
         "thousand items; functions let you name a chunk of logic and reuse it. Together they "
         "turn scripts from linear notes into real programs.",
"learn": [
{"h": "The for loop",
 "code": "for f in *.txt; do\n    echo \"found: $f\"\ndone\n\nfor i in 1 2 3; do echo \"n=$i\"; done\n\nfor i in $(seq 1 5); do echo \"$i\"; done   # 1..5",
 "label": "for VAR in LIST; do … done"},
{"h": "Looping over files SAFELY",
 "p": "Glob directly (`for f in *.txt`) rather than `for f in $(ls)` — the latter breaks on "
      "spaces in names. Always quote `\"$f\"` inside the loop. If a glob might match nothing, "
      "guard with `[ -e \"$f\" ]` at the top of the body."},
{"h": "The while loop",
 "code": "count=1\nwhile [ \"$count\" -le 5 ]; do\n    echo \"tick $count\"\n    count=$(( count + 1 ))\ndone\n\nwhile read -r line; do        # read a file line by line\n    echo \"line: $line\"\ndone < input.txt",
 "label": "while CONDITION; do … done"},
{"h": "Functions",
 "code": "greet() {\n    local name=\"$1\"        # 'local' keeps it inside the function\n    echo \"Hello, $name\"\n}\ngreet \"Tux\"                # call it like a command\n\ncount_files() {\n    find \"$1\" -type f | wc -l\n}\nn=$(count_files .)          # capture a function's output",
 "label": "name() { … } — call by name, args are $1 $2 …"},
{"p": "Functions take arguments exactly like scripts do (`$1`, `$2`, `$#`) and 'return' data by "
      "printing it (captured with `$(...)`). Use `local` for a function's own variables so they "
      "don't leak into the rest of the script — a discipline that prevents baffling bugs."},
{"tip": "`return N` sets a function's *exit code* (0–255), not its output. Output is what you "
        "`echo`. Confusing the two is a rite of passage — now you can skip it."},
],
"task": [
{"step": "Write `inspector.sh <dir>` that reports on a directory using BOTH a function and a loop. It must print exactly three lines:",
 "code": "dirs=<number of subdirectories>\nfiles=<number of regular files>\ntotal=<dirs + files>"},
{"step": "It must contain at least one function definition (`name() { ... }`) and at least one loop (`for` or `while`). One working shape:",
 "code": "#!/usr/bin/env bash\ntarget=\"${1:-.}\"\ncount_type() {\n    local kind=\"$1\" dir=\"$2\" n=0\n    for entry in \"$dir\"/*; do\n        [ -e \"$entry\" ] || continue\n        if [ \"$kind\" = d ] && [ -d \"$entry\" ]; then n=$(( n + 1 )); fi\n        if [ \"$kind\" = f ] && [ -f \"$entry\" ]; then n=$(( n + 1 )); fi\n    done\n    echo \"$n\"\n}\nd=$(count_type d \"$target\")\nf=$(count_type f \"$target\")\necho \"dirs=$d\"\necho \"files=$f\"\necho \"total=$(( d + f ))\""},
{"step": "The checker runs your script against a fixture directory with 2 subdirectories and 3 files (expecting dirs=2, files=3, total=5). Test yours against such a folder — make one with `mkdir -p t/{a,b}; touch t/{x,y,z}.txt; ./inspector.sh t`."},
],
"artifacts": [
["inspector.sh", "executable; prints dirs=/files=/total=; contains a function AND a loop; correct on the fixture"],
],
"hints": [
"The `[ -e \"$entry\" ] || continue` guard handles the case where a glob matches nothing.",
"total must equal dirs + files. The checker builds a 2-dir/3-file fixture and expects 2/3/5.",
"The checker greps your script for a function definition and a loop keyword — keep both.",
],
},

# ─────────────────────────────────────────────────────────────── 7.5
{
"id": "7.5", "slug": "05-boss-backup-forge", "title": "BOSS — The Backup Forge",
"tagline": "Build a real, argument-driven backup tool with retention.",
"xp": 250, "minutes": 50, "boss": True,
"intro": "Time to forge a tool you'd actually keep. A backup script: it takes arguments, "
         "validates them like an adult, compresses a directory with a timestamped name, and "
         "prunes old backups so the disk never fills. This is the graduation of the Script Smith.",
"learn": [
{"h": "Boss briefing — the spec",
 "list": [
   "`./backup.sh --help` → print usage, exit 0.",
   "`./backup.sh` with NO arguments → usage on stderr, exit 1.",
   "`./backup.sh <dir>` where <dir> doesn't exist → error on stderr, exit 2.",
   "`./backup.sh <dir>` (valid) → create `backups/<basename>-<timestamp>.tar.gz`, print a `created …` line, exit 0.",
   "Retention: keep only the **3 newest** archives in `backups/`, delete older ones.",
 ]},
{"h": "The compression command",
 "code": "tar -czf backups/name-20260101-120000.tar.gz -C parent basename\n#      │││                                        └ -C: cd there first, then archive 'basename'\n#      ││└ f: output file\n#      │└ z: gzip compress\n#      └ c: create",
 "label": "tar czf — create gzipped archive"},
{"h": "A safe timestamp",
 "code": "ts=$(date +%Y%m%d-%H%M%S)      # 20260101-120000 — sortable, no spaces",
 "label": "Sortable timestamps make retention trivial"},
{"h": "Retention with ls",
 "code": "ls -1t backups/*.tar.gz 2>/dev/null | tail -n +4 | while read -r old; do\n    rm -f \"$old\"\ndone\n# ls -1t = newest first; tail -n +4 = everything from the 4th onward (the old ones)",
 "label": "Keep 3: delete from the 4th-newest down"},
{"h": "Recommended header",
 "code": "#!/usr/bin/env bash\nset -euo pipefail\n# -e exit on error, -u error on unset var, -o pipefail catch errors mid-pipe",
 "label": "The professional safety header"},
{"tip": "Build incrementally: get `--help` working, then no-args, then the missing-dir case, "
        "then the happy path, and retention last. Test each branch before adding the next — "
        "that's how real tools get written."},
],
"task": [
{"step": "Write `backup.sh` meeting every point in the spec above. Handle `--help`, no-args (stderr+exit 1), missing dir (stderr+exit 2), and the happy path (create timestamped tar.gz in `backups/`, print `created <path>`, exit 0)."},
{"step": "Implement retention: after creating a backup, keep only the 3 newest `.tar.gz` files in `backups/`."},
{"step": "Test it yourself against a sample directory:",
 "code": "chmod +x backup.sh\nmkdir -p sample-data && echo hi > sample-data/a.txt\n./backup.sh --help; echo \"rc=$?\"\n./backup.sh; echo \"rc=$?\"            # expect rc=1\n./backup.sh /no/such/dir; echo \"rc=$?\"  # expect rc=2\n./backup.sh sample-data; echo \"rc=$?\"   # expect rc=0 + a created line\nls backups/"},
{"step": "The checker will run your script several times to confirm retention keeps exactly 3 archives. Make sure the archive is a valid tar.gz containing your source files (`tar -tzf backups/....tar.gz`)."},
],
"artifacts": [
["backup.sh", "executable; all four behaviors with correct exit codes"],
["backups/*.tar.gz", "valid gzipped tar containing the backed-up files"],
["retention", "never more than 3 archives kept"],
],
"hints": [
"For --help, check `[ \"$1\" = \"--help\" ]` BEFORE the no-args check (well, no-args means $# -eq 0).",
"Validate: `[ $# -eq 0 ]` → exit 1; `[ ! -d \"$1\" ]` → exit 2.",
"Verify an archive: `tar -tzf backups/<file>.tar.gz` should list your source files.",
"Retention counts only .tar.gz in backups/. Run backup.sh 4+ times and confirm `ls backups | wc -l` stays 3.",
],
},

    ],
}
