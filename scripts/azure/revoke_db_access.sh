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
for v in PGHOST PGUSER AZ_RG AZ_PG_SERVER; do
    if [ -z "${!v:-}" ]; then
        echo "Required env var $v is not set" >&2
        exit 2
    fi
done
export PGDATABASE="${PGDATABASE:-experiments}"
export PGSSLMODE="${PGSSLMODE:-require}"

RULE="researcher-${NAME//./-}"

# Firewall first so no new connections can start; not-found is fine.
az postgres flexible-server firewall-rule delete \
    --resource-group "$AZ_RG" --name "$AZ_PG_SERVER" \
    --rule-name "$RULE" --yes --output none 2>/dev/null \
    || echo "Firewall rule $RULE not found or already removed" >&2

psql -v ON_ERROR_STOP=1 -q -v role="$NAME" -f - <<'SQL'
SELECT format('DROP ROLE IF EXISTS %I', :'role')
\gexec
SQL

echo "Access revoked for $NAME"
