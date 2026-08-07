# Hello, Terminal

> _Meet the shell — your new superpower._

**Belt 1 · White Belt** · Mission `1.1` · Lesson 1 · **100 XP** · ~15 min

---

Welcome to the dojo, Hatchling. Before you can master Linux, you must speak to it directly. The terminal is not scary — it is honest. It does exactly what you say, which is why we will practice saying the right things.

## 📖 Learn

#### What a shell actually is

When you open a terminal, a program called a **shell** (usually `bash` or `zsh`) starts and waits for you. You type a command, press Enter, the shell finds the program, runs it, shows the output, and waits again. That loop — read, run, repeat — is the whole game. Everything else in this dojo builds on it.

#### Your first four commands

```bash
pwd        # Print Working Directory — where am I?
whoami     # which user am I logged in as?
date       # what time does the system think it is?
echo hi    # print back whatever I give you
```
_Try each one now_

`echo` looks silly until you realize it is how scripts talk, how you inspect variables, and how you write files without an editor. You will use it thousands of times.

#### Redirection: sending output into a file

Normally output goes to your screen. The `>` operator redirects it into a file instead — creating the file if needed, **overwriting** it if it exists. Its sibling `>>` appends to the end instead of overwriting.

```bash
echo "words go here" > note.txt    # create/overwrite note.txt
echo "one more line" >> note.txt   # append
cat note.txt                        # show the file
```
> 💡 **Sensei says:** Press the ↑ arrow to recall previous commands, and press Tab to auto-complete file names. Sensei types half as much as you think.

## 🎯 Your Mission

1. Open a terminal and `cd` into this mission folder (the folder containing this README).

2. Run `pwd`, `whoami` and `date` — just to feel the loop. Look at each output.

3. Create a file `hello.txt` containing exactly the line `Hello, Tux!` using echo and `>`:

   ```bash
   echo "Hello, Tux!" > hello.txt
   ```

4. Create `whoami.txt` containing the output of the `whoami` command (redirect it):

   ```bash
   whoami > whoami.txt
   ```

5. Read both files back with `cat` to confirm what landed in them.

## ✅ What the checker looks for

- **`hello.txt`** — one line, exactly: Hello, Tux!
- **`whoami.txt`** — one non-empty line — your username

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- If `hello.txt` has the wrong text, just run the echo command again — `>` overwrites.
- Quotes matter: `echo "Hello, Tux!"` keeps the exclamation mark safe from the shell.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 1.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
[🏠 Dojo map](../../../README.md) · Next: `1.2` ➡️
