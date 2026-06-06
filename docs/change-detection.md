# Change Detection & Rebuild Triggers

## Overview

The controller detects when a service's source has changed and triggers a rebuild. There are two detection mechanisms working together.

## Config Hash

An MD5 hash of the `agent-stack.json` contents. **Any edit triggers a rebuild immediately.**

## Repo / Commit Hash

For repos inside the monorepo, uses `git log -1 --format=%H` for the subdirectory. **Only triggers a rebuild after `git commit`.** Uncommitted changes are ignored.

## Fallback

If git isn't available, falls back to recursive MD5 of all files in the repo directory.

## Combined Hash

`md5(configHash + repoHash)` → stored in `/tmp/stack.<name>.hash`

## Skip-Build Mechanism

Commit messages containing `[stack skip-build]` defer the rebuild so the agent can make multiple commits without triggering a build per commit.

## .stackignore

Files matching gitignore-style patterns in `.stackignore` are excluded from the content hash so trivial changes (docs, config metadata) don't trigger container rebuilds.
