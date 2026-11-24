# Azure Migration — Design

**Date:** 2026-11-17 (revised the same day after an external review)
**Owner / approver:** Mat (data-location approver; Azure subscription owner and billing contact)
**Hard deadline:** 2026-12-15 (Tailscale access ends)
**Status:** approved by Mat 2026-11-17. As-built record added 2026-11-24 (§7); where §7 differs from §4–§6, §7 is what exists.

---

## 1. Why

Today the experiment tracker (React 18 + FastAPI + PostgreSQL) runs on one Windows lab PC at HQ, and the team reaches it over Tailscale. Tailscale access ends on **2026-12-15**, and keeping it would cost an extra $200/month. After that date nobody outside the lab could reach the app. Mat approved moving production to a secure cloud host (2026-11-12) and chose **Azure** (2026-11-17).

The auth work this move depended on is in production and its rollout is complete:
- **#170:** the approved-claim check and password removal. Mat confirmed on 2026-11-12 that the `labpc@` password was rotated, self sign-up was disabled in Firebase, the stored passwords were purged and the smoke test passed. The checklist in `docs/working/issue-log.md` has been ticked to match.
- **The public-endpoint lockdown:**
  - `next-ids` now requires auth.
  - `/docs`, `/redoc` and `/openapi.json` are served only with `ENABLE_API_DOCS=true`.

Firebase Authentication stays the login system.

## 2. What success looks like

In Mat's words, the failure to avoid on the first morning is **"data missing or it doesn't load."** Concretely:

- Every row in the lab PC production database is present in Azure, checked by per-table row counts compared before and after the final copy.
- **Dates are unchanged:** a row uploaded after the switch stores and displays the same calendar date it would on the lab PC (§5.2).
- The app loads at `https://data.addisenergy.com` and existing users sign in with their current Firebase passwords, without being asked to re-register.
- Uploads, exports, the dashboard and every `v_*` view work as they do today.

## 3. Goals, non-goals, anti-goals

**Goals**
- Production runs on Azure before 2026-12-15, with time to spare.
- Deploys are automated from `main` and no longer depend on the lab PC.
- All sample photos (the 227 existing ones and new uploads) live in durable cloud storage, ready for a later display feature.
- Daily automated database backups plus a nightly copy outside Azure, with alerts when any of it silently stops.
- No single-person dependency for owning the cloud account.

**Non-goals (December)**
- No changes to features or the UI.
- No replacement of Firebase Auth with Entra sign-in.
- No device or IP restriction on the *app*. This is deferred. Likely route: Entra in front of the app plus Conditional Access, if the M365 plan includes Entra ID P1.
- No move of local development off the dev machines; dev stays as it is.
- No Power BI work of any kind (no gateway, connector, refresh or access for it). Addis is retiring Power BI (Mat, 2026-11-12 and 2026-11-17). The `v_*` views still migrate because the app itself reads them.
- **No photo display in this project.** Today the Photos tab lists only file names (`frontend/src/pages/SampleDetail/PhotosTab.tsx:56-60`) and no endpoint returns image contents. Mat plans photo display on the samples dashboard and sample detail pages as a **separate follow-up feature** after the switch. This design only has to leave the photos in Blob, named so that feature can serve them (§5.3).
- **No move of existing result and analysis files** (§5.3). Photos do move.

**Anti-goals (a failure even if it technically "works")**
- Any data missing or shifted (for example dates a day early) after the switch, or a switch that can't be undone quickly.
- Secrets committed to the repo or pasted into docs. Today's `backup.ps1` hard-codes the DB superuser password; nothing like that carries over.
- The database reachable by anything other than the specific IPs listed in §5.1, with no blanket "Allow Azure services" rule.
- Uploaded photos stored on the App Service's local disk, where a restart or redeploy can lose them.
- A backup, deploy or app outage that nobody hears about.

## 4. Constraints

