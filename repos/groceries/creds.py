#!/usr/bin/env python3
"""
Groceries Credential Tool — insert/update grocery site credentials in the vault.

Convention:
  Key:   GROCERIES_{SITE}_{FIELD}
  Scope: ["groceries"]

  Where SITE  = WALMART | AMAZON | KROGER | SAMSCLUB | ALDI
        FIELD = USER | PASS | TOTP

Examples:
  GROCERIES_WALMART_USER   → "reed.sutliff@example.com"
  GROCERIES_WALMART_PASS   → "supersecret123"
  GROCERIES_AMAZON_USER    → "emilee.sutliff@example.com"
  GROCERIES_AMAZON_TOTP    → "JBSWY3DPEHPK3PXP" (TOTP secret key)

Usage:
  python3 creds.py                          # list all grocery secrets in vault
  python3 creds.py set <site>               # prompt for user/pass/totp for a site
  python3 creds.py set <site> <user> <pass>  # set directly
  python3 creds.py set-all                  # prompt for all 5 sites
  python3 creds.py totp <site>              # set/update TOTP key for a site
  python3 creds.py export                   # export to local credentials.json
"""
import os
import sys
import json
import getpass
import urllib.request
import urllib.error

# ─── Config ─────────────────────────────────────────────────────────────
VAULT_PORT = None
VAULT_PASSWORD = None
SCOPE = ["groceries"]

SITES = ["walmart", "amazon", "kroger", "samsclub", "aldi"]

SITE_KEYS = {
    site.upper(): [f"GROCERIES_{site.upper()}_USER", f"GROCERIES_{site.upper()}_PASS", f"GROCERIES_{site.upper()}_TOTP"]
    for site in SITES
}


# ─── Vault helpers ──────────────────────────────────────────────────────

