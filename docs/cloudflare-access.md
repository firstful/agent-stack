# Curling `*.ffilt.us` Sites

Services exposed via the Cloudflare Tunnel on `*.ffilt.us` are protected by Cloudflare Access. To make programmatic requests (e.g., with `curl` or scripts) from the host or other services, you must authenticate using a **Cloudflare Access Service Token** via headers.

The following service token can be used to reach any `*.ffilt.us` service programmatically.

## Service Token Headers

```
CF-Access-Client-Id: d2845237d9ac395bde2d9b946431742c.access
CF-Access-Client-Secret: 6aa475541cbe9c694b23cff57627da320f184975247fac2910307c519087ab86
```

## Example

```bash
curl -H "CF-Access-Client-Id: d2845237d9ac395bde2d9b946431742c.access" \
     -H "CF-Access-Client-Secret: 6aa475541cbe9c694b23cff57627da320f184975247fac2910307c519087ab86" \
     https://dash.ffilt.us/api/health
```

> **Security Note**: Treat these tokens as secrets. Do not commit them to public repositories or expose them in client-side code.
