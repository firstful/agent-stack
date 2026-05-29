#!/usr/bin/env python3
"""
agent-stack log collector.

Tails podman container logs, systemd journal units, and log files,
then ships structured entries to Quickwit's ingest API for KQL querying.

Usage:
  python3 collector.py                    # foreground
  python3 collector.py --daemon           # background with pidfile
  python3 collector.py --once             # collect existing logs and exit

Environment:
  QUICKWIT_URL   default: http://localhost:7280
  INDEX_ID       default: otel-logs-v1
  BATCH_SIZE     default: 50
  FLUSH_SECONDS  default: 5
"""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ── Config ──────────────────────────────────────────────────────────────

QUICKWIT_URL = os.environ.get("QUICKWIT_URL", "http://localhost:7280")
INDEX_ID = os.environ.get("INDEX_ID", "otel-logs-v1")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "50"))
FLUSH_SECONDS = int(os.environ.get("FLUSH_SECONDS", "5"))
CONTROLLER_LOG = "/srv/agent-stack/infra/controller.log"
PIDFILE = "/tmp/agent-stack-log-collector.pid"

# Podman containers may be running under different users (root + reeds)
PODMAN_USERS = os.environ.get("PODMAN_USERS", "root,reeds").split(",")

SYSTEMD_UNITS = [
    "agent-stack-appflowy",
    "agent-stack-cockpit",
    "agent-stack-code",
    "agent-stack-hermes-gateway",
    "agent-stack-hermes",
    "agent-stack-shellular",
]

# Regex to guess severity from a log line
SEVERITY_RE = re.compile(
    r'\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL|SEVERE)\b', re.IGNORECASE
)

# ── Log Entry Builder ───────────────────────────────────────────────────

def make_entry(service: str, body: str, severity: str = "INFO",
               attrs: dict | None = None) -> dict:
    """Build a structured log entry for Quickwit's otel-logs-v1 schema."""
    # Extract severity if present in the body
    m = SEVERITY_RE.search(body)
    if m:
        sev = m.group(1).upper()
        # Normalize
        severity = {"WARN": "WARN", "WARNING": "WARN", "FATAL": "ERROR",
                    "CRITICAL": "ERROR", "SEVERE": "ERROR", "DEBUG": "DEBUG",
                    "TRACE": "TRACE"}.get(sev, sev)

    return {
        "timestamp_nanos": int(time.time() * 1_000_000_000),
        "body": body.rstrip("\n"),
        "severity_text": severity,
        "service_name": service,
        "attributes": attrs or {},
    }


# ── Quickwit Client ─────────────────────────────────────────────────────

