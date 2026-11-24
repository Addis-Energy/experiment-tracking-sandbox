#!/usr/bin/env bash
# Provision every Azure resource for the experiment tracker (issue #196).
# Idempotent: re-running converges. Usage:
#   cp scripts/azure/azure.env.example scripts/azure/azure.env  # then edit
#   az login && bash scripts/azure/provision.sh
# Secrets: PG_ADMIN_PASSWORD is read from the environment (or prompted),
# never written to disk or echoed. DATABASE_URL / FIREBASE_* are never set.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows must not rewrite /subscriptions/...

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source <(tr -d '\r' < "${AZURE_ENV:-$HERE/azure.env}")
: "${SUBSCRIPTION:?}" "${RG:?}" "${LOCATION:?}" "${APP:?}" "${PG:?}"
: "${STORAGE:?}" "${PG_ADMIN_USER:?}" "${ADMIN_IP:?}" "${HQ_IP:?}"
: "${ALERT_EMAILS:?}"
BUDGET_USD="${BUDGET_USD:-150}"
# The portal-built app sits on a plan with a generated name; set PLAN in
# azure.env or this creates a second, unused plan.
PLAN="${PLAN:-${APP}-plan}"
LAW="${APP}-logs"
AG="${APP}-alerts"
PHOTO_CONTAINER="sample-photos"
# Single-quoted on purpose: ${PORT:-8000} must stay literal for App Service.
STARTUP='python -m uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1'

