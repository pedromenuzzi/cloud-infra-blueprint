# Archive Alchemy

> _tar and gzip — bundle, compress, and unpack anything._

**Belt 8 · Red Belt** · Mission `8.1` · Lesson 1 · **100 XP** · ~25 min

---

Every release, backup, and log rotation on Earth passes through `tar`. Its flags confuse beginners for years — today you break that spell for good with one mnemonic and a lot of practice.

## 📖 Learn

#### The mnemonic that ends the confusion

```bash
tar -czf archive.tar.gz stuff/     # Create Zipped File
tar -tzf archive.tar.gz            # lisT Zipped File (peek inside, extract nothing)
tar -xzf archive.tar.gz            # eXtract Zipped File
```
_Create / lisT / eXtract — each with z (gzip) and f (file)_

Read the letters: **c**reate, **t** = lis**t**, e**x**tract. Add **z** for gzip compression and **f** to name the file (the `f` must come last, right before the filename). Nearly every tar you'll ever type is one of `czf`, `tzf`, `xzf`.

#### Controlling paths with -C

```bash
tar -czf logs.tar.gz -C /var/log .    # archive the CONTENTS of /var/log
tar -xzf logs.tar.gz -C /tmp/restore   # extract INTO a chosen directory
```
_-C = cd there first_

`-C` avoids ugly absolute paths inside archives and lets you extract wherever you want. Good archives contain *relative* paths (`shipment/manifest.txt`), not `/home/you/...` — so they unpack cleanly on any machine.

#### Verbose and inspection

```bash
tar -czvf a.tar.gz dir/    # v = verbose: print each file as it's added
tar -tzf a.tar.gz | wc -l  # how many entries in this archive?
file mystery.gz            # what IS this thing? (file inspects any file's type)
```
_v to watch it work; tzf to look before you leap_

#### gzip on its own

```bash
gzip big.log        # → big.log.gz  (replaces the original)
gunzip big.log.gz   # → big.log     (back again)
zcat big.log.gz     # read a .gz WITHOUT unpacking it
```
_gzip compresses single files; tar bundles many_

> 💡 **Sensei says:** Always `tar -tzf` an unknown archive before extracting. A malicious or sloppy archive can scatter files across your directory ('tar bomb'); listing first shows you exactly what — and where — it will write.

## 🎯 Your Mission

1. A `relics.tar.gz` archive is provided. FIRST list its contents (don't extract yet): `tar -tzf relics.tar.gz`.

2. Extract it, then combine the two scrolls' text into `scrolls.txt` — scroll-1's line then scroll-2's line:

   ```bash
   tar -xzf relics.tar.gz
   cat relics/scroll-1.txt relics/scroll-2.txt > scrolls.txt
   ```

3. Now go the other way: create a gzipped archive `shipment.tar.gz` of the provided `shipment/` directory. Make sure the paths inside are relative (contain `shipment/manifest.txt`).

   ```bash
   tar -czf shipment.tar.gz shipment
   ```

4. Record the flags in `answers.md`:

   ```bash
   list_flag=THE_SINGLE_LETTER_THAT_LISTS_AN_ARCHIVE
   extract_flag=THE_SINGLE_LETTER_THAT_EXTRACTS
   ```

## ✅ What the checker looks for

- **`scrolls.txt`** — two lines: 'wax on' then 'wax off'
- **`shipment.tar.gz`** — gzipped tar; `tar -tzf` shows shipment/manifest.txt
- **`answers.md`** — list_flag=t, extract_flag=x

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- list = t, extract = x, create = c. Each pairs with z (gzip) and f (file).
- Verify your new archive: `tar -tzf shipment.tar.gz` should list shipment/manifest.txt and friends.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 8.1
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `7.5` · [🏠 Dojo map](../../../README.md) · Next: `8.2` ➡️
