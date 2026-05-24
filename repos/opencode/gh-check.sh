#!/bin/bash
# Checks GH_TOKEN expiry once per day. Run as a background cron-like loop.
INTERVAL=86400
while true; do
  if ! gh auth status 2>&1 | grep -q "Logged in"; then
    echo "[gh-check] GH_TOKEN is invalid or expired — create a new one at https://github.com/settings/tokens"
  fi
  sleep "$INTERVAL"
done
