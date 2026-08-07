# Masks and Defaults

> _umask — why new files are born 644._

**Belt 4 · Green Belt** · Mission `4.3` · Lesson 3 · **100 XP** · ~20 min

---

Ever wondered why every file you create starts at 644 and every directory at 755, without you asking? A quiet gatekeeper called `umask` decides. Understand it and you control the defaults instead of fighting them.

## 📖 Learn

#### The base and the mask

The system *wants* to create files as 666 (rw for all) and directories as 777. The `umask` then **subtracts** permission bits from that base. The common umask `022` removes write from group and other: 666 − 022 = **644** for files, 777 − 022 = **755** for directories. That's the default you've been seeing all along.

#### Seeing and setting it

```bash
umask            # show current mask (e.g. 0022)
umask -S         # show it symbolically (u=rwx,g=rx,o=rx)
umask 077        # new files → 600, new dirs → 700 (private-by-default)
umask 027        # new files → 640, new dirs → 750 (group-friendly, others out)
```
It's a *mask*, not a subtraction in the arithmetic sense — it clears bits. But for the everyday values (022, 027, 077) the 'base minus mask' mental model gives the right answer every time. `x` is never added to plain files regardless, which is why a new file under umask 022 is 644, not 755.

#### Scope and persistence

`umask` set in a shell affects only files created *afterward*, in *that* shell and its children. To make it permanent, add the `umask` line to your `~/.bashrc`. Servers often set `027` or `077` so freshly written files aren't world-readable by accident.

> 💡 **Sensei says:** umask changes the *future*, never the past. Files that already exist keep their modes — use chmod for those.

## 🎯 Your Mission

1. In your shell, set a private-by-default mask:

   ```bash
   umask 077
   ```

2. Create `private-note.txt` with a redirect (`echo "secret" > private-note.txt`) — under umask 077 it's born 600.

3. Now switch to a normal mask and create a public file:

   ```bash
   umask 022
   echo "public" > public-note.txt   # born 644
   ```

4. Create a directory `dropbox/` under umask 027 so it lands at 750:

   ```bash
   umask 027
   mkdir dropbox
   ```

5. Reason it out and record in `answers.md`:

   ```bash
   files_created_with_umask_027=THE_OCTAL_MODE_A_NEW_FILE_GETS   # (666 minus 027)
   ```

## ✅ What the checker looks for

- **`private-note.txt`** — mode 600 (created under umask 077)
- **`public-note.txt`** — mode 644 (created under umask 022)
- **`dropbox/`** — mode 750 (created under umask 027)
- **`answers.md`** — files_created_with_umask_027=…

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Set the umask, THEN create the file — order matters, umask only affects future creations.
- 666 − 027 = 640. That's the answer for the last key.
- If a file has the wrong mode, you set the umask after creating it — recreate it (or just chmod it to the target).

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 4.3
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `4.2` · [🏠 Dojo map](../../../README.md) · Next: `4.4` ➡️
