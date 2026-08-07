# Grep Detective

> _Find needles in log haystacks._

**Belt 3 · Orange Belt** · Mission `3.2` · Lesson 2 · **100 XP** · ~25 min

---

Someone has been hammering this server's SSH door all afternoon. The evidence is in `auth.log`. `grep` is the tool every Linux professional reaches for first — today you make it a reflex.

## 📖 Learn

#### grep fundamentals

```bash
grep "Failed password" auth.log     # lines containing the text
grep -i "failed" auth.log           # case-insensitive
grep -c "Failed password" auth.log  # just COUNT matching lines
grep -n "root" auth.log             # show line numbers
grep -v "Accepted" auth.log         # INVERT: lines NOT matching
grep -r "pattern" some-dir/         # search a whole directory tree
```
#### A taste of regular expressions

```bash
grep -E "Failed|Accepted" auth.log   # OR
grep "^Mar" auth.log                 # ^ anchors to line start
grep "ssh2$" auth.log                # $ anchors to line end
grep -E "40[0-9]{3}" auth.log        # digit classes and repetition
```
_-E enables the richer 'extended' syntax_

Always quote your pattern. Unquoted, the shell may mangle spaces, `$`, `*` before grep sees them. Quoting is not optional style — it is correctness.

#### Detective workflow

Real log analysis is grep chained with the orange-belt tools you already know: `grep "Failed" auth.log | wc -l` counts, `grep ... | head` samples. Filter first, then count, then narrow again. Each pipe is one deductive step.

> 💡 **Sensei says:** Beware of decoys: this log contains lines like `Invalid user admin from …` that are NOT `Failed password` lines. Detectives match precisely.

## 🎯 Your Mission

1. Extract every failed login attempt:

   ```bash
   grep "Failed password" auth.log > failed.txt
   ```

2. From those, extract the attempts against the `root` account:

   ```bash
   grep "Failed password for root" auth.log > root-attempts.txt
   ```

3. Investigate: which IP appears most among failed attempts? (Eyeball it, or sneak-preview next mission: `grep "Failed password" auth.log | grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | sort | uniq -c | sort -nr`.)

4. File your findings in `answers.md`:

   ```bash
   failed_count=NUMBER
   attacker_ip=THE_MOST_FREQUENT_FAILING_IP
   accepted_count=HOW_MANY_SUCCESSFUL_LOGINS
   ```

## ✅ What the checker looks for

- **`failed.txt`** — all Failed password lines, nothing else
- **`root-attempts.txt`** — only the root-targeting subset
- **`answers.md`** — failed_count, attacker_ip, accepted_count

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `grep -c` gives you failed_count and accepted_count without wc.
- The attacker tried the `admin` account from one IP a suspicious number of times.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 3.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `3.1` · [🏠 Dojo map](../../../README.md) · Next: `3.3` ➡️
