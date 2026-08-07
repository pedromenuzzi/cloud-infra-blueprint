# Incident Triage

> _A server is down and possibly breached. Stabilize it under pressure._

**Belt 9 · Black Belt** · Mission `9.1` · Lesson 1 · **150 XP** · ~45 min

---

3 AM. A production box crashed and something looks planted. You have a captured `server-room/` to work in — logs, junk, secrets with wrong permissions, and a backdoor hiding in the dark. Black belts don't panic; they triage: find the cause, remove the threat, lock the doors, and write it up.

## 📖 Learn

#### The triage mindset

- **Diagnose before you touch.** Read the logs; find the FATAL line that explains the crash.
- **Contain the threat.** A reverse-shell script and a malicious cron are active dangers — remove them.
- **Fix exposure.** Secrets and private keys must be `600`; a world-readable credential is an open door.
- **Clean the debris.** Junk and core dumps that filled the disk should go — carefully.
- **Document everything.** The report is how the team learns and how you cover the incident.

#### Everything you've learned, at once

```bash
grep -c ERROR server-room/logs/app.log         # how bad was it?
grep FATAL server-room/logs/app.log             # WHY did it die?
ls -la server-room/                             # -a: reveal the hidden backdoor
chmod 600 server-room/config/secrets.env        # lock the secret
find server-room -name '*.tmp' -o -name 'core.*' # the debris
```
_Belts 1–8, applied under fire_

#### Spotting the backdoor

A file whose name starts with a dot (`ls -a` to see it) containing a line like `bash -i >& /dev/tcp/…/4444` is a **reverse shell** — it dials out to give an attacker a prompt on your box. A cron entry piping `curl … | bash` re-installs malware on a schedule. Both must be removed; the cron is the persistence, the script is the payload.

> 💡 **Sensei says:** Order of operations in a real breach: capture evidence, remove persistence (cron), remove payload (the script), rotate exposed secrets, THEN clean disk. This mission compresses that into a checklist — internalize the order.

## 🎯 Your Mission

1. Diagnose: read `server-room/logs/app.log`. Count the ERROR lines and find the one FATAL line explaining the crash.

2. Contain: delete the hidden reverse-shell script (find it with `ls -la server-room/`) and remove the malicious `cron-dump.txt` backdoor file.

3. Lock down: set `server-room/config/secrets.env` and `server-room/config/deploy_key` to mode `600`.

4. Clean: delete the debris — every `*.tmp` file and the `core.*` dump under `server-room/`.

5. Report: write `triage.md` with exactly these keys:

   ```bash
   fatal_reason=SHORT_PHRASE_FROM_THE_FATAL_LINE      # what filled up / broke
   error_count=NUMBER_OF_ERROR_LINES
   backdoor_file=NAME_OF_THE_HIDDEN_REVERSE_SHELL_SCRIPT
   cron_backdoor=THE_SUSPICIOUS_COMMAND_IN_THE_CRON_DUMP   # a word like curl
   first_action=ONE_SENTENCE:_WHAT_YOU_DID_FIRST_AND_WHY
   ```

## ✅ What the checker looks for

- **`secrets.env + deploy_key`** — both mode 600
- **`backdoor removed`** — the hidden .sh reverse shell and cron-dump.txt are gone
- **`debris removed`** — no *.tmp and no core.* remain under server-room/
- **`triage.md`** — all five keys; fatal_reason and first_action are real sentences

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `ls -la server-room/` reveals the dot-file backdoor; its name starts with `.hidden`.
- error_count: `grep -c ERROR server-room/logs/app.log`.
- The FATAL line mentions the disk filling — 'disk full' is the fatal_reason.
- cron_backdoor: the cron line pipes `curl ... | bash`, so the answer word is `curl`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 9.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `8.5` · [🏠 Dojo map](../../../README.md) · Next: `9.2` ➡️
