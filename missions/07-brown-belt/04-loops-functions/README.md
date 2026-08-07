# Loops & Functions

> _for, while, and reusable functions._

**Belt 7 · Brown Belt** · Mission `7.4` · Lesson 4 · **100 XP** · ~30 min

---

Repetition is the whole reason scripts exist. Loops let one instruction process a thousand items; functions let you name a chunk of logic and reuse it. Together they turn scripts from linear notes into real programs.

## 📖 Learn

#### The for loop

```bash
for f in *.txt; do
    echo "found: $f"
done

for i in 1 2 3; do echo "n=$i"; done

for i in $(seq 1 5); do echo "$i"; done   # 1..5
```
_for VAR in LIST; do … done_

#### Looping over files SAFELY

Glob directly (`for f in *.txt`) rather than `for f in $(ls)` — the latter breaks on spaces in names. Always quote `"$f"` inside the loop. If a glob might match nothing, guard with `[ -e "$f" ]` at the top of the body.

#### The while loop

```bash
count=1
while [ "$count" -le 5 ]; do
    echo "tick $count"
    count=$(( count + 1 ))
done

while read -r line; do        # read a file line by line
    echo "line: $line"
done < input.txt
```
_while CONDITION; do … done_

#### Functions

```bash
greet() {
    local name="$1"        # 'local' keeps it inside the function
    echo "Hello, $name"
}
greet "Tux"                # call it like a command

count_files() {
    find "$1" -type f | wc -l
}
n=$(count_files .)          # capture a function's output
```
_name() { … } — call by name, args are $1 $2 …_

Functions take arguments exactly like scripts do (`$1`, `$2`, `$#`) and 'return' data by printing it (captured with `$(...)`). Use `local` for a function's own variables so they don't leak into the rest of the script — a discipline that prevents baffling bugs.

> 💡 **Sensei says:** `return N` sets a function's *exit code* (0–255), not its output. Output is what you `echo`. Confusing the two is a rite of passage — now you can skip it.

## 🎯 Your Mission

1. Write `inspector.sh <dir>` that reports on a directory using BOTH a function and a loop. It must print exactly three lines:

   ```bash
   dirs=<number of subdirectories>
   files=<number of regular files>
   total=<dirs + files>
   ```

2. It must contain at least one function definition (`name() { ... }`) and at least one loop (`for` or `while`). One working shape:

   ```bash
   #!/usr/bin/env bash
   target="${1:-.}"
   count_type() {
       local kind="$1" dir="$2" n=0
       for entry in "$dir"/*; do
           [ -e "$entry" ] || continue
           if [ "$kind" = d ] && [ -d "$entry" ]; then n=$(( n + 1 )); fi
           if [ "$kind" = f ] && [ -f "$entry" ]; then n=$(( n + 1 )); fi
       done
       echo "$n"
   }
   d=$(count_type d "$target")
   f=$(count_type f "$target")
   echo "dirs=$d"
   echo "files=$f"
   echo "total=$(( d + f ))"
   ```

3. The checker runs your script against a fixture directory with 2 subdirectories and 3 files (expecting dirs=2, files=3, total=5). Test yours against such a folder — make one with `mkdir -p t/{a,b}; touch t/{x,y,z}.txt; ./inspector.sh t`.

## ✅ What the checker looks for

- **`inspector.sh`** — executable; prints dirs=/files=/total=; contains a function AND a loop; correct on the fixture

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The `[ -e "$entry" ] || continue` guard handles the case where a glob matches nothing.
- total must equal dirs + files. The checker builds a 2-dir/3-file fixture and expects 2/3/5.
- The checker greps your script for a function definition and a loop keyword — keep both.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 7.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `7.3` · [🏠 Dojo map](../../../README.md) · Next: `7.5` ➡️
