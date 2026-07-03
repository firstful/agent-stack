#!/usr/bin/env python3
"""Export vault credentials → local credentials.json for scraper consumption."""
import sys
import json
import os
import urllib.request
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from creds import vault_list, vault_url, find_vault

VAULT_PASSWORD = find_vault()[1]

def resolve_plaintext() -> dict[str, str]:
    """Resolve plaintext grocery secrets from the vault controller."""
    req = urllib.request.Request(
        vault_url("/api/secrets/plain/groceries"),
        headers={"Authorization": f"Bearer {VAULT_PASSWORD}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return data.get("secrets", {})
    except urllib.error.HTTPError as e:
        print(f"  ⚠️  Could not resolve plaintext via controller: {e}", file=sys.stderr)
        return {}

def export():
    secrets = vault_list("groceries")
    if not secrets:
        print("No grocery secrets found.")
        return False

    stored_keys = {s["key"] for s in secrets}
    resolved = resolve_plaintext()

    # Build credentials dict: {site: {user: ..., pass: ..., totp: ...}}
    creds = {}
    for full_key in stored_keys:
        if not full_key.startswith("GROCERIES_"):
            continue
        rest = full_key[len("GROCERIES_"):]  # e.g. "WALMART_USER"
        parts = rest.rsplit("_", 1)
        if len(parts) != 2:
            continue
        site_raw, field = parts
        site = site_raw.lower()
        if site not in creds:
            creds[site] = {}

        # Try resolved first, fallback to placeholder
        value = resolved.get(full_key, "***VAULT_VALUE***")
        creds[site][field.lower()] = value

    profiles_dir = os.path.join(os.path.dirname(__file__))
    os.makedirs(profiles_dir, exist_ok=True)
    creds_path = os.path.join(profiles_dir, "credentials.json")

    with open(creds_path, "w") as f:
        json.dump(creds, f, indent=2)
    os.chmod(creds_path, 0o600)

    print(f"Exported {len(creds)} sites to {creds_path}")
    for site, fields in sorted(creds.items()):
        status_parts = []
        if fields.get("user"): status_parts.append("user✓")
        if fields.get("pass"): status_parts.append("pass✓")
        if fields.get("totp"): status_parts.append("totp✓")
        print(f"  {site:12s} {', '.join(status_parts)}")
    return True

if __name__ == "__main__":
    export()
