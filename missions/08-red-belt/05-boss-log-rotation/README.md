# 🥋 BOSS — The Log Rotation Engine

> _Build the tool that keeps servers from filling their disks._

**Belt 8 · Red Belt** · Mission `8.5` · 🥋 BOSS TRIAL · **250 XP** · ~55 min

---

Unrotated logs are the #1 way servers silently die: `/var/log` fills, writes fail, everything topples. `logrotate` solves this in production — but tonight you build a miniature of it yourself, and understand forever what it does. This is the System Craftsman's masterwork.

## 📖 Learn

#### Boss briefing — what rotation means

Rotation caps a growing log by shifting old copies down a numbered ladder and starting fresh. `app.log` becomes `app.log.1`; the old `app.log.1` becomes `app.log.2` (usually gzipped as `app.log.2.gz`), and so on. Beyond a retention limit, the oldest is deleted. The live log is truncated back to empty so the app keeps writing to the same path.

#### The spec for logkeeper.sh

```bash
./logkeeper.sh <logfile> <keep>
#   <logfile> : path to the active log
#   <keep>    : how many rotated copies to retain
```
_Two required arguments_

- Missing arguments → usage on **stderr**, `exit 2`.
- Shift existing rotations DOWN: `.1`→`.2`, `.2`→`.3`, … (work from highest number downward so you don't clobber).
- Move the current log to `.1`, then **gzip** the rotations except the freshest (`.1` stays plain so it's easy to read; `.2`, `.3`, … are `.gz`). *(Simpler accepted variant: gzip every rotation — the checker accepts either as long as `.1` exists after one rotation.)*
- Recreate the active log as a new **empty** file.
- Delete rotations beyond `<keep>`.
- Print a `rotated <logfile>` line on success, `exit 0`.

#### Shifting safely (highest first!)

```bash
# to avoid overwriting, move the HIGHEST numbers first
i="$keep"
while [ "$i" -ge 1 ]; do
    if [ -f "$log.$i" ]; then mv "$log.$i" "$log.$((i+1))"; fi
    if [ -f "$log.$i.gz" ]; then mv "$log.$i.gz" "$log.$((i+1)).gz"; fi
    i=$((i-1))
done
mv "$log" "$log.1"
: > "$log"          # truncate/recreate empty (the : builtin does nothing, > empties)
```
_Descend the ladder, then rotate in the live log_

#### Trimming to the retention limit

```bash
# delete anything numbered above <keep>
n=$((keep+1))
while [ -f "$log.$n" ] || [ -f "$log.$n.gz" ]; do
    rm -f "$log.$n" "$log.$n.gz"
    n=$((n+1))
done
```
_Prune the tail_

> 💡 **Sensei says:** Test by running it repeatedly against a log you keep re-filling: after each run, `ls -1 <log>*` should show the ladder growing then capping at `<keep>` rotations. Watching the ladder behave is how you know it's right.

## 🎯 Your Mission

1. Write `logkeeper.sh` implementing the full spec. Start from the header `#!/usr/bin/env bash` and `set -euo pipefail`.

2. Handle the argument errors first (missing args → stderr + exit 2).

3. Implement the shift-down, rotate-current, truncate, gzip, and prune logic.

4. Test the whole lifecycle yourself:

   ```bash
   chmod +x logkeeper.sh
   printf 'line1\nline2\n' > app.log
   ./logkeeper.sh app.log 3; echo "rc=$?"    # creates app.log.1, empties app.log
   ls -1 app.log*
   printf 'more\n' > app.log
   ./logkeeper.sh app.log 3                    # now app.log.1 fresh, older shifted
   ls -1 app.log*
   ./logkeeper.sh; echo "rc=$?"               # missing args → rc=2
   ```

5. Run it enough times to confirm it never keeps more than `<keep>` rotations.

## ✅ What the checker looks for

- **`logkeeper.sh`** — executable; usage+exit 2 on missing args; correct rotation lifecycle; caps at <keep>

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Shift from the HIGHEST number down, or you'll overwrite .2 with .1 before saving it.
- `: > "$log"` recreates the active log as empty (the app would keep writing to it).
- After one rotation there must be an `app.log.1` and `app.log` must exist and be empty.
- The checker fills+rotates several times and asserts the count of rotated files never exceeds <keep>.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 8.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `8.4` · [🏠 Dojo map](../../../README.md) · Next: `9.1` ➡️
