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

## System-Wide Transparent Proxy

This machine runs a transparent MITM proxy (`cf-proxy-mitm.service`) that
intercepts all outbound TCP/80 and TCP/443 traffic, and injects
`CF-Access-Client-Id` and `CF-Access-Client-Secret` headers automatically when
the destination matches `*.ffilt.us`.

The proxy uses mitmproxy with its CA certificate installed in the system trust
store, so HTTPS traffic is handled seamlessly.

**What this means for you:**

- Any `curl`, `wget`, browser, or tool on this machine accessing `*.ffilt.us`
  will automatically receive valid CF-Access headers.
- No need to set `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` env vars.
- When the proxy is not running, traffic falls through normally (fail-open).

**Maintenance:**

```bash
systemctl status cf-proxy-mitm              # Check status
tail -f /var/log/cf-proxy/intercepted.log   # Watch intercepted requests
```

To temporarily bypass the proxy (e.g. to test a container directly), stop it:

```bash
systemctl stop cf-proxy-mitm
```
