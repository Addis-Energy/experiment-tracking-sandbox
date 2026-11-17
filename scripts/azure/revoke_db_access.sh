#!/usr/bin/env bash
# Remove a researcher's DB role and Azure firewall rule.
#
# Usage: revoke_db_access.sh <first.last>
#
# Required env vars: PGHOST, PGUSER (Azure admin), PGPASSWORD (or .pgpass),
#   AZ_RG (resource group), AZ_PG_SERVER (flexible server name).
# Optional: PGDATABASE (default experiments), PGSSLMODE (default require)
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <first.last>" >&2
    exit 2
fi
NAME="$1"

if ! [[ "$NAME" =~ ^[a-z][a-z0-9._]*$ ]]; then
    echo "Invalid name '$NAME': must match ^[a-z][a-z0-9._]*\$" >&2
    exit 2
fi
if [[ "$NAME" =~ ^(experiments_app|experiments_backup|reporting_reader|postgres|azuresu)$ \
    || "$NAME" =~ ^(pg_|azure) ]]; then
    echo "Refusing reserved role name '$NAME'" >&2
    exit 2
fi
for v in PGHOST PGUSER AZ_RG AZ_PG_SERVER; do
    if [ -z "${!v:-}" ]; then
        echo "Required env var $v is not set" >&2
        exit 2
    fi
done
export PGDATABASE="${PGDATABASE:-experiments}"
export PGSSLMODE="${PGSSLMODE:-require}"

RULE="researcher-${NAME//./-}"

# Read-only check: only researcher roles (members of reporting_reader).
STATE="$(psql -v ON_ERROR_STOP=1 -tA -v role="$NAME" -f - <<'SQL'
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
        THEN 'none'
    WHEN pg_has_role(:'role', 'reporting_reader', 'MEMBER') THEN 'researcher'
    ELSE 'other' END;
SQL
)"
if [ "$STATE" = "other" ]; then
    echo "Role '$NAME' exists but is not a researcher; refusing to drop" >&2
    exit 1
fi

# Firewall first so no new connections can start. Role is dropped only
# afterwards, so any failure here leaves the role and the op can re-run.
if OUT="$(az postgres flexible-server firewall-rule show \
    --resource-group "$AZ_RG" --name "$AZ_PG_SERVER" \
    --rule-name "$RULE" --output none 2>&1)"; then
    az postgres flexible-server firewall-rule delete \
        --resource-group "$AZ_RG" --name "$AZ_PG_SERVER" \
        --rule-name "$RULE" --yes --output none
elif grep -qiE 'ResourceNotFound|was not found|could not be found' \
    <<<"$OUT"; then
    echo "Firewall rule $RULE not found; already removed" >&2
else
    echo "Cannot check firewall rule $RULE: $OUT" >&2
    exit 1
fi

if [ "$STATE" = "researcher" ]; then
    psql -v ON_ERROR_STOP=1 -q -v role="$NAME" -f - <<'SQL'
SELECT format('DROP ROLE %I', :'role')
\gexec
SQL
fi

echo "Access revoked for $NAME"
