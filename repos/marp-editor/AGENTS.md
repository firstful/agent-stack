# Repo: marp-editor

## Service Config

Desired state: `/srv/agent-stack/desired/marp-editor.json`

## Containerfile

This repo contains a `Containerfile` that builds the image `stack/marp-editor:latest`.

## Deployment Workflow

1. **Make changes** to this repo (Containerfile, source code, etc.)
2. **Create `.wip`** at the repo root to block auto-rebuilds:
   ```
   touch /srv/agent-stack/repos/marp-editor/.wip
   ```
3. Test your changes locally inside the running container if needed
4. **Remove `.wip`** when ready to deploy:
   ```
   rm /srv/agent-stack/repos/marp-editor/.wip
   ```
   The controller will detect the change within 5 seconds, rebuild the image, and recreate the container.

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `/srv/agent-stack/desired/marp-editor.json` directly — this always triggers a container recreation (no `.wip` needed).
