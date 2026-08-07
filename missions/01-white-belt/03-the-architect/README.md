# The Architect

> _Create structure out of nothing: mkdir and touch._

**Belt 1 · White Belt** · Mission `1.3` · Lesson 3 · **100 XP** · ~15 min

---

Reading the tree is half the skill. Now you will grow branches yourself. An architect who needs seven commands for a five-room house is still a student; today you learn `-p` and brace expansion, the tools of lazy masters.

## 📖 Learn

#### Creating directories

```bash
mkdir workshop                 # one directory
mkdir -p a/b/c                 # create the WHOLE path, parents included
mkdir -p proj/{src,docs,test}  # brace expansion: three dirs in one shot
```
Without `-p`, `mkdir a/b/c` fails if `a/b` does not exist. With `-p` it builds every missing level and never complains if something already exists. The braces `{src,docs}` are expanded by the *shell* before mkdir even runs — `echo proj/{src,docs}` shows you exactly what mkdir would receive. That trick works with every command, not just mkdir.

#### Creating empty files

```bash
touch notes.txt                # create if missing (or update its timestamp)
touch a.txt b.txt c.txt        # several at once
```
`touch` exists to update file timestamps, but everyone uses it to create empty files. An empty file is often meaningful: lock files, `.gitkeep` markers, placeholders.

#### A 60-second tour of the real tree

- `/etc` — system configuration (text files, mostly)
- `/home` — user home directories (`/home/tux`)
- `/var` — data that varies: logs (`/var/log`), queues, caches
- `/usr` — installed software and libraries
- `/tmp` — scratch space, wiped on reboot
- `/bin`, `/usr/bin` — the programs you have been running

> 💡 **Sensei says:** This layout is called the FHS (Filesystem Hierarchy Standard). When a config file goes missing, an expert *guesses* the right directory before searching. You will too.

## 🎯 Your Mission

1. In this mission folder, build exactly this structure:

   ```bash
   base-camp/
   ├── bin/
   ├── logs/
   │   └── archive/
   └── notes/
       ├── ideas.txt
       └── todo.txt
   ```

2. Inside `logs/archive/`, create a hidden marker file named `.keep` (empty).

   ```bash
   touch base-camp/logs/archive/.keep
   ```

3. Challenge (honor system): build all the directories with ONE `mkdir -p` command using braces, and both txt files with ONE `touch`.

4. Verify your work with `ls -laR base-camp`.

## ✅ What the checker looks for

- **`base-camp/bin/, logs/archive/, notes/`** — all directories exist
- **`base-camp/notes/ideas.txt + todo.txt`** — both files exist
- **`base-camp/logs/archive/.keep`** — hidden empty file exists

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- One-liner for the dirs: `mkdir -p base-camp/{bin,logs/archive,notes}`.
- One-liner for the files: `touch base-camp/notes/{ideas,todo}.txt`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 1.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `1.2` · [🏠 Dojo map](../../../README.md) · Next: `1.4` ➡️
