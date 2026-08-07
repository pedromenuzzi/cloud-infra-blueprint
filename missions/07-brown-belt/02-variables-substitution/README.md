# Variables & Substitution

> _Store values, capture command output, do arithmetic._

**Belt 7 · Brown Belt** · Mission `7.2` · Lesson 2 · **100 XP** · ~25 min

---

A script without variables is a fancy way to retype constants. Today: naming values, the quoting rules that separate working scripts from haunted ones, capturing a command's output into a variable, and doing math in bash.

## 📖 Learn

#### Setting and using variables

```bash
name="Tux"          # NO spaces around = (name = "Tux" is an error!)
echo "$name"        # use with $ ; quotes preserve spaces
echo "${name}_v2"    # braces when the name touches other text
```
_assign without spaces, expand with $_

#### The quoting rules that bite everyone

- **"double quotes"** — expand variables (`"$name"` → Tux) but keep the value as one word
- **'single quotes'** — literal, NO expansion (`'$name'` → the text $name)
- **no quotes** — expands AND splits on spaces and globs (source of most bugs)

Rule of thumb: **quote every variable expansion** (`"$var"`) unless you have a specific reason not to. Unquoted `$file` with a space in it becomes two arguments and breaks silently. This one habit prevents more bugs than any other.

#### Command substitution — capture output

```bash
today=$(date +%Y-%m-%d)      # run date, store its output
files=$(ls | wc -l)          # count files into a variable
echo "There are $files files, today is $today"
```
_$( ... ) runs a command and gives back its output_

#### Arithmetic

```bash
a=3; b=5
sum=$(( a + b ))         # 8  — $(( )) does integer math
product=$(( a * b ))     # 15
count=$(( count + 1 ))   # the classic increment
```
_$(( )) for integers_

#### Positional and special parameters

- `$1 $2 $3 …` — the script's arguments
- `$#` — how many arguments were given
- `$0` — the script's own name
- `$@` — all arguments (quote it: `"$@"`)

> 💡 **Sensei says:** `set -u` at the top of a script makes it error on any *unset* variable instead of silently using empty string — catching typo'd variable names early. You'll adopt it as standard at black belt.

## 🎯 Your Mission

1. Write `calc.sh` that takes two number arguments and prints two lines: `sum=<a+b>` and `product=<a*b>`. Example: `./calc.sh 3 5` prints `sum=8` then `product=15`.

   ```bash
   #!/usr/bin/env bash
   a="$1"; b="$2"
   echo "sum=$(( a + b ))"
   echo "product=$(( a * b ))"
   ```

2. Write `info.sh` that prints your hostname and a number of seconds, using command substitution:

   ```bash
   #!/usr/bin/env bash
   echo "host=$(hostname)"
   echo "secs=$(date +%S)"
   ```

3. Make both executable and test: `./calc.sh 3 5`, `./calc.sh 10 10`, `./info.sh`.

## ✅ What the checker looks for

- **`calc.sh`** — executable; 3 5 → sum=8/product=15; 10 10 → sum=20/product=100
- **`info.sh`** — executable; prints host=<nonempty> and secs=<digits>

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Assignment has NO spaces: `a="$1"` not `a = "$1"`.
- Arithmetic needs the double parens: `$(( a + b ))`.
- The checker runs calc.sh with two different pairs — make sure it reads $1 and $2, not hardcoded numbers.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 7.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `7.1` · [🏠 Dojo map](../../../README.md) · Next: `7.3` ➡️
