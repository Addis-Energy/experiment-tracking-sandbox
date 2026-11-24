-- Azure PG role setup. Run as the Azure admin (addisadmin), connected to the
-- maintenance database (postgres), BEFORE creating the experiments DB:
--
--   { printf "\\set app_password '%s'\n" "$APP_PW"
--     printf "\\set backup_password '%s'\n" "$BACKUP_PW"
--     cat scripts/azure/roles.sql; } | psql -v ON_ERROR_STOP=1 -f -
--
-- Passwords go in a \set prelude over stdin, never -v on the command line
-- (argv is visible in the process list). Supply the admin password via
-- PGPASSWORD in the environment.
--
-- As built on addisenergy-db (2026-11-24): these roles were first created by
-- hand with this same SQL. Re-running converges: roles that already exist are
-- left untouched (passwords are not reset; change one with \password <role>).
-- Passwords are never hard-coded.
--
-- Roles:
--   experiments_app   LOGIN   owns the DB and every object (the app drops and
--                             recreates v_* views at import time). Used by the
--                             app DATABASE_URL, the deploy migration step and
--                             pg_restore.
--   reporting_reader  NOLOGIN group role; read-only. Per-researcher logins and
--                             lab_backup are members.
--   lab_backup        LOGIN   member of reporting_reader; used by the lab PC
--                             backup.ps1 (pg_dump).
--
-- The database itself is NOT created here: CREATE DATABASE cannot run in a
-- transaction or DO block and is run separately by the runbook:
--
--   CREATE DATABASE experiments OWNER experiments_app;
--
-- Then restore as experiments_app (pg_restore --no-owner --no-acl) and run
-- grants.sql as experiments_app.

SELECT format('CREATE ROLE experiments_app LOGIN PASSWORD %L',
              :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'experiments_app')
\gexec

SELECT 'CREATE ROLE reporting_reader NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader')
\gexec

SELECT format('CREATE ROLE lab_backup LOGIN PASSWORD %L',
              :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lab_backup')
\gexec

-- Re-granting an existing membership only prints a notice.
GRANT reporting_reader TO lab_backup;

-- Belt and braces on top of the server parameter timezone=America/New_York:
-- the locked upload parsers write naive datetimes, read in the session zone.
ALTER ROLE experiments_app SET timezone = 'America/New_York';
ALTER ROLE lab_backup SET timezone = 'America/New_York';

-- The admin must be a member of experiments_app to run
-- CREATE DATABASE ... OWNER experiments_app (PG 16+; not a true superuser on
-- Azure).
GRANT experiments_app TO CURRENT_USER;
