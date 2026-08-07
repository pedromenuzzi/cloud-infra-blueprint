# The Sysinfo Suite

> _Write a production-grade diagnostics tool, JSON and all._

**Belt 9 · Black Belt** · Mission `9.2` · Lesson 2 · **150 XP** · ~45 min

---

Every ops team has a `sysinfo` script — the one you run first on any box to see what you're dealing with. Yours will be production-grade: strict mode, clean human output, and a `--json` flag for machines to consume. This is the tool you'll actually reuse after the dojo.

## 📖 Learn

#### The professional script header

```bash
#!/usr/bin/env bash
set -euo pipefail
#     │││
#     ││└ pipefail: a failing command mid-pipe fails the whole pipe
#     │└ u: using an unset variable is an error (catches typos)
#     └ e: exit immediately if any command fails
```
_set -euo pipefail — the three words that make bash safe_

Without `set -e`, a script barrels on after a failed command, often making things worse. Without `-u`, a mistyped `$HOSTNAEM` silently expands to empty. Without `pipefail`, `false | true` looks like success. These three are the seatbelt of every serious script.

#### Gathering system facts portably

```bash
hostname                         # machine name
uname -r                         # kernel release
uname -s                         # OS (Linux, Darwin, …)
whoami                           # current user
date -u +%Y-%m-%dT%H:%M:%SZ      # UTC timestamp, ISO-8601
```
_Prefer commands that exist everywhere_

#### Emitting JSON by hand

```bash
printf '{"hostname":"%s","user":"%s","kernel":"%s"}\n' \
    "$(hostname)" "$(whoami)" "$(uname -r)"
```
_printf with a template = valid JSON, no dependencies_

Real tools output *both* for humans and machines. A `--json` flag that emits a single compact JSON line lets your script feed dashboards, `jq` pipelines, and alerting — while the default stays readable. Designing for both consumers is a black-belt instinct.

#### Parsing your own flags

```bash
mode=human
if [ "${1:-}" = "--json" ]; then mode=json; fi
# ${1:-} = '$1 or empty if unset' — safe under set -u
```
_${var:-default} keeps set -u happy_

> 💡 **Sensei says:** `${1:-}` is essential under `set -u`: a bare `$1` when no argument was passed would abort the script. The `:-` gives it a safe default. Memorize this pairing.

## 🎯 Your Mission

1. Write `sysinfo.sh` starting with `#!/usr/bin/env bash` and `set -euo pipefail`.

2. Default (human) output must print these labelled lines (values from your system):

   ```bash
   hostname=<hostname>
   kernel=<uname -r>
   user=<whoami>
   shell_pid=<the script's PID, e.g. $$>
   date_utc=<ISO-8601 UTC timestamp, starts YYYY-MM-DD>
   ```

3. With `--json`, print a SINGLE line of valid JSON containing at least a `hostname` field, e.g. `{"hostname":"...","kernel":"...","user":"..."}`.

4. Make it executable and test both modes:

   ```bash
   chmod +x sysinfo.sh
   ./sysinfo.sh
   ./sysinfo.sh --json
   ```

5. Confirm it exits 0 in both modes (`echo $?`).

## ✅ What the checker looks for

- **`sysinfo.sh`** — executable; contains set -euo pipefail; human mode prints the 5 keys; --json prints one JSON line with hostname; exits 0

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- shell_pid can just be `$$` (the script's own PID).
- date_utc: `date -u +%Y-%m-%dT%H:%M:%SZ` — the checker only checks it starts with a YYYY-MM-DD date.
- For --json, printf with a template is easiest and always valid. Keep it to ONE line.
- The checker greps your file for `set -euo pipefail` (or the equivalent set -e/-u/-o pipefail) — include it.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 9.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `9.1` · [🏠 Dojo map](../../../README.md) · Next: `9.3` ➡️