if [[ -z "${PG_ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p "Postgres admin password: " PG_ADMIN_PASSWORD; echo
fi

# Git Bash: az -o tsv emits CRLF; every captured value goes through azv.
azv() { az "$@" | tr -d '\r'; }
step() { printf '\n== %s ==\n' "$*"; }
az account set --subscription "$SUBSCRIPTION"
SUB_ID="$(azv account show --query id -o tsv)"
az extension add --name scheduled-query --yes --only-show-errors >/dev/null
ADMIN_OBJECT_ID="${ADMIN_OBJECT_ID:-$(azv ad signed-in-user show --query id -o tsv)}"

# Create-or-update by name. Refuses any 0.* start IP (no Azure-services rule).
add_fw_rule() {  # name ip
  if [[ "$2" == 0.* ]]; then
    echo "refusing firewall rule $1 for $2" >&2; exit 1
  fi
  az postgres flexible-server firewall-rule create -g "$RG" -n "$PG" \
    --rule-name "$1" --start-ip-address "$2" --end-ip-address "$2" -o none
}

step "Resource group"
az group create -n "$RG" -l "$LOCATION" -o none

step "App Service plan + web app"
az appservice plan show -g "$RG" -n "$PLAN" >/dev/null 2>&1 ||
  az appservice plan create -g "$RG" -n "$PLAN" -l "$LOCATION" --is-linux \
    --sku B1 -o none
az webapp show -g "$RG" -n "$APP" >/dev/null 2>&1 ||
  az webapp create -g "$RG" -n "$APP" --plan "$PLAN" --runtime "PYTHON:3.13" \
    -o none
az webapp update -g "$RG" -n "$APP" --https-only true -o none
az webapp identity assign -g "$RG" -n "$APP" -o none
az webapp config set -g "$RG" -n "$APP" --min-tls-version 1.2 \
  --ftps-state Disabled --always-on true --startup-file "$STARTUP" \
  --generic-configurations '{"healthCheckPath": "/health"}' -o none
# Disables both FTP and SCM basic-auth publishing credentials.
az webapp update -g "$RG" -n "$APP" --basic-auth Disabled -o none
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  TZ=America/New_York CORS_ORIGINS=https://data.addisenergy.com \
  PHOTO_STORAGE=blob \
  "AZURE_STORAGE_ACCOUNT_URL=https://${STORAGE}.blob.core.windows.net" \
  "AZURE_PHOTO_CONTAINER=$PHOTO_CONTAINER" \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true
APP_PRINCIPAL="$(azv webapp identity show -g "$RG" -n "$APP" \
  --query principalId -o tsv)"
APP_ID="$(azv webapp show -g "$RG" -n "$APP" --query id -o tsv)"

step "PostgreSQL Flexible Server 18"
# The admin password is passed as an argument at create time only.
az postgres flexible-server show -g "$RG" -n "$PG" >/dev/null 2>&1 ||
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOCATION" \
    --version 18 --tier Burstable --sku-name Standard_B2s \
    --backup-retention 35 --geo-redundant-backup Disabled \
    --admin-user "$PG_ADMIN_USER" --admin-password "$PG_ADMIN_PASSWORD" \
    --public-access None --high-availability Disabled --yes -o none
set_pg_param() {
  az postgres flexible-server parameter set -g "$RG" --server-name "$PG" \
    --name "$1" --value "$2" -o none
}
set_pg_param timezone America/New_York
set_pg_param azure.extensions UUID-OSSP,PG_TRGM
set_pg_param require_secure_transport on

step "Firewall rules (admin, hq, app outbound IPs)"
add_fw_rule admin "$ADMIN_IP"
add_fw_rule hq "$HQ_IP"
# Re-read each run; stale app-outbound-* rules from an old IP set are not
# removed here (delete by hand if the plan moves scale units).
n=0
for ip in $(azv webapp show -g "$RG" -n "$APP" \
  --query possibleOutboundIpAddresses -o tsv | tr ',' ' '); do
  n=$((n + 1)); add_fw_rule "app-outbound-$n" "$ip"
done

step "Storage account + containers + RBAC"
az storage account show -g "$RG" -n "$STORAGE" >/dev/null 2>&1 ||
  az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" \
    --kind StorageV2 --sku Standard_LRS --allow-blob-public-access false \
    --min-tls-version TLS1_2 -o none
# Shared-key access must stay enabled: the lab PC heartbeat uses an
# account-key SAS bound to the labpc-heartbeat stored access policy (a
# user-delegation SAS is capped at 7 days). Disabling shared keys breaks it.
STORAGE_ID="$(azv storage account show -g "$RG" -n "$STORAGE" \
  --query id -o tsv)"
assign_blob_role() {  # object-id principal-type
  az role assignment create --role "Storage Blob Data Contributor" \
    --assignee-object-id "$1" --assignee-principal-type "$2" \
    --scope "$STORAGE_ID" -o none
}
assign_blob_role "$APP_PRINCIPAL" ServicePrincipal
assign_blob_role "$ADMIN_OBJECT_ID" User
# Containers are created with AAD auth; the role can take minutes to
# propagate, so retry.
for c in "$PHOTO_CONTAINER" heartbeat; do
  for attempt in 1 2 3 4 5 6; do
    az storage container create --account-name "$STORAGE" -n "$c" \
      --auth-mode login --public-access off -o none && break
    [[ $attempt -lt 6 ]] || { echo "container $c failed" >&2; exit 1; }
    echo "waiting for role propagation..."; sleep 30
  done
done

step "Monitoring: Log Analytics, diagnostics, alerts"
az monitor log-analytics workspace show -g "$RG" -n "$LAW" >/dev/null 2>&1 ||
  az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOCATION" \
    -o none
LAW_ID="$(azv monitor log-analytics workspace show -g "$RG" -n "$LAW" \
  --query id -o tsv)"
# Blob logs live on the blobServices/default sub-resource, not the account.
az monitor diagnostic-settings create -n blob-write-logs \
  --resource "$STORAGE_ID/blobServices/default" --workspace "$LAW_ID" \
  --logs '[{"category":"StorageWrite","enabled":true}]' -o none

AG_ARGS=(); i=0
IFS=',' read -r -a EMAILS <<< "${ALERT_EMAILS// /}"
for e in "${EMAILS[@]}"; do
  i=$((i + 1)); AG_ARGS+=(--action email "owner$i" "$e")
done
az monitor action-group create -g "$RG" -n "$AG" --short-name addisalert \
  "${AG_ARGS[@]}" -o none
AG_ID="$(azv monitor action-group show -g "$RG" -n "$AG" --query id -o tsv)"

# Heartbeat: fire when no blob write to heartbeat/labpc-backup in 36 h.
# Zero matching rows means count < 1, so the alert fires on silence.
# Created disabled: no heartbeat is sent until the switch, so it would fire
# from day one. The runbook enables it at R2 step 6. Re-running this script
# re-disables it, so enable it again afterwards if already switched.
HB_QUERY='StorageBlobLogs
| where OperationName in ("PutBlob", "PutBlockList")
| where Uri contains "heartbeat/labpc-backup"'
az monitor scheduled-query create -g "$RG" -n labpc-backup-heartbeat \
  --scopes "$LAW_ID" --condition "count 'hb' < 1" \
  --condition-query hb="$HB_QUERY" --window-size 36h \
  --evaluation-frequency 1h --severity 1 --action-groups "$AG_ID" \
  --skip-query-validation true --disabled true \
  --description "No lab PC backup heartbeat in 36 hours" -o none

# App availability: any 5xx in 15 min, and health check below 100%.
az monitor metrics alert create -g "$RG" -n "${APP}-http5xx" \
  --scopes "$APP_ID" --condition "total Http5xx > 0" \
  --window-size 15m --evaluation-frequency 5m --severity 2 \
  --action "$AG_ID" --description "App returned HTTP 5xx" -o none
az monitor metrics alert create -g "$RG" -n "${APP}-health" \
  --scopes "$APP_ID" --condition "avg HealthCheckStatus < 100" \
  --window-size 15m --evaluation-frequency 5m --severity 1 \
  --action "$AG_ID" --description "/health check failing" -o none

step "Monthly budget (80% and 100%, email)"
# `az consumption budget create` cannot express notifications, so PUT the
# budget through the Consumption REST API (idempotent by name).
EMAIL_JSON="$(printf '"%s",' "${EMAILS[@]}")"; EMAIL_JSON="[${EMAIL_JSON%,}]"
BUDGET_FILE="$(mktemp)"; trap 'rm -f "$BUDGET_FILE"' EXIT
START="$(date -u +%Y-%m-01)T00:00:00Z"
END="$(date -u -d '+5 years' +%Y-%m-01)T00:00:00Z"
cat > "$BUDGET_FILE" <<JSON
{"properties": {"category": "Cost", "amount": $BUDGET_USD,
 "timeGrain": "Monthly",
 "timePeriod": {"startDate": "$START", "endDate": "$END"},
 "filter": {"dimensions": {"name": "ResourceGroupName", "operator": "In",
                           "values": ["$RG"]}},
 "notifications": {
  "actual80": {"enabled": true, "operator": "GreaterThan", "threshold": 80,
               "thresholdType": "Actual", "contactEmails": $EMAIL_JSON},
  "actual100": {"enabled": true, "operator": "GreaterThan", "threshold": 100,
                "thresholdType": "Actual", "contactEmails": $EMAIL_JSON}}}}
JSON
BUDGET_URL="https://management.azure.com/subscriptions/$SUB_ID"
BUDGET_URL+="/providers/Microsoft.Consumption/budgets/${APP}-monthly"
BUDGET_URL+="?api-version=2023-05-01"
az rest --method put -o none --body "@$BUDGET_FILE" --url "$BUDGET_URL"

step "Done. Manual follow-up (never scripted)"
cat <<MSG
Set secrets by hand (values are NOT in this script):
  az webapp config appsettings set -g $RG -n $APP --settings \\
    DATABASE_URL='<database-url>' \\
    FIREBASE_PROJECT_ID='<project-id>' \\
    FIREBASE_PRIVATE_KEY='<private-key>' \\
    FIREBASE_CLIENT_EMAIL='<client-email>' \\
    FIREBASE_CLIENT_ID='<client-id>' \\
    FIREBASE_CLIENT_CERT_URL='<client-cert-url>'
FIREBASE_PRIVATE_KEY is one line with literal \\n sequences (as in the
service-account JSON), not real line breaks; the app converts them.
ENABLE_API_DOCS must stay unset on Azure.
The labpc-backup-heartbeat alert was created disabled; R2 step 6 enables it.
MSG