class QuickwitClient:
    """Batched HTTP client for Quickwit ingest."""

    def __init__(self):
        self.batch: list[dict] = []
        self.lock = threading.Lock()
        self.running = True
        self._ensure_index()

    def _ensure_index(self):
        """Create the log index in Quickwit if it doesn't exist."""
        # Check if index exists
        req = Request(f"{QUICKWIT_URL}/api/v1/indexes/{INDEX_ID}", method="GET")
        try:
            urlopen(req, timeout=5)
            log(f"index '{INDEX_ID}' already exists")
            return
        except HTTPError as e:
            if e.code != 404:
                log(f"index check failed: {e.code}", "WARN")
                return
        except URLError:
            log("quickwit not reachable yet, will retry on first flush", "WARN")
            return

        # Create the index
        schema_path = "/srv/agent-stack/config/observability/quickwit/logs-index.yaml"
        if os.path.exists(schema_path):
            with open(schema_path) as f:
                # Quickwit also accepts JSON schema via REST
                # But for YAML-based, it's easier to use quickwit CLI
                pass

        # Try via quickwit CLI
        try:
            subprocess.run(
                ["quickwit", "index", "create", "--index-config", schema_path,
                 "--overwrite"],
                capture_output=True, text=True, timeout=30
            )
            log(f"index '{INDEX_ID}' created via CLI")
        except Exception as e:
            log(f"could not create index via CLI: {e}", "WARN")
            log("will try REST API on first flush", "WARN")

    def add(self, entry: dict):
        with self.lock:
            self.batch.append(entry)
            if len(self.batch) >= BATCH_SIZE:
                batch = list(self.batch)
                self.batch.clear()
                threading.Thread(target=self._send, args=(batch,), daemon=True).start()

    def flush(self):
        with self.lock:
            if not self.batch:
                return
            batch = list(self.batch)
            self.batch.clear()
        self._send(batch)

    def _send(self, entries: list[dict]):
        if not entries:
            return
        try:
            data = json.dumps(entries).encode("utf-8")
            req = Request(
                f"{QUICKWIT_URL}/api/v1/{INDEX_ID}/ingest",
                data=data,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            resp = urlopen(req, timeout=15)
            if resp.status not in (200, 204):
                log(f"ingest returned {resp.status}", "WARN")
        except HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            log(f"ingest failed ({e.code}): {body}", "ERROR")
            # Try to create index if not found
            if e.code == 404:
                self._ensure_index()
        except URLError as e:
            log(f"ingest connection failed: {e.reason}", "WARN")
        except Exception as e:
            log(f"ingest error: {e}", "ERROR")


# ── Tailers ─────────────────────────────────────────────────────────────

def _podman_cmd(user: str, args: list[str]) -> list[str]:
    """Return the podman command for a given user."""
    if user == "root":
        return ["podman"] + args
    # For non-root users, construct the full shell command for su -c
    cmd_str = "podman " + " ".join(shlex.quote(a) for a in args)
    return ["su", "-", user, "-c", cmd_str]

def tail_podman(qw: QuickwitClient):
    """Tail logs from all running podman containers across users."""
    seen_by_user: dict[str, set[str]] = {}

    while qw.running:
        for user in PODMAN_USERS:
            if user not in seen_by_user:
                seen_by_user[user] = set()
            seen = seen_by_user[user]

            try:
                cmd = _podman_cmd(user, ["ps", "--format", "{{.Names}}"])
                out = subprocess.check_output(cmd, text=True, timeout=15)
                containers = {n.strip() for n in out.split("\n") if n.strip()}

                # Start tailing new containers
                for name in containers - seen:
                    if not qw.running:
                        return
                    t = threading.Thread(
                        target=_tail_container,
                        args=(qw, user, name),
                        daemon=True,
                        name=f"tail-{user}-{name}",
                    )
                    t.start()
                    seen.add(name)

                # Remove stopped containers from seen set
                seen &= containers

            except subprocess.TimeoutExpired:
                log(f"podman ps timed out for user {user}", "WARN")
            except subprocess.CalledProcessError as e:
                log(f"podman ps failed for user {user}: {e}", "WARN")
            except Exception as e:
                log(f"podman tail error for user {user}: {e}", "WARN")

        for _ in range(30):
            if not qw.running:
                return
            time.sleep(1)


def _tail_container(qw: QuickwitClient, user: str, name: str):
    """Follow a single container's logs."""
    service = f"container:{name}"
    log(f"tailing container ({user}): {name}")
    try:
        cmd = _podman_cmd(user, ["logs", "-f", "--since", "30s", name])
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for line in proc.stdout:
            if not qw.running:
                proc.terminate()
                return
            line = line.rstrip("\n")
            if line:
                qw.add(make_entry(service, line))
    except Exception as e:
        log(f"container {user}:{name} tail stopped: {e}", "WARN")


def tail_journald(qw: QuickwitClient):
    """Tail systemd service logs."""
    for unit in SYSTEMD_UNITS:
        t = threading.Thread(
            target=_tail_journal_unit,
            args=(qw, unit),
            daemon=True,
            name=f"tail-journal-{unit}",
        )
        t.start()


def _tail_journal_unit(qw: QuickwitClient, unit: str):
    """Follow a single systemd unit's journal."""
    service = f"systemd:{unit}"
    log(f"tailing journal: {unit}")
    try:
        proc = subprocess.Popen(
            ["journalctl", "-f", "-u", unit, "-o", "cat", "--since", "1min"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        for line in proc.stdout:
            if not qw.running:
                proc.terminate()
                return
            line = line.rstrip("\n")
            if line:
                qw.add(make_entry(service, line))
    except FileNotFoundError:
        pass  # journalctl not available
    except Exception as e:
        log(f"journal {unit} tail stopped: {e}", "DEBUG")


def tail_file(qw: QuickwitClient, path: str, service: str):
    """Tail a log file."""
    log(f"tailing file: {path}")
    try:
        proc = subprocess.Popen(
            ["tail", "-f", "-n", "0", path],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        for line in proc.stdout:
            if not qw.running:
                proc.terminate()
                return
            line = line.rstrip("\n")
            if line:
                qw.add(make_entry(service, line))
    except Exception as e:
        log(f"file {path} tail stopped: {e}", "WARN")


# ── Logging ─────────────────────────────────────────────────────────────

def log(msg: str, level: str = "INFO"):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    print(f"[{ts}] [log-collector] [{level}] {msg}", flush=True)


# ── Main ────────────────────────────────────────────────────────────────

def main():
    # Parse args
    args = set(sys.argv[1:])
    daemon = "--daemon" in args
    once = "--once" in args

    if daemon:
        if os.path.exists(PIDFILE):
            with open(PIDFILE) as f:
                pid = f.read().strip()
            if os.path.exists(f"/proc/{pid}"):
                log(f"already running (pid {pid})")
                return
            os.unlink(PIDFILE)
        with open(PIDFILE, "w") as f:
            f.write(str(os.getpid()))

    qw = QuickwitClient()

    def shutdown(signum, frame):
        log(f"received signal {signum}, shutting down")
        qw.running = False
        qw.flush()
        if daemon and os.path.exists(PIDFILE):
            os.unlink(PIDFILE)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Start tailers
    threads = [
        threading.Thread(target=tail_podman, args=(qw,), daemon=True),
        threading.Thread(target=tail_journald, args=(qw,), daemon=True),
    ]

    if os.path.exists(CONTROLLER_LOG):
        t = threading.Thread(
            target=tail_file,
            args=(qw, CONTROLLER_LOG, "controller"),
            daemon=True,
        )
        threads.append(t)

    for t in threads:
        t.start()

    if once:
        time.sleep(2)
        qw.flush()
        log("collected existing logs, exiting")
        return

    log(f"log collector started (index={INDEX_ID}, url={QUICKWIT_URL})")

    # Main loop — periodic flush
    try:
        while qw.running:
            time.sleep(FLUSH_SECONDS)
            qw.flush()
    except KeyboardInterrupt:
        shutdown(0, None)


if __name__ == "__main__":
    main()
