# 🥋 BOSS — The Final Black Belt Trial

> _One gauntlet. Every skill. Earn the black belt._

**Belt 9 · Black Belt** · Mission `9.5` · 🥋 BOSS TRIAL · **400 XP** · ~75 min

---

This is it, Sensei-to-be. A single sprawling `gauntlet/` that demands everything: navigation, globs and find, pipelines and forensics, permissions, a broken symlink to repair, and a script to tie it all together. No new concepts — only mastery. Finish this, and the black belt is yours. The dojo has no more to teach; from here you teach yourself.

## 📖 Learn

#### The gauntlet, mapped

- `gauntlet/messy-data/` — 30 files of mixed types scattered across subdirectories. Sort them by type into `gauntlet/sorted/{text,images,docs,audio,configs}/`.
- `gauntlet/logs/access.log` — 500 requests to analyze with your forensic pipeline.
- `gauntlet/secrets/` — three credential files that must all be locked to `600`.
- `gauntlet/current` — a **broken symlink** pointing at a release that doesn't exist. Repair it to point at the real `releases/v1`.
- A final report and a report-generating script to write.

#### Symlinks — creating and repairing

```bash
ls -l gauntlet/current                 # a dangling link shows its (missing) target
rm gauntlet/current                    # remove the broken link
ln -s releases/v1 gauntlet/current     # point it at the real release
readlink gauntlet/current              # confirm the new target
```
_ln -s TARGET LINKNAME  (target is relative to the link's location)_

A **symbolic link** is a pointer to another path. If the target vanishes, the link *dangles* — it still exists but points at nothing (`ls` shows it, following it fails). You fix it by removing the link and recreating it toward a real target. The `current → releases/vN` symlink is exactly how zero-downtime deploys flip between versions.

#### The forensic pipeline, one more time

```bash
cut -d' ' -f1 gauntlet/logs/access.log | sort | uniq -c | sort -nr | head   # top IPs
grep -c ' 500 ' gauntlet/logs/access.log                                      # server errors
cut -d' ' -f1 gauntlet/logs/access.log | sort -u | wc -l                       # unique IPs
```
_Everything from orange belt, on a bigger haystack_

#### Counting sorted results

```bash
find gauntlet/sorted -type f | wc -l           # total files sorted
find gauntlet/sorted/images -type f | wc -l    # per-category
```
_Prove your sort with counts_

> 💡 **Sensei says:** Break the trial into the five areas and finish one completely before the next. A black belt's real skill isn't any single command — it's decomposing a big, messy problem into ordered, verifiable steps. Show that here.

## 🎯 Your Mission

1. SORT: move all 30 files from `gauntlet/messy-data/` (any depth) into `gauntlet/sorted/{text,images,docs,audio,configs}/` by extension — `.txt`→text, `.jpg`→images, `.pdf`→docs, `.mp3`→audio, `.conf`→configs. (Hint: `find … -name '*.jpg' -exec mv {} gauntlet/sorted/images/ \;` per type.)

2. SECURE: set every file in `gauntlet/secrets/` to mode `600`.

3. REPAIR: fix the dangling `gauntlet/current` symlink so it points at `releases/v1` (which exists).

4. ANALYZE + REPORT: study `gauntlet/logs/access.log` and write `gauntlet/TRIAL.md` with exactly these keys:

   ```bash
   total_requests=NUMBER_OF_LOG_LINES
   unique_ips=HOW_MANY_DISTINCT_IPS
   top_ip=THE_MOST_ACTIVE_IP
   top_ip_hits=HOW_MANY_REQUESTS_FROM_THE_TOP_IP
   server_errors=HOW_MANY_500_RESPONSES
   not_found=HOW_MANY_404_RESPONSES
   i_am=tux-sensei
   ```

5. AUTOMATE: write `gauntlet/gauntlet-report.sh` (executable, `set -euo pipefail`) that prints three lines — `files_sorted=<count in sorted/>`, `errors_found=<500 count from the log>`, and `status=all-clear`.

## ✅ What the checker looks for

- **`gauntlet/sorted/*`** — all 30 files sorted by type into the five category dirs
- **`gauntlet/secrets/*`** — every secret file mode 600
- **`gauntlet/current`** — symlink now resolves to releases/v1 (no longer dangling)
- **`gauntlet/TRIAL.md`** — seven keys incl. i_am=tux-sensei; log answers correct
- **`gauntlet/gauntlet-report.sh`** — executable; prints files_sorted=30, errors_found=<500s>, status=all-clear

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Per-type moves from any depth: `find gauntlet/messy-data -name '*.txt' -exec mv {} gauntlet/sorted/text/ \;` (repeat for each extension).
- total_requests = `wc -l < gauntlet/logs/access.log`; unique_ips = `cut -d' ' -f1 ... | sort -u | wc -l`.
- top_ip and top_ip_hits: the first line of `cut -d' ' -f1 ... | sort | uniq -c | sort -nr | head -1`.
- server_errors = count of ' 500 ' lines; not_found = count of ' 404 ' lines.
- i_am must be exactly `tux-sensei`. files_sorted should be 30 after you finish the sort.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 9.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `9.4` · [🏠 Dojo map](../../../README.md) · Next: `10.1` ➡️
