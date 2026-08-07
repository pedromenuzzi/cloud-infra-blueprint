# Environment Control

> _PATH, export, and the variables every process inherits._

**Belt 8 · Red Belt** · Mission `8.2` · Lesson 2 · **100 XP** · ~30 min

---

Why does typing `ls` find the program, but `./script.sh` needs the dots? Why do some variables survive into programs you launch and others vanish? The answer is the *environment* — and controlling it is what separates users from craftsmen.

## 📖 Learn

#### Shell variables vs environment variables

```bash
name="Tux"          # a SHELL variable — this shell only
export name         # now it's an ENVIRONMENT variable — inherited by children
export city="Oslo"  # set and export in one line
env                 # list all environment variables
printenv PATH       # print one
```
_export promotes a variable so child processes inherit it_

When you run a program, it gets a *copy* of the exported environment. It can change its own copy freely, but **cannot** change the parent shell's variables — children never affect parents. That's why a script can't `cd` your interactive shell for you (unless you `source` it). Inheritance flows one way: down.

#### PATH — the search list

```bash
echo "$PATH"        # colon-separated list of directories
# /usr/local/bin:/usr/bin:/bin:...
which ls            # WHERE bash found 'ls' along PATH
type ls             # is it a program, builtin, alias, or function?
```
_PATH is why you type `ls` not `/bin/ls`_

When you type a bare command, bash searches each PATH directory in order and runs the first match. `.` (the current directory) is deliberately NOT on PATH — otherwise a malicious `ls` dropped in a folder you `cd` into would hijack the real one. That safety choice is exactly why you must write `./script.sh` to run something in the current dir.

#### Adding to PATH

```bash
export PATH="$HOME/bin:$PATH"     # prepend your own bin dir (wins over system)
export PATH="$PATH:$HOME/bin"     # append (system wins on conflicts)
```
_Prepend for priority, append for fallback — put it in ~/.bashrc to persist_

#### Where settings live

- `~/.bashrc` — runs for each interactive non-login shell (most terminals). Aliases, PATH, prompt.
- `~/.profile` / `~/.bash_profile` — login shells.
- `export` in a shell — this session only; put it in `.bashrc` to make it permanent.

> 💡 **Sensei says:** `source file` (or `. file`) runs a script *in your current shell* instead of a child — so its `export`s and `cd`s affect you. That's how `source ~/.bashrc` reloads your config without opening a new terminal.

## 🎯 Your Mission

1. Capture your PATH, one directory per line, into `path-report.txt`:

   ```bash
   echo "$PATH" | tr ':' '\n' > path-report.txt
   ```

2. Write a script `env_probe.sh` that prints where HOME points and how many entries PATH has:

   ```bash
   #!/usr/bin/env bash
   echo "home=$HOME"
   echo "path_entries=$(echo "$PATH" | tr ':' '\n' | grep -c .)"
   ```

3. Prove children get a COPY of the environment: run your probe with a modified HOME just for that one command, and confirm your real shell's HOME is unchanged:

   ```bash
   chmod +x env_probe.sh
   HOME=/tmp/fakehome ./env_probe.sh    # prints home=/tmp/fakehome
   echo "$HOME"                          # your REAL home — unchanged
   ```

4. Record the concepts in `answers.md`:

   ```bash
   child_can_set_parent_env=CAN_A_CHILD_PROCESS_CHANGE_ITS_PARENT_SHELL_VARS?_yes_or_no
   bash_interactive_file=WHICH_DOTFILE_CONFIGURES_INTERACTIVE_SHELLS   # the ~/.___ file
   ```

## ✅ What the checker looks for

- **`path-report.txt`** — 3+ lines, PATH split one dir per line
- **`env_probe.sh`** — executable; HOME=/tmp/fakehome ./env_probe.sh → home=/tmp/fakehome, path_entries=<digits>
- **`answers.md`** — child_can_set_parent_env=no, bash_interactive_file=.bashrc

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `VAR=value command` sets VAR just for that one command's environment — the perfect demo.
- Children get a COPY, so they can't change the parent → the answer is `no`.
- The interactive-shell dotfile is `.bashrc`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 8.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `8.1` · [🏠 Dojo map](../../../README.md) · Next: `8.3` ➡️
