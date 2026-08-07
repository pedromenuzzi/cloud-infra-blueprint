BELT = {
    "n": 3,
    "slug": "03-orange-belt",
    "name": "Orange Belt",
    "color": "#f59e42",
    "rank": "Text Ninja",
    "motto": "Small tools, one pipe, infinite power.",
    "missions": [

# ─────────────────────────────────────────────────────────────── 3.1
{
"id": "3.1", "slug": "01-the-pipeline", "title": "The Pipeline",
"tagline": "stdin, stdout, and the | that changed computing.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "This is the single most important idea in Unix: every program reads from an input "
         "stream and writes to an output stream, and the `|` glues one program's output to the "
         "next program's input. Master this, and you stop using commands — you start composing them.",
"learn": [
{"h": "The three streams",
 "list": [
   "**stdin** (0) — what a program reads",
   "**stdout** (1) — its normal output (what `>` redirects)",
   "**stderr** (2) — its error channel, kept separate on purpose (`2>` redirects it)",
 ]},
{"h": "The pipe",
 "code": "sort words.txt | uniq | wc -l\n#  └─ sorted lines ─┘   └ count them\n#            └─ duplicates collapsed",
 "label": "Output of one = input of the next"},
{"p": "Each tool does ONE thing: `sort` orders lines, `uniq` collapses *adjacent* duplicates, "
      "`wc -l` counts. None of them knows the others exist. The pipeline is the program — "
      "that's the Unix philosophy in one line."},
{"h": "Why uniq needs sort",
 "p": "`uniq` only removes duplicates that sit next to each other. Unsorted input leaves "
      "duplicates scattered and uncollapsed — the classic beginner surprise. `sort | uniq` "
      "is practically one word. Bonus: `sort -u` does both."},
{"h": "The frequency-table idiom (memorize this one)",
 "code": "sort words.txt | uniq -c | sort -nr | head\n# uniq -c  → prefix each line with its count\n# sort -nr → numeric sort, reversed (biggest first)\n# head     → top 10",
 "label": "Top-N of anything"},
{"tip": "You will use `sort | uniq -c | sort -nr` on IPs, error messages, file extensions, "
        "user agents… It is the swiss-army knife of quick analytics."},
],
"task": [
{"step": "Create `sorted.txt` — the words file, sorted:",
 "code": "sort words.txt > sorted.txt"},
{"step": "Count how many DIFFERENT words exist and save the number into `unique-count.txt`:",
 "code": "sort words.txt | uniq | wc -l > unique-count.txt"},
{"step": "Build the frequency table, look at the top, and write the most frequent word (just the word) into `top-word.txt`:",
 "code": "sort words.txt | uniq -c | sort -nr | head -n 3\necho \"THE_WINNER\" > top-word.txt"},
{"step": "Create `answers.md` with how many times that winner appears:",
 "code": "most_common_count=NUMBER"},
],
"artifacts": [
["sorted.txt", "words.txt in sorted order"],
["unique-count.txt", "one number — distinct word count"],
["top-word.txt", "the single most frequent word"],
["answers.md", "most_common_count=…"],
],
"hints": [
"The frequency table's first line is `COUNT WORD` — both of your answers live right there.",
"23 different words hide in that file. If your unique count disagrees, check you sorted first.",
],
},

# ─────────────────────────────────────────────────────────────── 3.2
{
"id": "3.2", "slug": "02-grep-detective", "title": "Grep Detective",
"tagline": "Find needles in log haystacks.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Someone has been hammering this server's SSH door all afternoon. The evidence is in "
         "`auth.log`. `grep` is the tool every Linux professional reaches for first — today "
         "you make it a reflex.",
"learn": [
{"h": "grep fundamentals",
 "code": "grep \"Failed password\" auth.log     # lines containing the text\ngrep -i \"failed\" auth.log           # case-insensitive\ngrep -c \"Failed password\" auth.log  # just COUNT matching lines\ngrep -n \"root\" auth.log             # show line numbers\ngrep -v \"Accepted\" auth.log         # INVERT: lines NOT matching\ngrep -r \"pattern\" some-dir/         # search a whole directory tree"},
{"h": "A taste of regular expressions",
 "code": "grep -E \"Failed|Accepted\" auth.log   # OR\ngrep \"^Mar\" auth.log                 # ^ anchors to line start\ngrep \"ssh2$\" auth.log                # $ anchors to line end\ngrep -E \"40[0-9]{3}\" auth.log        # digit classes and repetition",
 "label": "-E enables the richer 'extended' syntax"},
{"p": "Always quote your pattern. Unquoted, the shell may mangle spaces, `$`, `*` before grep "
      "sees them. Quoting is not optional style — it is correctness."},
{"h": "Detective workflow",
 "p": "Real log analysis is grep chained with the orange-belt tools you already know: "
      "`grep \"Failed\" auth.log | wc -l` counts, `grep ... | head` samples. Filter first, "
      "then count, then narrow again. Each pipe is one deductive step."},
{"tip": "Beware of decoys: this log contains lines like `Invalid user admin from …` that are "
        "NOT `Failed password` lines. Detectives match precisely."},
],
"task": [
{"step": "Extract every failed login attempt:",
 "code": "grep \"Failed password\" auth.log > failed.txt"},
{"step": "From those, extract the attempts against the `root` account:",
 "code": "grep \"Failed password for root\" auth.log > root-attempts.txt"},
{"step": "Investigate: which IP appears most among failed attempts? (Eyeball it, or sneak-preview next mission: `grep \"Failed password\" auth.log | grep -oE \"[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\" | sort | uniq -c | sort -nr`.)"},
{"step": "File your findings in `answers.md`:",
 "code": "failed_count=NUMBER\nattacker_ip=THE_MOST_FREQUENT_FAILING_IP\naccepted_count=HOW_MANY_SUCCESSFUL_LOGINS"},
],
"artifacts": [
["failed.txt", "all Failed password lines, nothing else"],
["root-attempts.txt", "only the root-targeting subset"],
["answers.md", "failed_count, attacker_ip, accepted_count"],
],
"hints": [
"`grep -c` gives you failed_count and accepted_count without wc.",
"The attacker tried the `admin` account from one IP a suspicious number of times.",
],
},

# ─────────────────────────────────────────────────────────────── 3.3
{
"id": "3.3", "slug": "03-cut-sort-count", "title": "Cut, Sort, Count",
"tagline": "Slice columns out of structured text.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Half of ops life is a CSV, a TSV, or a log with columns. `cut` slices the column "
         "you care about; `sort` has tricks you haven't met yet (numeric! by-column!); and the "
         "frequency idiom turns columns into insight. The fleet inventory awaits.",
"learn": [
{"h": "cut: pick a column",
 "code": "cut -d, -f2 fleet.csv        # -d, = comma delimiter, -f2 = field 2\ncut -d: -f1 /etc/passwd      # classic: all usernames on a system\ncut -d, -f1,3 fleet.csv      # several fields at once"},
{"h": "Skipping the header line",
 "code": "tail -n +2 fleet.csv         # everything FROM line 2 (+2 = 'starting at 2')\ntail -n +2 fleet.csv | cut -d, -f2   # header-free column",
 "label": "tail -n +N is the idiomatic header-skipper"},
{"h": "sort's power flags",
 "code": "sort -n        # numeric (10 after 9, not after 1!)\nsort -r        # reverse\nsort -t, -k3   # -t sets delimiter, -k picks the column to sort BY\nsort -t, -k3 -nr fleet.csv | head -n 3   # top 3 by column 3, numerically",
 "label": "sort by any column"},
{"p": "Forgetting `-n` is the classic bug: text sort puts `96` before `100` because `9` > `1` "
      "as characters. If a ranking ever looks insane, you text-sorted numbers."},
{"tip": "These four — `cut`, `sort`, `uniq -c`, `head` — answer 80% of “quick question about "
        "this data” moments faster than opening a spreadsheet."},
],
"task": [
{"step": "Build a region frequency table (skip the header!) into `regions.txt`:",
 "code": "tail -n +2 fleet.csv | cut -d, -f2 | sort | uniq -c | sort -nr > regions.txt"},
{"step": "Find the machine with the highest CPU (column 3) and write JUST its name into `top-cpu.txt`:",
 "code": "sort -t, -k3 -nr fleet.csv | head -n 1 | cut -d, -f1 > top-cpu.txt"},
{"step": "Record two facts in `answers.md`:",
 "code": "eu_west_count=NUMBER\ntotal_machines=NUMBER"},
],
"artifacts": [
["regions.txt", "4 lines, biggest region first"],
["top-cpu.txt", "one machine name"],
["answers.md", "eu_west_count and total_machines (header does not count!)"],
],
"hints": [
"regions.txt should have exactly 4 lines — one per region.",
"total_machines is data rows only: `tail -n +2 fleet.csv | wc -l`.",
],
},

# ─────────────────────────────────────────────────────────────── 3.4
{
"id": "3.4", "slug": "04-stream-surgeon", "title": "Stream Surgeon",
"tagline": "tr and sed — transform text in flight.",
"xp": 100, "minutes": 25, "boss": False,
"intro": "Reading and filtering is ninja level one. Level two is *transformation*: renaming a "
         "project across a document, fixing a word everywhere, uppercasing a shout. Two "
         "scalpels today: `tr` for characters, `sed` for patterns.",
"learn": [
{"h": "tr — translate characters",
 "code": "tr a-z A-Z < shout.txt        # lowercase → UPPERCASE\ntr -d '0-9' < file            # -d: DELETE all digits\ntr -s ' '   < file            # -s: SQUEEZE runs of spaces into one\ntr ':' '\\n' <<< \"$PATH\"       # turn PATH into one entry per line"},
{"p": "Note the `<` — tr reads stdin only; it takes no filename argument. `< file` feeds a "
      "file to any command's stdin, the mirror image of `>`."},
{"h": "sed — the stream editor",
 "code": "sed 's/PROJECT-X/Nimbus/' draft.md      # replace FIRST match per line\nsed 's/PROJECT-X/Nimbus/g' draft.md     # /g = ALL matches per line\nsed 's|/var/log|/tmp|g' file            # any delimiter works — handy for paths\nsed -n '27p' logbook.txt                # print only line 27",
 "label": "s/find/replace/flags"},
{"h": "Editing in place, portably",
 "code": "sed -i.bak 's/linux/Linux/g' release.md   # edits the file, keeps release.md.bak\nrm release.md.bak                          # inspect, then drop the safety net",
 "label": "-i.bak works on BOTH GNU (Linux) and BSD (macOS) sed"},
{"p": "Plain `sed -i` differs between GNU and macOS sed (macOS requires an argument). "
      "`-i.bak` behaves identically everywhere AND leaves a backup — the dojo standard."},
{"tip": "sed does full regex surgery (`^`, `$`, groups with `\\1`) — you'll cut deeper at "
        "black belt. Today: substitution mastery."},
],
"task": [
{"step": "Uppercase the shout:",
 "code": "tr a-z A-Z < shout.txt > LOUD.txt"},
{"step": "The secret project has a public name now. Produce `release.md` from draft.md with every `PROJECT-X` replaced by `Nimbus`:",
 "code": "sed 's/PROJECT-X/Nimbus/g' draft.md > release.md"},
{"step": "Marketing bug: lowercase `linux` must be `Linux`. Fix it IN PLACE inside release.md with `sed -i.bak`, then delete the .bak once satisfied."},
{"step": "Record in `answers.md` how many times the new name appears:",
 "code": "nimbus_count=NUMBER"},
],
"artifacts": [
["LOUD.txt", "the shout, uppercased"],
["release.md", "zero PROJECT-X, zero lowercase linux, no leftover .bak"],
["answers.md", "nimbus_count=…"],
],
"hints": [
"Count with grep: `grep -c Nimbus release.md` counts LINES — use `grep -o Nimbus release.md | wc -l` to count occurrences.",
"Draft had capitalized 'Linux' in two places already — those were fine and stay untouched by s/linux/Linux/g.",
],
},

# ─────────────────────────────────────────────────────────────── 3.5
{
"id": "3.5", "slug": "05-boss-log-forensics", "title": "BOSS — Log Forensics",
"tagline": "300 requests. One suspect. Full pipeline forensics.",
"xp": 250, "minutes": 40, "boss": True,
"intro": "A web server left you `access.log`: 300 requests of mixed traffic, and somewhere in "
         "there, someone probing for weaknesses. This is the orange-belt graduation: every tool "
         "from this belt, chained into real forensic conclusions.",
"learn": [
{"h": "Boss briefing — the log format",
 "code": "IP - - [timestamp] \"METHOD /path HTTP/1.1\" STATUS BYTES\n#^field 1                                  ^field 9 (space-delimited)",
 "label": "Apache-style access log"},
{"p": "With space as delimiter: field 1 is the client IP, field 9 the status code. "
      "`cut -d' ' -f1` and the frequency idiom will carry you far. A `404` status means "
      "*not found* — a burst of 404s on juicy paths (`/admin`, `/.env`) is scanner behavior."},
{"h": "Useful moves",
 "code": "cut -d' ' -f1 access.log | sort | uniq -c | sort -nr | head -n 5   # top talkers\ngrep ' 404 ' access.log                                            # all 404s (spaces matter!)\ncut -d' ' -f1 access.log | sort -u | wc -l                         # unique IPs",
 "label": "Your forensic toolkit"},
{"tip": "Why ` 404 ` with spaces? Because `404` could appear inside a path or byte count. "
        "Anchoring with the surrounding spaces targets the status field. Precision is the "
        "difference between evidence and noise."},
],
"task": [
{"step": "Create a `report/` directory for your findings."},
{"step": "Top 5 IPs by request count → `report/top-5-ips.txt` (frequency-table idiom, head -n 5)."},
{"step": "Every 404 line → `report/status-404.txt`."},
{"step": "Write `report/findings.md`:",
 "code": "total_requests=?\nunique_ips=?\nerrors_404=?\nsuspect_ip=?\nverdict=ONE_SENTENCE_ABOUT_WHAT_THE_SUSPECT_WAS_DOING"},
],
"artifacts": [
["report/top-5-ips.txt", "5 lines, counts + IPs, biggest first"],
["report/status-404.txt", "every 404 request line"],
["report/findings.md", "all five keys, correct values"],
],
"hints": [
"suspect_ip = the top talker — and look WHAT it requested: `grep 'THAT_IP' access.log | head -20`.",
"unique_ips: `cut -d' ' -f1 access.log | sort -u | wc -l`.",
"verdict is free text — say what you concluded (scanning? brute force?). Any non-empty sentence passes.",
],
},

    ],
}
