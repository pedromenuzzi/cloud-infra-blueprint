# Vital Signs

> _df, du, free, uptime — read the machine's health._

**Belt 5 · Blue Belt** · Mission `5.4` · Lesson 4 · **100 XP** · ~25 min

---

'The server is slow.' A Process Tamer doesn't guess — they check vital signs. Disk full? Memory exhausted? Load through the roof? Four commands turn vague panic into a diagnosis.

## 📖 Learn

#### Disk: df and du

```bash
df -h              # disk FREE per filesystem, human-readable
df -h /            # just the root filesystem
du -sh .           # total SIZE of the current directory (summary)
du -sh * | sort -h # size of each item, smallest→largest (sort -h!)
du -h --max-depth=1 /var   # where's the space going under /var
```
_df = whole disks; du = specific paths_

The classic 'disk full' hunt: `df -h` shows *which* filesystem is at 100%, then `du -sh * | sort -h` inside it walks you toward the culprit directory. `-h` on sort is the human-numeric sort that understands `K`, `M`, `G`.

#### Memory: free

```bash
free -h
#   total  used  free  shared  buff/cache  available
#                                         └ the number that matters
```
_Look at 'available', not 'free'_

Linux deliberately uses 'free' RAM as disk cache — so a low `free` number is *healthy*, not alarming. The honest 'how much can a new program get' figure is **available**, which counts reclaimable cache. Beginners panic at `free`; pros read `available`.

#### Load: uptime

```bash
uptime
#  ... load average: 0.52, 0.48, 0.44
#                    1min  5min  15min
```
_Three numbers = three time windows_

Load average is the number of processes wanting the CPU. The rough rule: compare to your core count. On a 4-core box, ~4.0 means fully busy; well above your core count means tasks are queuing (overloaded). The three numbers show the trend — rising or cooling off.

> 💡 **Sensei says:** First three commands in almost every 'server feels wrong' investigation: `df -h`, `free -h`, `uptime`. Thirty seconds to rule out the big three.

## 🎯 Your Mission

1. Capture disk usage. Save the df line for your root filesystem into `disk.txt`:

   ```bash
   df -h | grep -i filesystem > disk.txt   # header line (portable across systems)
   df -h / | tail -n 1 >> disk.txt          # the root filesystem row
   ```

2. Save the total size of THIS mission directory into `usage.txt`:

   ```bash
   du -sh . > usage.txt
   ```

3. A captured `sample/free.txt` and `sample/uptime.txt` are provided so answers are identical for everyone. Read them and fill `answers.md`:

   ```bash
   mem_available=THE_available_VALUE_FROM_sample/free.txt   # e.g. 9.2Gi
   load_1min=THE_1_MINUTE_LOAD_FROM_sample/uptime.txt      # e.g. 3.05
   overloaded=IS_1MIN_LOAD_ABOVE_4_CORES?_yes_or_no
   ```

## ✅ What the checker looks for

- **`disk.txt`** — a filesystem header + your root fs line
- **`usage.txt`** — one line — this directory's total size
- **`answers.md`** — mem_available, load_1min, overloaded

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- mem_available is the last number on the `Mem:` row of sample/free.txt.
- The 1-minute load is the FIRST of the three load-average numbers in sample/uptime.txt.
- The sample shows a 4-core box with load 5.10 — that's above 4, so overloaded=yes.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 5.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `5.3` · [🏠 Dojo map](../../../README.md) · Next: `5.5` ➡️
