# Azure Migration — Design

**Date:** 2026-11-17
**Owner / approver:** Mat (data-location approver; Azure subscription owner and billing contact)
**Hard deadline:** 2026-12-15 (Tailscale access ends)
**Status:** written 2026-11-17 after builder check; awaiting Mat's approval of this document

---

## 1. Why

Today the experiment tracker (React 18 + FastAPI + PostgreSQL) runs on one Windows lab PC at HQ, and the team reaches it over Tailscale. Tailscale access ends on **2026-12-15**, and keeping it would cost an extra $200/month. After that date nobody outside the lab could reach the app. Mat approved moving production to a secure cloud host (2026-11-12) and chose **Azure** (2026-11-17).

The auth work this move depended on is already in production: the approved-claim check and password removal (#170), and the public-endpoint lockdown (`next-ids` now requires auth; `/docs`, `/redoc` and `/openapi.json` are served only with `ENABLE_API_DOCS=true`). Firebase Authentication stays the login system.

## 2. What success looks like

In Mat's words, the failure to avoid on the first morning is **"data missing or it doesn't load."** Concretely:

- Every row in the lab PC production database is present in Azure, checked by per-table row counts compared before and after the final copy.
- The app loads at `https://data.addisenergy.com` and existing users sign in with their current Firebase passwords, without being asked to re-register.
- Uploads, exports, the dashboard and the reporting views all work as they do today.

## 3. Goals, non-goals, anti-goals

**Goals**
- Production runs on Azure before 2026-12-15, with time to spare.
- Deploys are automated from `main` and no longer depend on the lab PC.
- Sample photos get durable cloud storage before anyone uploads them.
- Daily automated database backups, plus a copy kept outside Azure.

**Non-goals (December)**
- No changes to features or the UI.
- No replacement of Firebase Auth with Entra sign-in.
- No device or IP restriction. This is deferred. Likely route: Entra in front of the app plus Conditional Access, if the M365 plan includes Entra ID P1.
- No move of local development off the dev machines; dev stays as it is.
- No Power BI work of any kind (no gateway, connector, refresh or access for it). Addis is retiring Power BI (Mat, 2026-11-12 and 2026-11-17). The `v_*` views still migrate because the app itself reads them.

**Anti-goals (a failure even if it technically "works")**
- Any data missing after the switch, or a switch that can't be undone quickly.
- Secrets committed to the repo or pasted into docs. Today's `backup.ps1` hard-codes the DB superuser password; nothing like that carries over.
- The database reachable from the open internet without a firewall rule.
- Uploaded photos stored on the App Service's local disk, where a restart or redeploy can lose them.

## 4. Constraints

- **Deadline:** 2026-12-15. Switch on **Thursday 2026-12-03 (morning)**; backup date **Thursday 2026-12-10 (morning)**. Mat chose Thursday morning for the data-entry freeze.
- **Owner:** Mat creates a new **Pay-As-You-Go** Azure subscription with their Addis work account, in the existing Microsoft Entra directory. No subscription exists today (checked 2026-11-17). Applying to Microsoft for Startups (Founders Hub) for credits runs in parallel and must not block anything.
- **Domain:** `data.addisenergy.com`. DNS for addisenergy.com is hosted at GoDaddy and managed by a colleague, who adds the records (a CNAME plus an `asuid` TXT verification record).
- **Region:** a US region (default East US; builder may pick East US 2 if capacity or price is better).
- **Locked components** (`docs/LOCKED_COMPONENTS.md`): models, alembic history, bulk-upload parsers, enums and Firebase auth must not change except where this design explicitly requires it. The photo storage change touches `backend/api/routers/samples.py` and settings only, not the models.
- **No new packages without approval.** The Azure Blob SDK (`azure-storage-blob`, and likely `azure-identity`) is a new dependency, and Mat approves it through this document.
- **Project docs that must change.** `.claude/CLAUDE.md` ("Single always-on lab PC, LAN only, no cloud") and `docs/ENVIRONMENT.md` say no cloud. Mat's approval of this design authorizes updating both to describe the Azure deployment.

## 5. What is decided

### 5.1 Azure resources (one resource group)

| Resource | Purpose | Notes |
|---|---|---|
| App Service (Linux, Python 3.13) | Runs FastAPI, which also serves `frontend/dist` | Basic B1 or B2 tier; Always On enabled so the first morning load is fast |
| Azure Database for PostgreSQL Flexible Server | Production DB | Burstable tier; automated backups with 7–35-day retention; public access with a firewall that allows only Azure services, admin IPs, the HQ IP (lab PC backups, §5.6), researchers granted access on request (§5.7) and the deploy runner during a job (§6); TLS required |
| Storage account (Blob) | Sample photos (private container) | Not publicly readable |
| Key Vault, or App Service settings | Secrets (DB URL, Firebase service account) | Never in the repo |

Rough cost: $50–100/month (to be priced in the plan).

### 5.2 Data move

- `pg_dump -Fc` from the lab PC, then `pg_restore --no-owner --no-acl` into Flexible Server as the app's role. This matches the existing restore practice in `docs/` and memory.
- Recreate the app DB role by hand (roles aren't in a per-database dump). The app role must own the `v_*` reporting views and the sequences, because the app drops and recreates the views on import (`database/event_listeners.py`) and calls `setval` on startup (`reset_postgres_sequences`).
- Allow-list `uuid-ossp` and `pg_trgm` (`azure.extensions`) if the dump references them.
- Verification is a script that prints per-table row counts plus `alembic current`, run against both sides, with the output diffed.

### 5.3 Photos

- No photo files exist yet. Mat will upload them after the switch, so no file migration is needed.
- Before the switch, uploads go to Blob Storage instead of the local filesystem, and deletes remove the blob. `sample_photos.file_path` stores the blob name. There is no schema change: the column stays text.

### 5.4 Deploys

- A GitHub Actions workflow on push to `main`:
  1. builds the frontend (with `VITE_FIREBASE_*` supplied from GitHub secrets, since they are baked in at build time)
  2. installs Python deps
  3. runs `alembic upgrade head` against Azure
  4. deploys to App Service
- This replaces `update.ps1`, NSSM and the Task Scheduler jobs. `/deploy` keeps its meaning (develop → main); the push to `main` now triggers the Azure deploy.
- Startup command: uvicorn on `$PORT` (App Service supplies it), not the lab PC's hard-coded 8000.

### 5.5 Config on Azure

- Env vars: `DATABASE_URL`, `FIREBASE_*` (backend service account), `CORS_ORIGINS=https://data.addisenergy.com`, plus the Blob settings.
- `ENABLE_API_DOCS` is **not** set.
- Firebase Auth authorized domains: add `data.addisenergy.com` and the `*.azurewebsites.net` hostname.

### 5.6 Backups

- Flexible Server automated backups (point-in-time restore).
- In addition, the **lab PC keeps running backups after the switch** (Mat, 2026-11-17). It stays at HQ, powered on. Its scheduled `backup.ps1` is repointed from the local Postgres to Azure, still writing to `C:\Backups\experiments` and the SharePoint-synced `03_Backups` folder. That keeps a copy Addis can reach if the Azure subscription has problems. Required changes:
  - Read the DB password from an environment variable or a local secret file that is not in the repo, instead of hard-coding it.
  - Connect as a read-only backup role, not the superuser.
  - Use `sslmode=require`.
  - The Postgres firewall allows the HQ public IP. *My call:* if HQ's IP turns out to be dynamic, the builder flags it during the rehearsal and we pick another route.
  - Backup frequency stays nightly, as today. Nightly costs nothing extra over weekly.
  - Only the lab PC's **app service and update task** retire, not the machine.

### 5.7 Direct database access for researchers

Team members can get direct Postgres access **on request** (Mat, 2026-11-17). It isn't on by default.

- **My call:** access is **read-only**, with **one login per person**, not a shared one. That way it can be revoked per person and the logs show who connected. Each login is a member of a `reporting_reader` group role with `SELECT` on tables and views and default privileges for future tables. The restore uses `--no-acl`, so the role and its grants are created after the restore, by a committed script.
- Granting access is a committed, documented runbook that Mat (or an admin) runs. It does three things:
  1. creates the login
  2. adds a firewall rule named after the person for their current IP
  3. hands over the connection string, which has `sslmode=require`
- Revoking access drops the login and the rule.
- Home IPs change, so a rule may need updating. The runbook covers that. If it becomes a burden, the follow-up is the deferred Entra work (Entra-authenticated Postgres logins or a private network). That isn't in December.
- `docs/PSQL_ACCESS.md` is rewritten for Azure. Nobody has a login on switch day unless they asked for one beforehand. Announce this with the switch so it doesn't read as a regression.

### 5.8 Schedule

| When | What |
|---|---|
| Week of 2026-11-23 | Mat creates the subscription. Build the Blob photo change, GitHub deploy workflow, provisioning steps and verification script. |
| Week of 2026-11-30 | **Rehearsal:** provision Azure, restore a copy of prod (no freeze), time it, diff counts, team smoke-tests at the `azurewebsites.net` address. |
| By 2026-12-02 | Colleague adds the GoDaddy DNS records; managed certificate issued for `data.addisenergy.com`. |
| **Thu 2026-12-03, morning** | **Switch:** freeze data entry → final dump → restore → diff counts → sign-in check → announce the new address. Lab PC stays up as a read-only fallback. |
| Thu 2026-12-10 | Backup switch date if 12-03 slips. |
| By 2026-12-15 | Lab PC app retired: ExperimentTracker service and nightly update task disabled, local DB superuser password rotated (it's hard-coded in `backup.ps1` today). The backup task stays, now pointed at Azure (§5.6). |

### 5.9 Rollback

Until the team has used Azure for a working day without problems, the lab PC database stays untouched. The rollback is to point people back at the lab PC address over Tailscale, which still works until 12-15. Any data entered on Azure in the meantime would have to be re-entered. Keeping the "untouched" window to a day or two keeps that small.

## 6. Left to the builder (my calls; Mat can override)

- App Service and Postgres tiers within the cost range above. The deciding factors are first-load speed and backup retention.
- Key Vault references versus plain App Service settings for secrets.
- How the GitHub Action authenticates to Azure (OIDC federated credential preferred over a stored publish profile).
- **Decided (my call):** `alembic upgrade head` runs in the workflow, so a failed migration blocks the deploy. The workflow adds a Postgres firewall rule for the runner's IP at the start of the job and removes it in an always-run step at the end. No standing rule for GitHub IPs.
- **Decided (my call):** provision PostgreSQL **18** if it is GA on Flexible Server, otherwise **17**. The rehearsal must prove that the lab PC's PG 18 dump restores cleanly into the chosen version. If the custom-format restore fails across versions, fall back to a plain-SQL dump.
- The exact read-only mechanism for the lab PC fallback (e.g. stop the service and run it with a read-only DB role, or just tell people not to write).
- Infrastructure as az CLI scripts or Bicep. Either is fine if it's committed and re-runnable.
- Whether to also gitignore `sample_photos/` on the lab PC branch as a stopgap. Low priority: Mat has no photos there.
