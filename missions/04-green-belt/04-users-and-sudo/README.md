# Users, Groups & Sudo

> _Who are you, who can you become, and how the system knows._

**Belt 4 · Green Belt** · Mission `4.4` · Lesson 4 · **100 XP** · ~25 min

---

Permissions mean nothing without identity. Today: how Linux stores users and groups in plain text files, what your identity actually *is*, and the careful art of borrowing root's power with `sudo`.

## 📖 Learn

#### Who am I, really

```bash
whoami        # just the username
id            # uid, gid, and ALL your groups — the full identity
groups        # the groups you belong to
id -u         # numeric user id only (root is always 0)
```
#### /etc/passwd — the user registry (7 colon-separated fields)

```bash
tux:x:1000:1000:Tux the Penguin:/home/tux:/bin/bash
│   │ │    │    │                │          └ login shell
│   │ │    │    │                └ home directory
│   │ │    │    └ comment / full name (GECOS)
│   │ │    └ primary group id (GID)
│   │ └ user id (UID)
│   └ password placeholder ('x' = it's in /etc/shadow)
└ username
```
_Despite the name, no passwords live here anymore_

UID 0 is root — absolute power. Regular humans usually start at 1000. A login shell of `/usr/sbin/nologin` or `/bin/false` marks a *service account* that isn't meant to log in (databases, daemons). `/etc/group` maps group names to GIDs and lists extra members.

#### sudo — borrow root for one command

```bash
sudo apt update           # run THIS command as root
sudo -u postgres psql     # run as a specific other user
sudo -l                   # list what you're allowed to run
sudo -i                   # start an interactive root shell (careful)
```
`sudo` beats logging in as root because it's *scoped* (one command), *audited* (every use is logged), and *revocable* (managed in `/etc/sudoers`, edited only via `visudo`). The rule of the craft: use the least power that gets the job done.

> 💡 **Sensei says:** This mission reads *sample* copies of passwd/group in `sample/` — you won't touch the real system files. But the format is identical to the real `/etc/passwd`.

## 🎯 Your Mission

1. Record your own identity: `id > my-id.txt` (must contain a `uid=` field).

2. Study `sample/passwd` and `sample/group`, then answer in `answers.md`:

   ```bash
   root_uid=THE_UID_OF_root
   tux_shell=THE_LOGIN_SHELL_OF_tux
   tux_home=THE_HOME_DIRECTORY_OF_tux
   ops_gid=THE_GID_OF_THE_ops_GROUP
   nologin_users=HOW_MANY_ACCOUNTS_USE_nologin_AS_SHELL
   passwd_field_count=HOW_MANY_COLON_SEPARATED_FIELDS_PER_LINE
   ```

## ✅ What the checker looks for

- **`my-id.txt`** — output of id, containing uid=
- **`answers.md`** — all six keys correct

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- Fields per line: count the colons and add one — `head -1 sample/passwd` then count.
- nologin users: `grep -c nologin sample/passwd`.
- ops group GID is the number in the `ops:` line of sample/group.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 4.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `4.3` · [🏠 Dojo map](../../../README.md) · Next: `4.5` ➡️
