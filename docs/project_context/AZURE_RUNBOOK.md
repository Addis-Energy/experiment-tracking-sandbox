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
source scripts/azure/azure.env
export PGHOST="$PG.postgres.database.azure.com"
export PGSSLMODE=require
az account set --subscription "$SUBSCRIPTION"
```

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
2. It prints placeholder `az webapp config appsettings set` lines for `DATABASE_URL`
   and `FIREBASE_*`. Fill in the real values and run them yourself (they are not
   saved anywhere). `DATABASE_URL` is `experiments_app` on the Azure host with
   `sslmode=require`.
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
   `AZURE_APP`, `AZURE_PG_SERVER`.
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
stdin (never `-v`, which shows in the process list):

```bash
read -rs -p "experiments_app password: " APP_PW; echo
read -rs -p "experiments_backup password: " BACKUP_PW; echo
export PGUSER=pgadmin PGDATABASE=postgres
{
  printf "\\\\set app_password '%s'\n" "$APP_PW"
  printf "\\\\set backup_password '%s'\n" "$BACKUP_PW"
  cat scripts/azure/roles.sql
} | psql -v ON_ERROR_STOP=1 -f -
psql -c "CREATE DATABASE experiments OWNER experiments_app;"
unset APP_PW BACKUP_PW
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
PGUSER=experiments_app PGDATABASE=experiments psql -v ON_ERROR_STOP=1 \
  -f scripts/azure/grants.sql
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
   exist; before R1.6 expect missing-blob findings). `DATABASE_URL` = Azure,
   `experiments_app`:
   ```bash
   python scripts/verify_migration.py snapshot --out after.json --check-blobs
   python scripts/verify_migration.py diff before.json after.json
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
(DefaultAzureCredential).

1. Path mapping. In the dev DB copy, the rows point at
   `C:\Users\LabPC\Addis Energy\All Company - Addis Energy\07_Software\addis_energy_research\uploads\sample_photos\...`
   but the synced files live in
   `...\07_Software\addis_energy_research_prod\sample_photos`. Check the real
   layout on the lab PC first, then pass `--map OLD_PREFIX=NEW_PREFIX`. On the dev
   copy that mapping moved 226 of 227 rows. Row id=1 pointed at a personal OneDrive
   (`...\0x_Software\experiment_tracking\uploads\sample_photos\img_6784_720.jpg`)
   and needs its own `--map` or manual handling.
2. Set the SharePoint photo folder to "Always keep on this device". A dry run never
   reads bytes, so online-only file errors only appear under `--apply`.
3. Dry run:
   ```powershell
   .venv\Scripts\python scripts\migrate_photos_to_blob.py --map "<OLD>=<NEW>"
   ```
   Expected: `missing` is empty, or each missing file is listed and you review it
   with Mat. Exit code 1 means something is missing or failed.
4. Apply:
   ```powershell
   .venv\Scripts\python scripts\migrate_photos_to_blob.py --apply --map "<OLD>=<NEW>"
   ```
   Expected: every row moved, `missing` empty, exit 0. Blob names are
   `<sample_id>/<stem>_<uuid8><ext>` in the private `sample-photos` container.
   If this fails: online-only files are recorded as "failed" and the run continues.
   Make the folder available offline and re-run; re-runs are safe and skip rows
   already done. A commit failure after a successful upload leaves an orphan blob
   and the re-run uploads under a new name (harmless).
5. Now take the AFTER snapshot with `--check-blobs` (R1.5 step 3) and re-run `diff`.
   Expected: `OK`.

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
   createdb -h localhost -U postgres scratch_restore
   pg_restore --no-owner --no-acl -h localhost -U postgres -d scratch_restore `
     "C:\Backups\experiments\<latest>.sql"
   ```
   Expected: completes; row counts match. Then `dropdb scratch_restore`.

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
   With the file absent, `backup.ps1` behaves as it does today (local DB).
2. The password comes from the backup task account's
   `%APPDATA%\postgresql\pgpass.conf` (log in as that account, or use `runas`):
   ```
   <PG>.postgres.database.azure.com:5432:experiments:experiments_backup:<password>
   ```
3. Create the SAS (write-only, one blob, about 1 year) with
   `az storage blob generate-sas --account-name "$STORAGE" -c heartbeat
   -n labpc-backup --permissions cw --expiry <date> --https-only --auth-mode login
   --as-user --full-uri`. Note the expiry in the issue; a lapsed SAS only shows up
   as a "Heartbeat FAILED" log line and then an alert.
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

### R1.11 Rollback drill

Run R3 once against the rehearsal data (dump Azure on the lab PC, restore into a
**scratch** database, not over the real one, during the rehearsal). Expected:
restores cleanly and the app can point at it. Record the time.

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
| Row counts (BEFORE / AFTER) | |
| `diff` result | OK / problems |
| Photo rows moved / missing / failed | /  /  |
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
2. **Stop the service.** [PS] on the lab PC, as administrator:
   ```powershell
   Stop-Service ExperimentTracker
   Get-Service ExperimentTracker
   ```
   Expected: `Stopped`.
3. **Final dump, restore, grants, photos, diff.**
   - Empty the target first: the rehearsal copy is in the `experiments` database.
     [bash] as the admin, connected to `postgres`:
     ```bash
     psql -c "DROP DATABASE experiments;" \
          -c "CREATE DATABASE experiments OWNER experiments_app;"
     ```
     Expected: `DROP DATABASE`, `CREATE DATABASE`. (Roles are kept; no need to rerun
     `roles.sql`.) Stop the web app first so nothing holds a connection:
     `az webapp stop -g "$RG" -n "$APP"`.
   - Do R1.1 (dump), R1.3 (restore, timed), R1.4 (grants), R1.6 (photo
     `--apply`; fewer rows will move because the rehearsal already migrated most, and
     already-migrated rows are skipped), and R1.5 (BEFORE and AFTER snapshots,
     `diff`). The BEFORE snapshot now runs after the service stopped, so counts
     must match exactly.
   - Start the web app: `az webapp start -g "$RG" -n "$APP"`.
   Expected: `diff` prints `OK`. If it does not, do not continue: go to R3, restart
   the service and tell the team.
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
   Expected: works, and a photo reference on a sample resolves.
6. **Announce** the new URL, and how to request database access (message Mat; R5).
   Nobody has a database login on day one unless they asked beforehand.
7. **Leave the lab PC service installed but stopped.** It is the rollback path until
   a full working day passes without problems. Its local DB stays untouched.

If 12-03 slips, the backup date is Thu 2026-12-10.

---

## R3 Rollback

Use only before the lab PC app is retired (R6). The lab PC database has everything
up to the freeze; Azure may have newer data entered since. This carries it back.

1. **Dump Azure on the lab PC** [PS] (it has PG 18 tools and is allowed through the
   firewall). Use `experiments_backup` or `experiments_app` credentials:
   ```powershell
   $env:PGSSLMODE = 'require'
   & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h <PG>.postgres.database.azure.com `
     -U experiments_backup -Fc -f C:\Backups\experiments\rollback_azure.dump experiments
   ```
   Expected: exit 0 (password from `pgpass.conf`).
