-- Azure PG role setup. Run once as the Azure admin, connected to the
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
-- Idempotent: roles that already exist are left untouched (passwords are
-- not reset). Passwords are never hard-coded.
--
-- Roles:
--   experiments_app    LOGIN   owns the DB and every object (the app drops
--                              and recreates v_* views at import time)
--   reporting_reader   NOLOGIN group role; per-researcher roles join it
--   experiments_backup LOGIN   read-only, used for pg_dump backups
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

SELECT format('CREATE ROLE experiments_backup LOGIN PASSWORD %L',
              :'backup_password')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'experiments_backup'
)
\gexec

-- The admin must be a member of experiments_app to run
-- CREATE DATABASE ... OWNER experiments_app (not a true superuser on Azure).
GRANT experiments_app TO CURRENT_USER;
