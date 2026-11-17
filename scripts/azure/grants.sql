-- Run AS experiments_app, connected to the experiments DB, after the restore:
--
--   psql -v ON_ERROR_STOP=1 -f scripts/azure/grants.sql
--
-- Read access for reporting_reader / experiments_backup. The default
-- privileges make future tables and rebuilt v_* views readable too, since
-- the app drops and recreates views whenever `database` is imported.

GRANT USAGE ON SCHEMA public TO reporting_reader, experiments_backup;

GRANT SELECT ON ALL TABLES IN SCHEMA public
    TO reporting_reader, experiments_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO experiments_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public
    GRANT SELECT ON TABLES TO reporting_reader, experiments_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE experiments_app IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO experiments_backup;
