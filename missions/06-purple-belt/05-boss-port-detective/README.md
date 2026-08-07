# 🥋 BOSS — The Port Detective

> _A backdoor is phoning home. Map the network crime scene._

**Belt 6 · Purple Belt** · Mission `6.5` · 🥋 BOSS TRIAL · **250 XP** · ~45 min

---

The blue team flagged strange outbound traffic. You've got a casefile: socket dumps, the routing table, DNS settings, the hosts file, and a captured HTTP exchange. Somewhere in there is a backdoor and a hijacked domain. Read the network, name the crime.

## 📖 Learn

#### Boss briefing — the casefile

- `casefile/ss-dump.txt` — every socket: listeners and established connections
- `casefile/route-dump.txt` — the routing table (`default via` = the gateway)
- `casefile/resolv.conf` — which DNS server the box uses (`nameserver …`)
- `casefile/hosts` — static name→IP overrides (a favorite attacker trick)
- `casefile/curl-verbose.txt` — a captured HTTP request/response

#### What to look for

- A listener on a weird high port (like **31337** — hacker humor for 'eleet') owned by a tool like `nc` = a **backdoor**.
- An **ESTABLISHED** connection from that tool to an external IP = it's phoning home right now.
- An extra line in `hosts` pointing a real domain at an attacker IP = **DNS hijack** via the hosts file.
- The HTTP capture's status line tells you what the server answered (e.g. a 302 redirect).

#### Tools you own

```bash
grep -i listen casefile/ss-dump.txt
grep default casefile/route-dump.txt      # the gateway
grep nameserver casefile/resolv.conf      # the DNS server
tail -n +1 casefile/hosts                 # read the whole hosts file
```
_Small greps, one fact each_

> 💡 **Sensei says:** The hosts file is checked *before* DNS. One malicious line there silently redirects `update-server.io` to an attacker box — so the victim downloads 'updates' from the wrong place. Reading `hosts` is a 10-second check with huge payoff.

## 🎯 Your Mission

1. Prove loopback works on your own machine and save the evidence:

   ```bash
   ping -c 1 127.0.0.1 | grep -i 'packets transmitted' > loopback-proof.txt
   ```

2. Investigate every file in `casefile/` and write `netreport.md` with exactly these keys:

   ```bash
   backdoor_port=THE_SUSPICIOUS_HIGH_PORT_LISTENING
   backdoor_tool=THE_PROGRAM_HOLDING_THAT_PORT      # one word
   gateway=THE_default_via_IP_FROM_THE_ROUTE_TABLE
   dns_server=THE_nameserver_IP
   hijacked_domain=THE_DOMAIN_MAPPED_TO_A_STRANGE_IP_IN_hosts
   redirect_status=THE_HTTP_STATUS_CODE_IN_THE_curl_CAPTURE
   ```

## ✅ What the checker looks for

- **`loopback-proof.txt`** — a real ping summary line for 127.0.0.1
- **`netreport.md`** — all six keys, correct values

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- The backdoor port is the odd high one in ss-dump with `nc` next to it.
- gateway comes from the `default via X.X.X.X` line; dns_server from `nameserver` in resolv.conf.
- hijacked_domain is the domain on the suspicious third line of the hosts file.
- redirect_status is the number on the `HTTP/1.1 ...` line of curl-verbose.txt.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 6.5
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `6.4` · [🏠 Dojo map](../../../README.md) · Next: `7.1` ➡️
