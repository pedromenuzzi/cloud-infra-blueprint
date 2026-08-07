# Stream Surgeon

> _tr and sed — transform text in flight._

**Belt 3 · Orange Belt** · Mission `3.4` · Lesson 4 · **100 XP** · ~25 min

---

Reading and filtering is ninja level one. Level two is *transformation*: renaming a project across a document, fixing a word everywhere, uppercasing a shout. Two scalpels today: `tr` for characters, `sed` for patterns.

## 📖 Learn

#### tr — translate characters

```bash
tr a-z A-Z < shout.txt        # lowercase → UPPERCASE
tr -d '0-9' < file            # -d: DELETE all digits
tr -s ' '   < file            # -s: SQUEEZE runs of spaces into one
tr ':' '\n' <<< "$PATH"       # turn PATH into one entry per line
```
Note the `<` — tr reads stdin only; it takes no filename argument. `< file` feeds a file to any command's stdin, the mirror image of `>`.

#### sed — the stream editor

```bash
sed 's/PROJECT-X/Nimbus/' draft.md      # replace FIRST match per line
sed 's/PROJECT-X/Nimbus/g' draft.md     # /g = ALL matches per line
sed 's|/var/log|/tmp|g' file            # any delimiter works — handy for paths
sed -n '27p' logbook.txt                # print only line 27
```
_s/find/replace/flags_

#### Editing in place, portably

```bash
sed -i.bak 's/linux/Linux/g' release.md   # edits the file, keeps release.md.bak
rm release.md.bak                          # inspect, then drop the safety net
```
_-i.bak works on BOTH GNU (Linux) and BSD (macOS) sed_

Plain `sed -i` differs between GNU and macOS sed (macOS requires an argument). `-i.bak` behaves identically everywhere AND leaves a backup — the dojo standard.

> 💡 **Sensei says:** sed does full regex surgery (`^`, `$`, groups with `\1`) — you'll cut deeper at black belt. Today: substitution mastery.

## 🎯 Your Mission

1. Uppercase the shout:

   ```bash
   tr a-z A-Z < shout.txt > LOUD.txt
   ```

2. The secret project has a public name now. Produce `release.md` from draft.md with every `PROJECT-X` replaced by `Nimbus`:

   ```bash
   sed 's/PROJECT-X/Nimbus/g' draft.md > release.md
   ```

3. Marketing bug: lowercase `linux` must be `Linux`. Fix it IN PLACE inside release.md with `sed -i.bak`, then delete the .bak once satisfied.

4. Record in `answers.md` how many times the new name appears:

   ```bash
   nimbus_count=NUMBER
   ```

## ✅ What the checker looks for

- **`LOUD.txt`** — the shout, uppercased
- **`release.md`** — zero PROJECT-X, zero lowercase linux, no leftover .bak
- **`answers.md`** — nimbus_count=…

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Count with grep: `grep -c Nimbus release.md` counts LINES — use `grep -o Nimbus release.md | wc -l` to count occurrences.
- Draft had capitalized 'Linux' in two places already — those were fine and stay untouched by s/linux/Linux/g.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 3.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `3.3` · [🏠 Dojo map](../../../README.md) · Next: `3.5` ➡️
