# 🥋 BOSS — Operation Lockdown

> _Secure a real app directory to production standards._

**Belt 4 · Green Belt** · Mission `4.5` · 🥋 BOSS TRIAL · **250 XP** · ~40 min

---

A developer shipped an app folder with everything world-readable — secrets included. Your job, Gatekeeper: lock it down to production hygiene. Right permissions on the right files, scripts runnable, secrets unreadable, and a written rationale.

## 📖 Learn

#### Boss briefing — the hardening standard

- Secrets (`config/secrets.env`) → **600**: only the owner may read. A leaked secret is the whole game.
- Config that services read (`config/app.conf`) → **640**: owner writes, group reads, others blind.
- Executables (`bin/*.sh`) → **755**: everyone may run, only owner may edit.
- Public assets (`public/*`) → **644**: readable by all, that's their job.
- Data directory (`data/`) → **750**: owner full, group may enter, others out.

#### Doing it efficiently

```bash
chmod 755 app/bin/*.sh          # glob hits every script at once
chmod 644 app/public/*         # all public assets
chmod 750 app/data             # the directory itself
ls -lR app                     # audit the whole tree afterward
```
_Glob per class, then verify_

> 💡 **Sensei says:** The written 'why' matters as much as the chmod. In a real review, 'secrets are 600 because a world-readable credential is a breach' is the sentence that gets you hired.

## 🎯 Your Mission

1. Apply the standard above to everything under `app/`.

2. Make `app/bin/start.sh` runnable and execute it (`./app/bin/start.sh`) — it prints a startup line proving the execute bit works.

3. Write `app/SECURITY.md` documenting your decisions:

   ```bash
   secrets_env=600
   bin_scripts=755
   data_dir=750
   why=ONE_SENTENCE_ON_WHY_SECRETS_ARE_600
   ```

4. Audit with `ls -lR app` and confirm every mode matches the standard.

## ✅ What the checker looks for

- **`app/config/secrets.env`** — mode 600
- **`app/config/app.conf`** — mode 640
- **`app/bin/*.sh`** — mode 755, and start.sh runs
- **`app/public/*`** — mode 644
- **`app/data/`** — mode 750
- **`app/SECURITY.md`** — four keys, why is a non-empty sentence

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Do the scripts with a glob: `chmod 755 app/bin/*.sh`.
- `ls -ld app/data` to check the directory's own mode is 750.
- 'why' just needs to be a real sentence — e.g. 'A world-readable credential file is a breach waiting to happen.'

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 4.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `4.4` · [🏠 Dojo map](../../../README.md) · Next: `5.1` ➡️
