# Azure Runbook

Operator guide for the move from the lab PC to Azure (issue #196). Design:
`docs/superpowers/specs/2026-11-17-azure-migration-design.md`.

Conventions:
- **[bash]** = Git Bash (az, psql, python scripts). **[PS]** = PowerShell on the lab PC.
- Run bash steps from the repo root. `az login` first.
- Passwords are never typed on a command line and never committed. Use the prompts and
  `\set` preludes shown below.
- Every check has an "Expected:" line. If it doesn't match, stop and use the
  "If this fails" note before going on.

## 0. Setup used by every section

```bash
cp scripts/azure/azure.env.example scripts/azure/azure.env   # untracked; fill it in
source <(tr -d '\r' < scripts/azure/azure.env)   # strip CRs (Windows editors)
export PGHOST="$PG.postgres.database.azure.com"
export PGSSLMODE=require
export AZ_RG="$RG" AZ_PG_SERVER="$PG" PGUSER="$PG_ADMIN_USER"   # used by R5
az account set --subscription "$SUBSCRIPTION"
```

**Prerequisite for R1.** Do the local backup password prerequisite below *first*.
Then: the branch carrying the Azure scripts (including
`migrate_photos_to_blob.py` and `verify_migration.py`) must be on `main` (run
`/deploy`), and the lab PC must have run `update.ps1`, which pip-installs
`requirements.txt` including `azure-storage-blob` and `azure-identity`. This does
not change the lab PC app's behaviour: `PHOTO_STORAGE` defaults to local.

**Prerequisite before merging this branch to `main` or running `update.ps1`: local
backup password.** `backup.ps1` no longer carries a hard-coded password. It reads
`pgpass.conf` and runs `pg_dump -w`, so without an entry the nightly backup fails
(fast, logged as `FAILED`) from the first run after the update. [PS] on the lab PC:
1. Find the backup task's account:
   ```powershell
   (Get-ScheduledTask ExperimentTrackerBackup).Principal.UserId
   ```
2. As that account (log in, or `runas /user:<account> powershell`), add this line to
   `%APPDATA%\postgresql\pgpass.conf` (create the folder and file if missing):
   ```
   localhost:5432:experiments:postgres:<local postgres password>
   ```
3. Still as that account, test the saved password directly. Don't use the lab PC's
   current `backup.ps1` for this: until the update it still sets its own password,
   so it would pass even with a missing or mistyped line.
   ```powershell
   Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
   Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -w -h localhost -U postgres `
     -d experiments -c "select 1"
   ```
   Expected: a one-row result showing `1`.
   If this fails: "fe_sendauth: no password supplied" means the line is missing or
   in another account's `%APPDATA%`; "password authentication failed" means the
   password in the line is wrong.
4. After the first `update.ps1` run that brings this branch onto the lab PC, check
   the next morning's backup. The backup task runs at 01:00 and the update at 02:00,
   so the first backup on the new script is the night *after* the update:
   ```powershell
   Get-Content C:\Logs\experiment-tracker\backup.log -Tail 5
   ```
   Expected: "Backup complete" and "Public copy complete" with that night's date.
   If it says `FAILED`, fix the `pgpass.conf` line (step 2) the same day.

Keep this line after the switch: R3 (rollback) goes back to the local DB and relies
on it.

Postgres server parameter `log_statement` must stay `none` (the default) whenever
`roles.sql` or `grant_db_access.sh` runs. Otherwise `CREATE ROLE ... PASSWORD` is
logged in plaintext.

**Never** run `database/init_db.py` against Azure: it drops and recreates the public
schema. **No admin session may import the `database` package against Azure**: the
views would be rebuilt owned by the admin and `experiments_app` could no longer
replace them. Data-fix scripts run from the App Service SSH console (R4).

---

## R1 Rehearsal (week of 2026-11-30, no freeze)

Goal: do the whole switch once on a copy of prod, time it, and find surprises while
the lab PC is still the live system. Keep a scratch file for the timing table at the
end of this section.

### R1.0 Provision

1. [bash] `bash scripts/azure/provision.sh`. It reads `scripts/azure/azure.env`. The
   Postgres admin password comes from `$PG_ADMIN_PASSWORD` or a hidden prompt.
2. It prints a placeholder `az webapp config appsettings set` command for
   `DATABASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_CLIENT_ID` and `FIREBASE_CLIENT_CERT_URL` (the
   names `backend/config/settings.py` reads). Fill in the real values from the
   Firebase service-account JSON and run it yourself (they are not saved anywhere).
   `FIREBASE_PRIVATE_KEY` must be one line with literal `\n` sequences, exactly as
   in the JSON, not real line breaks. `DATABASE_URL` is `experiments_app` on the
   Azure host with `sslmode=require`. The `labpc-backup-heartbeat` alert is created
   disabled; R2 step 6 enables it.
2b. **GitHub OIDC identity for the deploy workflow.** Do this after plan step P2
   (the repo is in the Addis org). [bash], with `<org>/<repo>` the real repo path,
   `gh auth login`ed as a repo admin:
   ```bash
   GH_REPO_PATH=<org>/<repo>
   CLIENT_ID="$(az ad app create --display-name experiment-tracker-deploy \
     --query appId -o tsv | tr -d '\r')"
   SP_ID="$(az ad sp create --id "$CLIENT_ID" --query id -o tsv | tr -d '\r')"
   az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
     \"name\": \"github-main\",
     \"issuer\": \"https://token.actions.githubusercontent.com\",
     \"subject\": \"repo:$GH_REPO_PATH:ref:refs/heads/main\",
     \"audiences\": [\"api://AzureADTokenExchange\"]}"
   RG_ID="$(az group show -n "$RG" --query id -o tsv | tr -d '\r')"
   az role assignment create --role Contributor --scope "$RG_ID" \
     --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal
   ```
   Then the GitHub side. The names must match `.github/workflows/deploy-azure.yml`
   exactly. `gh secret set NAME` prompts for the value (nothing on the command
   line):
   ```bash
   R=(--repo "$GH_REPO_PATH")
   printf '%s' "$CLIENT_ID" | gh secret set AZURE_CLIENT_ID "${R[@]}"
   az account show --query tenantId -o tsv | tr -d '\r\n' |
     gh secret set AZURE_TENANT_ID "${R[@]}"
   az account show --query id -o tsv | tr -d '\r\n' |
     gh secret set AZURE_SUBSCRIPTION_ID "${R[@]}"
   gh secret set AZURE_DATABASE_URL "${R[@]}"     # experiments_app, sslmode=require
   for n in API_KEY AUTH_DOMAIN PROJECT_ID STORAGE_BUCKET MESSAGING_SENDER_ID APP_ID
   do gh secret set "VITE_FIREBASE_$n" "${R[@]}"; done
   gh variable set AZURE_RG --body "$RG" "${R[@]}"
   gh variable set AZURE_APP --body "$APP" "${R[@]}"
   gh variable set AZURE_PG_SERVER --body "$PG" "${R[@]}"
   gh secret list "${R[@]}"; gh variable list "${R[@]}"
   ```
   Expected: 10 secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `AZURE_DATABASE_URL`, six `VITE_FIREBASE_*`) and 3
   variables (`AZURE_RG`, `AZURE_APP`, `AZURE_PG_SERVER`).
   If this fails: the role assignment can take a few minutes to apply; a login
   error in the workflow usually means the federated subject does not match the
   repo path exactly.
3. Check the firewall:
   ```bash
   az postgres flexible-server firewall-rule list -g "$RG" -n "$PG" -o table
   ```
   Expected: `app-outbound-*` rules (one per App Service outbound IP), the admin IP and
   the HQ IP. No `0.0.0.0` / "Allow Azure services" rule.
   If this fails: if there are no `app-outbound-*` rules, the
   `az webapp show --query possibleOutboundIpAddresses` call failed inside the loop
   and the app cannot reach the DB. Fix the az error, rerun `provision.sh`.
4. Confirm the containers exist (`sample-photos`, `heartbeat`) and that the web app
   identity and your login have Storage Blob Data Contributor on the storage account
   (the script does this; role assignments take a few minutes to apply).
5. Confirm server parameters: `timezone` = `America/New_York`, `log_statement` =
   `none`, backup retention 35 days, geo-redundant backup on.
   ```bash
   az postgres flexible-server parameter show -g "$RG" -s "$PG" -n timezone -o table
   az postgres flexible-server show -g "$RG" -n "$PG" \
     --query "{ver:version,ret:backup.backupRetentionDays,geo:backup.geoRedundantBackup}"
   ```
   Expected: `America/New_York`; version `18`, retention `35`, geo `Enabled`.
6. First deploy: GitHub, Actions, "Deploy to Azure", Run workflow. Expected: the log
   shows migrations running and Oryx running `pip install`. Repo secrets
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_DATABASE_URL`
   and the six `VITE_FIREBASE_*` must be set, plus repo variables `AZURE_RG`,
   `AZURE_APP`, `AZURE_PG_SERVER` (step 2b).
   If this fails: the GitHub federated credential subject must be exactly
   `repo:<org>/<repo>:ref:refs/heads/main` (the repo must already be in the Addis
   org). The very first deploy needs the empty-schema restore below first, so a
   migration failure here before step R1.3 is expected; rerun after the restore.

### R1.1 Dump the lab PC

[PS] on the lab PC, PG 18 tools:

```powershell
$t = Get-Date -Format yyyyMMdd_HHmmss
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U postgres `
  -Fc -f "C:\Backups\experiments\rehearsal_$t.dump" experiments
(Get-Item "C:\Backups\experiments\rehearsal_$t.dump").Length / 1MB
```

Expected: exit code 0, a plausible size in MB. Note the size and how long it took.
If this fails: check the `postgres` password and that you used the PG 18 `pg_dump`
(a 16/17 client refuses a PG 18 server).

### R1.2 Roles, then the database

[bash] The admin runs `roles.sql` with passwords passed through a `\set` prelude on
stdin (never `-v`, which shows in the process list).

Generated passwords must be alphanumeric only: they go inside a psql `\set '...'`
and into connection URLs, where quotes, `@`, `:`, `/` and `%` break things.
Generate each one with:

```bash
openssl rand -base64 32 | tr -dc A-Za-z0-9 | head -c 32; echo
```

```bash
read -rs -p "experiments_app password: " APP_PW; echo
read -rs -p "experiments_backup password: " BACKUP_PW; echo
read -rs -p "Azure admin password: " PGPASSWORD; echo   # env, never argv
export PGPASSWORD PGUSER=pgadmin PGDATABASE=postgres
{
  printf "\\\\set app_password '%s'\n" "$APP_PW"
  printf "\\\\set backup_password '%s'\n" "$BACKUP_PW"
  cat scripts/azure/roles.sql
} | psql -v ON_ERROR_STOP=1 -f -
psql -c "CREATE DATABASE experiments OWNER experiments_app;"
unset APP_PW BACKUP_PW PGPASSWORD
```

Expected: no errors; `CREATE DATABASE`. `roles.sql` ends with
`GRANT experiments_app TO CURRENT_USER`, which is what lets the admin create the
database owned by the app role. Keep both passwords in your password manager; the
app one goes into `DATABASE_URL`, the backup one into the lab PC `pgpass.conf`
(R1.10).
If this fails: roles that already exist are left alone (passwords are not reset). To
change a password, `ALTER ROLE` it by hand.

### R1.3 Restore and time it

Run as `experiments_app`, from a machine with PG 18 tools and the dump (the lab PC
is simplest; its IP is the HQ IP, which is allowed through the firewall).
[PS]:

```powershell
$env:PGSSLMODE = 'require'
$env:PGPASSWORD = Read-Host -AsSecureString "experiments_app password" |
  ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }
