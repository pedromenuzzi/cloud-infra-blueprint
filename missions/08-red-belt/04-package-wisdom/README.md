# Package Wisdom

> _apt, dnf, pacman — install software the right way, everywhere._

**Belt 8 · Red Belt** · Mission `8.4` · Lesson 4 · **100 XP** · ~25 min

---

Software doesn't come from random `curl | bash` incantations — it comes from package managers that track versions, dependencies, and files. Different distro families speak different dialects; a Craftsman knows the Rosetta Stone.

## 📖 Learn

#### The three big families

- **Debian/Ubuntu** → `apt` (packages are `.deb`)
- **RHEL/Fedora/Rocky** → `dnf` (older: `yum`; packages are `.rpm`)
- **Arch** → `pacman`

#### The same tasks, three dialects

```bash
# update the package index (do this first!)
apt update            dnf check-update       pacman -Sy
# install a package
apt install nginx     dnf install nginx      pacman -S nginx
# remove a package
apt remove nginx      dnf remove nginx       pacman -R nginx
# search
apt search nginx      dnf search nginx       pacman -Ss nginx
# what package owns this file?
dpkg -S /usr/bin/nginx   rpm -qf /usr/bin/nginx   pacman -Qo /usr/bin/nginx
```
_Learn the concepts; the commands are just translations_

#### update vs upgrade (the trap)

On Debian/Ubuntu, `apt update` only refreshes the *list* of available versions — it installs nothing. `apt upgrade` then actually installs the newer versions. Beginners run `update` and wonder why nothing upgraded. Always: `apt update && apt upgrade`.

#### remove vs purge

`apt remove pkg` deletes the program but *keeps* its config files (so a reinstall remembers your settings). `apt purge pkg` removes the program **and** its system-wide config. When you want it truly gone, purge.

#### Why not just download binaries?

Package managers verify signatures, resolve dependencies, let you cleanly uninstall, and receive security updates. A binary you `curl`ed into `/usr/local/bin` does none of that and becomes an untracked liability. Prefer the package manager; reach outside it only when you must, and document it.

> 💡 **Sensei says:** `apt-get` vs `apt`: `apt` is the friendlier modern front-end for interactive use; `apt-get` is the stable interface for scripts. Same underlying system.

## 🎯 Your Mission

1. Survey what package tooling exists on YOUR machine (any that are missing simply won't print — that's fine) into `tool-census.txt`:

   ```bash
   { echo "=== which package managers are present ==="
     for pm in apt apt-get dnf yum pacman zypper apk brew; do
         if command -v "$pm" >/dev/null 2>&1; then echo "present: $pm"; else echo "absent:  $pm"; fi
     done
   } > tool-census.txt
   ```

2. Fill the cross-distro Rosetta Stone in `answers.md`:

   ```bash
   debian_install=THE_COMMAND_WORD_TO_INSTALL_ON_DEBIAN    # apt (or apt-get)
   redhat_family=THE_PACKAGE_MANAGER_ON_FEDORA/RHEL         # dnf (yum also accepted)
   arch_pm=THE_PACKAGE_MANAGER_ON_ARCH                      # pacman
   q_update=WHICH_apt_SUBCOMMAND_REFRESHES_THE_INDEX?      # update or upgrade
   remove_config_too=THE_apt_SUBCOMMAND_THAT_ALSO_DELETES_CONFIG   # remove or purge
   ```

## ✅ What the checker looks for

- **`tool-census.txt`** — 3+ lines reporting present/absent package managers
- **`answers.md`** — five keys of cross-distro knowledge

<details>
<summary>💡 Stuck? Open for hints (try on your own first!)</summary>

- `command -v pm` is the portable 'is this installed?' test.
- q_update is `update` (refreshes the index; upgrade installs). remove_config_too is `purge`.
- redhat_family accepts dnf or yum; arch_pm is pacman.

</details>

## 🧪 Check your work

From the repository root, run:

```bash
./check 8.4
```

It tells you exactly which requirements pass and which need another pass. When it goes green, your progress and the game board update automatically.

---
⬅️ Previous: `8.3` · [🏠 Dojo map](../../../README.md) · Next: `8.5` ➡️