def find_vault() -> tuple[str, str]:
    """Discover vault port and password from runtime state."""
    global VAULT_PORT, VAULT_PASSWORD

    if VAULT_PORT and VAULT_PASSWORD:
        return VAULT_PORT, VAULT_PASSWORD

    # 1) Try runtime services.json
    try:
        with open("/srv/agent-stack/runtime/services.json") as f:
            state = json.load(f)
        vault = state.get("vault", {})
        port = vault.get("port") or vault.get("slots", {}).get(vault.get("activeSlot"), {}).get("port")
        pw = vault.get("container", {}).get("env", {}).get("VAULT_PASSWORD", "techdeck-vault-token")
        if port:
            VAULT_PORT = str(port)
            VAULT_PASSWORD = pw
            return VAULT_PORT, VAULT_PASSWORD
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

    # 2) Try podman inspection
    import subprocess
    try:
        result = subprocess.run(
            ["podman", "ps", "--filter", "name=vault", "--format", "{{.Ports}}"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            port_str = result.stdout.strip()
            # Parse "0.0.0.0:4001->3500/tcp"
            import re
            m = re.search(r'0\.0\.0\.0:(\d+)', port_str)
            if m:
                VAULT_PORT = m.group(1)
                VAULT_PASSWORD = "techdeck-vault-token"
                return VAULT_PORT, VAULT_PASSWORD
    except Exception:
        pass

    # 3) Fallback
    VAULT_PORT = "4001"
    VAULT_PASSWORD = "techdeck-vault-token"
    return VAULT_PORT, VAULT_PASSWORD


def vault_url(path: str = "") -> str:
    port, _ = find_vault()
    return f"http://localhost:{port}{path}"


def vault_put(key: str, value: str, scopes: list[str] | None = None):
    """Insert or update a secret in the vault."""
    _, pw = find_vault()
    data = json.dumps({"value": value, "scopes": scopes or SCOPE}).encode()
    req = urllib.request.Request(
        vault_url(f"/api/secrets/{key}"),
        data=data,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {pw}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ✗ HTTP {e.code}: {body}", file=sys.stderr)
        return None


def vault_list(scope_filter: str = "groceries") -> list[dict]:
    """List all secrets, optionally filtered by scope."""
    _, pw = find_vault()
    req = urllib.request.Request(
        vault_url("/api/secrets"),
        headers={"Authorization": f"Bearer {pw}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            secrets = json.loads(resp.read())
    except urllib.error.HTTPError:
        return []

    if scope_filter:
        secrets = [s for s in secrets if scope_filter in s.get("scopes", [])]
    return secrets


def vault_get(key: str) -> dict | None:
    """Get a single secret's metadata (not value)."""
    _, pw = find_vault()
    req = urllib.request.Request(
        vault_url(f"/api/secrets/{key}"),
        headers={"Authorization": f"Bearer {pw}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError:
        return None


# ─── CLI Commands ───────────────────────────────────────────────────────

def cmd_list():
    """List all grocery-scoped secrets in vault."""
    secrets = vault_list("groceries")
    if not secrets:
        print("No grocery secrets found in vault.")
        return

    print(f"\n{'Key':45s} {'Scopes':30s} {'Set':>5s}")
    print("-" * 82)
    for s in sorted(secrets, key=lambda x: x["key"]):
        scopes = ", ".join(s.get("scopes", []))
        print(f"{s['key']:45s} {scopes:30s} {'✓' if s.get('set') else '✗':>5s}")

    # Check which sites are complete
    print(f"\n── Site Status ──")
    stored_keys = {s["key"] for s in secrets}
    for site_upper, (user_key, pass_key, totp_key) in SITE_KEYS.items():
        has_user = user_key in stored_keys
        has_pass = pass_key in stored_keys
        has_totp = totp_key in stored_keys
        if has_user and has_pass:
            status = "✅"
            if has_totp:
                status += " TOTP"
        elif has_user or has_pass:
            status = "⚠️  partial"
        else:
            status = "⚠️  missing"
        print(f"  {site_upper:12s} {status}")


def cmd_set(site: str, username: str | None = None, password: str | None = None):
    """Set credentials for a site."""
    site_upper = site.upper()
    # Map common short names / lowercase to our keys
    site_map = {s.lower(): s.upper() for s in SITES}
    site_map.update({s.upper(): s.upper() for s in SITES})
    site_map.update({s.capitalize(): s.upper() for s in SITES})

    if site_upper not in SITE_KEYS and site.lower() not in site_map:
        print(f"Unknown site: {site}")
        print(f"Valid sites: {', '.join(SITES)}")
        return False

    site_upper = site_map.get(site.lower(), site_upper)
    user_key, pass_key = SITE_KEYS[site_upper]

    # Prompt for missing values
    if username is None:
        username = input(f"  {site_upper} email/username: ").strip()
    if password is None:
        password = getpass.getpass(f"  {site_upper} password: ").strip()

    if not username or not password:
        print("  ✗ Both username and password are required.")
        return False

    print(f"  Inserting {user_key} ...")
    r1 = vault_put(user_key, username)
    if r1:
        print(f"    ✅ {user_key} set")

    print(f"  Inserting {pass_key} ...")
    r2 = vault_put(pass_key, password)
    if r2:
        print(f"    ✅ {pass_key} set")

    return bool(r1 and r2)


def cmd_set_all():
    """Prompt for all 5 sites."""
    print("── Grocery Credentials Setup ──")
    print("Credentials are encrypted at rest in vault, scoped to 'groceries'.\n")

    for site in SITES:
        site_upper = site.upper()
        print(f"\n── {site_upper} ──")
        ans = input(f"  Add credentials for {site}? (y/N): ").strip().lower()
        if ans == "y":
            cmd_set(site)
        else:
            print("  Skipped.")

    print("\n── Done ──")
    cmd_list()


def cmd_export():
    """Export grocery credentials from vault → local credentials.json."""
    secrets = vault_list("groceries")
    if not secrets:
        print("No grocery secrets found in vault.")
        return

    creds = {}
    for s in secrets:
        key = s["key"]
        # GROCERIES_WALMART_USER → site=walmart, field=user
        # Strip GROCERIES_ prefix
        if not key.startswith("GROCERIES_"):
            continue
        rest = key[len("GROCERIES_"):]  # e.g. "WALMART_USER"
        parts = rest.rsplit("_", 1)
        if len(parts) != 2:
            continue
        site_raw, field = parts
        site = site_raw.lower()

        # We can't get the plaintext value from the metadata API
        # So this only exports what we know (metadata)
        if site not in creds:
            creds[site] = {}
        creds[site][field.lower()] = "***EXPORT VALUE NOT AVAILABLE FROM API***"

    # To actually get values, we'd need the controller's /api/secrets/plain/groceries endpoint
    # which resolves secrets for a service. Let's try:
    _, pw = find_vault()
    try:
        req = urllib.request.Request(
            vault_url("/api/secrets/plain/groceries"),
            headers={"Authorization": f"Bearer {pw}"},
        )
        with urllib.request.urlopen(req) as resp:
            resolved = json.loads(resp.read())
            secrets_dict = resolved.get("secrets", {})
            # Map back to credential structure
            for full_key, plain_value in secrets_dict.items():
                if not full_key.startswith("GROCERIES_"):
                    continue
                rest = full_key[len("GROCERIES_"):]
                parts = rest.rsplit("_", 1)
                if len(parts) != 2:
                    continue
                site_raw, field = parts
                site = site_raw.lower()
                if site not in creds:
                    creds[site] = {}
                creds[site][field.lower()] = plain_value
    except Exception as e:
        print(f"  Note: could not resolve plaintext values ({e})")
        print(f"  Exporting metadata only.")

    # Write local credentials file
    creds_path = os.path.join(os.path.dirname(__file__) or ".", "profiles", "credentials.json")
    os.makedirs(os.path.dirname(creds_path), exist_ok=True)
    with open(creds_path, "w") as f:
        json.dump(creds, f, indent=2)
    os.chmod(creds_path, 0o600)
    print(f"  Exported to {creds_path}")


def cmd_totp(site: str, key: str | None = None):
    """Set/update TOTP secret key for a site."""
    site_upper = site.upper()
    site_map = {s.lower(): s.upper() for s in SITES}
    site_upper = site_map.get(site.lower(), site_upper)

    if site_upper not in SITE_KEYS:
        print(f"Unknown site: {site}")
        return False

    _, _, totp_key = SITE_KEYS[site_upper]

    if key is None:
        key = getpass.getpass(f"  {site_upper} TOTP secret key: ").strip()

    if not key:
        print("  ✗ TOTP key is required.")
        return False

    print(f"  Inserting {totp_key} ...")
    r = vault_put(totp_key, key)
    if r:
        print(f"    ✅ {totp_key} set")
    return bool(r)


# ─── Main ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        cmd_list()
        return

    action = sys.argv[1]

    if action == "list":
        cmd_list()

    elif action == "set":
        if len(sys.argv) >= 3:
            site = sys.argv[2]
            user = sys.argv[3] if len(sys.argv) >= 4 else None
            pwd = sys.argv[4] if len(sys.argv) >= 5 else None
            cmd_set(site, user, pwd)
        else:
            print("Usage: python3 creds.py set <site> [username] [password]")
            print(f"  Sites: {', '.join(SITES)}")

    elif action == "set-all":
        cmd_set_all()

    elif action == "totp":
        if len(sys.argv) >= 3:
            site = sys.argv[2]
            key = sys.argv[3] if len(sys.argv) >= 4 else None
            cmd_totp(site, key)
        else:
            print("Usage: python3 creds.py totp <site> [key]")
            print(f"  Sites: {', '.join(SITES)}")

    elif action == "export":
        cmd_export()

    else:
        print(f"Unknown action: {action}")
        print("Usage:")
        print("  python3 creds.py                    list credentials")
        print("  python3 creds.py set <site>         set credentials for a site (interactive)")
        print("  python3 creds.py set <site> <user> <pass>  set directly")
        print("  python3 creds.py set-all            set all 5 sites (interactive)")
        print("  python3 creds.py totp <site>        set/update TOTP key for a site")
        print("  python3 creds.py export             export to local credentials.json")


if __name__ == "__main__":
    main()
