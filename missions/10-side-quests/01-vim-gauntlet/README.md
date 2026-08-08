# The Vim Gauntlet

> _Survive — then quietly start liking — the editor on every server._

**Belt 10 · Side Quests** · Mission `10.1` · Lesson 1 · **100 XP** · ~35 min

---

One day you'll SSH into a box that has no VS Code, no nano, no mercy — only `vim`. Every admin has lived it. This quest makes vim a tool instead of a trap: the modes, the survival keys, and one real editing gauntlet on a scroll.

## 📖 Learn

#### The big idea: modes

vim is a *modal* editor. In **NORMAL** mode, keys are commands (move, delete, copy). Press `i` to enter **INSERT** mode and type like a regular editor; press `Esc` to return to NORMAL. Beginners suffer because they type commands while in INSERT — when lost, press `Esc` (twice, for confidence) and you're back on solid ground.

#### Minimum viable vim

```bash
vim scroll.txt
i        # INSERT mode — type freely
Esc      # back to NORMAL
:wq      # write (save) and quit
:q!      # quit WITHOUT saving (your panic button)
```
_Enough to never be trapped again_

#### The NORMAL-mode moves you'll use forever

- `dd` — delete the current line · `yy` — copy (yank) it · `p` — paste below
- `u` — undo · `Ctrl+r` — redo
- `gg` / `G` — jump to first / last line · `5G` — jump to line 5
- `/text` then Enter — search; `n` jumps to the next match
- `:%s/old/new/g` — replace `old` with `new` in the whole file

#### Do vimtutor. Seriously.

```bash
vimtutor    # ships with vim — a guided 15-minute lesson
# no vim yet?  sudo apt install -y vim   (Debian/Ubuntu)
```
_15 minutes that repay a year of suffering_

Lessons 1 and 2 of `vimtutor` cover everything this gauntlet needs. Type it by hand — that's the pact — and your fingers will remember when it matters.

> 💡 **Sensei says:** vim is on every Linux server built in the last 30 years. Being merely *comfortable* in it is a professional superpower that takes one afternoon to acquire.

## 🎯 Your Mission

1. Run `vimtutor` and complete at least lessons 1 and 2 (honor system — the pact is with yourself).

2. Open the provided scroll in vim: `vim scroll.txt`. Then, using only NORMAL-mode commands:

3. Delete line 5 (the one begging for it): `5G` then `dd`.

4. Copy line 2 and paste it at the very end: `2G`, `yy`, `G`, `p`.

5. Replace every lowercase word `line` with `step` in the whole file: `:%s/line/step/g`.

6. Save and quit with `:wq`, then create `answers.md`:

   ```bash
   insert_key=THE_KEY_THAT_ENTERS_INSERT_MODE
   save_quit=THE_COMMAND_THAT_SAVES_AND_QUITS
   quit_no_save=THE_PANIC_BUTTON_COMMAND
   undo_key=THE_UNDO_KEY
   ```

## ✅ What the checker looks for

- **`scroll.txt`** — edited exactly: line 5 gone, old line 2 duplicated at the end, every 'line' → 'step'
- **`answers.md`** — insert_key=i, save_quit=:wq, quit_no_save=:q!, undo_key=u

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Do the steps in the listed order and the result is deterministic — the checker compares the exact final scroll.
- Typed a wrong command? `u` undoes it. Truly lost? `:q!` and reopen the file (restore the original with `git restore scroll.txt` if needed).
- `:%s/line/step/g` is case-sensitive — capitalized words are untouched, which is exactly what you want here.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 10.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `9.5` · [🏠 Dojo map](../../../README.md) · Next: `10.2` ➡️
