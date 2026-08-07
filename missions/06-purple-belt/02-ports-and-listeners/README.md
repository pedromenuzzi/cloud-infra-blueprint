# Ports & Listeners

> _ss/netstat — who is listening, and should they be?_

**Belt 6 · Purple Belt** · Mission `6.2` · Lesson 2 · **100 XP** · ~25 min

---

Every network service sits on a *port* waiting for connections. Knowing what's listening — and spotting what *shouldn't* be — is core security hygiene. `ss` is the fast modern tool; a surprising open port is often the first sign of trouble.

## 📖 Learn

#### Listing listeners

```bash
ss -tlnp
#  -t tcp   -l listening only   -n numeric ports (don't resolve names)   -p process
ss -tulnp     # add -u for UDP too
ss -tan       # ALL tcp sockets (listening + established)
```
_ss -tlnp = 'what TCP services are up, and who owns them'_

#### Reading a listener line

```bash
LISTEN 0 128  0.0.0.0:22   0.0.0.0:*  users:(("sshd",pid=901,fd=3))
#              │      │                          └ the process
#              │      └ port 22
#              └ 0.0.0.0 = listening on ALL interfaces (world-reachable)
```
_Bind address is the security-critical part_

#### 0.0.0.0 vs 127.0.0.1 — the crucial difference

A service bound to **127.0.0.1** accepts connections *only from the same machine* — safe by design (databases, metrics endpoints should bind here). A service bound to **0.0.0.0** listens on every interface, reachable from the whole network. A database or cache on `0.0.0.0` is a classic exposure — that's how open Redis/Mongo instances get found and drained.

#### Well-known ports worth memorizing

- **22** SSH · **80** HTTP · **443** HTTPS · **53** DNS
- **5432** PostgreSQL · **3306** MySQL · **6379** Redis · **27017** MongoDB
- Ports 0–1023 are 'privileged' — only root can bind them.

> 💡 **Sensei says:** `ss` replaced `netstat`; if `ss` isn't there, `netstat -tlnp` gives the same picture. Both answer 'what is this box exposing?' — a question you'll ask on every server.

## 🎯 Your Mission

1. Capture your own listeners into `my-listeners.txt`:

   ```bash
   ss -tlnp > my-listeners.txt 2>/dev/null || netstat -tlnp > my-listeners.txt 2>/dev/null || echo "no listener tool available" > my-listeners.txt
   ```

2. A captured `sample/ss.txt` is provided. Analyze it and fill `answers.md`:

   ```bash
   ssh_port=THE_PORT_sshd_LISTENS_ON
   db_bind=THE_BIND_ADDRESS_OF_postgres     # is it local-only or exposed?
   exposed_risky=THE_PORT_OF_THE_CACHE_EXPOSED_ON_0.0.0.0   # redis is the danger
   https_process=THE_PROCESS_NAME_LISTENING_ON_443
   ```

## ✅ What the checker looks for

- **`my-listeners.txt`** — your real socket listing (or a graceful 'no tool' note)
- **`answers.md`** — ssh_port, db_bind, exposed_risky, https_process

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- postgres in the sample binds 127.0.0.1 — that's the safe, local-only address.
- redis (port 6379) is bound to 0.0.0.0 in the sample — that's the risky exposure.
- Port 443 is served by nginx in the sample.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 6.2
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `6.1` · [🏠 Dojo map](../../../README.md) · Next: `6.3` ➡️