Measure-Command {
  & "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" --no-owner --no-acl `
    -h <PG>.postgres.database.azure.com -U experiments_app -d experiments `
    "C:\Backups\experiments\rehearsal_<timestamp>.dump"
}
$env:PGPASSWORD = $null
```

Expected: completes; a few harmless "already exists" or extension warnings at most.
Record the elapsed time (this is the length of the freeze window on switch day).
If this fails: if it reports permission errors creating an extension, list the
extension and allow-list it on the server (`azure.extensions` parameter), then
`DROP DATABASE experiments`, recreate it as in R1.2 and restore again. `--no-owner`
is mandatory so every object is owned by `experiments_app`.

### R1.4 Grants

[bash] Run AS `experiments_app`:

```bash
read -rs -p "experiments_app password: " PGPASSWORD; echo; export PGPASSWORD
PGUSER=experiments_app PGDATABASE=experiments psql -v ON_ERROR_STOP=1 \
  -f scripts/azure/grants.sql
unset PGPASSWORD
```

Expected: no errors. This gives `reporting_reader` and `experiments_backup` their
read access (existing objects plus default privileges for future ones).

### R1.5 Start the app; snapshot and diff

1. Redeploy or restart the web app (`az webapp restart -g "$RG" -n "$APP"`). Open
   `https://<APP>.azurewebsites.net`. Expected: the sign-in page loads.
