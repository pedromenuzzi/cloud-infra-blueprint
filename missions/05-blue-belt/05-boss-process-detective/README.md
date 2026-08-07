# 🥋 BOSS — The Process Detective

> _A server is compromised. Read the evidence, name the culprit._

**Belt 5 · Blue Belt** · Mission `5.5` · 🥋 BOSS TRIAL · **250 XP** · ~45 min

---

Alarms are firing: CPU pinned at 100%, a process nobody recognizes. You've been handed a casefile — snapshots of `ps`, `lsof`, and the crontab from the suspect box. Use everything from this belt to trace the intrusion and write the incident report.

## 📖 Learn

#### Boss briefing — the casefile

- `casefile/ps-dump.txt` — full process tree (UID, PID, **PPID**, CPU time, CMD)
- `casefile/lsof-dump.txt` — open network connections (which process, which port, to where)
- `casefile/crontab-dump.txt` — scheduled jobs (how attackers survive reboots)

#### How to think like the detective

- A process eating enormous CPU time with a weird name and an outbound connection to a random IP = a **cryptominer**.
- Trace its **PPID** in the ps dump — who launched it? That parent is the dropper.
- The **port** it talks to (in lsof) is the miner's pool connection.
- A **cron** entry re-running a script is the persistence mechanism — kill the process and it just comes back until you remove the cron.

#### Tools you already own

```bash
grep -E "miner|4444" casefile/*.txt      # pull the suspicious lines together
grep " 6060 " casefile/ps-dump.txt         # find a PID's row
sort -k? casefile/ps-dump.txt              # rank by a column
```
_Filter, correlate, conclude_

> 💡 **Sensei says:** The remediation order matters and is worth stating in your report: remove the cron persistence FIRST, then kill the process — otherwise cron respawns it seconds later.

## 🎯 Your Mission

1. Study all three files in `casefile/`. Correlate PID ↔ PPID ↔ open port.

2. Write your incident report `verdict.md` with exactly these keys:

   ```bash
   miner_pid=PID_OF_THE_MINING_PROCESS
   miner_parent=PPID_THAT_LAUNCHED_IT
   evil_port=THE_REMOTE_POOL_PORT_IT_CONNECTS_TO
   persistence=HOW_IT_SURVIVES_REBOOT      # one word, e.g. cron
   compromised_user=WHICH_USER_ACCOUNT_IS_RUNNING_IT
   kill_command=THE_EXACT_COMMAND_TO_FORCE-KILL_THE_MINER
   story=ONE_OR_TWO_SENTENCES_EXPLAINING_THE_ATTACK
   ```

## ✅ What the checker looks for

- **`verdict.md`** — all seven keys; story is a real explanation

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The miner is the process burning hours of CPU TIME with a pool address in its command line.
- kill_command should force-kill by PID, e.g. `kill -9 6060`.
- persistence is one word — what mechanism re-launches it on schedule?
- compromised_user is the USER column of the miner's row (a service account, not a human).

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 5.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `5.4` · [🏠 Dojo map](../../../README.md) · Next: `6.1` ➡️
