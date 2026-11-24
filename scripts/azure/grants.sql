-- Run AS experiments_app, connected to the experiments DB, after the restore:
--
--   psql -v ON_ERROR_STOP=1 -f scripts/azure/grants.sql
--
-- Re-runnable. Read access for reporting_reader, and through membership for
-- lab_backup and every researcher login. The default privileges make future
-- tables and rebuilt v_* views readable too, since the app drops and
-- recreates views whenever `database` is imported, which wipes plain grants.
-- pg_dump also needs SELECT on sequences, so the group gets that as well.

-- Both must be allow-listed in the azure.extensions server parameter. On
-- addisenergy-db they were created by experiments_app on 2026-11-24, so
-- these are normally no-ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT CONNECT ON DATABASE experiments TO reporting_reader;
GRANT USAGE ON SCHEMA public TO reporting_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO reporting_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public
    GRANT SELECT ON TABLES TO reporting_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO reporting_reader;
