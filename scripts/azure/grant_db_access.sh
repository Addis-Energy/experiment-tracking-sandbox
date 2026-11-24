#!/usr/bin/env bash
# Give a researcher read-only DB access: create a login role in
# reporting_reader and open an Azure firewall rule for their IP.
#
# Usage: grant_db_access.sh <first.last> <ipv4>
#
# Required env vars:
#   PGHOST      server FQDN
#   PGUSER      Azure admin login
#   PGPASSWORD  admin password (or use a .pgpass file)
#   AZ_RG       resource group
#   AZ_PG_SERVER  flexible server name (not FQDN)
# Optional: PGDATABASE (default experiments), PGSSLMODE (default require)
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <first.last> <ipv4>" >&2
    exit 2
fi
NAME="$1"
IP="$2"

if ! [[ "$NAME" =~ ^[a-z][a-z0-9._]*$ ]]; then
    echo "Invalid name '$NAME': must match ^[a-z][a-z0-9._]*\$" >&2
    exit 2
fi
if [[ "$NAME" =~ ^(experiments_app|lab_backup|reporting_reader|addisadmin|postgres|azuresu)$ \
    || "$NAME" =~ ^(pg_|azure) ]]; then
    echo "Refusing reserved role name '$NAME'" >&2
    exit 2
fi
OCTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
if ! [[ "$IP" =~ ^$OCTET\.$OCTET\.$OCTET\.$OCTET$ ]]; then
    echo "Invalid IPv4 address '$IP'" >&2
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
PW="$(openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-32)"

# Fail fast on a wrong target before creating anything.
if ! az postgres flexible-server show --resource-group "$AZ_RG" \
    --name "$AZ_PG_SERVER" --query id -o tsv >/dev/null; then
    echo "Cannot reach server '$AZ_PG_SERVER' in resource group '$AZ_RG'" \
        "(check AZ_RG, AZ_PG_SERVER, az login/subscription)" >&2
    exit 1
fi

# Password goes in via stdin (heredoc), so it never appears in argv.
psql -v ON_ERROR_STOP=1 -q -v role="$NAME" -f - <<SQL
\set pw '$PW'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE reporting_reader',
              :'role', :'pw')
\gexec
SQL

if ! az postgres flexible-server firewall-rule create \
    --resource-group "$AZ_RG" --name "$AZ_PG_SERVER" \
    --rule-name "$RULE" --start-ip-address "$IP" \
    --end-ip-address "$IP" --output none; then
    echo "Firewall rule failed; role '$NAME' exists. Re-run revoke_db_access.sh" \
        "$NAME before retrying." >&2
    exit 1
fi

echo "Access granted. Hand this to $NAME once (password is not stored):"
echo "postgresql://$NAME:$PW@$PGHOST:5432/$PGDATABASE?sslmode=require"
