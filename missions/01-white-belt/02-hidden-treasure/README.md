# The Hidden Treasure

> _Navigate the filesystem. Find what hides from plain sight._

**Belt 1 · White Belt** · Mission `1.2` · Lesson 2 · **100 XP** · ~20 min

---

A maze of directories awaits inside this folder. Somewhere deep within lies a treasure — but it hides the way many important Linux files hide: behind a name that starts with a dot.

## 📖 Learn

#### The filesystem is a tree

Linux organizes everything under a single root, `/`. Directories contain files and more directories. Your position in the tree is your *working directory* (`pwd` shows it). Paths starting with `/` are **absolute**; anything else is **relative** to where you stand.

#### Moving around

```bash
cd maze            # go down into 'maze' (relative)
cd corridor-a      # deeper
cd ..              # up one level
cd ../..           # up two levels
cd -               # jump back to wherever you were before
cd                 # no argument: go to your home directory
```
#### Looking around

```bash
ls          # list the current directory
ls -l       # long format: permissions, owner, size, date
ls -a       # ALL entries — including hidden dotfiles
ls -la      # both at once
ls -R       # recurse into subdirectories
```
_The flags you will use forever_

Files and directories whose names start with `.` are *hidden*: plain `ls` skips them. That is convention, not security — `.bashrc`, `.ssh`, `.gitignore` all live like this. `ls -a` reveals them (note the `.` and `..` entries: the directory itself and its parent).

> 💡 **Sensei says:** Tab completion works on directory names too. Type `cd cor` then Tab. If it beeps, press Tab twice to see the options.

## 🎯 Your Mission

1. Explore `maze/` using `cd` and `ls -a`. Read the notes you find — the flavor is free, the practice is the point.

2. Somewhere in the maze is a hidden file called `.treasure`. Find it.

3. From this mission folder, copy the treasure's *content* into a file named `found.txt`:

   ```bash
   cat maze/path/to/the/.treasure > found.txt   # fix the path to the real one
   ```

4. Create `answers.md` here with exactly these two lines (fill in the real values):

   ```bash
   treasure_dir=NAME_OF_DIRECTORY_CONTAINING_TREASURE
   reveal_flag=THE_LS_FLAG_THAT_SHOWS_HIDDEN_FILES
   ```

## ✅ What the checker looks for

- **`found.txt`** — the exact content of the hidden .treasure file
- **`answers.md`** — treasure_dir=… and reveal_flag=… filled in correctly

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `ls -aR maze` sweeps the whole maze in one shot — corridors, shelves, everything.
- `treasure_dir` wants just the directory's name (like `cellar`), not the whole path.
- You can create answers.md with echo: `echo "treasure_dir=..." > answers.md` then `echo "reveal_flag=..." >> answers.md`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 1.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `1.1` · [🏠 Dojo map](../../../README.md) · Next: `1.3` ➡️
