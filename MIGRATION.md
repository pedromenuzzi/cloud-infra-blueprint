# 📦 Moving Linux Dojo into its own private repository

You asked for a brand-new, **100% private** repo that only you touch. This document gets you there in
about two minutes.

## Why this step is needed

The automated build environment can push branches, but it is **not permitted to create new GitHub
repositories** on your account (the integration returns `403 Resource not accessible by integration`).
So the complete, finished project was delivered as a clean, from-scratch history on this branch:

- **Repo:** `pedromenuzzi/cloud-infra-blueprint`
- **Branch:** `claude/linux-learning-game-h3q7nw`

That branch is an **orphan branch** — it shares *no history* with anything else in that repo. Its very
first commit is the root of the Linux Dojo. That means you can lift it into a dedicated repo cleanly,
with none of the old project's history tagging along.

Pick **one** of the two paths below.

---

## Path A — with the GitHub CLI (`gh`), the fast way

```bash
# 1) Grab just this branch into a fresh local folder
git clone --single-branch --branch claude/linux-learning-game-h3q7nw \
  https://github.com/pedromenuzzi/cloud-infra-blueprint.git linux-dojo
cd linux-dojo

# 2) Make its history start clean on 'main' (drops the branch name, keeps all files)
git checkout --orphan main
git add -A
git commit -m "Linux Dojo — initial import"

# 3) Create the new PRIVATE repo and push to it in one shot
gh repo create linux-dojo --private --source=. --remote=origin --push

# done — your new private repo is live:
gh repo view --web
```

`gh repo create … --source=. --push` creates `pedromenuzzi/linux-dojo` as **private** and pushes `main`
to it. Nobody but you can see it.

---

## Path B — with the GitHub website + git

1. Go to **https://github.com/new** and create a repository:
   - **Name:** `linux-dojo`
   - **Visibility:** **Private** ✅
   - Do **not** add a README, .gitignore, or license (this project already has them).

2. Then, in your terminal:

```bash
# Grab just this branch
git clone --single-branch --branch claude/linux-learning-game-h3q7nw \
  https://github.com/pedromenuzzi/cloud-infra-blueprint.git linux-dojo
cd linux-dojo

# Start a clean 'main' history (keeps every file, drops the long branch name)
git checkout --orphan main
git add -A
git commit -m "Linux Dojo — initial import"

# Point at your new private repo and push
git remote set-url origin https://github.com/pedromenuzzi/linux-dojo.git
git push -u origin main
```

---

## After migrating

```bash
cd linux-dojo
./play            # open the board
./check           # confirm a clean 0/45 to start
bash tools/selftest.sh   # optional: prove the whole thing is beatable (45/45)
```

Everything is self-contained, so it works immediately in the new repo — no setup, no dependencies.

## Prefer to keep it exactly where it is?

You don't have to migrate at all. The project is fully functional on the
`claude/linux-learning-game-h3q7nw` branch as delivered. Migrating just gives it a clean home and a
short `main` branch name. If `cloud-infra-blueprint` is already private, only you can see the branch
regardless.

---

_Once migrated, you can safely delete the `claude/linux-learning-game-h3q7nw` branch from
`cloud-infra-blueprint` if you want to tidy up._
