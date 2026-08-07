# Cut, Sort, Count

> _Slice columns out of structured text._

**Belt 3 · Orange Belt** · Mission `3.3` · Lesson 3 · **100 XP** · ~25 min

---

Half of ops life is a CSV, a TSV, or a log with columns. `cut` slices the column you care about; `sort` has tricks you haven't met yet (numeric! by-column!); and the frequency idiom turns columns into insight. The fleet inventory awaits.

## 📖 Learn

#### cut: pick a column

```bash
cut -d, -f2 fleet.csv        # -d, = comma delimiter, -f2 = field 2
cut -d: -f1 /etc/passwd      # classic: all usernames on a system
cut -d, -f1,3 fleet.csv      # several fields at once
```
#### Skipping the header line

```bash
tail -n +2 fleet.csv         # everything FROM line 2 (+2 = 'starting at 2')
tail -n +2 fleet.csv | cut -d, -f2   # header-free column
```
_tail -n +N is the idiomatic header-skipper_

#### sort's power flags

```bash
sort -n        # numeric (10 after 9, not after 1!)
sort -r        # reverse
sort -t, -k3   # -t sets delimiter, -k picks the column to sort BY
sort -t, -k3 -nr fleet.csv | head -n 3   # top 3 by column 3, numerically
```
_sort by any column_

Forgetting `-n` is the classic bug: text sort puts `96` before `100` because `9` > `1` as characters. If a ranking ever looks insane, you text-sorted numbers.

> 💡 **Sensei says:** These four — `cut`, `sort`, `uniq -c`, `head` — answer 80% of “quick question about this data” moments faster than opening a spreadsheet.

## 🎯 Your Mission

1. Build a region frequency table (skip the header!) into `regions.txt`:

   ```bash
   tail -n +2 fleet.csv | cut -d, -f2 | sort | uniq -c | sort -nr > regions.txt
   ```

2. Find the machine with the highest CPU (column 3) and write JUST its name into `top-cpu.txt`:

   ```bash
   sort -t, -k3 -nr fleet.csv | head -n 1 | cut -d, -f1 > top-cpu.txt
   ```

3. Record two facts in `answers.md`:

   ```bash
   eu_west_count=NUMBER
   total_machines=NUMBER
   ```

## ✅ What the checker looks for

- **`regions.txt`** — 4 lines, biggest region first
- **`top-cpu.txt`** — one machine name
- **`answers.md`** — eu_west_count and total_machines (header does not count!)

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- regions.txt should have exactly 4 lines — one per region.
- total_machines is data rows only: `tail -n +2 fleet.csv | wc -l`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 3.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `3.2` · [🏠 Dojo map](../../../README.md) · Next: `3.4` ➡️
