# Talaria

Push-to-talk voice agent — Android client + FastAPI WebSocket server.

## Build & Deploy

The APK is auto-versioned with the format `<git-commit-count>.<date>.<time>-<git-hash>`.

### One-step build + deploy

```bash
./build-apk.sh
```

Builds a debug APK, extracts the version from BuildConfig, then copies it to
`/srv/files/apk/Talaria/` with a versioned filename and updates the
`talaria-latest.apk` symlink. Only the 5 most recent builds are retained.

**Deployed URLs:**
- Latest:  https://files.ffilt.us/apk/Talaria/talaria-latest.apk
- Version: https://files.ffilt.us/apk/Talaria/talaria-<version>.apk

### Build only (no deploy)

```bash
./build-apk.sh --no-deploy
```

The raw APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Prerequisites

- Android SDK at `/opt/android-sdk` (set in `android/local.properties`)
- JDK 17+
- The host machine serves `files.ffilt.us` from `/srv/files/`

### Crash Logs

On a crash, the app writes a stack trace to internal storage at
`filesDir/crashes/crash-<timestamp>.txt`. Recent logs and any crash reports
can be shared via the drawer menu → **Share Logs** (no ADB or root required).