2. Snapshot the lab PC (BEFORE), [PS] on the lab PC with `DATABASE_URL` set in the
   shell to the local DB:
   ```powershell
   .venv\Scripts\python scripts\verify_migration.py snapshot --out before.json
   ```
3. Snapshot Azure (AFTER). `--check-blobs` is required for the AFTER side or `diff`
   fails with "photo refs not checked" (do this after R1.6 so the photo refs
   exist; before R1.6 expect missing-blob findings). The check uses the configured
   photo store, which defaults to local, so set all three shell-only env vars:
   `DATABASE_URL` (Azure, `experiments_app`), `PHOTO_STORAGE=blob` and
   `AZURE_STORAGE_ACCOUNT_URL` (and be `az login`ed):
   ```bash
   export PHOTO_STORAGE=blob AZURE_STORAGE_ACCOUNT_URL=https://<STORAGE>.blob.core.windows.net
   # DATABASE_URL: set it without echoing it, e.g. read -rs DATABASE_URL; export DATABASE_URL
   .venv/Scripts/python scripts/verify_migration.py snapshot --out after.json \
     --check-blobs
   .venv/Scripts/python scripts/verify_migration.py diff before.json after.json
   ```
   Expected: `OK` and exit code 0. The AFTER snapshot's timezone must be
   `America/New_York`.
   If this fails: the diff lists each problem (row counts, view definitions, photo
   refs, timezone). Row-count differences mean the lab PC changed between dump and
   snapshot: that is normal in a rehearsal with no freeze, so re-snapshot the lab
   PC right after the dump or accept small drift and note it. Anything else is a
   real defect: stop.

### R1.6 Photo migration

Run on the lab PC (or whichever machine has the SharePoint photo folder), with
shell-only env vars (never in a `.env`): `DATABASE_URL` (Azure, `experiments_app`),
`PHOTO_STORAGE=blob`, `AZURE_STORAGE_ACCOUNT_URL`. Blob auth is `az login` as Mat
(DefaultAzureCredential), so the Azure CLI must be installed on the lab PC first
(`winget install Microsoft.AzureCLI`, then open a new shell and `az login`).

1. Path mapping. In the dev DB copy, the rows point at
   `C:\Users\LabPC\Addis Energy\All Company - Addis Energy\07_Software\addis_energy_research\uploads\sample_photos\...`
   but the synced files live in
   `...\07_Software\addis_energy_research_prod\sample_photos`. Check the real
   layout on the lab PC first, then pass `--map OLD_PREFIX=NEW_PREFIX`. On the dev
   copy that mapping moved 226 of 227 rows.
1b. Row id=1 points at Mat's personal OneDrive. Copy that one file to the lab PC
   and map its folder too, so all 227 photos resolve. From Mat's machine, copy
   `img_6784_720.jpg` from
   `C:\Users\MathewHearl\OneDrive - Addis Energy\Documents\0x_Software\experiment_tracking\uploads\sample_photos\`
   into `C:\Backups\experiments\photo_id1\` on the lab PC (via OneDrive/SharePoint
   or a USB stick). Every run below then takes a second `--map`:
   `--map "C:\Users\MathewHearl\OneDrive - Addis Energy\Documents\0x_Software\experiment_tracking\uploads\sample_photos=C:\Backups\experiments\photo_id1"`
   (use the prefix exactly as the dry run prints it for id=1 if it differs).
2. Set the SharePoint photo folder to "Always keep on this device". A dry run never
   reads bytes, so online-only file errors only appear under `--apply`.
3. Dry run:
   ```powershell
   .venv\Scripts\python scripts\migrate_photos_to_blob.py --map "<OLD>=<NEW>" `
     --map "<ID1_OLD>=C:\Backups\experiments\photo_id1"
   ```
   The first lines print the target: `database: host=... database=...` and
   `photo store: blob <account URL> container=sample-photos`. **Check the printed
   target is Azure before `--apply`** (host ends `.postgres.database.azure.com`).
   Expected: `missing` is empty, or each missing file is listed and you review it
   with Mat. Exit code 1 means something is missing or failed.
