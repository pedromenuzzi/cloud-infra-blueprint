# The Signal Path

> _kill, signals, and the difference between asking and forcing._

**Belt 5 · Blue Belt** · Mission `5.2` · Lesson 2 · **100 XP** · ~30 min

---

`kill` is badly named — it really means 'send a signal'. Most signals are polite requests a program may handle or ignore; one cannot be refused. Today you meet a stubborn daemon and learn the whole spectrum from 'please stop' to 'stop NOW'.

## 📖 Learn

#### Signals are messages, not murders

```bash
kill 4242            # send the DEFAULT signal (TERM) to PID 4242
kill -15 4242        # TERM explicitly — 'please shut down cleanly'
kill -TERM 4242      # same thing, by name
kill -9 4242         # KILL — the un-ignorable, un-catchable hammer
kill -2 4242         # INT — what Ctrl+C sends
kill -1 4242         # HUP — often 'reload your config'
```
_-15 asks nicely; -9 does not ask_

#### The three you must know

- **SIGTERM (15)** — the default. 'Please clean up and exit.' A well-behaved program flushes files, closes sockets, then quits. *Always try this first.*
- **SIGKILL (9)** — cannot be caught, blocked, or ignored. The kernel destroys the process instantly. No cleanup — risk of corrupt state. *Last resort.*
- **SIGHUP (1)** — historically 'terminal hung up'; today many daemons treat it as 'reload config without restarting'.

#### Why a program can ignore TERM

Programs install *signal handlers* — code that runs when a signal arrives. A handler can catch TERM and decide to log it and keep running (databases do this to finish writing safely). SIGKILL is special precisely because the kernel never delivers it to the program at all — there's nothing to catch. That's why `-9` always wins.

#### Finding the PID to signal

```bash
pgrep -f naughty_daemon      # PIDs whose command matches
pkill -f naughty_daemon      # signal them by name (TERM by default)
pkill -9 -f naughty_daemon   # force by name
```
_pgrep/pkill save you the ps|grep dance_

> 💡 **Sensei says:** Escalate, don't lead with force: TERM, wait a moment, and only then KILL. Leading with `-9` on a database is how you learn about corrupt data the hard way.

## 🎯 Your Mission

1. Launch the stubborn daemon in the background:

   ```bash
   ./naughty_daemon.sh &
   ```

2. Confirm it's alive and note its PID (it also writes `daemon.pid`):

   ```bash
   cat daemon.pid
   ps aux | grep naughty_daemon
   ```

3. Politely ask it to stop with SIGTERM — then check `daemon.log`. You'll see it *ignored* you (it has a handler).

   ```bash
   kill -15 $(cat daemon.pid)
   cat daemon.log
   ```

4. Now end it for real with the un-ignorable signal:

   ```bash
   kill -9 $(cat daemon.pid)
   ```

5. Confirm it's gone (`ps aux | grep naughty_daemon` shows nothing but grep), then record in `answers.md`:

   ```bash
   polite_signal=15                # the name TERM is also accepted
   unstoppable_signal=9
   ```

## ✅ What the checker looks for

- **`daemon.log`** — shows the daemon started AND logged ignoring SIGTERM
- **`daemon.pid`** — the PID — and that process must NO LONGER be running
- **`answers.md`** — polite_signal and unstoppable_signal

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The daemon writes its own PID to daemon.pid, so `kill $(cat daemon.pid)` always targets it.
- If it won't die, you're sending TERM (which it ignores). Use `kill -9`.
- `polite_signal` accepts either `15` or `TERM`; `unstoppable_signal` is `9`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 5.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `5.1` · [🏠 Dojo map](../../../README.md) · Next: `5.3` ➡️
