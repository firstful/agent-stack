# Repo: cockpit

## Service Config

Desired state: `/srv/agent-stack/desired/cockpit.json`

## Containerfile

This repo contains a `Containerfile` that builds the image `stack/cockpit:latest`.

## Deployment Workflow

1. **Make changes** to this repo (Containerfile, scripts, etc.)
2. Test your changes locally inside the running container if needed
3. **Commit** your changes:
   ```
   git add . && git commit -m "describe your changes"
   ```
   The controller will detect the new commit hash within 5 seconds and apply the changes.

> **Important**: The controller uses the git commit hash to detect source changes. Uncommitted file edits will NOT trigger a rebuild. (`desired/cockpit.json` edits always trigger a change on the next reconcile regardless of commits.)

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `/srv/agent-stack/desired/cockpit.json` directly — this always triggers a change on the next reconcile (no commit required).
