#!/bin/bash
# Migrate /srv/agent-stack to a monorepo with bare repo at /srv/git/infra.git
# Run from the host as reeds (not inside the agent-stack container).
set -e

BARE=/srv/git/infra.git
WORKING=/srv/agent-stack
BRANCH=main

echo "==> Creating bare repo at $BARE"
mkdir -p "$(dirname "$BARE")"
git init --bare "$BARE"

echo "==> Initializing monorepo in $WORKING"
cd "$WORKING"

# Remove any stray .git dirs in subdirectories (services sometimes have their own)
echo "==> Removing nested .git directories"
find . -mindepth 2 -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true

# Init the monorepo if not already
if [ ! -d ".git" ]; then
  git init
fi

# Configure user for the commit
git config user.email "agent-stack@ffilt.us"
git config user.name "Agent Stack"

# Stage everything — .gitignore already excludes runtime/, secrets, logs, etc.
echo "==> Creating initial commit"
git add -A
if git diff --cached --quiet; then
  echo "  nothing to commit"
else
  git commit -m "initial monorepo import"
fi

# Set up remote and push
echo "==> Pushing to bare repo at $BARE"
git remote remove origin 2>/dev/null || true
git remote add origin "$BARE"
git push -u origin "$BRANCH"

echo "==> Adding post-receive hook for GitHub mirror"
HOOK="$BARE/hooks/post-receive"
cat > "$HOOK" << 'HOOK'
#!/bin/bash
# Push mirror to GitHub on every push.
# Replace 'your-org/infra.git' with your actual GitHub repo.
# GITHUB_REMOTE="git@github.com:your-org/infra.git"
# git push --mirror "$GITHUB_REMOTE" 2>/dev/null || echo "[hook] GitHub mirror failed"
HOOK
chmod +x "$HOOK"

echo ""
echo "=== Done ==="
echo ""
echo "To push from your dev machine:"
echo "  git remote add origin reeds@HOST:/srv/git/infra.git"
echo "  git push origin main"
echo ""
echo "To enable GitHub backup:"
echo "  1. Edit $HOOK"
echo "  2. Uncomment GITHUB_REMOTE and set your repo"
