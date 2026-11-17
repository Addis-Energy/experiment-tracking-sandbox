# Azure Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production from the lab PC to Azure (App Service + PostgreSQL Flexible Server 18 + Blob Storage) with the switch on Thu 2026-12-03, before Tailscale ends on 2026-12-15, with no data missing or shifted.

**Architecture:** The repo gains:
- a pluggable photo store (local disk for dev and tests, Blob in prod)
- three operational scripts: photo migration, migration snapshot/diff, DB roles
- committed Azure provisioning (az CLI)
- a nightly GitHub Actions deploy with OIDC
- a repointed lab PC backup with a heartbeat
- runbooks for the rehearsal, switch, rollback and access grants

No models, alembic history, bulk-upload parsers, enums or Firebase auth change. The timezone fix is server and app settings only.

**Tech Stack:** FastAPI, SQLAlchemy, pytest, `azure-storage-blob`, `azure-identity`, az CLI (bash), GitHub Actions, PowerShell 5.1 (lab PC).

**Spec:** `docs/superpowers/specs/2026-11-17-azure-migration-design.md` (approved by Mat 2026-11-17)

## Global Constraints

- Deadline: 2026-12-15. Switch Thu 2026-12-03 morning; backup date Thu 2026-12-10.
- Region East US (East US 2 allowed). PostgreSQL **18**. App Service Linux, Python **3.13**, Basic tier, `--workers 1`.
- Postgres Burstable **B2s** or larger; `timezone = America/New_York`; backup retention **35** days; **geo-redundant backup on** (only settable at creation).
- App setting `TZ=America/New_York`. `ENABLE_API_DOCS` is never set on Azure. `CORS_ORIGINS=https://data.addisenergy.com`.
- Firewall: **no** "Allow Azure services" (`0.0.0.0`) rule. Allow only: App Service `possibleOutboundIpAddresses`, admin IPs, the HQ IP, per-researcher IPs, and the deploy runner during a job.
- App Service: HTTPS only, min TLS 1.2, FTP and SCM basic-auth publishing disabled, Always On.
- App role `experiments_app` owns the database and every object in it. Everything that imports `database` (app, CI migrations, admin scripts) connects as it.
- Researcher access: read-only, one login per person, members of `reporting_reader`. Grants via `ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app`.
- Photo blob name: `<sample_id>/<stem>_<uuid8><ext>`. Container private.
- Packages: pin `azure-storage-blob==12.30.0` (installed today) and add `azure-identity` pinned to the version pip resolves. No other new packages.
- Deploy: nightly 02:00 Eastern plus manual dispatch, not on push; one run at a time (no cancel-in-progress); migrations in the workflow.
- Secrets never in the repo or docs. Do not read or modify `.env` files.
- Repo conventions:
  - one pytest process at a time (shared `experiments_test`)
  - run Python with `.venv/Scripts/python`
  - commit format `[#<issue>] ...` with Tests/Docs lines and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - PRs `--base develop`

## Prerequisites (Mat, before Task 6 runs against Azure)

These are manual and have no code. Tasks 1–5 don't need them.
- [ ] P1. Create a Pay-As-You-Go subscription (Addis Entra directory). Add Michael Alexander as **Owner**. Apply to Microsoft for Startups in parallel.
- [ ] P2. Create the Addis GitHub organization (two admins), transfer the repo, then update `origin` on dev machines and the lab PC. Confirm `frontend-checks.yml` still runs and branch protection and secrets came across.
- [ ] P3. The DNS colleague checks addisenergy.com for CAA records. If any exist, they must allow `digicert.com`.
- [ ] P4. Run `SHOW timezone;` on the lab PC Postgres and record the result in the issue (expected `America/New_York`).

## Review Focus

