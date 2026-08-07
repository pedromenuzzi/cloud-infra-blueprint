# The Watchdog

> _Keep a service alive: detect death, restart, log with timestamps._

**Belt 9 · Black Belt** · Mission `9.4` · Lesson 4 · **150 XP** · ~50 min

---

Services crash. A watchdog notices and brings them back — the loop behind every 'self-healing' system. You'll build one against a provided fake service you can start, stop, and kill at will, and prove your watchdog does the right thing whether the service is alive or dead.

## 📖 Learn

#### Boss briefing — the pieces

- A `fake-service.sh` is provided with `start`, `stop`, and `status` subcommands. It tracks a PID in `service.pid` and its `status` exits 0 if alive, non-zero if not.
- Your `watchdog.sh` checks the service once per run: if alive, log an OK line; if dead, start it and log a RESTARTED line.
- Every log line must be **timestamped** and appended to `watchdog.log`.

#### Checking liveness by exit code

```bash
if ./fake-service.sh status >/dev/null 2>&1; then
    # exit 0 → it's alive
else
    # non-zero → it's down
fi
```
_Let the service's own status command be the source of truth_

#### Timestamped logging

```bash
log() {
    echo "$(date +%Y-%m-%dT%H:%M:%S) $*" >> watchdog.log
}
log "OK service alive pid=$(cat service.pid 2>/dev/null)"
log "RESTARTED service was down, started it"
```
_A log() helper keeps every line consistent_

#### The PID-file pattern

A service writes its process id to a *pidfile* (`service.pid`) when it starts. To check if it's really alive, you read the pidfile and test the process: `kill -0 "$pid"` sends no signal but succeeds only if the process exists and you may signal it. That's the idiomatic liveness probe — the fake service already does this internally for you.

#### Why watchdogs run on a timer

In production a watchdog runs from cron (`* * * * *`, every minute) or as a systemd timer. Each invocation is one check-and-maybe-restart. You're building that single invocation — the thing the scheduler calls. Keep it fast and idempotent: safe to run whether the service is up or down.

> 💡 **Sensei says:** Real systems use `systemd` with `Restart=always` for this, but understanding the manual watchdog loop is what lets you debug systemd when *it* misbehaves. Know the mechanism, not just the magic.

## 🎯 Your Mission

1. Study the provided `fake-service.sh` — try `./fake-service.sh start`, `status`, `stop` and watch `service.pid`.

2. Write `watchdog.sh` that: checks the service via its `status`; if alive, appends a timestamped line containing `OK` and the pid to `watchdog.log`; if dead, runs `./fake-service.sh start` and appends a timestamped line containing `RESTARTED`.

3. Prove both branches. Scenario A — service already running:

   ```bash
   chmod +x watchdog.sh
   ./fake-service.sh start
   ./watchdog.sh        # should log an OK line
   tail watchdog.log
   ```

4. Scenario B — service down:

   ```bash
   ./fake-service.sh stop
   ./watchdog.sh        # should START it and log a RESTARTED line
   ./fake-service.sh status; echo "rc=$?"   # now rc=0 (alive again)
   tail watchdog.log
   ```

5. Clean up when done: `./fake-service.sh stop`. The checker runs its own alive/dead scenarios against your watchdog.

## ✅ What the checker looks for

- **`watchdog.sh`** — executable; logs OK when alive, RESTARTS + logs RESTARTED when dead
- **`watchdog.log`** — timestamped lines; contains both OK and RESTARTED across the scenarios

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Use the service's own `status` exit code as truth — don't reinvent the liveness check.
- Each log line needs a timestamp (a date at the front) and the keyword (OK / RESTARTED).
- After a RESTARTED run, `./fake-service.sh status` must exit 0 — your watchdog actually started it.
- The checker stops the service, runs your watchdog, and asserts the service is alive afterward.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 9.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `9.3` · [🏠 Dojo map](../../../README.md) · Next: `9.5` ➡️