4. Apply:
   ```powershell
   .venv\Scripts\python scripts\migrate_photos_to_blob.py --apply --map "<OLD>=<NEW>" `
     --map "<ID1_OLD>=C:\Backups\experiments\photo_id1"
   ```
   `--apply` refuses (exit 1, nothing written) unless `PHOTO_STORAGE=blob`.
   Expected: every row moved, `missing` empty, exit 0. Blob names are
   `<sample_id>/<stem>_<uuid8><ext>` in the private `sample-photos` container.
   If this fails: online-only files are recorded as "failed" and the run continues.
   Make the folder available offline and re-run; re-runs are safe and skip rows
   already done. A commit failure after a successful upload leaves an orphan blob
   and the re-run uploads under a new name (harmless).
   Time the `--apply` run: it is inside the freeze window on switch day.
5. Now take the AFTER snapshot with `--check-blobs` (R1.5 step 3, with all three env
   vars set) and re-run `diff`. Expected: `OK`.

### R1.7 Timezone round-trip

1. Build a one-row New Experiments upload sheet dated today (reuse an existing test
   sheet and change the date). Upload it on the lab PC app and on the Azure app.
2. Compare the stored timestamp on both sides:
   ```sql
   SELECT id, date FROM experiments ORDER BY id DESC LIMIT 1;
   ```
   Expected: equal values on both sides, and the UI shows the same calendar date
   on both.
   If this fails: check the `timezone` server parameter and the app setting
   `TZ=America/New_York`; restart the app after changing either. Delete the test
   rows on both sides afterward.

### R1.8 RF5: views readable after an app restart

Views are dropped and recreated at app import time, owned by `experiments_app`. The
default privileges must cover them.

1. Restart the app: `az webapp restart -g "$RG" -n "$APP"`. Wait for it to be
   healthy.
2. Create a test researcher (R5), then connect as that login:
   ```bash
   PGUSER=test.researcher psql -c "SELECT 1 FROM v_experiments LIMIT 1;"
   ```
   Expected: one row. If `permission denied for view v_experiments`: the default
   privileges are missing; re-run `grants.sql` as `experiments_app` and repeat.
3. Revoke the test login (R5) afterwards.

### R1.9 Restore tests

1. Azure point-in-time restore to a scratch server:
   ```bash
   az postgres flexible-server restore -g "$RG" -n "$PG-scratch" \
     --source-server "$PG" --restore-time "$(date -u -d '-15 min' +%FT%TZ)"
   ```
   Connect as `experiments_app` and count rows in `experiments`. Expected: matches
   Azure. Delete the scratch server when done:
   `az postgres flexible-server delete -g "$RG" -n "$PG-scratch" --yes`.
2. Lab PC dump into a scratch database: [PS]
   ```powershell
   Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue  # local server: no SSL
   $pg = "C:\Program Files\PostgreSQL\18\bin"
   & "$pg\createdb.exe" -h localhost -U postgres scratch_restore
   & "$pg\pg_restore.exe" --no-owner --no-acl -h localhost -U postgres `
     -d scratch_restore "C:\Backups\experiments\<latest>.sql"
   ```
   Expected: completes; row counts match. Then
   `& "$pg\dropdb.exe" -h localhost -U postgres scratch_restore`.

### R1.10 Lab PC backup against Azure

1. [PS] Create the config file (as an administrator; it holds no password):
   ```powershell
   New-Item -ItemType Directory -Force C:\ProgramData\experiment-tracker | Out-Null
   notepad C:\ProgramData\experiment-tracker\backup.config.psd1
   ```
   Contents (placeholder values):
   ```powershell
   @{
       # Azure Postgres server FQDN; the local default is 'localhost'
       DbHost       = '<PG>.postgres.database.azure.com'
       # Read-only backup role created by roles.sql
       DbUser       = 'experiments_backup'
       # Write-only SAS URL for heartbeat/labpc-backup. This is a credential:
       # keep it out of the repo, logs and chat.
       HeartbeatUrl = 'https://<STORAGE>.blob.core.windows.net/heartbeat/labpc-backup?<sas>'
   }
   ```
   With the file absent, `backup.ps1` dumps the local DB as `postgres` on
   `localhost`. The password then comes from the `localhost:5432:experiments:postgres`
   line in the task account's `pgpass.conf` (Section 0 prerequisite); without it the
   backup fails.
2. The password comes from the backup task account's
   `%APPDATA%\postgresql\pgpass.conf` (log in as that account, or use `runas`):
   ```
   <PG>.postgres.database.azure.com:5432:experiments:experiments_backup:<password>
   ```
3. Create the heartbeat SAS. A user-delegation SAS (`--as-user`) is capped at 7
   days, so use an account-key SAS tied to a stored access policy on the
   `heartbeat` container. [bash]
   ```bash
   KEY="$(az storage account keys list -g "$RG" -n "$STORAGE" \
     --query '[0].value' -o tsv | tr -d '\r')"
   az storage container policy create --account-name "$STORAGE" \
     --account-key "$KEY" -c heartbeat -n labpc-heartbeat --permissions cw \
     --expiry "$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%SZ)"
   az storage blob generate-sas --account-name "$STORAGE" --account-key "$KEY" \
     --container-name heartbeat --name labpc-backup \
     --policy-name labpc-heartbeat --https-only --full-uri -o tsv
   unset KEY
   ```
   Expected: the policy is created (write and create only) and a full blob URL
   ending in `?sv=...&si=labpc-heartbeat&sig=...` is printed. Put it in
   `HeartbeatUrl`. Allow about 30 seconds for the policy to take effect. Revoking the
   URL = `az storage container policy delete`; renewing = extend the policy expiry
   (`az storage container policy update --expiry ...`); the URL stays the same. Note
   the expiry in the issue; a lapsed SAS only shows as a "Heartbeat FAILED" log line
   and then an alert.