1. **A naive datetime from a bulk upload on a UTC server.** It must store and display the same calendar date as on the lab PC. Pinned by the timezone check in Task 4's snapshot and the rehearsal round-trip in Task 8.
2. **A photo row whose source file is missing, or whose path is a different user's OneDrive.** The migration must report it, keep the row and continue. Pinned in Task 3.
3. **Re-running the photo migration after a partial run.** Rows already holding blob names must be skipped, not re-uploaded or duplicated. Pinned in Task 3.
4. **Deleting a legacy photo row (Windows path) on Azure.** It must return 204 and remove the row, even though no blob exists. Pinned in Task 2.
5. **An app restart after the restore.** Researcher and backup roles must still be able to `SELECT` every `v_*` view after the app drops and recreates them. Pinned by Task 5's verification query and the Task 8 rehearsal step.

---

### Task 1: Photo store abstraction

**Files:**
- Create: `backend/services/photo_storage.py`
- Modify: `backend/config/settings.py` (photo settings)
- Modify: `requirements.txt:80` (pin) and add `azure-identity`
- Test: `tests/services/test_photo_storage.py`

**Interfaces:**
- Produces:
  - `photo_blob_name(sample_id: str, filename: str | None) -> str`, which returns `f"{sample_id}/{stem}_{uuid8}{ext}"`. The stem defaults to `"photo"` and the extension to `".jpg"`, matching `samples.py` today.
  - `class PhotoStore(Protocol)` with two methods:
    - `save(self, sample_id: str, filename: str | None, content: bytes, content_type: str) -> str` returns the reference stored in `sample_photos.file_path`
    - `delete(self, ref: str) -> None`, a no-op when the ref doesn't exist
    - `exists(self, ref: str) -> bool`. For local stores this is `Path(ref).is_file()`; for Blob it is `container.get_blob_client(ref).exists()`.
  - `class LocalPhotoStore(root: Path)`. `save` writes to `root/<blob name>` and returns `str(path)`, keeping today's behaviour. `delete` unlinks the file if it exists.
  - `class BlobPhotoStore(container: ContainerClient)`. `save` uploads with `content_settings=ContentSettings(content_type=...)` and returns the blob name. `delete` calls `delete_blob` and swallows `ResourceNotFoundError`.
  - `get_photo_store(settings: Settings) -> PhotoStore` picks the store from `settings.photo_storage`:
    - `"local"` returns `LocalPhotoStore(Path(settings.sample_photos_dir))`
    - `"blob"` returns a `BlobPhotoStore` on `ContainerClient(account_url=settings.azure_storage_account_url, container_name=settings.azure_photo_container, credential=DefaultAzureCredential())`
- New settings:
  - `photo_storage: Literal["local", "blob"] = "local"`
  - `azure_storage_account_url: str = ""`
  - `azure_photo_container: str = "sample-photos"`

- [ ] **Step 1: Install and pin.** `.venv/Scripts/python -m pip install azure-identity`. In `requirements.txt`, change `azure-storage-blob>=12.25.1` to `azure-storage-blob==12.30.0` and add `azure-identity==<installed version>`.
- [ ] **Step 2: Write the failing tests** in `tests/services/test_photo_storage.py`:
  - `test_blob_name_shape`: `photo_blob_name("S1", "shot.png")` matches `^S1/shot_[0-9a-f]{8}\.png$`, and `photo_blob_name("S1", None)` matches `^S1/photo_[0-9a-f]{8}\.jpg$`.
  - `test_local_save_and_delete(tmp_path)`:
    - `ref = LocalPhotoStore(tmp_path).save("S1", "a.jpg", b"x", "image/jpeg")`
    - `Path(ref).read_bytes() == b"x"`
    - `Path(ref).parent == tmp_path / "S1"`
    - after `delete(ref)` the file is gone
    - `delete(ref)` again doesn't raise
  - `test_blob_save_uploads_with_content_type`: with a `MagicMock` container, `save` returns a name starting `"S1/"`. `container.upload_blob` is called once with `name=<that name>`, `data=b"x"`, and `content_settings.content_type == "image/png"`.
  - `test_blob_delete_missing_is_noop`: `container.delete_blob.side_effect = ResourceNotFoundError("gone")`, and `delete("S1/a.jpg")` doesn't raise.
  - `test_exists`: on a local store, `exists(ref)` is True after `save` and False after `delete`. On a blob store with `container.get_blob_client.return_value.exists.return_value = False`, `exists("S1/a.jpg")` is False.
  - `test_get_photo_store_local_default`: `get_photo_store(Settings(_env_file=None, sample_photos_dir=str(tmp_path)))` is a `LocalPhotoStore`.
  - `test_get_photo_store_blob`: `Settings(_env_file=None, photo_storage="blob", azure_storage_account_url="https://acct.blob.core.windows.net")`, with `ContainerClient` and `DefaultAzureCredential` patched in `backend.services.photo_storage`, returns a `BlobPhotoStore`, and `ContainerClient` was called with `container_name="sample-photos"`.
