#!/bin/bash
# Groceries data sync configuration
# Edit these values for your deployment
SERVER_HOST="groceries.ffilt.us"
SERVER_PORT=""            # e.g. "2222" for non-standard SSH, or 8080 for API
SERVER_API_KEY=""         # API key for authentication (future use)
SYNC_MODE="api"           # "api" = POST via HTTP, "scp" = direct file copy
