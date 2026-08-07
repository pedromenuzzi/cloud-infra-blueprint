# Speed Reader

> _cat, less, head, tail, wc — read files like a pro._

**Belt 1 · White Belt** · Mission `1.4` · Lesson 4 · **100 XP** · ~20 min

---

In Linux, *everything* wants to talk to you through text files: logs, configs, even the kernel. The expedition logbook in this folder is your training text. Learn to read big files without drowning in them.

## 📖 Learn

#### Four readers, four jobs

```bash
cat logbook.txt        # dump the whole file (fine for small files)
less logbook.txt       # PAGE through a big file (q to quit)
head -n 5 logbook.txt  # first 5 lines only
tail -n 5 logbook.txt  # last 5 lines only
```
#### Survival keys inside less

- `Space` / `b` — next / previous page
- `/text` then Enter — search forward for “text”; `n` jumps to the next match
- `g` / `G` — jump to the beginning / end
- `q` — quit (the key everyone forgets first)

#### Counting with wc

```bash
wc -l logbook.txt   # lines
wc -w logbook.txt   # words
wc -c logbook.txt   # bytes
```
`tail` has a famous superpower you will meet again in ops work: `tail -f file` *follows* a file live, printing new lines as they are written. It is how people watch logs in real time. (Ctrl+C stops it.)

> 💡 **Sensei says:** Rule of thumb: `cat` for small files, `less` for everything else. Piping a giant file to your terminal with cat is a rite of passage — once.

## 🎯 Your Mission

1. Save the first 5 lines of the logbook into `first5.txt`:

   ```bash
   head -n 5 logbook.txt > first5.txt
   ```

2. Save the last 5 lines into `last5.txt`:

   ```bash
   tail -n 5 logbook.txt > last5.txt
   ```

3. Open the logbook with `less`, search for the word `SIGNAL` (type `/SIGNAL` then Enter), and note the code that follows it. Quit with `q`.

4. Count the lines of the logbook with `wc -l`, then create `answers.md`:

   ```bash
   total_lines=NUMBER
   signal=THE_CODE_YOU_FOUND
   ```

## ✅ What the checker looks for

- **`first5.txt`** — exactly the first 5 lines of logbook.txt
- **`last5.txt`** — exactly the last 5 lines of logbook.txt
- **`answers.md`** — total_lines=… and signal=… filled in

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The signal code looks like `word-word-number`. Copy it exactly.
- `wc -l logbook.txt` prints the count and the filename; the number is what you want.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 1.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `1.3` · [🏠 Dojo map](../../../README.md) · Next: `1.5` ➡️
