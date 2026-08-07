# See the Machine

> _ps and top — make the invisible running system visible._

**Belt 5 · Blue Belt** · Mission `5.1` · Lesson 1 · **100 XP** · ~25 min

---

Right now, dozens of processes are alive on your machine — shells, services, the very terminal you're reading this in. A Process Tamer's first skill is *sight*: listing what runs, who owns it, and what it's costing.

## 📖 Learn

#### ps — a snapshot of processes

```bash
ps               # just YOUR processes in this terminal
ps aux           # EVERY process, detailed (the classic incantation)
ps -ef           # every process, different columns (PPID = parent!)
ps aux | grep nginx    # filter for what you care about
```
_aux and -ef are the two you'll actually type_

#### Reading ps aux columns

- **USER** — who owns the process
- **PID** — process id, its unique handle (you signal processes by PID)
- **%CPU / %MEM** — current resource share
- **STAT** — state: `R` running, `S` sleeping, `Z` zombie, `T` stopped
- **COMMAND** — what's actually running

#### PID 1 and the family tree

Every process has a parent (PPID). The chain climbs to **PID 1** — the init system (`systemd` on most distros) that the kernel starts first and that adopts orphans. `ps -ef` shows PPIDs so you can trace who launched what — vital when hunting something suspicious.

#### top / htop — the live dashboard

```bash
top       # live, refreshing view (press q to quit, M sort by memory, P by cpu)
htop      # friendlier colored version, if installed
```
_ps is a photo; top is the video_

#### Zombies, briefly

A **zombie** (`Z`, `<defunct>`) is a finished process whose parent hasn't collected its exit status yet. It holds no resources but clutters the table; a pile of them signals a buggy parent. You can't kill a zombie — it's already dead.

> 💡 **Sensei says:** Your own shell has a PID too. `echo $$` prints it — the shell's special variable for 'my own process id'.

## 🎯 Your Mission

1. Capture a snapshot of all processes into `snapshot.txt`:

   ```bash
   ps aux > snapshot.txt
   ```

2. Record your current shell's PID into `my-shell-pid.txt`:

   ```bash
   echo $$ > my-shell-pid.txt
   ```

3. A captured `sample/ps.txt` is provided (so answers are identical for everyone). Study it and answer in `answers.md`:

   ```bash
   biggest_memory_pid=PID_WITH_THE_HIGHEST_%MEM
   zombie_pid=PID_IN_STATE_Z
   init_pid=PID_OF_/sbin/init
   ```

## ✅ What the checker looks for

- **`snapshot.txt`** — your real ps aux output (has a PID header + many lines)
- **`my-shell-pid.txt`** — one number — your shell PID
- **`answers.md`** — three PIDs read from sample/ps.txt

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- In sample/ps.txt, %MEM is column 4. The java process is the memory hog.
- The zombie is the line with STAT `Z` and `<defunct>`.
- init is PID 1 by universal convention.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 5.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `4.5` · [🏠 Dojo map](../../../README.md) · Next: `5.2` ➡️
