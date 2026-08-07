BELT = {
    "n": 1,
    "slug": "01-white-belt",
    "name": "White Belt",
    "color": "#f2f2ec",
    "rank": "Hatchling",
    "motto": "Every sensei once typed `ls` for the first time.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 1.1
{
"id": "1.1", "slug": "01-hello-terminal", "title": "Hello, Terminal",
"tagline": "Meet the shell — your new superpower.",
"xp": 100, "minutes": 15, "boss": False,
"intro": "Welcome to the dojo, Hatchling. Before you can master Linux, you must speak "
         "to it directly. The terminal is not scary — it is honest. It does exactly "
         "what you say, which is why we will practice saying the right things.",
"learn": [
{"h": "What a shell actually is",
 "p": "When you open a terminal, a program called a **shell** (usually `bash` or `zsh`) starts "
      "and waits for you. You type a command, press Enter, the shell finds the program, runs it, "
      "shows the output, and waits again. That loop — read, run, repeat — is the whole game. "
      "Everything else in this dojo builds on it."},
{"h": "Your first four commands",
 "code": "pwd        # Print Working Directory — where am I?\nwhoami     # which user am I logged in as?\ndate       # what time does the system think it is?\necho hi    # print back whatever I give you",
 "label": "Try each one now"},
{"p": "`echo` looks silly until you realize it is how scripts talk, how you inspect variables, "
      "and how you write files without an editor. You will use it thousands of times."},
{"h": "Redirection: sending output into a file",
 "p": "Normally output goes to your screen. The `>` operator redirects it into a file instead — "
      "creating the file if needed, **overwriting** it if it exists. Its sibling `>>` appends to "
      "the end instead of overwriting."},
{"code": "echo \"words go here\" > note.txt    # create/overwrite note.txt\necho \"one more line\" >> note.txt   # append\ncat note.txt                        # show the file"},
{"tip": "Press the ↑ arrow to recall previous commands, and press Tab to auto-complete file "
        "names. Sensei types half as much as you think."},
],
"task": [
{"step": "Open a terminal and `cd` into this mission folder (the folder containing this README)."},
{"step": "Run `pwd`, `whoami` and `date` — just to feel the loop. Look at each output."},
{"step": "Create a file `hello.txt` containing exactly the line `Hello, Tux!` using echo and `>`:",
 "code": "echo \"Hello, Tux!\" > hello.txt"},
{"step": "Create `whoami.txt` containing the output of the `whoami` command (redirect it):",
 "code": "whoami > whoami.txt"},
{"step": "Read both files back with `cat` to confirm what landed in them."},
],
"artifacts": [
["hello.txt", "one line, exactly: Hello, Tux!"],
["whoami.txt", "one non-empty line — your username"],
],
"hints": [
"If `hello.txt` has the wrong text, just run the echo command again — `>` overwrites.",
"Quotes matter: `echo \"Hello, Tux!\"` keeps the exclamation mark safe from the shell.",
],
},

# ─────────────────────────────────────────────────────────────── 1.2
{
"id": "1.2", "slug": "02-hidden-treasure", "title": "The Hidden Treasure",
"tagline": "Navigate the filesystem. Find what hides from plain sight.",
"xp": 100, "minutes": 20, "boss": False,
"intro": "A maze of directories awaits inside this folder. Somewhere deep within lies a "
         "treasure — but it hides the way many important Linux files hide: behind a name "
         "that starts with a dot.",
"learn": [
{"h": "The filesystem is a tree",
 "p": "Linux organizes everything under a single root, `/`. Directories contain files and more "
      "directories. Your position in the tree is your *working directory* (`pwd` shows it). "
      "Paths starting with `/` are **absolute**; anything else is **relative** to where you stand."},
{"h": "Moving around",
 "code": "cd maze            # go down into 'maze' (relative)\ncd corridor-a      # deeper\ncd ..              # up one level\ncd ../..           # up two levels\ncd -               # jump back to wherever you were before\ncd                 # no argument: go to your home directory"},
{"h": "Looking around",
 "code": "ls          # list the current directory\nls -l       # long format: permissions, owner, size, date\nls -a       # ALL entries — including hidden dotfiles\nls -la      # both at once\nls -R       # recurse into subdirectories",
 "label": "The flags you will use forever"},
{"p": "Files and directories whose names start with `.` are *hidden*: plain `ls` skips them. "
      "That is convention, not security — `.bashrc`, `.ssh`, `.gitignore` all live like this. "
      "`ls -a` reveals them (note the `.` and `..` entries: the directory itself and its parent)."},
{"tip": "Tab completion works on directory names too. Type `cd cor` then Tab. If it beeps, "
        "press Tab twice to see the options."},
],
"task": [
{"step": "Explore `maze/` using `cd` and `ls -a`. Read the notes you find — the flavor is free, the practice is the point."},
{"step": "Somewhere in the maze is a hidden file called `.treasure`. Find it."},
{"step": "From this mission folder, copy the treasure's *content* into a file named `found.txt`:",
 "code": "cat maze/path/to/the/.treasure > found.txt   # fix the path to the real one"},
{"step": "Create `answers.md` here with exactly these two lines (fill in the real values):",
 "code": "treasure_dir=NAME_OF_DIRECTORY_CONTAINING_TREASURE\nreveal_flag=THE_LS_FLAG_THAT_SHOWS_HIDDEN_FILES"},
],
"artifacts": [
["found.txt", "the exact content of the hidden .treasure file"],
["answers.md", "treasure_dir=… and reveal_flag=… filled in correctly"],
],
"hints": [
"`ls -aR maze` sweeps the whole maze in one shot — corridors, shelves, everything.",
"`treasure_dir` wants just the directory's name (like `cellar`), not the whole path.",
"You can create answers.md with echo: `echo \"treasure_dir=...\" > answers.md` then `echo \"reveal_flag=...\" >> answers.md`.",
],
},

# ─────────────────────────────────────────────────────────────── 1.3
{
"id": "1.3", "slug": "03-the-architect", "title": "The Architect",
"tagline": "Create structure out of nothing: mkdir and touch.",
"xp": 100, "minutes": 15, "boss": False,
"intro": "Reading the tree is half the skill. Now you will grow branches yourself. "
         "An architect who needs seven commands for a five-room house is still a student; "
         "today you learn `-p` and brace expansion, the tools of lazy masters.",
"learn": [
{"h": "Creating directories",
 "code": "mkdir workshop                 # one directory\nmkdir -p a/b/c                 # create the WHOLE path, parents included\nmkdir -p proj/{src,docs,test}  # brace expansion: three dirs in one shot"},
{"p": "Without `-p`, `mkdir a/b/c` fails if `a/b` does not exist. With `-p` it builds every "
      "missing level and never complains if something already exists. The braces `{src,docs}` "
      "are expanded by the *shell* before mkdir even runs — `echo proj/{src,docs}` shows you "
      "exactly what mkdir would receive. That trick works with every command, not just mkdir."},
{"h": "Creating empty files",
 "code": "touch notes.txt                # create if missing (or update its timestamp)\ntouch a.txt b.txt c.txt        # several at once"},
{"p": "`touch` exists to update file timestamps, but everyone uses it to create empty files. "
      "An empty file is often meaningful: lock files, `.gitkeep` markers, placeholders."},
{"h": "A 60-second tour of the real tree",
 "list": [
   "`/etc` — system configuration (text files, mostly)",
   "`/home` — user home directories (`/home/tux`)",
   "`/var` — data that varies: logs (`/var/log`), queues, caches",
   "`/usr` — installed software and libraries",
   "`/tmp` — scratch space, wiped on reboot",
   "`/bin`, `/usr/bin` — the programs you have been running",
 ]},
{"tip": "This layout is called the FHS (Filesystem Hierarchy Standard). When a config file "
        "goes missing, an expert *guesses* the right directory before searching. You will too."},
],
"task": [
{"step": "In this mission folder, build exactly this structure:",
 "code": "base-camp/\n├── bin/\n├── logs/\n│   └── archive/\n└── notes/\n    ├── ideas.txt\n    └── todo.txt"},
{"step": "Inside `logs/archive/`, create a hidden marker file named `.keep` (empty).",
 "code": "touch base-camp/logs/archive/.keep"},
{"step": "Challenge (honor system): build all the directories with ONE `mkdir -p` command using braces, and both txt files with ONE `touch`."},
{"step": "Verify your work with `ls -laR base-camp`."},
],
"artifacts": [
["base-camp/bin/, logs/archive/, notes/", "all directories exist"],
["base-camp/notes/ideas.txt + todo.txt", "both files exist"],
["base-camp/logs/archive/.keep", "hidden empty file exists"],
],
"hints": [
"One-liner for the dirs: `mkdir -p base-camp/{bin,logs/archive,notes}`.",
"One-liner for the files: `touch base-camp/notes/{ideas,todo}.txt`.",
],
},

# ─────────────────────────────────────────────────────────────── 1.4
{
"id": "1.4", "slug": "04-speed-reader", "title": "Speed Reader",
"tagline": "cat, less, head, tail, wc — read files like a pro.",
"xp": 100, "minutes": 20, "boss": False,
"intro": "In Linux, *everything* wants to talk to you through text files: logs, configs, "
         "even the kernel. The expedition logbook in this folder is your training text. "
         "Learn to read big files without drowning in them.",
"learn": [
{"h": "Four readers, four jobs",
 "code": "cat logbook.txt        # dump the whole file (fine for small files)\nless logbook.txt       # PAGE through a big file (q to quit)\nhead -n 5 logbook.txt  # first 5 lines only\ntail -n 5 logbook.txt  # last 5 lines only"},
{"h": "Survival keys inside less",
 "list": [
   "`Space` / `b` — next / previous page",
   "`/text` then Enter — search forward for “text”; `n` jumps to the next match",
   "`g` / `G` — jump to the beginning / end",
   "`q` — quit (the key everyone forgets first)",
 ]},
{"h": "Counting with wc",
 "code": "wc -l logbook.txt   # lines\nwc -w logbook.txt   # words\nwc -c logbook.txt   # bytes"},
{"p": "`tail` has a famous superpower you will meet again in ops work: `tail -f file` *follows* "
      "a file live, printing new lines as they are written. It is how people watch logs in real "
      "time. (Ctrl+C stops it.)"},
{"tip": "Rule of thumb: `cat` for small files, `less` for everything else. Piping a giant file "
        "to your terminal with cat is a rite of passage — once."},
],
"task": [
{"step": "Save the first 5 lines of the logbook into `first5.txt`:",
 "code": "head -n 5 logbook.txt > first5.txt"},
{"step": "Save the last 5 lines into `last5.txt`:",
 "code": "tail -n 5 logbook.txt > last5.txt"},
{"step": "Open the logbook with `less`, search for the word `SIGNAL` (type `/SIGNAL` then Enter), and note the code that follows it. Quit with `q`."},
{"step": "Count the lines of the logbook with `wc -l`, then create `answers.md`:",
 "code": "total_lines=NUMBER\nsignal=THE_CODE_YOU_FOUND"},
],
"artifacts": [
["first5.txt", "exactly the first 5 lines of logbook.txt"],
["last5.txt", "exactly the last 5 lines of logbook.txt"],
["answers.md", "total_lines=… and signal=… filled in"],
],
"hints": [
"The signal code looks like `word-word-number`. Copy it exactly.",
"`wc -l logbook.txt` prints the count and the filename; the number is what you want.",
],
},

# ─────────────────────────────────────────────────────────────── 1.5
{
"id": "1.5", "slug": "05-boss-scavenger-hunt", "title": "BOSS — The Scavenger Hunt",
"tagline": "Everything so far, in one hunt: navigate, reveal, read, count, write.",
"xp": 250, "minutes": 25, "boss": True,
"intro": "Your first trial, Hatchling. A village, a forest, and three shards hidden in the "
         "shadows. No new commands here — only proof that the old ones obey you. Defeat this "
         "and the white belt is yours.",
"learn": [
{"h": "Boss briefing",
 "p": "Inside `hunt/` are exactly **three hidden shard files** (`.shard-1`, `.shard-2`, "
      "`.shard-3`), each containing one word. Together, in order, they form a three-word "
      "passphrase. There is also a `wall-of-text.txt` whose line count guards the answer to "
      "one question."},
{"h": "Your arsenal",
 "code": "ls -aR hunt          # sweep everything, hidden files included\ncat hunt/path/.shard-1\nwc -l hunt/wall-of-text.txt\nmkdir, echo >, >>      # you know these now"},
{"tip": "When you need one file to contain several words on one line, remember that echo "
        "prints exactly what you give it: `echo \"a b c\" > file`."},
],
"task": [
{"step": "Find all three shards inside `hunt/` and read each one."},
{"step": "Create a directory `trophy-room/` in this mission folder."},
{"step": "Write the three shard words, in shard order, as ONE line separated by single spaces, into `trophy-room/passphrase.txt`. (Three words, one space between each.)"},
{"step": "Count the lines of `hunt/wall-of-text.txt` and create `answers.md`:",
 "code": "lines=NUMBER\nshards_found=3"},
],
"artifacts": [
["trophy-room/passphrase.txt", "the three shard words in order, one line"],
["answers.md", "lines=… and shards_found=3"],
],
"hints": [
"`ls -aR hunt` shows every hidden file at once — the shards' paths included.",
"Shard order is the number in the file name, not the order you find them in.",
"Passphrase format: `word1 word2 word3` — no commas, no extra spaces.",
],
},

    ],
}
