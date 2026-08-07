# 🛠️ Setup — get a Linux shell in ~10 minutes

The dojo runs on a real Unix shell (Bash). Pick your situation below. Once you have a shell and this
repo cloned, run `./play` and start at mission **1.1**.

---

## Windows → WSL2 (recommended)

The premise of this dojo is a freshly-formatted PC with nothing installed yet. WSL2 (Windows Subsystem
for Linux, version 2) runs a **real Linux kernel** inside Windows, in a light, invisible VM. Ubuntu is
the distribution that runs on top of it. You install both with essentially one command.

### 1. Install WSL2 + Ubuntu

Open **PowerShell as Administrator** (Start menu → type "PowerShell" → right-click → *Run as
administrator*) and run:

```powershell
wsl --install
```

This installs WSL2 and Ubuntu (the default distro) in one shot. When it finishes it will ask you to
**restart** the PC. Do it.

### 2. First boot

After restart, Ubuntu opens on its own (or find "Ubuntu" in the Start menu). The first time, it asks
you to create your Linux user:

```
Enter new UNIX username:   ← pick a name (lowercase, no spaces, e.g. yourname)
New password:              ← invent a password (nothing shows as you type — that's normal)
Retype new password:       ← repeat
```

You land at a Linux prompt: `yourname@DESKTOP:~$`. You're inside Linux.

### 3. If something goes wrong

An error like `WslRegisterDistribution failed` or a "virtual machine platform" complaint almost always
means CPU virtualization is off:

1. Enable virtualization in BIOS/UEFI (reboot, enter BIOS — usually `Del` or `F2` — and turn on
   **Intel VT-x**, **AMD-V**, or **SVM Mode**).
2. Make sure Windows Update is current (Settings → Windows Update).
3. From PowerShell: `wsl --status` (shows version + default distro) and `wsl --update` (updates the
   engine). Then reboot once more — that fixes ~90% of fresh-PC cases.

### 4. Get the tools the dojo likes

Inside Ubuntu:

```bash
sudo apt update
sudo apt install -y git python3 vim tree htop
```

### WSL quality-of-life

- Your Windows drive is visible from Linux at **`/mnt/c`** (e.g. `ls /mnt/c/Users`).
- Your Linux files are visible from Windows Explorer at **`\\wsl$\Ubuntu`**.
- Restart the WSL engine any time with `wsl --shutdown` (from PowerShell).
- **Keep the repo inside the Linux home** (`~`), not under `/mnt/c` — it's much faster there.

---

## macOS

You already have a Unix shell. Just make sure you have the basics:

```bash
xcode-select --install     # git + developer command-line tools (if not already present)
```

Bash on macOS is the older 3.2 — the dojo's grader is written to work with it, so you're fine. If you'd
rather use a newer bash, `brew install bash`, but it's optional.

---

## Linux

You're home. Ensure `git`, `python3` and the usual coreutils are installed (they almost always are):

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y git python3 vim
# Fedora/RHEL
sudo dnf install -y git python3 vim
# Arch
sudo pacman -S --needed git python vim
```

---

## Then: get the dojo and start

```bash
# clone your private repo (SSH or HTTPS — your choice)
git clone <your-linux-dojo-repo-url> linux-dojo
cd linux-dojo

./play            # open the game board in your browser
./check           # grade everything (starts at a clean 0/45)
```

Click mission **1.1**, read the lesson, do it in your terminal, then `./check 1.1`. Welcome to the dojo. 🐧
