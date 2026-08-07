# Script Zero

> _Shebang, chmod +x, exit codes — a real script from scratch._

**Belt 7 · Brown Belt** · Mission `7.1` · Lesson 1 · **100 XP** · ~25 min

---

Everything you've typed by hand, a script can do on demand, forever. A shell script is just commands in a file — plus three rituals that turn a text file into a real program: the shebang, the execute bit, and an exit code.

## 📖 Learn

#### The shebang line

```bash
#!/usr/bin/env bash
# ^ MUST be the very first line. Tells the OS which interpreter runs this file.
```
_#! + interpreter path_

`#!/usr/bin/env bash` finds bash via your PATH — more portable than a hardcoded `#!/bin/bash` (bash lives in different places on different systems). The line looks like a comment but the kernel reads those first two bytes specially.

#### From file to program

```bash
vim greet.sh          # or nano, or your editor of choice
chmod +x greet.sh     # grant the execute bit
./greet.sh            # run it (./ = 'right here')
```
_Three steps: write, chmod, run_

#### Comments and echo

```bash
#!/usr/bin/env bash
# This is a comment — ignored by bash, read by humans.
echo "Hello, Tux!"    # print a line
```
_# starts a comment anywhere on a line_

#### Exit codes — how programs report success

```bash
exit 0     # success (0 = OK, ALWAYS)
exit 1     # generic failure
exit 2     # a different failure (your choice of meaning)
# after any command:
echo $?    # the exit code of the LAST command
```
_0 = success; non-zero = something went wrong_

Exit codes are how scripts talk to each other and to `&&`/`||`. `cmd && echo ok` runs the echo only if cmd succeeded (exit 0); `cmd || echo failed` runs it only on failure. A script with no explicit `exit` returns the code of its last command — usually fine, but being explicit with `exit 0` signals intent.

> 💡 **Sensei says:** Run `bash -n script.sh` to syntax-check a script *without executing it*. Catching a typo before it runs is a Script Smith habit.

## 🎯 Your Mission

1. Write a script `greet.sh` in this folder that: starts with the bash shebang, and prints exactly `Hello, Tux!` when given a name argument OR `Hello, stranger!` when given none.

2. Full example to adapt:

   ```bash
   #!/usr/bin/env bash
   if [ -n "$1" ]; then
       echo "Hello, $1!"
   else
       echo "Hello, stranger!"
   fi
   exit 0
   ```

3. Wait — read that carefully: the checker wants `Hello, Tux!` specifically when you pass `Tux`, and `Hello, stranger!` with no argument. Make it executable and test both:

   ```bash
   chmod +x greet.sh
   ./greet.sh Tux      # → Hello, Tux!
   ./greet.sh          # → Hello, stranger!
   ```

4. Confirm the exit code is 0: `./greet.sh Tux; echo $?`.

## ✅ What the checker looks for

- **`greet.sh`** — executable, has a shebang, prints Hello, Tux! / Hello, stranger!, exits 0

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `[ -n "$1" ]` is true when the first argument is non-empty. Quote $1 to survive spaces.
- If './greet.sh' says permission denied, you forgot `chmod +x greet.sh`.
- The checker runs `./greet.sh Tux` and `./greet.sh` — match both outputs exactly.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 7.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `6.5` · [🏠 Dojo map](../../../README.md) · Next: `7.2` ➡️
