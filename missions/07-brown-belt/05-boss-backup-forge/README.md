# 🥋 BOSS — The Backup Forge

> _Build a real, argument-driven backup tool with retention._

**Belt 7 · Brown Belt** · Mission `7.5` · 🥋 BOSS TRIAL · **250 XP** · ~50 min

---

Time to forge a tool you'd actually keep. A backup script: it takes arguments, validates them like an adult, compresses a directory with a timestamped name, and prunes old backups so the disk never fills. This is the graduation of the Script Smith.

## 📖 Learn

#### Boss briefing — the spec

- `./backup.sh --help` → print usage, exit 0.
- `./backup.sh` with NO arguments → usage on stderr, exit 1.
- `./backup.sh <dir>` where <dir> doesn't exist → error on stderr, exit 2.
- `./backup.sh <dir>` (valid) → create `backups/<basename>-<timestamp>.tar.gz`, print a `created …` line, exit 0.
- Retention: keep only the **3 newest** archives in `backups/`, delete older ones.

#### The compression command

```bash
tar -czf backups/name-20260101-120000.tar.gz -C parent basename
#      │││                                        └ -C: cd there first, then archive 'basename'
#      ││└ f: output file
#      │└ z: gzip compress
#      └ c: create
```
_tar czf — create gzipped archive_

#### A safe timestamp

```bash
ts=$(date +%Y%m%d-%H%M%S)      # 20260101-120000 — sortable, no spaces
```
_Sortable timestamps make retention trivial_

#### Retention with ls

```bash
ls -1t backups/*.tar.gz 2>/dev/null | tail -n +4 | while read -r old; do
    rm -f "$old"
done
# ls -1t = newest first; tail -n +4 = everything from the 4th onward (the old ones)
```
_Keep 3: delete from the 4th-newest down_

#### Recommended header

```bash
#!/usr/bin/env bash
set -euo pipefail
# -e exit on error, -u error on unset var, -o pipefail catch errors mid-pipe
```
_The professional safety header_

> 💡 **Sensei says:** Build incrementally: get `--help` working, then no-args, then the missing-dir case, then the happy path, and retention last. Test each branch before adding the next — that's how real tools get written.

## 🎯 Your Mission

1. Write `backup.sh` meeting every point in the spec above. Handle `--help`, no-args (stderr+exit 1), missing dir (stderr+exit 2), and the happy path (create timestamped tar.gz in `backups/`, print `created <path>`, exit 0).

2. Implement retention: after creating a backup, keep only the 3 newest `.tar.gz` files in `backups/`.

3. Test it yourself against a sample directory:

   ```bash
   chmod +x backup.sh
   mkdir -p sample-data && echo hi > sample-data/a.txt
   ./backup.sh --help; echo "rc=$?"
   ./backup.sh; echo "rc=$?"            # expect rc=1
   ./backup.sh /no/such/dir; echo "rc=$?"  # expect rc=2
   ./backup.sh sample-data; echo "rc=$?"   # expect rc=0 + a created line
   ls backups/
   ```

4. The checker will run your script several times to confirm retention keeps exactly 3 archives. Make sure the archive is a valid tar.gz containing your source files (`tar -tzf backups/....tar.gz`).

## ✅ What the checker looks for

- **`backup.sh`** — executable; all four behaviors with correct exit codes
- **`backups/*.tar.gz`** — valid gzipped tar containing the backed-up files
- **`retention`** — never more than 3 archives kept

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- For --help, check `[ "$1" = "--help" ]` BEFORE the no-args check (well, no-args means $# -eq 0).
- Validate: `[ $# -eq 0 ]` → exit 1; `[ ! -d "$1" ]` → exit 2.
- Verify an archive: `tar -tzf backups/<file>.tar.gz` should list your source files.
- Retention counts only .tar.gz in backups/. Run backup.sh 4+ times and confirm `ls backups | wc -l` stays 3.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 7.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `7.4` · [🏠 Dojo map](../../../README.md) · Next: `8.1` ➡️
