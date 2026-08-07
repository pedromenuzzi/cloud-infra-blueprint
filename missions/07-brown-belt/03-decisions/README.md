# Decisions

> _if/test, exit codes, and talking to stderr._

**Belt 7 · Brown Belt** · Mission `7.3` · Lesson 3 · **100 XP** · ~30 min

---

Scripts that can't decide are just macros. Today your scripts gain judgment: testing files, comparing values, branching, and — the mark of a pro — reporting errors on stderr with meaningful exit codes.

## 📖 Learn

#### The if statement

```bash
if [ "$x" = "yes" ]; then
    echo "affirmative"
elif [ "$x" = "no" ]; then
    echo "negative"
else
    echo "unclear"
fi
```
_if … then … elif … else … fi_

#### File test operators

- `[ -e path ]` — exists (any type)
- `[ -f path ]` — exists and is a regular **f**ile
- `[ -d path ]` — exists and is a **d**irectory
- `[ -r path ]` / `-w` / `-x` — readable / writable / executable
- `[ -s path ]` — exists and is non-empty (has **s**ize)

#### String and number tests

```bash
[ "$a" = "$b" ]    # strings equal        [ "$a" != "$b" ]  # not equal
[ -z "$s" ]        # string is empty       [ -n "$s" ]       # string is non-empty
[ "$m" -eq "$n" ]  # numbers: -eq -ne -lt -le -gt -ge
```
_= for strings, -eq for numbers (mixing them is a classic bug)_

#### stderr and exit codes — professional error reporting

```bash
if [ "$#" -eq 0 ]; then
    echo "usage: $0 <path>" >&2    # errors go to STDERR (>&2)
    exit 1                          # non-zero = failure
fi
```
_Errors on stderr, distinct exit codes_

Why `>&2`? So error messages don't pollute the *data* a script prints on stdout. A user can do `./script > results.txt` and still SEE the errors on screen. Different exit codes (1, 2, …) let callers distinguish failure *reasons* — the checker relies on exactly this.

#### The [[ ]] upgrade

Bash also offers `[[ ... ]]` — same idea, but safer (no word-splitting surprises) and with extras like `&&`, `||`, and pattern matching. Prefer `[[ ]]` in bash scripts; `[ ]` is the portable POSIX form. Both are taught here; the checker accepts either.

## 🎯 Your Mission

1. Write `filecheck.sh` that inspects its first argument and behaves EXACTLY like this:

2. • No argument → print `usage: ...` to **stderr** and `exit 1`.

3. • Argument is a directory → print `is a directory` and `exit 0`.

4. • Argument is a regular file → print `is a file` and `exit 0`.

5. • Argument names something that doesn't exist → print `does not exist` and `exit 2`.

6. Skeleton to complete:

   ```bash
   #!/usr/bin/env bash
   if [ "$#" -eq 0 ]; then
       echo "usage: $0 <path>" >&2
       exit 1
   fi
   if [ -d "$1" ]; then
       echo "is a directory"; exit 0
   elif [ -f "$1" ]; then
       echo "is a file"; exit 0
   else
       echo "does not exist"; exit 2
   fi
   ```

7. Test all four paths and check `$?` each time: no-arg, a dir (like `.`), a file (like the script itself), and a made-up name.

## ✅ What the checker looks for

- **`filecheck.sh`** — executable; four behaviors with exit codes 1/0/0/2 and stderr usage

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Order matters: test -d before -f, and both before the 'does not exist' else.
- `>&2` redirects that echo to stderr. The checker verifies the usage text is NOT on stdout.
- Verify exit codes: `./filecheck.sh; echo $?` should print 1 (no arg).

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 7.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `7.2` · [🏠 Dojo map](../../../README.md) · Next: `7.4` ➡️
