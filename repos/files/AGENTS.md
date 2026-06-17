# files

## About

Simple file hosting service for `file.ffilt.us`.

Serves files from `/srv/files/` with proper Content-Type headers.
HTML pages render in the browser. Archives force download.
Directory listing with index.html support.

## Usage

```
https://file.ffilt.us/<path>
```

## Tech

- Node.js (built-in `http` module, no deps)
- systemd-managed (`agent-stack-files.service`)
- Routes through slot-proxy by Host header
