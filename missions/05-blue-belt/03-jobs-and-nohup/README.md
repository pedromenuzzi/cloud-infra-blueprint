# Jobs & Nohup

> _Background, foreground, and surviving logout._

**Belt 5 · Blue Belt** · Mission `5.3` · Lesson 3 · **100 XP** · ~25 min

---

One terminal, many tasks. Job control lets you pause a job, shove it to the background, pull it back — and `nohup`/`&` let a task outlive the terminal that started it. Essential the first time an SSH session drops mid-job.

## 📖 Learn

#### Background and foreground

```bash
./slow_task.sh &     # start in the BACKGROUND (& = don't wait)
jobs                 # list this shell's jobs
fg %1                # bring job 1 to the FOREGROUND
bg %1                # resume a stopped job in the background
```
_& detaches; jobs/fg/bg manage them_

#### The Ctrl+Z dance

- **Ctrl+C** — send INT, terminate the foreground job
- **Ctrl+Z** — send TSTP, *suspend* it (frozen, not dead)
- then **`bg`** — resume it in the background, or **`fg`** — resume in foreground

So the rescue for 'oops, this is taking forever and blocking my terminal' is: **Ctrl+Z** to suspend, then **`bg`** to let it run detached while you keep working.

#### Surviving logout: nohup and &

```bash
nohup ./slow_task.sh &        # immune to HUP; keeps running after logout
# stdout/stderr are saved to ./nohup.out automatically
nohup ./slow_task.sh > run.log 2>&1 &   # send output where you want
```
_nohup = no hangup_

When a terminal closes, the kernel sends **SIGHUP** to its jobs — normally killing them. `nohup` makes a command ignore HUP, so `nohup cmd &` keeps running after you log out. (`tmux`/`screen` solve this more richly, but nohup is everywhere and needs nothing installed.)

#### Redirecting both streams

```bash
cmd > out.log 2>&1 &
#          └ 2>&1 = 'send stderr to wherever stdout is going'
```
_Capture normal output AND errors together_

> 💡 **Sensei says:** `2>&1` order matters: it means 'stderr follows stdout's current destination', so it must come *after* the `>`. A daily-driver idiom worth memorizing.

## 🎯 Your Mission

1. Run the slow task with nohup in the background, capturing output to `slow.log` (the script writes there itself):

   ```bash
   nohup ./slow_task.sh > /dev/null 2>&1 &
   ```

2. While it runs, prove you understand job control: start a `sleep 30`, press Ctrl+Z to suspend it, then `bg` to background it, then confirm with `jobs`.

3. Wait for the task to finish (about 10s), then confirm `slow.log` ends with a `done` line: `tail slow.log`.

4. Record the concepts in `answers.md`:

   ```bash
   pause_key=THE_KEY_COMBO_THAT_SUSPENDS_A_JOB    # e.g. ctrl+z
   resume_bg=THE_COMMAND_THAT_RESUMES_IN_BACKGROUND   # one word
   hup_immune=THE_COMMAND_THAT_SURVIVES_LOGOUT        # one word
   ```

## ✅ What the checker looks for

- **`slow.log`** — contains tick lines and a final 'done'
- **`answers.md`** — pause_key, resume_bg, hup_immune

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- pause_key is `ctrl+z` (case/spacing lenient); resume_bg is `bg`; hup_immune is `nohup`.
- If slow.log has no 'done' yet, the task is still running — wait a few seconds and re-check.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 5.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `5.2` · [🏠 Dojo map](../../../README.md) · Next: `5.4` ➡️
