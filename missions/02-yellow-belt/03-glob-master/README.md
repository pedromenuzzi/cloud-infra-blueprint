# Glob Master

> _Wildcards: make the shell do the boring work._

**Belt 2 · Yellow Belt** · Mission `2.3` · Lesson 3 · **100 XP** · ~20 min

---

Twenty-four files landed in your inbox. You could move them one by one like a tourist — or describe *patterns* and let the shell expand them. Globbing is the first time Linux starts feeling like a power tool.

## 📖 Learn

#### The pattern language

```bash
*.jpg          # anything ending in .jpg
photo-*        # anything starting with photo-
?.txt          # ONE single character, then .txt
notes-[abc].txt   # notes-a.txt, notes-b.txt or notes-c.txt
report-202[1-4].pdf   # character ranges work too
```
#### Who expands the pattern? (this is the key idea)

The **shell** expands globs *before* the command runs. When you type `mv *.jpg images/`, the program `mv` never sees the `*` — it receives the already-expanded list: `mv photo-01.jpg photo-02.jpg … images/`. That is why `echo *.jpg` is the perfect dry-run: it shows you literally what any command would receive.

If a pattern matches nothing, bash passes it through as literal text (`*.xyz` stays `*.xyz`) — which usually ends in a confusing “file not found”. Another reason to `echo` first.

#### Brace expansion — patterns you invent

```bash
mkdir sorted/{images,audio,docs,text,other}   # five dirs, one command
cp file.txt{,.bak}                            # expands to: cp file.txt file.txt.bak
```
> 💡 **Sensei says:** Globs match *existing* names; braces generate *any* strings. They combine well, and both happen before the command ever runs.

## 🎯 Your Mission

1. Create the destination tree in one command:

   ```bash
   mkdir -p sorted/{images,audio,docs,text,other}
   ```

2. Using glob patterns (one `mv` per family), sort the inbox:

   ```bash
   mv inbox/*.jpg sorted/images/
   mv inbox/*.mp3 sorted/audio/
   mv inbox/*.pdf sorted/docs/
   mv inbox/*.txt sorted/text/
   ```

3. Everything still left in `inbox/` (scripts, zips) goes to `sorted/other/` — one more mv with `*`.

4. `ls inbox/` must come back empty. `ls -R sorted` shows your work.

## ✅ What the checker looks for

- **`sorted/images/`** — 6 jpg files
- **`sorted/audio/`** — 5 mp3 files
- **`sorted/docs/`** — 4 pdf files
- **`sorted/text/`** — 5 txt files
- **`sorted/other/`** — the remaining 4 files
- **`inbox/`** — empty

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Preview any pattern with `echo inbox/*.jpg` before moving.
- The final sweep is just `mv inbox/* sorted/other/` — by then only non-matched files remain.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 2.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `2.2` · [🏠 Dojo map](../../../README.md) · Next: `2.4` ➡️
