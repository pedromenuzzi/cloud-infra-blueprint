# 🥋 BOSS — The Scavenger Hunt

> _Everything so far, in one hunt: navigate, reveal, read, count, write._

**Belt 1 · White Belt** · Mission `1.5` · 🥋 BOSS TRIAL · **250 XP** · ~25 min

---

Your first trial, Hatchling. A village, a forest, and three shards hidden in the shadows. No new commands here — only proof that the old ones obey you. Defeat this and the white belt is yours.

## 📖 Learn

#### Boss briefing

Inside `hunt/` are exactly **three hidden shard files** (`.shard-1`, `.shard-2`, `.shard-3`), each containing one word. Together, in order, they form a three-word passphrase. There is also a `wall-of-text.txt` whose line count guards the answer to one question.

#### Your arsenal

```bash
ls -aR hunt          # sweep everything, hidden files included
cat hunt/path/.shard-1
wc -l hunt/wall-of-text.txt
mkdir, echo >, >>      # you know these now
```
> 💡 **Sensei says:** When you need one file to contain several words on one line, remember that echo prints exactly what you give it: `echo "a b c" > file`.

## 🎯 Your Mission

1. Find all three shards inside `hunt/` and read each one.

2. Create a directory `trophy-room/` in this mission folder.

3. Write the three shard words, in shard order, as ONE line separated by single spaces, into `trophy-room/passphrase.txt`. (Three words, one space between each.)

4. Count the lines of `hunt/wall-of-text.txt` and create `answers.md`:

   ```bash
   lines=NUMBER
   shards_found=3
   ```

## ✅ What the checker looks for

- **`trophy-room/passphrase.txt`** — the three shard words in order, one line
- **`answers.md`** — lines=… and shards_found=3

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `ls -aR hunt` shows every hidden file at once — the shards' paths included.
- Shard order is the number in the file name, not the order you find them in.
- Passphrase format: `word1 word2 word3` — no commas, no extra spaces.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 1.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `1.4` · [🏠 Dojo map](../../../README.md) · Next: `2.1` ➡️