4. Run it by hand as the task account:
   ```powershell
   powershell -NoProfile -File C:\path\to\backup.ps1
   Get-Content C:\Logs\experiment-tracker\backup.log -Tail 8
   ```
   Expected: "Backup complete", "Public copy complete", "Heartbeat sent"; new files in
   `C:\Backups\experiments` and the SharePoint `03_Backups` folder. The heartbeat
   blob's Last-Modified is now:
   ```bash
   az storage blob show --auth-mode login --account-name "$STORAGE" \
     -c heartbeat -n labpc-backup --query properties.lastModified
   ```
   If this fails: "password authentication failed" means `pgpass.conf` is wrong or
   not in that account's `%APPDATA%`; a timeout means the HQ IP isn't in the
   firewall (if HQ's IP is dynamic, flag it to Mat now and update the rule).
5. Confirm the `ExperimentTrackerBackup` scheduled task runs as an account whose
   password will not be rotated (R6).
6. **Rehearsal only: take the config out of service again.** Until the switch, the
   nightly backup must keep dumping the live local DB. [PS]
   ```powershell
   Rename-Item C:\ProgramData\experiment-tracker\backup.config.psd1 `
     backup.config.psd1.disabled
   ```
   Expected: the file is gone under its old name. R2 puts it back after the final
   diff passes. (Leaving it in place would silently point the live backup at the
   rehearsal copy and stop dumping prod.)

### R1.11 Rollback drill

Practise the R3 dump and restore against the rehearsal data, into a **scratch**
database. The lab PC's `experiments` database is still the live production DB.

**Do NOT run R3 steps 0, 2 or 3 during the drill**, and never run
`dropdb experiments` (or `DROP DATABASE experiments`) on the lab PC during the
rehearsal.

1. Do R3 step 1 (dump Azure to `C:\Backups\experiments\rollback_azure.dump`).
2. Restore it into a scratch database and time it. [PS] on the lab PC, in the same
   window. Step 1 set `PGSSLMODE=require` for Azure; the local server doesn't use
   SSL, so clear it first:
   ```powershell
   Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
   $pg = "C:\Program Files\PostgreSQL\18\bin"
   Measure-Command {
     & "$pg\createdb.exe" -h localhost -U postgres rollback_drill
     & "$pg\pg_restore.exe" --no-owner --no-acl -h localhost -U postgres `
       -d rollback_drill C:\Backups\experiments\rollback_azure.dump
   }
   ```
   Expected: completes without errors.
3. Verify counts against Azure:
   ```powershell
   & "$pg\psql.exe" -h localhost -U postgres -d rollback_drill `
     -c "SELECT count(*) FROM experiments;" -c "SELECT count(*) FROM sample_photos;"
   ```
   Expected: the same counts as the Azure AFTER snapshot (R1.5).
4. Drop the scratch database (note the name: `rollback_drill`, not `experiments`):
   ```powershell
   & "$pg\dropdb.exe" -h localhost -U postgres rollback_drill
   ```
Record the time.

### R1.11b Data-fix console smoke test (R4)

Open the App Service SSH console and do R4 steps 2-5 (not the apply) with
`delete_zero_notes_022`. That script specifically is preview-by-default and only
writes with `--apply`, so running it without `--apply` is safe. Do not use other
scripts for this test, because some commit immediately.
Expected: it prints its report and changes nothing. Write the real venv and
app-directory paths into R4 step 3.
If this fails: the usual cause is the venv not activated (`ModuleNotFoundError`),
`PYTHONPATH=.` missing, or running outside the app directory.

### R1.12 Team smoke test

Give the team `https://<APP>.azurewebsites.net`. Add that host to Firebase
Authorized domains first (Firebase console, Authentication, Settings). Each person
signs in, opens an experiment, uploads a small file, and views a sample's Photos
tab. Expected: no errors. Collect problems in the issue.

### R1.13 Record in the issue

Paste this table, filled in, into issue #196:

| Item | Value |
|---|---|
| Lab PC dump size / time | |
| Restore time (R1.3) | |
| Photo `--apply` time (R1.6) | |
| Row counts (BEFORE / AFTER) | |
| `diff` result | OK / problems |
| Photo rows moved / missing / failed | /  /  |
| Unresolved photo ids Mat accepts for switch day (R2 step 3), signed off | |
| Timezone check (stored timestamps equal, UI date same) | |
| RF5 check | |
| PITR restore time | |
| Lab PC dump restore time | |
| Backup run + heartbeat blob updated | |
| Rollback drill time | |
| Smoke test problems | |
| Firewall-rule stderr check (below) | |
| Oryx pip install seen in deploy log | |

Rehearsal-only checks to record:
- **Revoke error text.** Revoke a researcher twice. Expected: the second time
  reports "already removed" and finishes. If it aborts instead, check whether the
  real stderr of `az postgres flexible-server firewall-rule show` for a missing rule
  contains `firewallRules/<rule>`. If not, the revoke script's missing-rule
  classifier needs adjusting. Revoking is safe in the meantime (it stops, it does not
  delete the wrong thing).
- **HQ IP static?** If it changed between runs, say so now.

---

## R2 Switch (Thu 2026-12-03, morning)

Before the day: the colleague has checked that CAA records allow `digicert.com`,
and added the GoDaddy `CNAME data -> <APP>.azurewebsites.net` and the
`asuid.data` TXT record (value from `az webapp show --query customDomainVerificationId`)
by 2026-12-02. Rehearsal timings tell you how long the freeze will be.

1. **Announce the freeze** to the team (Slack): data entry stops at HH:MM, expected
   back at HH:MM, old address stops working.
2. **Stop the service and keep it stopped.** [PS] on the lab PC, as administrator.
   `update.ps1` starts the service at the end of its nightly run even if it was
   already stopped, and the service is set to auto-start at boot, so stop it and
   disable both:
   ```powershell
   Stop-Service ExperimentTracker
   Set-Service ExperimentTracker -StartupType Disabled
   Disable-ScheduledTask -TaskName ExperimentTrackerUpdate
   Get-Service ExperimentTracker
   (Get-ScheduledTask ExperimentTrackerUpdate).State
   ```
   Expected: `Stopped`, and `Disabled`. Without this, someone with an old bookmark
   could write to the frozen DB, and R3 would overwrite those writes.
3. **Final dump, restore, grants, photos, diff.**
   - Stop the Azure web app first, so nothing holds a connection to the rehearsal
     database: `az webapp stop -g "$RG" -n "$APP"`.
   - Then empty the target (the rehearsal copy is in `experiments`). [bash] as the
     admin, connected to `postgres`, with `PGPASSWORD` from a `read -rs` as in R1.2:
     ```bash
     psql -c "DROP DATABASE experiments WITH (FORCE);" \
          -c "CREATE DATABASE experiments OWNER experiments_app;"
     ```
     Expected: `DROP DATABASE`, `CREATE DATABASE`. (Roles are kept; no need to rerun
     `roles.sql`. `WITH (FORCE)` ends any leftover session, e.g. a researcher's psql.)
   - Do R1.1 (dump), R1.3 (restore, timed), R1.4 (grants), R1.6 (photo `--apply`,
     timed) and R1.5 (BEFORE and AFTER snapshots, `diff`). The restore resets every
     photo row to its local path, so **all ~227 photos are uploaded again**, not
     just the new ones. The blobs the rehearsal uploaded become orphans (harmless).
     To clear them first, delete the rehearsal blobs before the photo `--apply`:
     `az storage blob delete-batch -s sample-photos --auth-mode login --account-name "$STORAGE"`.
     The BEFORE snapshot runs after the service stopped, so counts must match
     exactly. The AFTER snapshot needs `DATABASE_URL`, `PHOTO_STORAGE=blob` and
     `AZURE_STORAGE_ACCOUNT_URL` all set (R1.5). Before the photo `--apply`, check
     the printed target is Azure (R1.6 step 3), and pass both `--map`s (R1.6 step
     1b).
   - Start the web app: `az webapp start -g "$RG" -n "$APP"`.
   Expected: `diff` prints `OK`.
   One exception: if the only problem `diff` reports is `unresolved photo ids: [...]`
   and every id listed was reviewed and signed off by Mat in the R1.13 record,
   continue (no rollback) and fix those photos after the switch. Any other problem,
   or an id not in that record: do not continue; go to R3 and tell the team.
4. **Custom domain.** In the portal: App Service, Custom domains, Add custom domain,
   `data.addisenergy.com`, validate, then Add binding with an App Service Managed
   Certificate (SNI SSL). Or:
   ```bash
   az webapp config hostname add -g "$RG" --webapp-name "$APP" \
     --hostname data.addisenergy.com
   az webapp config ssl create -g "$RG" -n "$APP" --hostname data.addisenergy.com
   ```
   Then bind the issued certificate thumbprint with
   `az webapp config ssl bind --certificate-thumbprint <t> --ssl-type SNI`.
   Expected: `https://data.addisenergy.com` loads with a valid certificate.
   If this fails: certificate issuance fails if the CNAME/TXT are missing or the CAA
   record doesn't allow digicert.com. Use the `azurewebsites.net` address in the
   meantime and ask the colleague to fix DNS.
   Add `data.addisenergy.com` **and** the `*.azurewebsites.net` host to Firebase
   Authorized domains. `CORS_ORIGINS` is already `https://data.addisenergy.com`.
5. **Sign-in check.** From a browser not previously logged in: sign in at
   `https://data.addisenergy.com`, open an experiment, and view recent data.
   Expected: works, and a sample's Photos tab lists its file names (there is no
   photo display yet).
6. **Put the backup config in service.** The rehearsal renamed it away (R1.10 step
   6). Now that the diff passed, restore it so tonight's backup dumps Azure
   (and sends the heartbeat). [PS]
   ```powershell
   Rename-Item C:\ProgramData\experiment-tracker\backup.config.psd1.disabled `
     backup.config.psd1
   ```
   Expected: the file exists under its real name. Check the log after the first
   night's run (R1.10 step 4).
   Then arm the heartbeat alert, which `provision.sh` created disabled so it would
   not fire before the switch. [bash]
   ```bash
   az monitor scheduled-query update -g "$RG" -n labpc-backup-heartbeat \
     --disabled false
   az monitor scheduled-query show -g "$RG" -n labpc-backup-heartbeat \
     --query enabled
   ```
   Expected: `true`. If tonight's backup does not send a heartbeat, the alert fires
   within 36 hours.
7. **Announce** the new URL, and how to request database access (message Mat; R5).
   Nobody has a database login on day one unless they asked beforehand.
8. **Leave the lab PC service installed but stopped and disabled** (step 2). It is
   the rollback path until a full working day passes without problems. Its local
   DB stays untouched.

If 12-03 slips, the backup date is Thu 2026-12-10.

---

## R3 Rollback

Use only before the lab PC app is retired (R6). The lab PC database has everything
up to the freeze; Azure may have newer data entered since. This carries it back.

0. **Announce a freeze and stop Azure writes first.** Otherwise data entered during
   the dump is lost. Also disable the nightly deploy so it does not run against the
   stopped app:
   ```bash
   az webapp stop -g "$RG" -n "$APP"
   gh workflow disable "Deploy to Azure"
   gh workflow list --all
   ```
   Expected: the site stops responding; "Deploy to Azure" shows
   `disabled_manually`. Re-enable it (`gh workflow enable "Deploy to Azure"`) only
   when Azure is brought back into service for a new switch attempt.
1. **Dump Azure on the lab PC** [PS] (it has PG 18 tools and is allowed through the
   firewall). Use `experiments_backup` credentials (password from `pgpass.conf`):
   ```powershell
   $env:PGSSLMODE = 'require'
   & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h <PG>.postgres.database.azure.com `
     -U experiments_backup -Fc -f C:\Backups\experiments\rollback_azure.dump experiments
   ```
   Expected: exit 0.
2. **Restore over the local DB.** This replaces the local data, so first take a
   fresh dump of the local DB. Do not rely on the latest `experiments_*.sql` in
   `C:\Backups\experiments`: after the switch those are Azure dumps, not the local
   DB. The `postgres` password comes from the `localhost` line in `pgpass.conf`
   (Section 0 prerequisite). Step 1 set `PGSSLMODE=require` for Azure; the local
   server doesn't use SSL, so clear it first or every local command below fails:
   ```powershell
   Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
   $pg = "C:\Program Files\PostgreSQL\18\bin"
   $t = Get-Date -Format yyyyMMdd_HHmmss
   & "$pg\pg_dump.exe" -h localhost -U postgres -Fc `
     -f "C:\Backups\experiments\local_before_rollback_$t.dump" experiments
   ```
   Expected: exit 0 and a plausible file size. Only then:
   ```powershell
   & "$pg\dropdb.exe" -h localhost -U postgres experiments
   & "$pg\createdb.exe" -h localhost -U postgres experiments
   & "$pg\pg_restore.exe" --no-owner --no-acl -h localhost -U postgres -d experiments `
     C:\Backups\experiments\rollback_azure.dump
   ```
   If the lab PC app's DB role differs from `postgres` (check `DATABASE_URL` in the
   service config), add `--role=<app role>` or re-grant afterward.
   Expected: completes without errors.
3. **Re-enable and start the service, point the team back.** The switch disabled
   both (R2 step 2):
   ```powershell
   Set-Service ExperimentTracker -StartupType Automatic
   Enable-ScheduledTask -TaskName ExperimentTrackerUpdate
   Start-Service ExperimentTracker
   Get-Service ExperimentTracker
   ```
   Expected: `Running`. Tell the team to use the lab PC address over Tailscale
   (works until 12-15). After rollback **all photo rows hold blob references**, so
   the lab PC app shows no photos until they are migrated back. The photos are not
   lost: they are still in Blob and in the SharePoint folder. Note it in the issue.
   Also rename `backup.config.psd1` away (R1.10 step 6) so the nightly backup dumps
   the local DB again; it then uses the `localhost:5432:experiments:postgres` line
   in the task account's `pgpass.conf` (Section 0 prerequisite), so check that line
   is still there. Disable the heartbeat alert too, since the lab PC stops sending
   heartbeats: `az monitor scheduled-query update -g "$RG" -n
   labpc-backup-heartbeat --disabled true`. No data needs re-entering.

---

## R4 Data-fix scripts against prod

Data-fix scripts (in `database/data_migrations/`) import the `database` package, so
they run **from the App Service SSH console as `experiments_app`**, never from an
admin session on a laptop. Reason: importing `database` rebuilds the views, and
anyone but `experiments_app` would own the rebuilt views.

**Scripts differ.** Some preview by default and take `--apply` (for example
`delete_zero_notes_022`). Others use `--dry-run` or `--confirm`, and some have no
preview at all and commit as soon as they run. Never assume; read each script first.

1. **Safety dump first, before running anything.** On the lab PC, with
   `experiments_backup`, run the R3 step 1 dump command to a dated file. Expected:
   exit 0 and a plausible file size.
2. Open the console: portal, the web app, Development Tools, SSH (or
   `az webapp ssh -g "$RG" -n "$APP"`).
3. Get oriented. The SSH session may not have the app's Python environment active:
   ```bash
   ls /                          # look for /antenv
   echo $APPSVC_VIRTUAL_ENV      # path printed here, if set
   source /antenv/bin/activate   # or the path above
   ls                            # expect database/ and backend/; if not, cd to
                                 # the extracted app dir (often /tmp/<id>)
   env | grep DATABASE_URL | cut -c1-20   # confirms app settings are exported
   ```
   Expected: the venv activates, `database/` is in the current dir, and the last
   line prints `DATABASE_URL=postgresql`. Confirm these once during R1 (R1.11b)
   and write the real paths here.
4. **Read the script; never run it to find its flags.** Open
   `database/data_migrations/<script>.py` in the repo (or `cat` it on the console)
   and read the module docstring and the `if __name__ == "__main__":` block. They
   show whether the script has a preview mode and which flags it uses (`--apply`,
   `--dry-run`, `--confirm`, or none). Running a script, even with `--help`, may
   execute it: many have no argument handling and run their migration
   unconditionally.
5. **Preview** with that script's own preview mode (no flag for `--apply`-style
   scripts, `--dry-run` for those that have it, and so on). Expected: it prints what
   would change. Review it with Mat.
   **If the script has no preview mode, stop and get Mat's explicit sign-off before
   running it**, since running it writes to prod.
