# 🥋 BOSS — The Great Cleanup

> _A real messy drive. Sort it, purge it, report it._

**Belt 2 · Yellow Belt** · Mission `2.5` · 🥋 BOSS TRIAL · **250 XP** · ~35 min

---

Someone's `chaos-drive/` has been accumulating digital sediment for years — vacation photos next to server configs next to `.tmp` crust. Yellow belts don't flinch at mess; they bring patterns. Sort everything, destroy the junk, file a report.

## 📖 Learn

#### Boss briefing

Files hide at several depths inside `chaos-drive/`. Globs only reach one level (`chaos-drive/*/*.jpg` reaches two) — so either repeat patterns per level, or bring the bloodhound: `find` + `-exec`.

#### find -exec: a preview of power

```bash
find chaos-drive -name "*.jpg" -exec mv {} sorted/images/ \;
```
_For each result, run mv — {} is the found path_

`{}` is replaced by each found file; `\;` terminates the command. This one-liner moves every jpg from any depth. Use it, or use per-level globs — the checker only judges the end state.

#### Counting what you moved

```bash
find organized/images -type f | wc -l   # count files in a tree
```
> 💡 **Sensei says:** Do the junk deletion LAST — after the good files are already safe in `organized/`. Demolition after evacuation. That ordering habit saves careers.

## 🎯 Your Mission

1. Create `organized/{documents,images,audio,configs,vault}` in this mission folder.

2. From anywhere inside `chaos-drive/`, move: `*.pdf` → documents, `*.jpg` AND `*.png` → images, `*.mp3` → audio, `*.conf` → configs.

3. Move the lost crypto wallet `old-wallet.dat` (somewhere in there) into `organized/vault/`.

4. Delete every `*.tmp` file and every backup file ending in `~` anywhere inside `chaos-drive/`.

5. Write `cleanup-report.md` with exactly these lines:

   ```bash
   pdf_count=?
   jpg_count=?
   png_count=?
   mp3_count=?
   conf_count=?
   junk_deleted=?
   ```

## ✅ What the checker looks for

- **`organized/documents|images|audio|configs`** — all sorted by type, from every depth
- **`organized/vault/old-wallet.dat`** — the wallet, secured
- **`chaos-drive/`** — zero .tmp and zero ~ files remain
- **`cleanup-report.md`** — six counts, all correct

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Count before you fill the report: `find organized/images -type f | wc -l`.
- Junk deletion: `find chaos-drive -name "*.tmp" -delete` and `find chaos-drive -name "*~" -delete` (or -exec rm {} \;).
- junk_deleted = tmp files + ~ files, added together.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 2.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `2.4` · [🏠 Dojo map](../../../README.md) · Next: `3.1` ➡️
