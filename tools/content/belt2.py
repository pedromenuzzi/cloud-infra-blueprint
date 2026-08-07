BELT = {
    "n": 2,
    "slug": "02-yellow-belt",
    "name": "Yellow Belt",
    "color": "#f7d94c",
    "rank": "File Wrangler",
    "motto": "Move a thousand files with one line — or delete your weekend with one typo.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 2.1
{
"id": "2.1", "slug": "01-copy-that", "title": "Copy That",
"tagline": "cp and mv — duplicate, rename, relocate.",
"xp": 100, "minutes": 15, "boss": False,
"intro": "A wrangler never edits originals. Today you learn the two commands that move "
         "matter around the filesystem — and the difference between them: `cp` makes more, "
         "`mv` makes elsewhere.",
"learn": [
{"h": "Copying",
 "code": "cp source.txt copy.txt          # copy a file\ncp source.txt some-dir/         # copy INTO a directory (same name)\ncp -r project/ project-backup/  # copy a whole directory tree (-r = recursive)"},
{"p": "Directories need `-r` (recursive) — without it, cp refuses. A trailing `/` on the "
      "source vs not can matter in some tools; with plain `cp -r src dest`, if `dest` does not "
      "exist it becomes a copy of `src`, and if it exists, `src` lands *inside* it. When unsure, "
      "run `ls` after — verifying beats guessing."},
{"h": "Moving and renaming are the same command",
 "code": "mv draft.txt final.txt        # rename in place\nmv final.txt archive/         # move into a directory\nmv old-name/ new-name/        # rename a directory (no -r needed!)"},
{"p": "`mv` never copies data when staying on the same disk — it just relabels the entry, "
      "which is why moving a 10 GB folder is instant. That also means the old path is *gone* "
      "afterwards."},
{"h": "The safety flags",
 "code": "cp -i src dst   # -i = ask before overwriting\nmv -i src dst   # same for mv\nmv -n src dst   # -n = never overwrite, silently skip"},
{"tip": "Both `cp` and `mv` will happily crush an existing destination file without a word. "
        "Until reflexes form, `-i` is your seatbelt."},
],
"task": [
{"step": "Copy the whole `originals/` directory to a new directory `backup/`:",
 "code": "cp -r originals backup"},
{"step": "Inside `backup/`, rename `contract.txt` to `contract-final.txt`."},
{"step": "Create a directory `backup/assets/` and move `backup/logo.txt` into it."},
{"step": "Confirm `originals/` still has all 3 untouched files — that is the whole point of working on a copy."},
],
"artifacts": [
["backup/contract-final.txt", "same content as the original contract"],
["backup/assets/logo.txt", "moved, not copied (no logo.txt left in backup/ root)"],
["originals/", "completely untouched"],
],
"hints": [
"Rename = `mv backup/contract.txt backup/contract-final.txt`.",
"If you accidentally damaged `originals/`, restore it with `git checkout -- originals` from the repo — git is your time machine in this dojo.",
],
},

# ─────────────────────────────────────────────────────────────── 2.2
{
"id": "2.2", "slug": "02-demolition-crew", "title": "The Demolition Crew",
"tagline": "rm — the command with no undo button.",
"xp": 100, "minutes": 15, "boss": False,
"intro": "There is no recycle bin down here. `rm` unlinks files forever, instantly, silently. "
         "Which is exactly why the dojo makes you practice demolition in a controlled site "
         "before real life makes you practice it in production.",
"learn": [
{"h": "The demolition tools",
 "code": "rm file.txt              # delete a file\nrm a.txt b.txt c.txt     # several\nrm -r directory/         # delete a directory AND everything inside\nrmdir directory/         # delete a directory ONLY if it is empty (safe)\nrm -i file.txt           # ask first"},
{"h": "Why everyone fears rm -rf",
 "p": "`-f` (force) silences errors and prompts; combined with `-r` and a bad path it can "
      "erase a system. The infamous `rm -rf /` needs privileges to hurt, but "
      "`rm -rf ~/ projects` (note the accidental space!) has destroyed real home directories: "
      "it means “delete my whole home, then delete projects”. Spaces and typos are the real "
      "enemy, not the command."},
{"h": "The professional habit",
 "code": "ls site/junk/tmp*.txt     # 1) LOOK at what the pattern matches\nrm site/junk/tmp*.txt     # 2) only then delete the same pattern",
 "label": "Preview with ls, fire with rm"},
{"tip": "In this dojo, everything is committed to git — `git status` shows what you deleted "
        "and `git checkout -- path` resurrects it. Real servers rarely offer that mercy; "
        "practice the ls-then-rm habit anyway."},
],
"task": [
{"step": "Inspect the demolition site first: `ls -R site`."},
{"step": "Delete all the `tmp*.txt` files inside `site/junk/` (the directory itself stays)."},
{"step": "Demolish the entire `site/rubble/` directory with one command."},
{"step": "Do NOT touch `site/keep/gold.txt`. The auditor checks."},
],
"artifacts": [
["site/junk/", "still exists, but no tmp files remain inside"],
["site/rubble/", "gone entirely"],
["site/keep/gold.txt", "intact"],
],
"hints": [
"Preview first: `ls site/junk/tmp*.txt` — then reuse the exact same pattern with rm.",
"A directory with files inside needs `rm -r site/rubble` — rmdir will refuse.",
],
},

# ─────────────────────────────────────────────────────────────── 2.3
{
"id": "2.3", "slug": "03-glob-master", "title": "Glob Master",
"tagline": "Wildcards: make the shell do the boring work.",
"xp": 100, "minutes": 20, "boss": False,
"intro": "Twenty-four files landed in your inbox. You could move them one by one like a "
         "tourist — or describe *patterns* and let the shell expand them. Globbing is the "
         "first time Linux starts feeling like a power tool.",
"learn": [
{"h": "The pattern language",
 "code": "*.jpg          # anything ending in .jpg\nphoto-*        # anything starting with photo-\n?.txt          # ONE single character, then .txt\nnotes-[abc].txt   # notes-a.txt, notes-b.txt or notes-c.txt\nreport-202[1-4].pdf   # character ranges work too"},
{"h": "Who expands the pattern? (this is the key idea)",
 "p": "The **shell** expands globs *before* the command runs. When you type `mv *.jpg images/`, "
      "the program `mv` never sees the `*` — it receives the already-expanded list: "
      "`mv photo-01.jpg photo-02.jpg … images/`. That is why `echo *.jpg` is the perfect "
      "dry-run: it shows you literally what any command would receive."},
{"p": "If a pattern matches nothing, bash passes it through as literal text (`*.xyz` stays "
      "`*.xyz`) — which usually ends in a confusing “file not found”. Another reason to "
      "`echo` first."},
{"h": "Brace expansion — patterns you invent",
 "code": "mkdir sorted/{images,audio,docs,text,other}   # five dirs, one command\ncp file.txt{,.bak}                            # expands to: cp file.txt file.txt.bak"},
{"tip": "Globs match *existing* names; braces generate *any* strings. They combine well, "
        "and both happen before the command ever runs."},
],
"task": [
{"step": "Create the destination tree in one command:",
 "code": "mkdir -p sorted/{images,audio,docs,text,other}"},
{"step": "Using glob patterns (one `mv` per family), sort the inbox:",
 "code": "mv inbox/*.jpg sorted/images/\nmv inbox/*.mp3 sorted/audio/\nmv inbox/*.pdf sorted/docs/\nmv inbox/*.txt sorted/text/"},
{"step": "Everything still left in `inbox/` (scripts, zips) goes to `sorted/other/` — one more mv with `*`."},
{"step": "`ls inbox/` must come back empty. `ls -R sorted` shows your work."},
],
"artifacts": [
["sorted/images/", "6 jpg files"],
["sorted/audio/", "5 mp3 files"],
["sorted/docs/", "4 pdf files"],
["sorted/text/", "5 txt files"],
["sorted/other/", "the remaining 4 files"],
["inbox/", "empty"],
],
"hints": [
"Preview any pattern with `echo inbox/*.jpg` before moving.",
"The final sweep is just `mv inbox/* sorted/other/` — by then only non-matched files remain.",
],
},

# ─────────────────────────────────────────────────────────────── 2.4
{
"id": "2.4", "slug": "04-the-finder", "title": "The Finder",
"tagline": "find — interrogate the whole tree with predicates.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Globs reach one directory at a time. `find` walks the entire tree and answers "
         "questions: *what*, *where*, *how big*, *what type*. It is the bloodhound of Linux — "
         "point it somewhere and describe the scent.",
"learn": [
{"h": "Anatomy of a find command",
 "code": "find WHERE  TESTS...\nfind warehouse -name \"*.conf\"      # by name (quote the pattern!)\nfind warehouse -iname \"*DRAGON*\"   # case-insensitive name\nfind warehouse -type d              # only directories\nfind warehouse -type f -size +50k   # files bigger than 50 KB\nfind warehouse -empty               # empty files/dirs\nfind warehouse -maxdepth 1          # don't descend below one level"},
{"p": "Quoting the pattern (`\"*.conf\"`) matters: unquoted, the *shell* might expand the glob "
      "against the current directory before find ever runs. Quoted, the pattern reaches find "
      "intact, and find applies it at every depth."},
{"h": "Combining tests",
 "code": "find warehouse -type f -name \"*.conf\"        # AND (just list tests)\nfind warehouse -name \"*.log\" -o -name \"*.md\"  # OR\nfind warehouse ! -name \"*.txt\"                # NOT"},
{"h": "Sizes",
 "list": [
   "`-size +50k` — bigger than 50 KB (`M` for MB, `G` for GB)",
   "`-size -10k` — smaller than 10 KB",
   "`+`/`-` mean over/under; no sign means “exactly” (rarely useful)",
 ]},
{"p": "find also matches hidden files without asking — `-name \"*.conf\"` happily returns "
      "`.secret.conf`. The dot is only special to globs and plain ls, not to find."},
{"tip": "Later (brown belt) you will bolt actions onto find with `-exec`. For now, redirecting "
        "its output into a file *is* the action."},
],
"task": [
{"step": "Save every `.conf` file's path (there are hidden ones — find sees them):",
 "code": "find warehouse -name \"*.conf\" > conf-files.txt"},
{"step": "Save every path whose name contains `dragon`, any capitalization:",
 "code": "find warehouse -iname \"*dragon*\" > dragons.txt"},
{"step": "Save every file bigger than 50 KB:",
 "code": "find warehouse -type f -size +50k > big-ones.txt"},
{"step": "Find the one completely empty file in the warehouse (`-type f -empty`) and record it in `answers.md`:",
 "code": "empty_file=NAME_OF_THE_EMPTY_FILE"},
],
"artifacts": [
["conf-files.txt", "4 paths (one is hidden)"],
["dragons.txt", "3 paths"],
["big-ones.txt", "exactly 1 path"],
["answers.md", "empty_file=… (just the file name)"],
],
"hints": [
"`wc -l conf-files.txt` tells you if you caught all 4.",
"`empty_file` wants only the name, like `something.dat` — not the full path.",
],
},

# ─────────────────────────────────────────────────────────────── 2.5
{
"id": "2.5", "slug": "05-boss-great-cleanup", "title": "BOSS — The Great Cleanup",
"tagline": "A real messy drive. Sort it, purge it, report it.",
"xp": 250, "minutes": 35, "boss": True,
"intro": "Someone's `chaos-drive/` has been accumulating digital sediment for years — "
         "vacation photos next to server configs next to `.tmp` crust. Yellow belts don't "
         "flinch at mess; they bring patterns. Sort everything, destroy the junk, file a report.",
"learn": [
{"h": "Boss briefing",
 "p": "Files hide at several depths inside `chaos-drive/`. Globs only reach one level "
      "(`chaos-drive/*/*.jpg` reaches two) — so either repeat patterns per level, or bring "
      "the bloodhound: `find` + `-exec`."},
{"h": "find -exec: a preview of power",
 "code": "find chaos-drive -name \"*.jpg\" -exec mv {} sorted/images/ \\;",
 "label": "For each result, run mv — {} is the found path"},
{"p": "`{}` is replaced by each found file; `\\;` terminates the command. This one-liner moves "
      "every jpg from any depth. Use it, or use per-level globs — the checker only judges the "
      "end state."},
{"h": "Counting what you moved",
 "code": "find organized/images -type f | wc -l   # count files in a tree"},
{"tip": "Do the junk deletion LAST — after the good files are already safe in `organized/`. "
        "Demolition after evacuation. That ordering habit saves careers."},
],
"task": [
{"step": "Create `organized/{documents,images,audio,configs,vault}` in this mission folder."},
{"step": "From anywhere inside `chaos-drive/`, move: `*.pdf` → documents, `*.jpg` AND `*.png` → images, `*.mp3` → audio, `*.conf` → configs."},
{"step": "Move the lost crypto wallet `old-wallet.dat` (somewhere in there) into `organized/vault/`."},
{"step": "Delete every `*.tmp` file and every backup file ending in `~` anywhere inside `chaos-drive/`."},
{"step": "Write `cleanup-report.md` with exactly these lines:",
 "code": "pdf_count=?\njpg_count=?\npng_count=?\nmp3_count=?\nconf_count=?\njunk_deleted=?"},
],
"artifacts": [
["organized/documents|images|audio|configs", "all sorted by type, from every depth"],
["organized/vault/old-wallet.dat", "the wallet, secured"],
["chaos-drive/", "zero .tmp and zero ~ files remain"],
["cleanup-report.md", "six counts, all correct"],
],
"hints": [
"Count before you fill the report: `find organized/images -type f | wc -l`.",
"Junk deletion: `find chaos-drive -name \"*.tmp\" -delete` and `find chaos-drive -name \"*~\" -delete` (or -exec rm {} \\;).",
"junk_deleted = tmp files + ~ files, added together.",
],
},

    ],
}