2. **Restore over the local DB** (this replaces the local data, so first keep the
   existing local state: copy the latest `experiments_*.sql` backup aside):
   ```powershell
   $pg = "C:\Program Files\PostgreSQL\18\bin"
   & "$pg\dropdb.exe" -h localhost -U postgres experiments
   & "$pg\createdb.exe" -h localhost -U postgres experiments
   & "$pg\pg_restore.exe" --no-owner -h localhost -U postgres -d experiments `
     C:\Backups\experiments\rollback_azure.dump
   ```
   If the lab PC app's DB role differs from `postgres` (check `DATABASE_URL` in the
   service config), use `--no-owner --role=<app role>`, or re-grant afterward.
   Expected: completes without errors.
3. **Start the service and point the team back:**
   ```powershell
   Start-Service ExperimentTracker
   Get-Service ExperimentTracker
   ```
   Expected: `Running`. Tell the team to use the lab PC address over Tailscale
   (works until 12-15). Photos entered on Azure live in Blob; the rolled-back rows
   point at blob references, which the lab PC app cannot display. They are not lost:
   note it in the issue.
   No data needs re-entering. Stop the Azure web app so nobody keeps writing to it:
   `az webapp stop -g "$RG" -n "$APP"`.

---

## R4 Data-fix scripts against prod

Scripts that import the `database` package (any repo data-fix, migration or
analysis script) run **from the App Service SSH console as `experiments_app`**, never
from an admin session on a laptop. Reason: importing `database` rebuilds the views,
and anyone but `experiments_app` would own the rebuilt views.

1. Open the console: portal, the web app, Development Tools, SSH (or
   `az webapp ssh -g "$RG" -n "$APP"`).
2. In the console the app environment (including `DATABASE_URL`) is already set:
   ```bash
   cd /home/site/wwwroot
   python scripts/<the_fix>.py --dry-run
   ```
   Expected: the dry run prints what would change. Review it, then run without
   `--dry-run`.
3. Take a safety dump first for anything destructive (dump on the lab PC with
   `experiments_backup`, R3 step 1 command, to a dated file).
4. Never run `database/init_db.py` (it wipes the schema).

If this fails: if a script needs a package not deployed, stop and ask. Do not
pip-install on the box (it vanishes on the next deploy).

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
   `Get-ScheduledTask ExperimentTrackerUpdate` shows `Disabled`. Do not uninstall
   the service yet.
2. **Rotate the local `postgres` password.** The old one was hard-coded in
   `backup.ps1` for years and is in git history:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -c "\password postgres"
   ```
   Expected: prompts twice for the new password; store it in the password manager.
   Nothing on the lab PC needs the local DB any more.
3. **Keep `ExperimentTrackerBackup` running**, now against Azure (R1.10). It must run
   under an account whose password isn't rotated; a scheduled task stops silently
   when its account's password changes. Check:
   ```powershell
   Get-ScheduledTaskInfo ExperimentTrackerBackup | Select LastRunTime, LastTaskResult
   ```
   Expected: `LastTaskResult` 0 and a `LastRunTime` within the last day.
4. Check the heartbeat alert is armed: the blob `heartbeat/labpc-backup` is updated
   daily and `labpc-backup-heartbeat` is enabled in Azure Monitor. If the SAS expiry
   is within 60 days, renew it (R1.10 step 3) and update `backup.config.psd1`.
5. Update the issue and `docs/deployment/PRODUCTION_DEPLOYMENT.md` to say the lab PC
   app is retired.
