# Repo: fuse

This repo contains a `Dockerfile` that builds the image `stack/fuse:latest`.

## Deployment

1. **Make changes** to this repo (Dockerfile, source code, etc.)
2. **Create `.wip`** at the repo root to block auto-rebuilds:
   ```
   touch /srv/agent-stack/repos/fuse/.wip
   ```
3. Test your changes locally inside the running container if needed
4. **Remove `.wip`** when ready to deploy:
   ```
   rm /srv/agent-stack/repos/fuse/.wip
   ```
   The controller will detect the change within 5 seconds, rebuild the image, and recreate the container.

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `agent-stack.json` in this repo directly — this always triggers a container recreation (no `.wip` needed).
