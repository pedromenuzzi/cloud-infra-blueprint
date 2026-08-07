# The Nine Bits

> _Read any permission string on sight._

**Belt 4 · Green Belt** · Mission `4.1` · Lesson 1 · **100 XP** · ~25 min

---

`-rwxr-xr--`. To a beginner it's line noise. To a Gatekeeper it's a sentence: who owns this, who's in its group, and exactly what each may do. Today you learn to read that sentence instantly — no new commands, just literacy.

## 📖 Learn

#### The ten-character string

```bash
-rwxr-xr--
│└┬┘└┬┘└┬┘
│ │  │  └ OTHER  (everyone else)
│ │  └──── GROUP
│ └─────── USER  (the owner)
└───────── type: - file   d directory   l symlink
```
_1 type bit + 3 groups of 3_

#### Each triad: r, w, x

- **r** (read) = 4 — view file contents / list a directory
- **w** (write) = 2 — modify a file / create+delete entries in a directory
- **x** (execute) = 1 — run a file as a program / *enter* (cd into) a directory
- a `-` means that permission is absent

#### The octal shorthand

Add the values per triad. `rwx` = 4+2+1 = **7**. `rw-` = 4+2 = **6**. `r-x` = 4+1 = **5**. `r--` = **4**. So `-rwxr-xr--` = **754**. Three digits describe all nine bits. Memorize the common ones: 644 (rw-r--r--, normal file), 755 (rwxr-xr-x, program/dir), 600 (rw-------, private), 640 (rw-r-----, group-readable secret), 700 (private dir).

#### x on directories is special

On a directory, `x` doesn't mean 'run' — it means 'traverse': you can `cd` in and access known paths, but without `r` you can't *list* it. A `755` directory is the norm: everyone can enter and list; only the owner can add or remove files.

#### The special bits you'll spot

- `s` in the user slot (e.g. `-rwsr-xr-x`) — **setuid**: run as the file's owner (how `passwd` edits root-owned files)
- `t` at the end of a directory (e.g. `drwxrwxrwt`) — **sticky bit**: in a shared-writable dir, only owners can delete their own files (that's `/tmp`)

> 💡 **Sensei says:** `ls -l` prints these strings all day. Reading them fluently is a daily-use skill, not trivia.

## 🎯 Your Mission

1. Study `listing.txt` — a captured `ls -l` output. Decode each line by hand.

2. Answer these in `answers.md` (exact keys):

   ```bash
   mode_of_secret=OCTAL_OF_secret.env         # e.g. 640
   owner_of_app=USER_WHO_OWNS_THE_app_FILE
   world_writable=NAME_OF_THE_FILE_ANYONE_CAN_WRITE
   sticky_dir=THE_DIRECTORY_WITH_THE_STICKY_BIT   # answer with its name
   symbolic_770=THE_rwx_STRING_FOR_OCTAL_770
   ```

3. For `symbolic_770`: convert 770 back to the nine-character rwx form (no leading type char).

## ✅ What the checker looks for

- **`answers.md`** — all five keys correct

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- secret.env shows `-rw-r-----` → user rw (6), group r (4), other none (0) → 640.
- The sticky bit is the `t` at the very end of one directory's mode string.
- 770 = rwx (7) rwx (7) --- (0) = `rwxrwx---`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 4.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `3.5` · [🏠 Dojo map](../../../README.md) · Next: `4.2` ➡️
