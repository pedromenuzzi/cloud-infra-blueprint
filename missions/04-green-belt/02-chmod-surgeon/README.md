# Chmod Surgeon

> _Set permissions with precision — octal and symbolic._

**Belt 4 · Green Belt** · Mission `4.2` · Lesson 2 · **100 XP** · ~25 min

---

Reading locks was 4.1. Now you cut new ones. `chmod` speaks two dialects — octal (absolute) and symbolic (relative) — and a real Gatekeeper is fluent in both, because each wins in different moments.

## 📖 Learn

#### Octal mode — set everything at once

```bash
chmod 600 vault.txt      # rw-------  (private)
chmod 644 notes.txt      # rw-r--r--  (normal file)
chmod 755 script.sh      # rwxr-xr-x  (runnable)
chmod 770 group-zone/    # rwxrwx---  (owner+group full, others out)
```
#### Symbolic mode — adjust relative to what's there

```bash
chmod +x script.sh       # add execute for everyone
chmod u+x script.sh      # add execute for USER only
chmod g-w file           # remove write from GROUP
chmod o= file            # set OTHER to nothing
chmod u=rw,g=r,o= file   # spell each class out (= 640)
```
_u=user g=group o=other a=all  •  + add  - remove  = set exactly_

Use **octal** when you know the final state you want ('make it 600'). Use **symbolic** when you want a delta without disturbing the rest ('just add execute'). `chmod +x deploy.sh` is the most-typed chmod on Earth — it makes a script runnable without touching read bits.

#### Making a script executable, then running it

```bash
chmod +x runme.sh
./runme.sh          # the ./ says 'run the file right here'
```
_Why ./ ? Because '.' isn't on your PATH — a security default_

#### Recursive, carefully

```bash
chmod -R 755 dir/          # every file AND dir under it
chmod -R u+X dir/          # capital X = x only where it makes sense (dirs, already-exec files)
```
_-R descends; capital X is the smart-execute trick_

> 💡 **Sensei says:** `chmod -R 755` on a tree makes *data files* executable too, which is sloppy. Capital `X` adds execute only to directories and files that already had some execute bit — exactly what you usually mean.

## 🎯 Your Mission

1. Set `vault.txt` to `600` (owner read/write only).

2. Set `bulletin.txt` to `644` (owner writes, everyone reads).

3. Make `runme.sh` executable at `755`, then run it with `./runme.sh` — it should print a success line.

4. Set the directory `group-zone/` to `770`.

5. Verify with `ls -l` and `ls -ld group-zone`. The checker parses the exact modes.

## ✅ What the checker looks for

- **`vault.txt`** — mode 600
- **`bulletin.txt`** — mode 644
- **`runme.sh`** — mode 755 and runs
- **`group-zone/`** — mode 770

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `ls -ld group-zone` shows a directory's own mode (without -d it lists the contents).
- If `./runme.sh` says 'Permission denied', the execute bit isn't set — recheck the 755.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 4.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `4.1` · [🏠 Dojo map](../../../README.md) · Next: `4.3` ➡️
