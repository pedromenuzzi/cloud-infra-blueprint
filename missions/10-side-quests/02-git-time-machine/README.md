# Git Time Machine

> _status, log, restore, branch, commit — git as a survival skill._

**Belt 10 · Side Quests** · Mission `10.2` · Lesson 2 · **100 XP** · ~35 min

---

This whole dojo lives in git — which means you've been carrying a time machine the entire journey. Today you learn to drive it: see what changed, resurrect a deleted file, branch safely, and write your first proper commit.

## 📖 Learn

#### Tell git who you are (once per machine)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
# commits are signed with this identity — git refuses to commit without it
```
_Skip this and your first commit will complain_

#### Reading the present and the past

```bash
git status                 # what changed since the last commit?
git status --short         # the compact view you'll grow to prefer
git log --oneline -10      # the last 10 commits, one line each
git diff                   # exactly WHAT changed, line by line
```
_The three commands you'll run 50 times a day_

#### The resurrection drill (why git is your safety net)

```bash
rm precious.txt             # oops. gone. no trash can, remember?
git status                  # git noticed: 'deleted: precious.txt'
git restore precious.txt    # ...and it's BACK. (older git: git checkout -- precious.txt)
```
_Deleted ≠ lost, as long as it was committed_

This is why the dojo told you from day one: *git is your time machine*. Anything committed can be resurrected. Anything **not** committed is one `rm` from oblivion — which is the whole argument for committing early and often.

#### Branches: parallel timelines

```bash
git branch                    # where am I?
git branch training/dojo      # create a new branch (timeline)
git switch training/dojo      # jump onto it (older git: git checkout)
git switch -                  # jump back
```
_Branches are free — use them for every experiment_

#### A commit worth reading

```bash
git add missions/10-side-quests/02-git-time-machine/git-notes.md
git commit -m "dojo: complete the git time machine side quest"
#            └ a good message: short prefix + what it does
```
_Stage, then commit with a message future-you will thank_

> 💡 **Sensei says:** Never commit secrets: private keys, `.env`, tokens. You proved this reflex at purple belt with `.gitignore` + `git check-ignore` — it applies to every repo you'll ever touch.

## 🎯 Your Mission

1. Make sure git knows you: `git config --global user.name` / `user.email` (set them if empty).

2. From the repo root, read the machine: `git status`, then `git log --oneline -5`.

3. THE DRILL — in this mission folder, delete `precious.txt` with `rm`, confirm it's gone with `ls`, then resurrect it:

   ```bash
   rm precious.txt
   ls
   git restore precious.txt    # or: git checkout -- precious.txt
   cat precious.txt             # back from the dead
   ```

4. Create a training branch (no need to switch): `git branch training/dojo`.

5. Write `git-notes.md` in this folder:

   ```bash
   restore_cmd=THE_COMMAND_THAT_RESURRECTED_THE_FILE   # one word is enough
   branch_created=training/dojo
   never_commit=WHAT_MUST_NEVER_ENTER_A_REPO   # think purple belt
   ```

6. Stage and commit it with a message that starts with `dojo:`:

   ```bash
   git add missions/10-side-quests/02-git-time-machine/git-notes.md
   git commit -m "dojo: complete the git time machine side quest"
   ```

## ✅ What the checker looks for

- **`precious.txt`** — present and intact (resurrected, not recreated by hand)
- **`a branch`** — `git branch --list 'training/*'` shows training/dojo
- **`a commit`** — `git log` contains a commit message starting with dojo:
- **`git-notes.md`** — restore_cmd, branch_created, never_commit

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- If `git commit` complains about identity, run the two `git config --global` lines first.
- `git restore` is the modern spelling; `git checkout -- <file>` does the same on older git. The checker accepts either word in restore_cmd.
- The commit can include other work too — the checker only looks for the `dojo:` message in your history.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 10.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `10.1` · [🏠 Dojo map](../../../README.md) · Next: `10.3` ➡️
