#!/usr/bin/env bash
# Remove a researcher's DB role and Azure firewall rule.
#
# Usage: revoke_db_access.sh <first.last>
#
# Required env vars: PGHOST, PGUSER (Azure admin), PGPASSWORD (or .pgpass),
#   AZ_RG (resource group), AZ_PG_SERVER (flexible server name).
# Optional: PGDATABASE (default experiments), PGSSLMODE (default require)
set -euo pipefail

# True only if az stderr ($2) is a not-found for the rule's own path ($1),
# not for the resource group or server (those also say "not found").
is_rule_not_found() {
    grep -qiE "firewallRules/$1" <<<"$2" \
        && grep -qiE 'not found|could not be found|NotFound' <<<"$2"
}
# Test hook: revoke_db_access.sh --classify <rule> <stderr text>
if [ "${1:-}" = "--classify" ]; then
    is_rule_not_found "$2" "$3"
    exit $?
fi

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <first.last>" >&2
    exit 2
fi
NAME="$1"

if ! [[ "$NAME" =~ ^[a-z][a-z0-9._]*$ ]]; then
    echo "Invalid name '$NAME': must match ^[a-z][a-z0-9._]*\$" >&2
    exit 2
fi
if [[ "$NAME" =~ ^(experiments_app|lab_backup|reporting_reader|addisadmin|postgres|azuresu)$ \
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

# Fail fast on a wrong target: a bad AZ_RG / AZ_PG_SERVER / subscription
# would otherwise look like "rule not found" while the real rule stays open.
if ! az postgres flexible-server show --resource-group "$AZ_RG" \
    --name "$AZ_PG_SERVER" --query id -o tsv >/dev/null; then
    echo "Cannot reach server '$AZ_PG_SERVER' in resource group '$AZ_RG'" \
        "(check AZ_RG, AZ_PG_SERVER, az login/subscription)" >&2
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
elif is_rule_not_found "$RULE" "$OUT"; then
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
    echo "Access revoked for $NAME (role dropped)"
else
    echo "Access revoked for $NAME (role did not exist)"
fi