- **Deadline:** 2026-12-15. Switch on **Thursday 2026-12-03 (morning)**; backup date **Thursday 2026-12-10 (morning)**. Mat chose Thursday morning for the data-entry freeze.
- **Owner:** Mat creates a new **Pay-As-You-Go** Azure subscription with their Addis work account, in the existing Microsoft Entra directory. No subscription exists today (checked 2026-11-17). Applying to Microsoft for Startups (Founders Hub) for credits runs in parallel and must not block anything.
- **Second owner:** Michael Alexander is added as an Owner of the subscription (Mat, 2026-11-17), before the rehearsal. Alerts (§5.10) go to both owners.
- **Domain:** `data.addisenergy.com`. DNS for addisenergy.com is hosted at GoDaddy and managed by a colleague, who adds the records (a CNAME plus an `asuid` TXT verification record). The colleague also checks for **CAA records**: App Service's free certificate comes from DigiCert, so a CAA record that doesn't allow DigiCert blocks it.
- **GitHub repo moves to an Addis organization** (Mat, 2026-11-17), **before the deploy workflow is set up**, because the GitHub-to-Azure sign-in (OIDC) is tied to the repo path. **Done 2026-11-23:** now `Addis-Energy/experiment-tracking-sandbox` (Free organization plan). The Team plan ($4/user/month) is only needed for branch protection or deployment environments on a private repo.
  - Steps: create a free GitHub organization for Addis, with Mat and a second admin; transfer the repo; update `origin` on the dev machines and the lab PC. GitHub redirects the old URL, but don't rely on that.
  - Re-check what the transfer can drop: the CI workflow (`frontend-checks.yml`), branch protection and secrets.
  - The deploy workflow and its secrets are created only in the new location.
- **Region:** **East US 2** (as built). East US was the first choice, but Azure refused PostgreSQL Flexible Server there ("subscription not allowed to provision in East US"), a capacity restriction on new subscriptions. Every resource sits in East US 2 so the app and database share a region.
- **Locked components** (`docs/LOCKED_COMPONENTS.md`): models, alembic history, bulk-upload parsers, enums and Firebase auth must not change. The timezone fix (§5.2) is settings only for that reason. The photo storage change touches `backend/api/routers/samples.py` and settings only, not the models.
- **Packages:**
  - `azure-storage-blob` is already listed in `requirements.txt:80`, unpinned and unused. It gets pinned.
  - `azure-identity` is the one new package, and is pinned too.
  - Mat approves both through this document.
