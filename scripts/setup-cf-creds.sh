#!/bin/bash
# Sources ~/.hermes/cf-creds.properties and appends to each project's local.properties
# so all projects pick up the credentials in one step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CRED_FILE="$HOME/.hermes/cf-creds.properties"
if [[ -f "$CRED_FILE" ]]; then
    source "$CRED_FILE"
else
    echo "ERROR: cf-creds.properties not found at $CRED_FILE" >&2
    exit 1
fi

ensure_prop() {
    local file="$1"
    local key="$2"
    local value="$3"
    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Talaria
ensure_prop "/srv/agent-stack/repos/talaria/android/local.properties" "cfAccessClientId" "$cfAccessClientId"
ensure_prop "/srv/agent-stack/repos/talaria/android/local.properties" "cfAccessClientSecret" "$cfAccessClientSecret"
ensure_prop "/srv/agent-stack/repos/talaria/android/local.properties" "talariaWsUrl" "$talariaWsUrl"

# Red Thread
ensure_prop "/srv/repos/red-thread/local.properties" "cfAccessClientId" "$cfAccessClientId"
ensure_prop "/srv/repos/red-thread/local.properties" "cfAccessClientSecret" "$cfAccessClientSecret"

echo "Done. CF credentials synced to all projects."
