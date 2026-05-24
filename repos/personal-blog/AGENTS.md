# Repo: personal-blog

## Service Config

Desired state: `/srv/agent-stack/desired/personal-blog.json`

## Containerfile

This repo contains a `Containerfile` that builds the image `stack/personal-blog:latest`.

## Deployment Workflow

1. **Make changes** to this repo (Containerfile, source code, etc.)
2. **Create `.wip`** at the repo root to block auto-rebuilds:
   ```
   touch /srv/agent-stack/repos/personal-blog/.wip
   ```
3. Test your changes locally inside the running container if needed
4. **Remove `.wip`** when ready to deploy:
   ```
   rm /srv/agent-stack/repos/personal-blog/.wip
   ```
   The controller will detect the change within 5 seconds, rebuild the image, and recreate the container.

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `/srv/agent-stack/desired/personal-blog.json` directly — this always triggers a container recreation (no `.wip` needed).
