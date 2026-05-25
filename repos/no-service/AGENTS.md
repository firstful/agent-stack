# Repo: no-service

## Service Config

Desired state: `agent-stack.json` in this repo

## Containerfile

This repo contains a `Containerfile` that builds the image `stack/no-service:latest`.

## Deployment Workflow

1. **Make changes** to this repo (Containerfile, source code, etc.)
2. Test your changes locally inside the running container if needed
3. **Commit** your changes:
   ```
   git add . && git commit -m "describe your changes"
   ```
   The controller will detect the new commit hash within 5 seconds, rebuild the image, and recreate the container.

> **Important**: The controller uses the git commit hash to detect source changes. Uncommitted file edits will NOT trigger a rebuild. (`agent-stack.json` edits always trigger a rebuild regardless of commits.)

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `agent-stack.json` in this repo directly — this always triggers a container recreation on the next reconcile (no commit required).
