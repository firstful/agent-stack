# Change Detection

The controller determines whether a service's container needs a rebuild by computing a combined hash of:

1. **Config hash** — `md5` of `agent-stack.json` (or `desired/<name>.json`). Any edit to the config always triggers a rebuild.
2. **Repo hash** — a hash of all files in the service's repo directory, used to detect source/Dockerfile changes.

The combined hash is: `md5(configHash + repoHash)`. If this hash differs from the previous reconciliation, the controller rebuilds the image and recreates the container.

## Git-Aware Hashing

Since the entire `/srv/agent-stack/` tree is a git repository, the controller uses `git log -1 --format=%H -- repos/<service-name>/` to compute the repo hash. This means:

- **Uncommitted file edits do NOT trigger a rebuild.** The `git log` query returns the same commit hash until you `git commit`.
- **After committing**, the next reconciliation (within 5 seconds) detects the new commit hash and triggers a rebuild.
- **Editing `agent-stack.json` always triggers a rebuild**, regardless of commits, because it changes the config hash component.
- **Note:** If `git` fails (e.g., dubious ownership error when the repo is owned by a different user), the controller silently falls back to file-based hashing.

## File-Based Fallback

If `/srv/agent-stack/.git` is not available (e.g., the repo was deployed without git history), or if `git` commands fail (e.g., ownership mismatch), the controller falls back to a recursive `md5` hash of all files in the service directory (excluding `node_modules` and dotfiles). In this mode, any file edit on disk is detected immediately — no commit required.
