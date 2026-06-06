# Cloudflare Access

## Overview

Services exposed via Cloudflare Tunnel use Cloudflare Access for authentication. This document explains how to obtain and use service tokens for programmatic access.

## Service Tokens

Cloudflare Access service tokens allow automated systems (CI/CD, scripts, API clients) to authenticate to Cloudflare-protected endpoints without interactive login.

### Required Headers

For programmatic access to `*.ffilt.us` endpoints, include these headers:

```
CF-Access-Client-Id: <access-client-id>
CF-Access-Client-Secret: <access-client-secret>
```

### Obtaining Tokens

Service tokens are configured in the Cloudflare Zero Trust dashboard under Access → Service Auth.

## Authentication Flow

1. Client sends request with CF-Access-Client-Id and CF-Access-Client-Secret headers
2. Cloudflare validates the token against the configured service auth policy
3. If valid, request is forwarded to the tunnel → slot-proxy → target service
4. If invalid, Cloudflare returns a 403/401 response

## Configuration

Tunnel configuration is managed by `infra/lib/cloudflared.ts`, which writes `/etc/cloudflared/config.yml`.
