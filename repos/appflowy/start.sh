#!/bin/bash
set -e
cd /srv/agent-stack/repos/appflowy

# Start postgres and wait for it
/usr/bin/docker-compose up -d postgres
for i in $(seq 1 30); do
  if /usr/bin/docker-compose exec -T postgres pg_isready -U appflowy >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Run initial migration (idempotent)
/usr/bin/docker-compose run --rm appflowy_cloud migrate 2>&1 || echo "migration may have already run"

# Start full stack
exec /usr/bin/docker-compose up
