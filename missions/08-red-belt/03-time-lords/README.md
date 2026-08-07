# Time Lords

> _cron — schedule work to run itself, forever._

**Belt 8 · Red Belt** · Mission `8.3` · Lesson 3 · **100 XP** · ~30 min

---

The final promotion of automation: work that runs with nobody watching. `cron` is the scheduler behind backups, report emails, and cleanup jobs on nearly every server alive. Its five-field syntax looks cryptic for about ten minutes, then never again.

## 📖 Learn

#### The five fields

```bash
# ┌─ minute (0-59)
# │ ┌─ hour (0-23)
# │ │ ┌─ day of month (1-31)
# │ │ │ ┌─ month (1-12)
# │ │ │ │ ┌─ day of week (0-7, 0 and 7 = Sunday)
# │ │ │ │ │
  0 8 * * *   /opt/dojo/checkup.sh    # every day at 08:00

```
_min hour dom month dow  command_

#### The special characters

- `*` — every value ('every hour', 'every day')
- `*/15` — every 15 units (in the minute field: every 15 minutes)
- `1-5` — a range (in day-of-week: Mon–Fri)
- `1,15` — a list (1st and 15th)
- day-of-week accepts `mon tue wed …` names too

#### Reading real schedules

```bash
0 8 * * *        # daily at 08:00
*/15 * * * *     # every 15 minutes, all day
30 18 * * 1      # 18:30 every Monday (1 = Mon)
0 0 1 * *        # midnight on the 1st of every month
0 2 * * 0        # 02:00 every Sunday
```
_Practice reading these until they're obvious_

#### Managing your crontab

```bash
crontab -l       # list your scheduled jobs
crontab -e       # edit them (opens your editor)
crontab -r       # remove ALL of them (careful!)
```
_Per-user schedules, edited safely_

#### The #1 cron gotcha

Cron runs jobs with a **minimal environment** — a bare PATH, no `~/.bashrc`, often no `HOME` you expect. Scripts that work in your terminal fail under cron because a command isn't on cron's PATH. The fix: use **absolute paths** for everything (`/usr/bin/find`, `/opt/app/run.sh`), or set PATH explicitly at the top of the script. Also redirect output (`>> /var/log/job.log 2>&1`) — cron emails it into the void otherwise.

> 💡 **Sensei says:** Test the *command* by hand first, with the exact absolute paths cron will use. 'Works in my shell' is not 'works in cron' — the environment is the difference.

## 🎯 Your Mission

1. Write a crontab file `schedule.cron` with exactly four job lines (comments allowed but they don't count), scheduling these absolute-path scripts:

2. • `/opt/dojo/checkup.sh` — every day at **08:00**

3. • `/opt/dojo/pulse.sh` — **every 15 minutes**

4. • `/opt/dojo/weekly.sh` — **18:30 every Monday**

5. • `/opt/dojo/rollup.sh` — **midnight on the 1st of each month**

6. Reference shape (fill the fields in yourself before peeking at the hints):

   ```bash
   0 8 * * *    /opt/dojo/checkup.sh
   */15 * * * * /opt/dojo/pulse.sh
   30 18 * * 1  /opt/dojo/weekly.sh
   0 0 1 * *    /opt/dojo/rollup.sh
   ```

7. Record two facts in `answers.md`:

   ```bash
   field_order=THE_FIRST_TWO_FIELD_NAMES_IN_ORDER    # e.g. minute hour
   cron_env_gotcha=THE_ONE_WORD_MOST_LIKELY_TO_BE_WRONG_UNDER_CRON   # hint: it's an env variable
   ```

## ✅ What the checker looks for

- **`schedule.cron`** — four correct cron lines for the four scripts
- **`answers.md`** — field_order and cron_env_gotcha

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- 'every 15 minutes' is `*/15` in the minute field, `*` everywhere else.
- Monday is day-of-week 1; 18:30 is minute 30, hour 18.
- field_order: the fields start minute then hour. cron_env_gotcha: the classic culprit is PATH.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 8.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `8.2` · [🏠 Dojo map](../../../README.md) · Next: `8.4` ➡️
