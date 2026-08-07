# The Deployer

> _Ship a release the real way: build, render config, atomic layout._

**Belt 9 · Black Belt** · Mission `9.3` · Lesson 3 · **150 XP** · ~50 min

---

Deployment is where all the belts converge: arguments, validation, directories, permissions, templating, and idempotency. You'll build a `deploy.sh` that lays out a release the way real systems do — a `current` release, shared logs, config rendered from a template — and that you can run twice without breaking anything.

## 📖 Learn

#### Boss briefing — the deploy spec

- `./deploy.sh <target-dir> <port>` — two required arguments.
- No/one argument → usage on stderr, `exit 1`. Non-numeric port → error on stderr, `exit 2`.
- Build the layout under `<target-dir>/`: `current/` (the app) and `shared/logs/`.
- Copy the app from the provided `release/static/` and `release/run.sh` into `current/`.
- Render `release/app.conf.template` into `current/app.conf`, replacing `__PORT__` with the given port. The result must contain `port=<port>` and NO `__PORT__`.
- Set `current/app.conf` to mode `600` (it may hold secrets).
- Write a `<target-dir>/RELEASE` manifest with `version=` (from `release/VERSION`) and `port=`.
- Print `deployed <target-dir> on port <port>`, `exit 0`. Running it again must succeed (idempotent).

#### Validating a numeric argument

```bash
case "$2" in
    ''|*[!0-9]*) echo "port must be a number" >&2; exit 2 ;;
esac
```
_The portable 'is it all digits?' test_

#### Rendering a template with sed

```bash
sed "s/__PORT__/$port/g" release/app.conf.template > "$target/current/app.conf"
```
_Substitute the placeholder — you learned this at orange belt_

#### Idempotency — safe to run twice

```bash
mkdir -p "$target/current" "$target/shared/logs"   # -p never complains if they exist
cp -r release/static/. "$target/current/"           # refresh contents
```
_mkdir -p and overwriting copies make re-runs harmless_

Idempotency is the deployment superpower: a script you can re-run any number of times and always end in the same correct state. `mkdir -p` (no error if exists) and copies that overwrite are the building blocks. A deploy that breaks on the second run is a deploy that pages you at 2 AM.

> 💡 **Sensei says:** The `current/` + `shared/` layout mirrors real tools (Capistrano, etc.): code is disposable and versioned, while logs and uploads live in `shared/` so they survive every deploy. You're building a real pattern in miniature.

## 🎯 Your Mission

1. Write `deploy.sh` implementing every point in the spec. Use `set -euo pipefail`.

2. Handle the argument errors: wrong count → exit 1 (stderr usage); non-numeric port → exit 2 (stderr).

3. Build the layout, copy the app, render the config (no `__PORT__` left), chmod the conf to 600, write the RELEASE manifest.

4. Test it — including running it twice:

   ```bash
   chmod +x deploy.sh
   ./deploy.sh; echo "rc=$?"                 # expect 1
   ./deploy.sh ./out abc; echo "rc=$?"       # expect 2 (bad port)
   ./deploy.sh ./out 8080; echo "rc=$?"      # expect 0
   cat out/current/app.conf out/RELEASE
   ./deploy.sh ./out 8080                     # run AGAIN — must still succeed
   ```

## ✅ What the checker looks for

- **`deploy.sh`** — executable; exit 1/2 on bad args; builds current/ + shared/logs/
- **`out/current/app.conf`** — mode 600; contains port=<port>; NO __PORT__ remains
- **`out/RELEASE`** — manifest with version= and port=
- **`idempotent`** — second run with the same args also exits 0

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Numeric check: the `case "$2" in ''|*[!0-9]*) ... ;; esac` idiom rejects empties and non-digits.
- Render with sed replacing __PORT__, then `chmod 600` the resulting app.conf.
- version= comes from `cat release/VERSION` (it's 1.0.0).
- For idempotency use `mkdir -p` and overwriting copies — never assume the dirs are absent.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 9.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `9.2` · [🏠 Dojo map](../../../README.md) · Next: `9.4` ➡️
