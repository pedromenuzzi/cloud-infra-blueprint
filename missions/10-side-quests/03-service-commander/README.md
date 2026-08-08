# Service Commander

> _systemctl & journalctl — command the daemons like an admin._

**Belt 10 · Side Quests** · Mission `10.3` · Lesson 3 · **100 XP** · ~35 min

---

Real servers run *services*: nginx, postgres, your app — supervised by systemd. When something breaks at 3 AM, the admin ritual is always the same trio: check the status, read the logs, restart. Today you learn the ritual on captured evidence, so it grades the same on any machine.

## 📖 Learn

#### The systemd model

systemd is the manager that starts and supervises services (*units*). `systemctl` gives orders; `journalctl` reads their logs. A unit can be **active (running)**, **inactive**, or **failed** — and separately **enabled** (starts on boot) or **disabled**. `enable` and `start` are different questions: *from now on* vs *right now*.

#### The commands

```bash
systemctl status nginx          # state, PID, memory, last log lines — the first look
sudo systemctl start nginx      # start it now
sudo systemctl restart nginx    # stop + start (after a config change)
sudo systemctl enable nginx     # start automatically on boot
journalctl -u nginx -n 50       # last 50 log lines of THAT unit
journalctl -u nginx -f          # follow live (the service's tail -f)
systemctl list-units --type=service   # everything running
```
_The admin's daily bread_

#### Reading a status block

```bash
● nginx.service - A high performance web server...
     Loaded: loaded (...; enabled; ...)     ← starts on boot
     Active: active (running) since ...     ← alive right now
   Main PID: 1200 (nginx)                   ← the process to trace
```
_Three lines tell you almost everything_

#### The triage ritual (memorize the order)

- 1. **status** — is it running? since when? what did it say last?
- 2. **logs** — `journalctl -u <unit> -n 50`: WHY did it fail? (exit code 127 = command not found; 1 = generic error; 137 = killed)
- 3. **restart** — only after you understand; then status again to confirm.

Restarting *before* reading logs destroys evidence and often just reproduces the crash. Status → logs → restart. That order is the difference between an operator and a button-pusher — and it's exactly what the samples in this mission let you practice.

> 💡 **Sensei says:** WSL2 ships with systemd enabled these days, so these commands work in your dojo. Containers usually don't have it — that's why this mission grades on captured evidence, plus one live probe that adapts to your machine.

## 🎯 Your Mission

1. Study `sample/systemctl-status.txt` (a healthy nginx), `sample/systemctl-failed.txt` (a crashed unit) and `sample/journal.txt` (its logs).

2. Answer the triage in `answers.md`:

   ```bash
   nginx_state=ACTIVE_STATE_OF_NGINX          # one word from the Active: line
   nginx_main_pid=THE_MAIN_PID
   nginx_enabled=DOES_IT_START_ON_BOOT           # the word from Loaded:
   failed_unit=THE_NAME_OF_THE_BROKEN_SERVICE    # without .service is fine
   exit_status=THE_NUMERIC_EXIT_CODE_OF_THE_CRASH
   root_cause=THE_MISSING_COMMAND_IN_THE_LOGS    # one word
   ```

3. Write your `runbook.md` — the ritual you'd run on a real box, in order, with real commands (status first, logs second, restart third). Include the literal commands `systemctl status`, `journalctl -u` and `systemctl restart`, plus:

   ```bash
   first_step=status
   ```

4. One live probe — works with or without systemd on your machine (note the `||` fallback doing the graceful degradation):

   ```bash
   { systemctl list-units --type=service 2>/dev/null || echo "no systemd on this machine"; } | head -20 > systemctl-live.txt
   ```

## ✅ What the checker looks for

- **`answers.md`** — six triage answers from the captured evidence
- **`runbook.md`** — the trio in order: systemctl status → journalctl -u → systemctl restart, plus first_step=status
- **`systemctl-live.txt`** — your machine's live probe (or the graceful fallback line)

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- exit_status: the failed unit's Process line ends with `status=NNN` — that number.
- root_cause: the journal's last lines name the command that was not found.
- The runbook is prose + commands — the checker greps for the three commands and the first_step key.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 10.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `10.2` · [🏠 Dojo map](../../../README.md)