- **Docs that describe the lab PC deploy and must be updated** (Mat's approval of this design authorizes it):
  - `.claude/CLAUDE.md` and `.claude/commands/deploy.md`
  - `README.md`
  - `docs/STACK.md`, `docs/ENVIRONMENT.md`, `docs/GIT_WORKFLOW.md` and `docs/DIRECTORY_STRUCTURE.md`
  - `docs/PSQL_ACCESS.md`
  - `docs/deployment/PRODUCTION_DEPLOYMENT.md` and `docs/deployment/STARTUP_GUIDE.md`
  - `docs/user_guide/ONBOARDING.md` and `docs/user_guide/USER_MANUAL.md` (these carry the URL people follow)
  - `docs/POWERBI_MODEL.md` is marked retired, not updated.

## 5. What is decided

### 5.1 Azure resources (one resource group)

| Resource | Purpose | Notes |
|---|---|---|
| App Service (Linux, Python 3.13) | Runs FastAPI, which also serves `frontend/dist` | Basic tier (Basic has stable outbound IPs; Premium v4 does not, so don't move there without a private endpoint). Always On. HTTPS only, minimum TLS 1.2, FTP and SCM basic-auth publishing off (GitHub deploys via OIDC). |
| Azure Database for PostgreSQL Flexible Server, **PostgreSQL 18** | Production DB | PG 18 matches the lab PC's version, so the dump restores like-for-like. Confirm it is offered at provisioning; the reviewer reports it has been GA since 2025-12. See §5.6 for backups and §5.2 for the timezone. |
| Storage account (Blob) | New sample photos (private container) | Not publicly readable |
| Key Vault, or App Service settings | Secrets (DB URL, Firebase service account) | Never in the repo |
| Azure Monitor alerts, budget | §5.10 | |

**Postgres firewall** (public access, TLS required). It allows only:
- the App Service's outbound IPs (`possibleOutboundIpAddresses`)
- admin IPs
- the HQ IP, for lab PC backups (§5.6)
- researchers granted access on request (§5.7)
- the deploy runner, only while a job runs (§5.4)

There is **no "Allow Azure services" rule**: it admits every Azure customer's resources. (Power BI, the one consumer that would have needed it, is retired.)

**As built:** the server's networking mode is *public access (allowed IP addresses) plus private endpoints*. That mode can only be set at creation. No private endpoint exists yet; the firewall rules above are the only way in. Sign-in accepts both PostgreSQL passwords and Microsoft Entra (Entra admin: Mat). Every role in §5.2 uses a password.

HQ is in a shared building (Hatch.Bio). If its internet connection is shared across tenants, the HQ rule admits the whole building. The builder confirms this with Mat during the rehearsal, and a login plus password stays the real barrier either way.

**Sizing.** The app's SQLAlchemy engine uses the default pool, which allows up to 15 connections per process (`database/database.py:22`). Burstable B1ms allows about 35 user connections. Two decisions follow:
- **Pin the app to one worker process.** That matches the lab PC today, which runs one uvicorn process (`setup.ps1:195`). Each extra process also rebuilds every view at startup.
- **Use Burstable B2s** (far higher connection limit), so CI, backups and researchers fit alongside the app with headroom. If the server is scaled up later, `max_connections` must be raised by hand; it keeps its original value.

Rough cost: about $66/month list as built (§7): Postgres about $53, App Service about $12.41, plus small storage and monitoring charges. The budget alert is set at about $120/month.

### 5.2 Data move, roles and timezone

**Timezone (must be set before any data lands).**
- **The problem:** Azure Postgres defaults to UTC, and the code relies on the server running US Eastern.
  - The locked upload parsers write naive datetimes (`backend/services/bulk_uploads/new_experiments.py:883`, `experiment_status.py:334`, `scalar_results.py:34-44`, `master_bulk_upload.py:343-358`). Postgres reads them in the server's zone.
  - Downstream code assumes an Eastern offset: `backend/services/result_entry_service.py:99-106`, lab-local dates in `backend/api/routers/experiments.py:113`, exports, day counts, and frontend pages that read the ISO date directly.
  - On UTC, a sheet dated Dec 3 is stored as Dec 2 at 7 pm Eastern and shows a day early.
- **The fix is settings only:**
  - Set the server parameter `timezone = America/New_York`.
  - Set the App Service setting `TZ=America/New_York`, which covers `datetime.now()` calls such as `database/lineage_utils.py:511`.
- **Verification:**
  - Run `SHOW timezone;` on the lab PC to confirm today's value. The dev copy of prod reports `America/New_York`.
  - The rehearsal uploads a one-row sheet on both sides and compares the stored timestamp and the displayed date.

**Roles and ownership.** These steps follow from how the app manages views and from PostgreSQL 15+ rules.
- Create an **app role** (e.g. `experiments_app`) and create the database with it as owner: `CREATE DATABASE experiments OWNER experiments_app`. Since PG 15 only the owner can create in `public` by default, and the Azure admin is not a true superuser.
- Restore with `pg_restore --no-owner --no-acl` **as the app role**, so it owns every table, sequence and view.
- **Everything that can import `database` connects as the app role.** That covers the app, the CI migration step and admin scripts, because `database/event_listeners.py:99-104,1180-1197` drops and recreates every `v_*` view on import, including from `alembic/env.py:11`. The Azure admin can't drop views the app role owns, and vice versa.
- **Grants survive view rebuilds only through default privileges set by the app role.**
  - Every start recreates the views, which wipes direct grants on them.
  - The researcher group role `reporting_reader` (§5.7) therefore gets `ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public GRANT SELECT ON TABLES` and `... ON SEQUENCES`, plus a one-time grant on existing objects after the restore.
  - **As built:** the backup login `lab_backup` (§5.6) is a *member* of `reporting_reader` rather than holding its own grants, so pg_dump's sequence reads come through the group. Researchers can therefore read sequence values too, which is harmless.
  - Both login roles that write or dump data (`experiments_app`, `lab_backup`) also carry `ALTER ROLE ... SET timezone = 'America/New_York'` on top of the server parameter.
  - `docs/PSQL_ACCESS.md:563` omits `FOR ROLE` and is corrected.
- Allow-list `uuid-ossp` and `pg_trgm` (`azure.extensions`) if the dump references them.

**Verification script** (committed; run against both sides, output diffed):
- per-table row counts
- `alembic current`
- **every expected `v_*` view exists and is selectable**, checked after the first app start. View rebuild failures are only logged (`event_listeners.py:1196-1197`), so a missing view would otherwise go unnoticed.
- `SHOW timezone`

### 5.3 Photos and attached files

- **New photos:** uploads go to Blob Storage and deletes remove the blob. `sample_photos.file_path` stores the blob name. There is no schema change: the column stays text.
- **Storage backend is chosen by config:** local disk (the default; used in dev and tests, so neither needs Azure) or Blob (production).
- **What exists today.** The dev copy of prod (2026-10-26) has 227 `sample_photos`, 363 `result_files` and 3 `analysis_files` rows. Almost all point to `C:\Users\LabPC\Addis Energy\All Company - Addis Energy\07_Software\addis_energy_research\...`, a SharePoint-synced folder from the old Streamlit app, so the files themselves are safe in SharePoint. One photo row points to a path in Mat's own OneDrive. The plan records the prod counts at the rehearsal.
- **Existing photos move to Blob** (Mat, 2026-11-17). A committed, re-runnable script handles them:
  1. For each `sample_photos` row, read the file from the SharePoint-synced folder on the lab PC (or any machine with that folder synced).
  2. Upload it under the same blob naming as new uploads (`<sample_id>/<stem>_<uuid8><ext>`).
  3. Rewrite `file_path` to the blob name.
  4. Report every row whose source file is missing, and never delete a row.

  The script runs at the rehearsal (counts only, against the scratch copy) and again right after the final restore on switch day, and the verification script checks that every photo row resolves to an existing blob. The source files stay in SharePoint as an untouched backup.
- **Blob naming for the display feature:** the blob name is the only reference the app keeps, so Mat's later display feature can serve a photo either by streaming it through an authenticated endpoint or by issuing a short-lived read link. *My call:* the container stays private either way.
- **Existing result and analysis files stay where they are** (*my call*; Mat asked only about photos). The 366 rows keep pointing at SharePoint, and the app never reads them, so nothing breaks. Deleting such a row on Azure removes only the row. They can move to Blob later with the same script pattern if a feature needs them.

### 5.4 Deploys

- A GitHub Actions workflow builds the frontend (with `VITE_FIREBASE_*` from GitHub secrets, since they are baked in at build time), installs Python deps, runs migrations and deploys to App Service.
- **When it runs (my call):** on a nightly schedule (02:00 Eastern, as today) plus a manual "run now" button. It does not run on every push to `main`. Basic tier has no staging slot, so a deploy restarts the app; nightly keeps that out of working hours. `/deploy` keeps its meaning (develop → main).
- **Concurrency:** one deploy at a time (a workflow `concurrency` group, no cancel-in-progress), so two runs never migrate at once.
- **Migrations** run in the workflow as the app role (§5.2), so a failed migration blocks the deploy. The workflow adds a firewall rule for the runner's IP at the start and removes it in an always-run step.
- **Startup command:** `python -m uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1`.
- **Data-fix scripts against prod** (the Azure equivalent of "run the cleanup on the lab PC first" in `.claude/commands/deploy.md`): run them from the App Service SSH console, which already has the code and the settings, as the app role. `/deploy`'s Step 0 is rewritten to say so.

### 5.5 Config on Azure

- Env vars:
  - `DATABASE_URL` (app role, `sslmode=require`)
  - `FIREBASE_*` (backend service account)
  - `CORS_ORIGINS=https://data.addisenergy.com`
  - `TZ=America/New_York`
  - the photo storage backend and Blob settings
- `ENABLE_API_DOCS` is **not** set.
- Firebase Auth authorized domains: add `data.addisenergy.com` and the app's exact default hostname. "Secure unique default hostname" is on, so that is `addisenergy-lab-<random>.eastus2-01.azurewebsites.net`, not `addisenergy-lab.azurewebsites.net` (§7).

### 5.6 Backups

- **Azure:** Flexible Server automated backups with **35-day retention** (the default is 7). **Geo-redundant backup: off** (Mat, at creation 2026-11-24). It can only be chosen at server creation, so this is permanent for this server. The nightly lab PC dump to SharePoint is the copy outside the region. The original call here was "on".
- **Outside Azure:** the **lab PC keeps running backups after the switch** (Mat, 2026-11-17). It stays at HQ, powered on, and runs nightly as today. Its scheduled `backup.ps1` is repointed to Azure, still writing to `C:\Backups\experiments` and the SharePoint-synced `03_Backups` folder.
  - It reads its password from a local secret outside the repo.
  - It connects as the read-only backup role `lab_backup`.
  - It uses `sslmode=require` and a PG 18 `pg_dump`.
  - It runs as a dedicated local account, or one whose password isn't rotated, because the scheduled task stops silently when its account's password changes.
  - The Postgres firewall allows the HQ IP. If HQ's IP turns out to be dynamic, the builder flags it during the rehearsal.
- **Only the lab PC's app service and update task retire**, not the machine.
- **Both restore paths are tested once before 12-03:** an Azure point-in-time restore to a scratch server, and a lab PC dump restored into a scratch database.

### 5.7 Direct database access for researchers

Team members can get direct Postgres access **on request** (Mat, 2026-11-17). It isn't on by default.

- **My call:** access is **read-only**, with **one login per person**, not a shared one. That way it can be revoked per person and the logs show who connected. Each login is a member of a `reporting_reader` group role whose read access comes from default privileges (§5.2), so it survives view rebuilds and new tables.
- Granting access is a committed, documented runbook that Mat (or the second owner) runs. It does three things:
  1. creates the login
  2. adds a firewall rule named after the person for their current IP
  3. hands over the connection string, which has `sslmode=require`
- Revoking access drops the login and the rule. Home IPs change, so the runbook covers updating a rule.
- `docs/PSQL_ACCESS.md` is rewritten for Azure. Nobody has a login on switch day unless they asked for one beforehand. Announce this with the switch.

### 5.8 Schedule

| When | What |
|---|---|
| Week of 2026-11-23 | Mat creates the subscription and adds Michael Alexander as owner. The repo moves to the Addis GitHub organization. Colleague checks CAA. Build: timezone settings, roles script, verification script, photo storage backend, photo migration script, deploy workflow, provisioning scripts, alerts. |
| Week of 2026-11-30 | **Rehearsal:** provision Azure, restore a copy of prod (no freeze), time it, diff counts and views, migrate the 227 photos to Blob and confirm every row resolves, check the timezone round-trip, test both restore paths, test the lab PC backup against Azure, team smoke-tests at the `azurewebsites.net` address. |
| By 2026-12-02 | Colleague adds the GoDaddy DNS records; managed certificate issued for `data.addisenergy.com`. |
| **Thu 2026-12-03, morning** | **Switch:** freeze data entry → final dump → restore → photo migration script → verification script → sign-in check → announce the new address (and how to request DB access). Lab PC stays up as a fallback (§5.9). |
| Thu 2026-12-10 | Backup switch date if 12-03 slips. |
| By 2026-12-15 | Lab PC app retired: ExperimentTracker service and nightly update task disabled, local DB superuser password rotated (it's hard-coded in `backup.ps1` today). The backup task stays, now pointed at Azure (§5.6). |

### 5.9 Rollback

Until the team has used Azure for a working day without problems, the lab PC database stays untouched and its service stays installed. To roll back:
1. Dump from Azure **on the lab PC**, which has PG 18 tools and is allowed through the firewall.
2. Restore over the lab PC database, which carries any data entered on Azure back with it.
3. Point people back at the lab PC address over Tailscale, which still works until 12-15.

No data needs re-entering. The rehearsal runs this once.

### 5.10 Alerts

Each alert emails Mat and the second owner.
- **Backups:** an alert if no fresh lab PC dump has appeared in about 36 hours. `backup.ps1` only writes FAILED to a log, the same pattern that once left `update.ps1` ten days stale. *My call:* the lab PC posts a heartbeat after each successful dump, and an alert fires if it goes quiet.
- **The app:** an availability alert on the App Service.
- **Cost:** a monthly budget alert on the Pay-As-You-Go subscription.

## 6. Left to the builder (my calls; Mat can override)

- Exact tiers within the constraints above (Basic App Service, Burstable B2s or larger).
- Key Vault references versus plain App Service settings for secrets.
- OIDC federated credential for GitHub → Azure (no stored publish profile), set up after Mat's repo-location decision.
- The mechanism for the backup heartbeat (Azure Monitor custom check, a healthcheck service or similar).
- Infrastructure as az CLI scripts or Bicep. Either is fine if it's committed and re-runnable.

## 7. As built (2026-11-24)

Mat created the core resources by hand in the Azure portal. This section records what exists. It never records passwords, connection strings, subscription or object IDs, or IP addresses. `scripts/azure/provision.sh` converges the rest against these names (`azure.env.example` carries them); see the runbook R1.0.

**Subscription and region.** Pay-As-You-Go subscription "Azure subscription 1", resource group `DataApplication`, region **East US 2** (§4).

**PostgreSQL Flexible Server `addisenergy-db`** (`addisenergy-db.postgres.database.azure.com`)

| Setting | Value | Note |
|---|---|---|
| Version | PostgreSQL 18 (server 18.6) | matches the lab PC |
| Compute | Burstable Standard_B2s (2 vCores, 4 GiB) | about 414 user connections; one uvicorn worker (§5.1) |
| Storage | 32 GiB Premium SSD (P4), autogrow on | about $53/month list in total |
| High availability | off | |
| Backups | 35-day retention; geo-redundant **off** (permanent); immutable off | §5.6 |
| Authentication | PostgreSQL and Microsoft Entra | password admin `addisadmin`; Entra admin Mat |
| Networking | public access (allowed IPs) plus private endpoints (permanent mode); "Allow public access from any Azure service" **off** | one firewall rule so far, for the machine that created the server |
| Server parameters | `timezone = America/New_York`; `azure.extensions` includes `pg_trgm`, `uuid-ossp` | |

The portal wizard defaulted to General Purpose D4ds_v5 with HA and Premium SSD v2, about $549/month. Premium SSD v2 hides the Burstable tier, so storage had to be switched to Premium SSD first.

**Database and roles** (created by hand with the SQL now in `scripts/azure/roles.sql` and `grants.sql`):
- Database `experiments`, owner `experiments_app`.
- `experiments_app`: LOGIN; owns the database and everything restored or migrated; time zone `America/New_York`. It is used by the app's `DATABASE_URL`, the deploy workflow's migration step and `pg_restore`.
- `reporting_reader`: NOLOGIN group; CONNECT on `experiments`, USAGE on `public`; default privileges from `experiments_app` for SELECT on tables and sequences (confirmed in `pg_default_acl`).
- `lab_backup`: LOGIN, a member of `reporting_reader`, time zone set. Used by the lab PC's `backup.ps1`.
- `addisadmin` is a member of `experiments_app`, which PG 16+ requires before it can create a database owned by that role.
- Extensions `pg_trgm` and `uuid-ossp` were created as `experiments_app`.
- Researcher logins on request: `CREATE ROLE <name> LOGIN IN ROLE reporting_reader`, then `\password <name>`, plus a firewall rule named after the person (`scripts/azure/grant_db_access.sh`).
- After each restore, once: `GRANT SELECT ON ALL TABLES` and `ON ALL SEQUENCES IN SCHEMA public TO reporting_reader` (`grants.sql`).

**App Service `addisenergy-lab`**
- Linux, Python 3.13, Basic B1 (1.75 GB), plan `ASP-DataApplication-965e`, East US 2, about $12.41/month. Application Insights is on (`addisenergy-lab`).
- **Secure unique default hostname** is on. The default address is `addisenergy-lab-<random>.eastus2-01.azurewebsites.net`, not `addisenergy-lab.azurewebsites.net`. That exact host is the GoDaddy CNAME target and a Firebase authorized domain.
- Basic-auth publishing is disabled. The portal's continuous deployment is **not** enabled: its generated workflow neither builds the frontend nor runs migrations, so `.github/workflows/deploy-azure.yml` is used instead.

**GitHub.** The repo was transferred to `Addis-Energy/experiment-tracking-sandbox` (Free organization) on 2026-11-23, before any OIDC credential exists.

**Still open** (runbook R1.0 unless noted):
1. App Service configuration:
   - Startup command `python -m uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1`.
   - Always On; HTTPS only; minimum TLS 1.2; FTP and SCM basic auth off.
   - App settings: `DATABASE_URL`, `TZ=America/New_York`, the `FIREBASE_*` settings, `CORS_ORIGINS=https://data.addisenergy.com`, `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and the photo settings.
   - `ENABLE_API_DOCS` is not set.
2. Database firewall: add the app's outbound and additional outbound IPs. Confirm whether the existing rule is the HQ IP; add `hq` and `admin` rules as needed.
3. Storage account (LRS, anonymous access off) with private containers `sample-photos` and `heartbeat`. The app's system-assigned identity gets Storage Blob Data Contributor.
4. DNS through the colleague at GoDaddy:
   - `CNAME data -> <default host>` and `TXT asuid.data -> <custom domain verification ID>`.
   - A CAA check: DigiCert must be allowed.
   - Then the custom domain and an App Service Managed Certificate (SNI).
   - Firebase authorized domains: `data.addisenergy.com` and the default host.
5. Michael Alexander as a second subscription Owner; budget alert at about $120/month; optionally a CanNotDelete lock on the resource group.
6. Mat needs admin on the transferred repo (GitHub left him with write access). Then the OIDC credential for `repo:Addis-Energy/experiment-tracking-sandbox:ref:refs/heads/main`, the repo secrets and variables, and the first deploy.
7. Rehearsal the week of 2026-11-30; switch Thursday 2026-12-03; fallback 2026-12-10.
