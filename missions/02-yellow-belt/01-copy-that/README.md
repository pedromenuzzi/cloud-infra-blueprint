# Copy That

> _cp and mv — duplicate, rename, relocate._

**Belt 2 · Yellow Belt** · Mission `2.1` · Lesson 1 · **100 XP** · ~15 min

---

A wrangler never edits originals. Today you learn the two commands that move matter around the filesystem — and the difference between them: `cp` makes more, `mv` makes elsewhere.

## 📖 Learn

#### Copying

```bash
cp source.txt copy.txt          # copy a file
cp source.txt some-dir/         # copy INTO a directory (same name)
cp -r project/ project-backup/  # copy a whole directory tree (-r = recursive)
```
Directories need `-r` (recursive) — without it, cp refuses. A trailing `/` on the source vs not can matter in some tools; with plain `cp -r src dest`, if `dest` does not exist it becomes a copy of `src`, and if it exists, `src` lands *inside* it. When unsure, run `ls` after — verifying beats guessing.

#### Moving and renaming are the same command

```bash
mv draft.txt final.txt        # rename in place
mv final.txt archive/         # move into a directory
mv old-name/ new-name/        # rename a directory (no -r needed!)
```
`mv` never copies data when staying on the same disk — it just relabels the entry, which is why moving a 10 GB folder is instant. That also means the old path is *gone* afterwards.

#### The safety flags

```bash
cp -i src dst   # -i = ask before overwriting
mv -i src dst   # same for mv
mv -n src dst   # -n = never overwrite, silently skip
```
> 💡 **Sensei says:** Both `cp` and `mv` will happily crush an existing destination file without a word. Until reflexes form, `-i` is your seatbelt.

## 🎯 Your Mission

1. Copy the whole `originals/` directory to a new directory `backup/`:

   ```bash
   cp -r originals backup
   ```

2. Inside `backup/`, rename `contract.txt` to `contract-final.txt`.

3. Create a directory `backup/assets/` and move `backup/logo.txt` into it.

4. Confirm `originals/` still has all 3 untouched files — that is the whole point of working on a copy.

## ✅ What the checker looks for

- **`backup/contract-final.txt`** — same content as the original contract
- **`backup/assets/logo.txt`** — moved, not copied (no logo.txt left in backup/ root)
- **`originals/`** — completely untouched

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Rename = `mv backup/contract.txt backup/contract-final.txt`.
- If you accidentally damaged `originals/`, restore it with `git checkout -- originals` from the repo — git is your time machine in this dojo.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 2.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `1.5` · [🏠 Dojo map](../../../README.md) · Next: `2.2` ➡️
