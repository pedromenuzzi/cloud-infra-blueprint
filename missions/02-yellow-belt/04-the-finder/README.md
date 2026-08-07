# The Finder

> _find — interrogate the whole tree with predicates._

**Belt 2 · Yellow Belt** · Mission `2.4` · Lesson 4 · **100 XP** · ~25 min

---

Globs reach one directory at a time. `find` walks the entire tree and answers questions: *what*, *where*, *how big*, *what type*. It is the bloodhound of Linux — point it somewhere and describe the scent.

## 📖 Learn

#### Anatomy of a find command

```bash
find WHERE  TESTS...
find warehouse -name "*.conf"      # by name (quote the pattern!)
find warehouse -iname "*DRAGON*"   # case-insensitive name
find warehouse -type d              # only directories
find warehouse -type f -size +50k   # files bigger than 50 KB
find warehouse -empty               # empty files/dirs
find warehouse -maxdepth 1          # don't descend below one level
```
Quoting the pattern (`"*.conf"`) matters: unquoted, the *shell* might expand the glob against the current directory before find ever runs. Quoted, the pattern reaches find intact, and find applies it at every depth.

#### Combining tests

```bash
find warehouse -type f -name "*.conf"        # AND (just list tests)
find warehouse -name "*.log" -o -name "*.md"  # OR
find warehouse ! -name "*.txt"                # NOT
```
#### Sizes

- `-size +50k` — bigger than 50 KB (`M` for MB, `G` for GB)
- `-size -10k` — smaller than 10 KB
- `+`/`-` mean over/under; no sign means “exactly” (rarely useful)

find also matches hidden files without asking — `-name "*.conf"` happily returns `.secret.conf`. The dot is only special to globs and plain ls, not to find.

> 💡 **Sensei says:** Later (brown belt) you will bolt actions onto find with `-exec`. For now, redirecting its output into a file *is* the action.

## 🎯 Your Mission

1. Save every `.conf` file's path (there are hidden ones — find sees them):

   ```bash
   find warehouse -name "*.conf" > conf-files.txt
   ```

2. Save every path whose name contains `dragon`, any capitalization:

   ```bash
   find warehouse -iname "*dragon*" > dragons.txt
   ```

3. Save every file bigger than 50 KB:

   ```bash
   find warehouse -type f -size +50k > big-ones.txt
   ```

4. Find the one completely empty file in the warehouse (`-type f -empty`) and record it in `answers.md`:

   ```bash
   empty_file=NAME_OF_THE_EMPTY_FILE
   ```

## ✅ What the checker looks for

- **`conf-files.txt`** — 4 paths (one is hidden)
- **`dragons.txt`** — 3 paths
- **`big-ones.txt`** — exactly 1 path
- **`answers.md`** — empty_file=… (just the file name)

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `wc -l conf-files.txt` tells you if you caught all 4.
- `empty_file` wants only the name, like `something.dat` — not the full path.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 2.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `2.3` · [🏠 Dojo map](../../../README.md) · Next: `2.5` ➡️
