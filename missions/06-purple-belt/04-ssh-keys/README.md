# SSH & Keys

> _Generate a keypair, configure a host, never leak a secret._

**Belt 6 · Purple Belt** · Mission `6.4` · Lesson 4 · **100 XP** · ~30 min

---

SSH is how you reach every server you'll ever run. Passwords are the weak way in; **key pairs** are the professional way. Today you generate one, learn what must never leave your machine, and write an SSH config so `ssh dojo` just works.

## 📖 Learn

#### The keypair idea

You generate two linked files: a **private key** (`id_ed25519`) that stays on your machine forever, and a **public key** (`id_ed25519.pub`) you copy onto servers. The server challenges you; only the matching private key can answer. The private key is the crown jewel — leak it and anyone becomes you.

#### Generating a modern key

```bash
ssh-keygen -t ed25519 -C "you@dojo" -f ./lab_key
#           │              │            └ output file
#           │              └ a label/comment
#           └ ed25519: fast, tiny, modern (prefer over old RSA)
# creates lab_key (private) and lab_key.pub (public)
```
_ed25519 is today's default choice_

#### Permissions are enforced by SSH itself

```bash
chmod 700 ~/.ssh          # the directory: owner-only
chmod 600 ~/.ssh/id_ed25519   # private key: owner read/write only
chmod 644 ~/.ssh/id_ed25519.pub  # public key can be world-readable
```
_SSH REFUSES to use a private key others can read_

If your private key is group- or world-readable, `ssh` prints 'UNPROTECTED PRIVATE KEY FILE' and refuses to use it. That's a feature. **600** on the private key is not optional.

#### The ~/.ssh/config shortcut

```bash
Host dojo
    HostName 203.0.113.10
    User tux
    Port 2222
    IdentityFile ~/.ssh/lab_key
# now just: ssh dojo
```
_Name your servers once, connect by nickname forever_

#### Never commit a private key

Private keys, `.env` files, and credentials must never enter git. A `.gitignore` entry (`lab_key`, `*.pem`, `.env`) is your safety net. `git check-ignore lab_key` confirms a path is ignored *before* you accidentally stage it.

> 💡 **Sensei says:** Real workflow: `ssh-copy-id dojo` pushes your public key to a server's `authorized_keys` so you can log in key-only. The public key is meant to be shared; the private one, never.

## 🎯 Your Mission

1. Generate an ed25519 keypair in this folder, no passphrase for the lab (`-N ""`):

   ```bash
   ssh-keygen -t ed25519 -C "tux@dojo" -f ./lab_key -N ""
   ```

2. Lock the private key to 600:

   ```bash
   chmod 600 lab_key
   ```

3. Write an SSH config snippet `ssh_config_lab` defining a `Host dojo` with HostName `203.0.113.10`, Port `2222`, and `IdentityFile` pointing at your lab_key (see the learn block for the shape).

4. Create a `.gitignore` in this folder that ignores `lab_key` (the private key). Verify it's ignored:

   ```bash
   echo "lab_key" > .gitignore
   git check-ignore lab_key   # should print: lab_key
   ```

5. Record in `answers.md`:

   ```bash
   key_type=THE_ALGORITHM_YOU_USED       # ed25519
   never_commit=WHICH_KEY_MUST_NEVER_BE_SHARED   # 'private' (the word)
   ssh_dir_mode=THE_RECOMMENDED_MODE_FOR_~/.ssh   # 700
   ```

## ✅ What the checker looks for

- **`lab_key + lab_key.pub`** — a real ed25519 keypair; private key is 600
- **`ssh_config_lab`** — Host dojo with HostName/Port/IdentityFile
- **`.gitignore`** — ignores lab_key (git check-ignore confirms)
- **`answers.md`** — key_type, never_commit, ssh_dir_mode

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `-N ""` sets an empty passphrase so the lab key generates without prompting.
- The .pub file starts with `ssh-ed25519 ` — that's how the checker confirms the type.
- never_commit is the word `private`; ssh_dir_mode is `700`.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 6.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `6.3` · [🏠 Dojo map](../../../README.md) · Next: `6.5` ➡️
