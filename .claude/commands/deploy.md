---
description: Merge develop into origin/main; main then deploys to Azure nightly. Run after /complete-task has merged the working branch into develop.
allowed-tools: Bash
---

You are executing a production deployment merge. Follow every step in order. Stop and report to the user at any failure point — do not attempt to recover automatically.

## Step 0 — Pending-migration pre-flight check

Before merging any branch whose migration can refuse to apply (e.g. a
duplicate-data guard), confirm the required data cleanup has already been run
against production. The Azure deploy workflow runs `alembic upgrade head` on
every deploy and fails on a non-zero exit. If a pending migration's
pre-flight raises (e.g. a `RuntimeError` refusing to add a constraint while
duplicate rows remain), the nightly deploy fails every night until the
cleanup is applied. If this deploy includes such a migration, tell the user
before continuing and confirm the cleanup script has been run first. Pending
data-fix/cleanup scripts run against Azure per
`docs/deployment/AZURE_RUNBOOK.md` R4 (App Service SSH console).

> Until the switch (2026-12-03) production is still the lab PC: run cleanup
> scripts there, and `update.ps1` Step 5 runs the migration. This note is
> retired 2026-12 (after the Azure switch).

## Step 1 — Pre-flight checks

Run these three checks in sequence. Stop if any fails.

```bash
git branch --show-current
```
If the result is not `develop`, run `git checkout develop` and confirm before continuing.

```bash
git status
```
If the output is not "nothing to commit, working tree clean", stop and tell the user what is dirty. Ask whether to stash or commit before continuing.

```bash
git fetch origin
git rev-list --count origin/develop..develop
```
If the result is not `0`, run `git push origin develop` before continuing.

## Step 2 — Check for divergence between develop and origin/main

```bash
git fetch origin main
git rev-list --left-right --count develop...origin/main
```

The output is two numbers: `<ahead> <behind>`.

- `N 0` — normal, continue to Step 3
- `0 0` — branches are identical, tell the user "Nothing to deploy — develop and main are already in sync" and stop
- `0 N` — main is ahead of develop, which violates the workflow rules. Stop. Report the divergence and wait for explicit user instruction before touching anything
- `N M` (both non-zero) — branches have diverged. Stop. Run `git merge-base develop origin/main` and report the divergence point and affected commits to the user. Wait for explicit instruction

## Step 3 — Merge develop into main

```bash
git checkout main
git pull origin main
git merge develop --no-edit
```

If `git merge` exits with a conflict:

1. Run `git merge --abort` immediately
2. Report which files have conflicts: `git diff --name-only --diff-filter=U`
3. Report what each side introduced: `git log --oneline develop ^main` and `git log --oneline main ^develop`
4. Ask the user: "There are merge conflicts in the files listed above. Would you like me to walk through each conflict, or will you resolve them manually?"
5. Wait for explicit instruction before taking any further git action

## Step 4 — Push to origin/main

```bash
git push origin main
```

If the push is rejected:

1. Do NOT run `git push --force` or `git push --force-with-lease` under any circumstances
2. Run `git fetch origin main && git log --oneline HEAD..origin/main` to show the user what is on the remote that is not local
3. Report: "Push was rejected — origin/main has commits not present locally. Force-pushing main is prohibited. Here is what is on the remote:" followed by the log output
4. Wait for explicit user instruction

## Step 5 — Return to develop and confirm

```bash
git checkout develop
git log --oneline -5
```

Report the last 5 commits so the user can confirm the expected work is included.

## Step 6 — Deployment reminder

Tell the user:

> **origin/main is updated.**
>
> origin/main deploys to Azure nightly at 02:00 Eastern, or immediately by
> running the **Deploy to Azure** workflow manually (GitHub Actions, Run workflow).
>
> To verify: check the run with `gh run list --workflow "Deploy to Azure" --limit 3`
> (or the Actions tab), then open `https://data.addisenergy.com/health`.
> Rollback and troubleshooting: `docs/deployment/AZURE_RUNBOOK.md` R3.
>
> **Until the switch (2026-12-03)** the lab PC is still production: right-click
> `update.ps1` and choose **Run with PowerShell**, then check
> `Get-Content "C:\Logs\experiment-tracker\updates.log" -Tail 20`; restart with
> `nssm restart ExperimentTracker` if needed. Retired 2026-12 (after the Azure
> switch).
