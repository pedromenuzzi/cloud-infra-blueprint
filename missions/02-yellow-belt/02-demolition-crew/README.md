# The Demolition Crew

> _rm — the command with no undo button._

**Belt 2 · Yellow Belt** · Mission `2.2` · Lesson 2 · **100 XP** · ~15 min

---

There is no recycle bin down here. `rm` unlinks files forever, instantly, silently. Which is exactly why the dojo makes you practice demolition in a controlled site before real life makes you practice it in production.

## 📖 Learn

#### The demolition tools

```bash
rm file.txt              # delete a file
rm a.txt b.txt c.txt     # several
rm -r directory/         # delete a directory AND everything inside
rmdir directory/         # delete a directory ONLY if it is empty (safe)
rm -i file.txt           # ask first
```
#### Why everyone fears rm -rf

`-f` (force) silences errors and prompts; combined with `-r` and a bad path it can erase a system. The infamous `rm -rf /` needs privileges to hurt, but `rm -rf ~/ projects` (note the accidental space!) has destroyed real home directories: it means “delete my whole home, then delete projects”. Spaces and typos are the real enemy, not the command.

#### The professional habit

```bash
ls site/junk/tmp*.txt     # 1) LOOK at what the pattern matches
rm site/junk/tmp*.txt     # 2) only then delete the same pattern
```
_Preview with ls, fire with rm_

> 💡 **Sensei says:** In this dojo, everything is committed to git — `git status` shows what you deleted and `git checkout -- path` resurrects it. Real servers rarely offer that mercy; practice the ls-then-rm habit anyway.

## 🎯 Your Mission

1. Inspect the demolition site first: `ls -R site`.

2. Delete all the `tmp*.txt` files inside `site/junk/` (the directory itself stays).

3. Demolish the entire `site/rubble/` directory with one command.

4. Do NOT touch `site/keep/gold.txt`. The auditor checks.

## ✅ What the checker looks for

- **`site/junk/`** — still exists, but no tmp files remain inside
- **`site/rubble/`** — gone entirely
- **`site/keep/gold.txt`** — intact

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Preview first: `ls site/junk/tmp*.txt` — then reuse the exact same pattern with rm.
- A directory with files inside needs `rm -r site/rubble` — rmdir will refuse.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 2.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `2.1` · [🏠 Dojo map](../../../README.md) · Next: `2.3` ➡️