- [ ] **Step 3: Run** `.venv/Scripts/python -m pytest tests/services/test_photo_storage.py -q`. Expected: collection ERROR or FAIL (module missing).
- [ ] **Step 4: Implement** the module and the settings per Interfaces.
- [ ] **Step 5: Run** the same command. Expected: 7 passed.
- [ ] **Step 6: Commit** `[#<n>] Add pluggable photo store` (requirements.txt, settings.py, photo_storage.py, test).

### Task 2: Route photo upload/delete through the store

**Files:**
- Modify: `backend/api/routers/samples.py:419-433` (upload), `:461-467` (delete)
- Test: `tests/api/test_samples.py:141-182`

**Interfaces:**
- Consumes: `get_photo_store(settings) -> PhotoStore` from Task 1, imported into `backend.api.routers.samples`.

- [ ] **Step 1: Rewrite the three existing photo tests** to patch `backend.api.routers.samples.get_photo_store` with `lambda s: LocalPhotoStore(tmp_path)` instead of faking `get_settings`, and add these tests:
  - `test_upload_photo_stores_ref_from_store`: patch it with a fake whose `save` returns `"PHOTO_S04/shot_deadbeef.jpg"`. After the POST, the `SamplePhotos` row's `file_path == "PHOTO_S04/shot_deadbeef.jpg"`, and `save` got `("PHOTO_S04", "shot.jpg", b"fake image bytes", "image/jpeg")`.
  - `test_delete_photo_calls_store_delete`: the fake store records `delete` calls. Deleting a row with `file_path="S/x.jpg"` gives 204 and `delete` called with `"S/x.jpg"`.
  - `test_delete_legacy_windows_path_photo` (Review Focus 4): a row with `file_path=r"C:\Users\LabPC\x\y.jpg"` and a `BlobPhotoStore` on a `MagicMock` container whose `delete_blob` raises `ResourceNotFoundError` gives 204, and the row is gone.
- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/api/test_samples.py -q -k photo`. Expected: the new tests FAIL (the router still writes to disk directly).
- [ ] **Step 3: Implement.**
  - Upload: `ref = get_photo_store(get_settings()).save(sample_id, file.filename, content, file.content_type)`, then `file_path=ref`.
  - Delete: `get_photo_store(get_settings()).delete(photo.file_path)` replaces the `Path.unlink` block.
  - Remove the now-unused `uuid` import if nothing else uses it.
- [ ] **Step 4: Run** `.venv/Scripts/python -m pytest tests/api/test_samples.py -q`. Expected: all pass.
- [ ] **Step 5: Commit** `[#<n>] Save sample photos through photo store`.

### Task 3: Existing-photo migration script

**Files:**
- Create: `scripts/migrate_photos_to_blob.py`
- Test: `tests/test_migrate_photos_to_blob.py`

**Interfaces:**
- Consumes: `PhotoStore`, `photo_blob_name` (Task 1).
- Produces:
  - `is_local_ref(ref: str) -> bool`. True when the ref has a drive letter (`^[A-Za-z]:[\\/]`), a backslash, or a leading `/`. Blob names are never local.
  - `@dataclass MigrationReport(moved: int, skipped: int, missing: list[tuple[int, str]])`
  - `migrate_photos(db: Session, store: PhotoStore, prefix_map: dict[str, str], dry_run: bool) -> MigrationReport`
  - CLI: `python scripts/migrate_photos_to_blob.py [--apply] [--map OLD=NEW ...]`. Without `--apply` it is a dry run. It uses `get_photo_store(get_settings())` and `SessionLocal`, and exits 1 if `missing` is non-empty.
  - On switch day it runs **on the lab PC**, where the SharePoint folder is synced, with these environment variables set for that shell only, never in `.env`:
    - `DATABASE_URL` set to Azure as `experiments_app`
    - `PHOTO_STORAGE=blob`
    - `AZURE_STORAGE_ACCOUNT_URL`

    Blob credentials come from `DefaultAzureCredential`, via `az login` as Mat, who needs the `Storage Blob Data Contributor` role on the account. The runbook (Task 8) spells this out.
- Algorithm (not determined by the signature):
  - For each `SamplePhotos` row ordered by id: if `not is_local_ref(file_path)`, then `skipped += 1`.
  - Otherwise, apply the first matching prefix in `prefix_map` (case-insensitive) to get the source path. If the file doesn't exist, append `(id, file_path)` to `missing` and continue. Never delete or alter a missing row.
  - If the file exists and it's not a dry run: `ref = store.save(row.sample_id, row.file_name or source.name, bytes, row.file_type or "image/jpeg")`, set `row.file_path = ref`, and commit **per row**, so a crash leaves finished rows done.
  - `moved` counts both real and would-move rows.

- [ ] **Step 1: Write failing tests**, seeding `sample_photos` rows via `db_session` with a `LocalPhotoStore(tmp_path/"dest")` as the target:
  - `test_moves_local_file_and_rewrites_path`: the source file exists at `tmp_path/"src"/"a.jpg"`, and the row's `file_path` is that path. Result: `moved == 1`, the row's `file_path` is under `tmp_path/"dest"/<sample_id>/`, the bytes are equal, and the source file still exists.
  - `test_dry_run_changes_nothing`: `moved == 1`, the row is unchanged, and the dest dir is empty.
  - `test_missing_file_reported_row_kept` (RF2): `missing == [(id, path)]`, and the row is unchanged.
  - `test_rerun_skips_blob_refs` (RF3): a row with `file_path="S1/a_1234abcd.jpg"` gives `skipped == 1` and `moved == 0`, and `store.save` is never called (use a `MagicMock` store).
  - `test_prefix_map_remaps_other_users_path` (RF2): the row path is `r"C:\Users\Someone\OneDrive\x\a.jpg"`, the map is `{r"C:\Users\Someone\OneDrive": str(tmp_path/"src")}`, and the file is at `tmp_path/"src"/"x"/"a.jpg"`. Result: `moved == 1`.
  - `test_is_local_ref`: `r"C:\a\b.jpg"`, `"C:/a/b.jpg"`, `"/var/x.jpg"` and `r"a\b.jpg"` are True; `"S1/a_1234abcd.jpg"` is False.
- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_migrate_photos_to_blob.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** per Interfaces and Algorithm. Normalise the backslashes in the remapped path with `PureWindowsPath(...).parts` before joining onto the mapped root, so it works on Linux and Windows.
- [ ] **Step 4: Run** it again. Expected: 6 passed.
- [ ] **Step 5: Commit** `[#<n>] Add photo-to-Blob migration script`.

### Task 4: Migration snapshot and diff

**Files:**
- Create: `scripts/verify_migration.py`
- Test: `tests/test_verify_migration.py`

**Interfaces:**
- Produces:
  - `snapshot(conn: Connection, check_photo_blob: Callable[[str], bool] | None = None) -> dict`. It returns these keys:
    - `"tables"`: row count per table in `Base.metadata.sorted_tables`
    - `"alembic"`: `select version_num from alembic_version`
    - `"views"`: for each name in `database.event_listeners._VIEWS`, True if `SELECT 1 FROM <view> LIMIT 1` succeeds
    - `"timezone"`: `SHOW timezone`
    - `"photos_unresolved"`: when `check_photo_blob` is given (the CLI passes `get_photo_store(get_settings()).exists`), a list of `sample_photos.id` whose `file_path` fails it or is a local ref (from Task 3's `is_local_ref`). Otherwise `None`.
  - `diff(before: dict, after: dict) -> list[str]`. It returns human-readable problems:
    - any table count that differs
    - an alembic mismatch
    - any view `False` in `after`
    - `after["timezone"] != "America/New_York"`
    - a non-empty `after["photos_unresolved"]`
  - CLI:
    - `snapshot --out FILE [--check-blobs]` uses `DATABASE_URL`, and with `--check-blobs` a `BlobPhotoStore` existence check
    - `diff BEFORE AFTER` prints the problems and exits 1 if there are any, otherwise prints `OK` and exits 0

- [ ] **Step 1: Write failing tests:**
  - `test_snapshot_on_test_db(db_session)`: the result has an `"experiments"` key in `"tables"`, `"timezone"` is a non-empty str, and every view key is present. Use the `views` fixture from `tests/api/conftest.py`, or copy it.
  - `test_diff_clean`: identical dicts with timezone `"America/New_York"` give `[]`.
  - `test_diff_flags_count_view_tz_photos`: a changed count, a `False` view, timezone `"UTC"` and `photos_unresolved=[5]` give 4 problems, each naming its table, view, `UTC` or `5`.
- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_verify_migration.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: 3 passed.
- [ ] **Step 5: Commit** `[#<n>] Add migration snapshot/diff script`.

### Task 5: Database roles and access scripts

**Files:**
- Create: `scripts/azure/roles.sql`. psql variables: `:app_password`, `:backup_password`. It contains:
  - create roles `experiments_app` (LOGIN), `reporting_reader` (NOLOGIN) and `experiments_backup` (LOGIN)
  - `CREATE DATABASE experiments OWNER experiments_app`, run separately and guarded in the runbook
- Create: `scripts/azure/grants.sql`. Run **as `experiments_app`** after the restore:
  - `GRANT USAGE ON SCHEMA public TO reporting_reader, experiments_backup`
  - `GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting_reader, experiments_backup`
  - `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO experiments_backup`
  - `ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public GRANT SELECT ON TABLES TO reporting_reader, experiments_backup`
  - `ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO experiments_backup`
- Create: `scripts/azure/grant_db_access.sh <first.last> <ip>` and `revoke_db_access.sh <first.last>`:
  - grant: `CREATE ROLE <first.last> LOGIN PASSWORD <generated> IN ROLE reporting_reader` (via `psql` as the admin), then `az postgres flexible-server firewall-rule create --name researcher-<first.last>`. It prints the connection string with `sslmode=require` once.
  - revoke: drops both.
- Test: verification query in Step 2.

- [ ] **Step 1: Write the scripts** per the Files block. Generate passwords with `openssl rand -base64 24`, and never echo them to logs except the single hand-over line.
- [ ] **Step 2: Verify against `experiments_test`** where possible. Run `grants.sql` as `experiments_user` with `experiments_app` replaced by `experiments_user` via `psql -v`. Then:
  - `SELECT has_table_privilege('reporting_reader','v_experiments','SELECT')`. Expected: `t`.
  - Re-run the view rebuild (`.venv/Scripts/python -c "import database.event_listeners"` against the test URL) and repeat the query. Expected: still `t` (RF5).
  - If role creation isn't allowed locally (memory: no CREATEDB), record that and defer this check to Task 8 Rehearsal step R4.
- [ ] **Step 3: Commit** `[#<n>] Add Azure DB role and access scripts`.

### Task 6: Azure provisioning

**Files:**
- Create: `scripts/azure/provision.sh` (bash, az CLI, idempotent: `show || create`). Inputs come from `scripts/azure/azure.env.example`, copied to an untracked `azure.env`: subscription, `RG`, `LOCATION`, `APP`, `PG`, `STORAGE`, `ADMIN_IP`, `HQ_IP`, `ALERT_EMAILS`.
- Create: `scripts/azure/azure.env.example`. Add `scripts/azure/azure.env` to `.gitignore`.

Resources and settings (values from Global Constraints):
- **Resource group.**
- **App Service plan** (Linux, B1).
- **Web app:**
  - runtime `PYTHON:3.13`
  - `--https-only true`, `minTlsVersion 1.2`, `ftpsState Disabled`, basic publishing credentials off for both `ftp` and `scm`
  - `alwaysOn true`
  - system-assigned identity
  - startup command `uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1`
  - app settings: `TZ`, `CORS_ORIGINS`, `PHOTO_STORAGE=blob`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_PHOTO_CONTAINER=sample-photos`, `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
  - Mat sets `DATABASE_URL` and `FIREBASE_*` by hand (or as Key Vault references). The script prints the `az webapp config appsettings set` line with placeholders, never values.
- **PostgreSQL Flexible Server:**
  - `--version 18 --tier Burstable --sku-name Standard_B2s`
  - `--backup-retention 35 --geo-redundant-backup Enabled`
  - `--public-access None` at create, then explicit firewall rules
  - server parameters `timezone=America/New_York`, `azure.extensions=UUID-OSSP,PG_TRGM`, `require_secure_transport=on`
- **Firewall rules:** `admin`, `hq`, and one `app-outbound-<n>` per IP in `az webapp show --query possibleOutboundIpAddresses`.
- **Storage account** (StorageV2, `--allow-blob-public-access false`, min TLS 1.2):
  - private container `sample-photos`
  - container `heartbeat`
  - role `Storage Blob Data Contributor` for the web app identity and for Mat, scoped to the account
- **Monitoring:**
  - Log Analytics workspace, with diagnostic settings sending `StorageWrite` blob logs to it
  - scheduled-query alert: no `PutBlob` to `heartbeat/labpc-backup` in 36 h
  - App Service availability alert (HTTP 5xx / health check on `/health`)
  - monthly consumption budget with an email at 80% and 100%
  - all of them email `ALERT_EMAILS` (Mat and Michael)

- [ ] **Step 1: Write the script and example env.**
- [ ] **Step 2: Static check.** Run `bash -n scripts/azure/provision.sh`. Expected: no output. Then `grep -n "0.0.0.0" scripts/azure/provision.sh`. Expected: it appears only in the startup command, never in a firewall rule.
- [ ] **Step 3: Commit** `[#<n>] Add Azure provisioning script`.
- [ ] **Step 4 (rehearsal week, after P1):** Mat runs `az login`, then `bash scripts/azure/provision.sh`. Expected checks:
  - `az postgres flexible-server parameter show --name timezone` gives `America/New_York`
  - `az postgres flexible-server firewall-rule list` has no rule with start IP `0.0.0.0`
  - `az webapp show --query httpsOnly` gives `true`

### Task 7: Nightly deploy workflow

**Files:**
- Create: `.github/workflows/deploy-azure.yml`

Decisions:
- **Triggers:** `schedule: cron "0 7 * * *"` (02:00 EST / 03:00 EDT) and `workflow_dispatch`.
- **Concurrency:** `concurrency: { group: deploy-azure, cancel-in-progress: false }`.
- **Permissions:** `id-token: write`, `contents: read`.
- **Checkout:** `ref: main`.
- **Skip unchanged deploys:** compare `github.sha` to the web app setting `DEPLOYED_SHA`. If equal and not dispatched, skip the remaining steps.
- **Frontend:** Node 22, `npm ci && npm run build` in `frontend/`, with `VITE_FIREBASE_*` from repo secrets.
- **Python:** 3.13, `pip install -r requirements.txt`.
- **Azure sign-in and firewall:**
  - `azure/login@v2` with `client-id`, `tenant-id` and `subscription-id` secrets (OIDC)
  - add firewall rule `gh-runner-${{ github.run_id }}` for `curl -s https://api.ipify.org`
- **Migrate:** `alembic upgrade head` with `DATABASE_URL` from the secret `AZURE_DATABASE_URL` (the `experiments_app` role, `sslmode=require`).
- **Firewall cleanup:** delete the runner rule with `if: always()`.
- **Deploy:** `azure/webapps-deploy@v3`, with the package as the repo root including `frontend/dist`. Exclude `frontend/node_modules`, `.venv` and `tests`.
- **Record:** set `DEPLOYED_SHA=${{ github.sha }}` after a successful deploy.

- [ ] **Step 1: Write the workflow.**
- [ ] **Step 2: Validate the YAML.** Run `.venv/Scripts/python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/deploy-azure.yml')); assert d['concurrency']['cancel-in-progress'] is False; print(sorted(d[True].keys()))"` (PyYAML parses `on` as `True`). Expected: `['schedule', 'workflow_dispatch']`.
- [ ] **Step 3: Commit** `[#<n>] Add nightly Azure deploy workflow`.
- [ ] **Step 4 (after P2 and Task 6):** Mat creates the Entra app registration with a federated credential for `repo:<org>/<repo>:ref:refs/heads/main`. It gets `Contributor` on the resource group (needed for firewall rules and the deploy). Mat adds the secrets, then runs the workflow manually. Expected: green, and `https://<app>.azurewebsites.net/health` returns `{"status":"ok",...}`.

### Task 8: Lab PC backup repoint and runbooks

**Files:**
- Modify: `backup.ps1`
  - Read `$DbHost`, `$DbUser` and `$HeartbeatUrl` from `C:\ProgramData\experiment-tracker\backup.config.psd1` (`Import-PowerShellDataFile`). The defaults keep today's local behaviour if the file is absent.
  - Drop `$env:PGPASSWORD`. The password comes from the task account's `%APPDATA%\postgresql\pgpass.conf`.
  - Set `$env:PGSSLMODE = 'require'` when `$DbHost` isn't `localhost`.
  - Pass `-h $DbHost -U $DbUser`.
  - After both dumps succeed, `Invoke-WebRequest -Method Put -Uri $HeartbeatUrl -Headers @{'x-ms-blob-type'='BlockBlob'} -Body (Get-Date -Format o)`. The URL is a write-only SAS for `heartbeat/labpc-backup`. A heartbeat failure is logged, not fatal.
- Create: `docs/deployment/AZURE_RUNBOOK.md` with these sections:
  - **R1 Rehearsal**
    1. Dump the lab PC (`pg_dump -Fc`, PG 18).
    2. Run `roles.sql`, then create the DB.
    3. `pg_restore --no-owner --no-acl -d experiments` as `experiments_app`, and time it.
    4. Run `grants.sql`.
    5. Start the app. Run `verify_migration.py snapshot` on both sides, then `diff`. Expected: `OK`.
    6. `migrate_photos_to_blob.py` dry run, then `--apply`. Expected: `missing` empty, or each one listed and reviewed with Mat.
    7. Timezone round-trip: upload a one-row New Experiments sheet dated today on both sides. Stored timestamps are equal and the UI shows the same date.
    8. RF5: after an app restart, as a test researcher login, `SELECT 1 FROM v_experiments LIMIT 1` succeeds.
    9. Restore tests: a point-in-time restore to a scratch server, and the lab PC dump into a scratch DB.
    10. Lab PC backup against Azure, with the heartbeat blob updated.
    11. Rollback drill.
    12. Team smoke test at the azurewebsites.net URL.
    13. Record all timings and counts in the issue.
  - **R2 Switch (Thu 12-03)**
    1. Announce the freeze.
    2. Stop the ExperimentTracker service.
    3. Final dump, then restore, grants, photo migration `--apply`, and snapshot/diff `OK`.
    4. Bind `data.addisenergy.com` with a managed certificate. Add it and the azurewebsites host to Firebase authorized domains.
    5. Sign-in check.
    6. Announce the new URL and how to request DB access.
    7. Leave the lab PC service installed but stopped.
  - **R3 Rollback**
    1. Dump Azure from the lab PC.
    2. Restore over the local DB.
    3. Start the service and point the team to the lab PC.
  - **R4 Data-fix scripts against prod:** run from the App Service SSH console as `experiments_app`.
  - **R5 Grant/revoke researcher access:** Task 5 scripts.
  - **R6 Lab PC retirement by 12-15:**
    1. Disable the ExperimentTracker service and the `ExperimentTrackerUpdate` task.
    2. Rotate the local `postgres` password.
    3. Keep `ExperimentTrackerBackup` running under an account whose password isn't rotated.

- [ ] **Step 1: Edit `backup.ps1`.** Then run `powershell -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('backup.ps1',[ref]$null,[ref]$e); $e.Count"`. Expected: `0`. Also `git grep -n "PGPASSWORD = \"" backup.ps1`. Expected: no output.
- [ ] **Step 2: Write `AZURE_RUNBOOK.md`.**
- [ ] **Step 3: Commit** `[#<n>] Repoint lab PC backup; add Azure runbook`.

### Task 9: Documentation sweep

**Files:**
- Modify:
  - `.claude/CLAUDE.md` §2 "Deployment" line (authorized by the approved spec)
  - `.claude/commands/deploy.md`: Step 0 now covers Azure (R4), and Step 6 says main deploys nightly at 02:00 or via the manual workflow
  - `README.md`
  - `docs/STACK.md`, `docs/ENVIRONMENT.md` (remove "no cloud"; add the new settings: `PHOTO_STORAGE`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_PHOTO_CONTAINER`, `TZ`)
  - `docs/GIT_WORKFLOW.md`, `docs/DIRECTORY_STRUCTURE.md` (`scripts/azure/`)
  - `docs/PSQL_ACCESS.md` (rewrite for Azure: request-based, per-person login, `sslmode=require`, and fix the missing `FOR ROLE` at `:563`)
  - `docs/deployment/PRODUCTION_DEPLOYMENT.md`, `docs/deployment/STARTUP_GUIDE.md` (point to `AZURE_RUNBOOK.md`; keep the lab PC sections marked "retired 2026-12")
  - `docs/user_guide/ONBOARDING.md`, `docs/user_guide/USER_MANUAL.md` (URL `https://data.addisenergy.com`)
  - `docs/POWERBI_MODEL.md` (add a "Retired" banner only)
  - `docs/working/issue-log.md` (entry)
  - `docs/working/decisions.md` (entry: Azure hosting, timezone setting, nightly deploy)
- Edit `docs/` files with the Edit tool so the project_context hook syncs them. `.claude/CLAUDE.md` syncs to `root_CLAUDE.md`.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify.** Run `git grep -nE "no cloud|LAN only" -- '*.md' ':!docs/superpowers' ':!docs/working' ':!docs/project_context'`. Expected: no output. Then `git status --short docs/project_context`. Expected: a synced copy for each edited `docs/` file.
- [ ] **Step 3: Full verification.** Run the scoped suite `.venv/Scripts/python -m pytest tests/services/ tests/regression/ tests/api/ tests/models/ tests/views/ tests/data_migrations/ tests/test_user_management.py tests/test_manage_users_cli.py tests/test_migrate_photos_to_blob.py tests/test_verify_migration.py -q`. Expected: all pass (1844 before this plan plus the new tests).
- [ ] **Step 4: Commit** `[#<n>] Update docs for Azure hosting`.

---

**Order and timing:**
- Tasks 1–5, 7 and 9 are code and docs and can merge to develop in the week of Nov 23, before Azure exists. Merging them changes nothing on the lab PC: `photo_storage` defaults to `local`, and the workflow needs secrets that don't exist yet.
- Task 6 Step 4, Task 7 Step 4 and the R1 rehearsal follow P1/P2 in the week of Nov 30.
- R2 runs on Dec 3.
