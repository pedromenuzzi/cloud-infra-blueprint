# 🥋 BOSS — Log Forensics

> _300 requests. One suspect. Full pipeline forensics._

**Belt 3 · Orange Belt** · Mission `3.5` · 🥋 BOSS TRIAL · **250 XP** · ~40 min

---

A web server left you `access.log`: 300 requests of mixed traffic, and somewhere in there, someone probing for weaknesses. This is the orange-belt graduation: every tool from this belt, chained into real forensic conclusions.

## 📖 Learn

#### Boss briefing — the log format

```bash
IP - - [timestamp] "METHOD /path HTTP/1.1" STATUS BYTES
#^field 1                                  ^field 9 (space-delimited)
```
_Apache-style access log_

With space as delimiter: field 1 is the client IP, field 9 the status code. `cut -d' ' -f1` and the frequency idiom will carry you far. A `404` status means *not found* — a burst of 404s on juicy paths (`/admin`, `/.env`) is scanner behavior.

#### Useful moves

```bash
cut -d' ' -f1 access.log | sort | uniq -c | sort -nr | head -n 5   # top talkers
grep ' 404 ' access.log                                            # all 404s (spaces matter!)
cut -d' ' -f1 access.log | sort -u | wc -l                         # unique IPs
```
_Your forensic toolkit_

> 💡 **Sensei says:** Why ` 404 ` with spaces? Because `404` could appear inside a path or byte count. Anchoring with the surrounding spaces targets the status field. Precision is the difference between evidence and noise.

## 🎯 Your Mission

1. Create a `report/` directory for your findings.

2. Top 5 IPs by request count → `report/top-5-ips.txt` (frequency-table idiom, head -n 5).

3. Every 404 line → `report/status-404.txt`.

4. Write `report/findings.md`:

   ```bash
   total_requests=?
   unique_ips=?
   errors_404=?
   suspect_ip=?
   verdict=ONE_SENTENCE_ABOUT_WHAT_THE_SUSPECT_WAS_DOING
   ```

## ✅ What the checker looks for

- **`report/top-5-ips.txt`** — 5 lines, counts + IPs, biggest first
- **`report/status-404.txt`** — every 404 request line
- **`report/findings.md`** — all five keys, correct values

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- suspect_ip = the top talker — and look WHAT it requested: `grep 'THAT_IP' access.log | head -20`.
- unique_ips: `cut -d' ' -f1 access.log | sort -u | wc -l`.
- verdict is free text — say what you concluded (scanning? brute force?). Any non-empty sentence passes.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 3.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `3.4` · [🏠 Dojo map](../../../README.md) · Next: `4.1` ➡️
