# The Pipeline

> _stdin, stdout, and the | that changed computing._

**Belt 3 · Orange Belt** · Mission `3.1` · Lesson 1 · **100 XP** · ~25 min

---

This is the single most important idea in Unix: every program reads from an input stream and writes to an output stream, and the `|` glues one program's output to the next program's input. Master this, and you stop using commands — you start composing them.

## 📖 Learn

#### The three streams

- **stdin** (0) — what a program reads
- **stdout** (1) — its normal output (what `>` redirects)
- **stderr** (2) — its error channel, kept separate on purpose (`2>` redirects it)

#### The pipe

```bash
sort words.txt | uniq | wc -l
#  └─ sorted lines ─┘   └ count them
#            └─ duplicates collapsed
```
_Output of one = input of the next_

Each tool does ONE thing: `sort` orders lines, `uniq` collapses *adjacent* duplicates, `wc -l` counts. None of them knows the others exist. The pipeline is the program — that's the Unix philosophy in one line.

#### Why uniq needs sort

`uniq` only removes duplicates that sit next to each other. Unsorted input leaves duplicates scattered and uncollapsed — the classic beginner surprise. `sort | uniq` is practically one word. Bonus: `sort -u` does both.

#### The frequency-table idiom (memorize this one)

```bash
sort words.txt | uniq -c | sort -nr | head
# uniq -c  → prefix each line with its count
# sort -nr → numeric sort, reversed (biggest first)
# head     → top 10
```
_Top-N of anything_

> 💡 **Sensei says:** You will use `sort | uniq -c | sort -nr` on IPs, error messages, file extensions, user agents… It is the swiss-army knife of quick analytics.

## 🎯 Your Mission

1. Create `sorted.txt` — the words file, sorted:

   ```bash
   sort words.txt > sorted.txt
   ```

2. Count how many DIFFERENT words exist and save the number into `unique-count.txt`:

   ```bash
   sort words.txt | uniq | wc -l > unique-count.txt
   ```

3. Build the frequency table, look at the top, and write the most frequent word (just the word) into `top-word.txt`:

   ```bash
   sort words.txt | uniq -c | sort -nr | head -n 3
   echo "THE_WINNER" > top-word.txt
   ```

4. Create `answers.md` with how many times that winner appears:

   ```bash
   most_common_count=NUMBER
   ```

## ✅ What the checker looks for

- **`sorted.txt`** — words.txt in sorted order
- **`unique-count.txt`** — one number — distinct word count
- **`top-word.txt`** — the single most frequent word
- **`answers.md`** — most_common_count=…

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The frequency table's first line is `COUNT WORD` — both of your answers live right there.
- 23 different words hide in that file. If your unique count disagrees, check you sorted first.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 3.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `2.5` · [🏠 Dojo map](../../../README.md) · Next: `3.2` ➡️