6. **Apply** with the script's apply-mode invocation, for example:
   ```bash
   PYTHONPATH=. python -m database.data_migrations.<script_name> --apply
   ```
   (use the flag that script documents: `--apply`, `--confirm`, no `--dry-run`, or no
   flag for a script with none).
7. **Verify.** Re-run the preview if the script has one (expect nothing left to do)
   or query the affected rows. Record what changed in the issue.
8. Never run `database/init_db.py` (it wipes the schema).

If this fails: if a script needs a package that is not deployed, stop and ask. Do
not pip-install on the box (it vanishes on the next deploy).

---

## R5 Grant / revoke researcher access

Read-only, one login per person, member of `reporting_reader`. On request only.
Both scripts need env vars: `PGHOST`, `PGUSER` (Azure admin), `PGPASSWORD` (or a
`.pgpass` entry), `PGDATABASE=experiments`, `PGSSLMODE=require`, `AZ_RG`,
`AZ_PG_SERVER`. [bash]

Grant (the person gives you their current public IP from a browser search for "what
is my IP"; format `first.last`, lowercase):

```bash
bash scripts/azure/grant_db_access.sh first.last 203.0.113.10
```

Expected: it creates the login, adds a firewall rule named for the person, and
prints the connection string and a generated password once. Send them the string over
a private channel (not Slack channels, not email in clear if avoidable). Point them
to `docs/PSQL_ACCESS.md`.

Revoke:

```bash
bash scripts/azure/revoke_db_access.sh first.last
```

Expected: drops the login and the firewall rule. Revoking does not kill live
sessions; they end when the person disconnects. To cut a live session at once, as
the admin: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE
usename = 'first.last';`.

Updating a changed IP = revoke, then grant with the new IP. This rotates their
password, so send the new connection string.

If this fails: both scripts refuse reserved names (`experiments_app`,
`experiments_backup`, `reporting_reader`, `postgres`, `azure*`, `pg_*`). If revoke
reports a wrong Azure target, check `AZ_RG` and `AZ_PG_SERVER`; it refuses on
purpose rather than delete the wrong rule.

---

## R6 Lab PC retirement (by 2026-12-15)

Only after the team has used Azure for a full working day without problems and the
rollback path is no longer needed. [PS] as administrator on the lab PC.

1. **Disable the app and the update task.**
   ```powershell
   Stop-Service ExperimentTracker
   Set-Service ExperimentTracker -StartupType Disabled
   Disable-ScheduledTask -TaskName ExperimentTrackerUpdate
   ```
   Expected: `Get-Service ExperimentTracker` shows `Stopped`, and
   `Get-ScheduledTask ExperimentTrackerUpdate` shows `Disabled`. These were already
   disabled at the switch (R2 step 2); this keeps them so. Do not uninstall
   the service yet.
2. **Rotate the local `postgres` password.** The old one (`password`) was
   hard-coded in `backup.ps1` for years and is in git history. Every command in
   this step is typed in **PowerShell** on the lab PC, not at a `psql` prompt:
   PowerShell starts `psql.exe` for a single command, and `psql` only ever asks
   you for passwords. Run it as the backup task's account (Section 0 step 1 finds
   it). If that isn't the account you're logged in as, open PowerShell with
   `runas /user:<account> powershell` and run everything in the new window.
   1. [PS] Clear session settings that would override the saved password or point
      `psql` at Azure:
      ```powershell
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
      Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
      Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
      ```
      Expected: no output.
   2. [PS] Set the new password:
      ```powershell
      & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -d experiments -c "\password postgres"
      ```
      Expected: `Enter new password for user "postgres":` and then `Enter it
      again:`. Type the new password at each; nothing appears as you type. You
      return to the PowerShell prompt with no error. If it first asks
      `Password for user postgres:`, this account has no `pgpass.conf` line: enter
      the old password there, then the new one twice. Avoid `:` and `\` in the new
      password. Store it in the password manager.
   3. [PS] Delete the saved local line rather than updating it. Nothing on the lab
      PC uses the local DB any more; the Azure line from R1.10 stays:
      ```powershell
      $f = "$env:APPDATA\postgresql\pgpass.conf"
      (Get-Content $f) | Where-Object { $_ -notlike 'localhost:5432:experiments:postgres:*' } | Set-Content $f -Encoding ascii
      Get-Content $f | ForEach-Object { ($_ -split ':')[0..3] -join ':' }
      ```
      Expected: the last command lists each line without its password. The
      `localhost:5432:experiments:postgres` line is gone and the
      `<PG>.postgres.database.azure.com:5432:experiments:experiments_backup` line
      is still there. Keep `-Encoding ascii`: other encodings make the file
      unreadable to Postgres.
   4. [PS] Confirm the old password is dead and the new one works:
      ```powershell
      & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -d experiments -c "select 1"
      ```
      Run it twice. At `Password for user postgres:` enter `password` the first
      time. Expected: `password authentication failed`. The second time, enter the
      new password. Expected: a one-row result showing `1`.
   5. [PS] Confirm the nightly backup to Azure is unaffected:
      ```powershell
      & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -w -h localhost -U postgres -d experiments -c "select 1"
      ```
      Expected: `fe_sendauth: no password supplied`, because the local line is
      gone. Check `Get-Content C:\Logs\experiment-tracker\backup.log -Tail 5` the
      next morning. Expected: "Backup complete" for that night.

   If the local DB is ever needed again (for example a late R3 rollback), re-add
   the line from Section 0 step 2 with the new password.
3. **Keep `ExperimentTrackerBackup` running**, now against Azure (R1.10). It must run
   under an account whose password isn't rotated; a scheduled task stops silently
   when its account's password changes. Check:
   ```powershell
   Get-ScheduledTaskInfo ExperimentTrackerBackup | Select LastRunTime, LastTaskResult
   ```
   Expected: `LastTaskResult` 0 and a `LastRunTime` within the last day.
4. Check the heartbeat alert is armed: the blob `heartbeat/labpc-backup` is updated
   daily and `labpc-backup-heartbeat` is enabled in Azure Monitor. If the policy expiry
   is within 60 days, extend it with `az storage container policy update -c
   heartbeat -n labpc-heartbeat --expiry <new date> ...` (R1.10 step 3). The SAS
   URL stays the same, so `backup.config.psd1` needs no change.
5. Update the issue and `docs/deployment/PRODUCTION_DEPLOYMENT.md` to say the lab PC
   app is retired.
