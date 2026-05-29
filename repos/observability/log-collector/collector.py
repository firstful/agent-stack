#!/usr/bin/env python3
"""
agent-stack log collector.

Tails podman container logs, systemd journal units, and log files,
then ships structured entries to Quickwit's ingest API for KQL querying.

Backfill mode (--backfill) bulk-loads recent log history on startup using
a checkpoint file for idempotency — re-running produces zero duplicates.

Usage:
  python3 collector.py                      # follow mode (new logs only)
  python3 collector.py --backfill            # backfill + follow
  python3 collector.py --backfill-only       # backfill once and exit
  python3 collector.py --once               # deprecated, same as --backfill-only

Environment:
  QUICKWIT_URL   default: http://localhost:7280
  INDEX_ID       default: otel-logs-v1
  BATCH_SIZE     default: 50
  FLUSH_SECONDS  default: 5
  PODMAN_USERS   default: root,reeds
  BACKFILL_TAIL  default: 500 (lines per container on backfill)
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
import hashlib
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
CHECKPOINT_FILE = "/tmp/agent-stack-log-collector-checkpoint.json"
BACKFILL_TAIL = int(os.environ.get("BACKFILL_TAIL", "500"))

PODMAN_USERS = os.environ.get("PODMAN_USERS", "root,reeds").split(",")

SYSTEMD_UNITS = [
    "agent-stack-appflowy",
    "agent-stack-cockpit",
    "agent-stack-code",
    "agent-stack-hermes-gateway",
    "agent-stack-hermes",
    "agent-stack-shellular",
]

SEVERITY_RE = re.compile(
    r'\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL|SEVERE)\b', re.IGNORECASE
)

# ── Checkpoint ──────────────────────────────────────────────────────────

class Checkpoint:
    """Persistent cursor tracking for idempotent backfill.

    Format:
    {
      "container:<user>:<name>": <last_timestamp_ns>,
      "journal:<unit>": <cursor_string>,
      "file:<path>": { "ino": <inode>, "offset": <bytes>, "mtime": <float> }
    }
    """

    def __init__(self, path: str = CHECKPOINT_FILE):
        self.path = path
        self.data: dict = {}
        self.lock = threading.Lock()
        self._load()

    def _load(self):
        try:
            with open(self.path) as f:
                self.data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {}

    def save(self):
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.data, f)
            os.rename(tmp, self.path)

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    def set(self, key: str, value):
        self.data[key] = value


# ── Log Entry Builder ───────────────────────────────────────────────────

def make_entry(service: str, body: str, severity: str = "INFO",
               ts_ns: int | None = None, attrs: dict | None = None) -> dict:
    m = SEVERITY_RE.search(body)
    if m:
        sev = m.group(1).upper()
        severity = {"WARN": "WARN", "WARNING": "WARN", "FATAL": "ERROR",
                    "CRITICAL": "ERROR", "SEVERE": "ERROR", "DEBUG": "DEBUG",
                    "TRACE": "TRACE"}.get(sev, sev)

    return {
        "timestamp_nanos": ts_ns or int(time.time() * 1_000_000_000),
        "body": body.rstrip("\n"),
        "severity_text": severity,
        "service_name": service,
        "attributes": attrs or {},
    }


# ── Quickwit Client ─────────────────────────────────────────────────────

class QuickwitClient:
    def __init__(self):
        self.batch: list[dict] = []
        self.lock = threading.Lock()
        self.running = True
        self._ensure_index()

    def _ensure_index(self):
        req = Request(f"{QUICKWIT_URL}/api/v1/indexes/{INDEX_ID}", method="GET")
        try:
            urlopen(req, timeout=5)
            log(f"index '{INDEX_ID}' exists")
            return
        except HTTPError as e:
            if e.code != 404:
                log(f"index check failed: {e.code}", "WARN")
                return
        except URLError:
            log("quickwit not reachable yet, will retry on first flush", "WARN")
            return

        # Create via REST API
        schema = {
            "version": "0.8",
            "index_id": INDEX_ID,
            "doc_mapping": {
                "field_mappings": [
                    {"name": "timestamp_nanos", "type": "datetime",
                     "input_formats": ["unix_timestamp"], "output_format": "unix_timestamp_micros",
                     "fast": True, "fast_precision": "seconds"},
                    {"name": "body", "type": "text", "tokenizer": "default", "record": "position"},
                    {"name": "severity_text", "type": "text"},
                    {"name": "service_name", "type": "text"},
                    {"name": "resource_attributes", "type": "json"},
                    {"name": "attributes", "type": "json"},
                ],
                "timestamp_field": "timestamp_nanos",
                "index_field_presence": True,
            },
            "search_settings": {"default_search_fields": ["body"]},
            "indexing_settings": {"commit_timeout_secs": 10},
        }
        try:
            data = json.dumps(schema).encode()
            req = Request(f"{QUICKWIT_URL}/api/v1/indexes", data=data, method="POST",
                          headers={"Content-Type": "application/json"})
            resp = urlopen(req, timeout=10)
            log(f"index '{INDEX_ID}' created via REST ({resp.status})")
        except Exception as e:
            log(f"could not create index: {e}", "WARN")

    def ingest(self, entries: list[dict]) -> bool:
        """Synchronously send a batch. Returns True on success."""
        if not entries:
            return True
        try:
            # Quickwit expects NDJSON (newline-delimited JSON objects),
            # NOT a JSON array — one doc per line, terminated by newline
            data = "\n".join(json.dumps(e) for e in entries).encode("utf-8")
            req = Request(f"{QUICKWIT_URL}/api/v1/{INDEX_ID}/ingest", data=data,
                          method="POST", headers={"Content-Type": "application/json"})
            resp = urlopen(req, timeout=15)
            ok = resp.status in (200, 204)
            if not ok:
                log(f"ingest returned {resp.status}", "WARN")
            return ok
        except HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            log(f"ingest failed ({e.code}): {body}", "ERROR")
            if e.code == 404:
                self._ensure_index()
            return False
        except URLError as e:
            log(f"ingest connection failed: {e.reason}", "WARN")
            return False
        except Exception as e:
            log(f"ingest error: {e}", "ERROR")
            return False

    def add(self, entry: dict):
        with self.lock:
            self.batch.append(entry)
            if len(self.batch) >= BATCH_SIZE:
                batch = list(self.batch)
                self.batch.clear()
                threading.Thread(target=self.ingest, args=(batch,), daemon=True).start()

    def flush(self):
        with self.lock:
            if not self.batch:
                return
            batch = list(self.batch)
            self.batch.clear()
        self.ingest(batch)


# ── Podman Helpers ──────────────────────────────────────────────────────

def _podman_cmd(user: str, args: list[str]) -> list[str]:
    if user == "root":
        return ["podman"] + args
    cmd_str = "podman " + " ".join(shlex.quote(a) for a in args)
    return ["su", "-", user, "-c", cmd_str]


def _list_containers() -> list[tuple[str, str]]:
    """Return [(user, container_name), ...] for all running containers."""
    result = []
    for user in PODMAN_USERS:
        try:
            cmd = _podman_cmd(user, ["ps", "--format", "{{.Names}}"])
            out = subprocess.check_output(cmd, text=True, timeout=15)
            for name in out.strip().split("\n"):
                if name.strip():
                    result.append((user, name.strip()))
        except Exception:
            pass
    return result


# ── Backfill ────────────────────────────────────────────────────────────

def backfill_podman(qw: QuickwitClient, cp: Checkpoint):
    """Bulk-load recent container logs. Idempotent via nanosecond timestamps."""
    for user, name in _list_containers():
        key = f"container:{user}:{name}"
        last_ts = cp.get(key)
        service = f"container:{name}"
        log(f"backfilling container ({user}): {name}" + (f" (since ts={last_ts})" if last_ts else ""))

        try:
            # Get recent lines with nanosecond timestamps
            cmd = _podman_cmd(user, ["logs", "--timestamps", "--tail", str(BACKFILL_TAIL), name])
            out = subprocess.check_output(cmd, text=True, timeout=30)
            lines = [l for l in out.split("\n") if l.strip()]

            entries = []
            newest_ts = last_ts

            for line in lines:
                # podman --timestamps prefix: "2026-05-29T02:49:12.441442847Z actual log content"
                ts_str = line[:30] if len(line) > 30 and line[29:30] == 'Z' else None
                body = line[31:] if ts_str else line

                if ts_str:
                    try:
                        # Parse RFC 3339 nanosecond timestamp
                        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        ts_ns = int(dt.timestamp() * 1_000_000_000)
                    except ValueError:
                        ts_ns = int(time.time() * 1_000_000_000)
                else:
                    ts_ns = int(time.time() * 1_000_000_000)

                # Skip if already ingested (same or older timestamp)
                if last_ts and ts_ns <= last_ts:
                    continue

                entries.append(make_entry(service, body, ts_ns=ts_ns))
                newest_ts = max(newest_ts, ts_ns) if newest_ts else ts_ns

            if entries:
                qw.ingest(entries)
                if newest_ts:
                    cp.set(key, newest_ts)
                log(f"  → ingested {len(entries)} lines from {name}")
            else:
                log(f"  → 0 new lines (already current)")

        except Exception as e:
            log(f"backfill container {user}:{name} failed: {e}", "WARN")


def backfill_journald(qw: QuickwitClient, cp: Checkpoint):
    """Bulk-load recent systemd journal logs. Idempotent via cursor tracking."""
    for unit in SYSTEMD_UNITS:
        key = f"journal:{unit}"
        cursor = cp.get(key)
        service = f"systemd:{unit}"
        log(f"backfilling journal: {unit}" + (f" (after cursor)" if cursor else ""))

        try:
            # Build args with cursor if we have one
            # Build args — use --after-cursor for incremental or --lines for first backfill
            args = ["journalctl", "-u", unit, "-o", "json"]
            if cursor:
                args.extend(["--after-cursor", cursor])
            else:
                args.extend(["--lines", str(min(BACKFILL_TAIL, 200))])

            out = subprocess.check_output(args, text=True, timeout=30, stderr=subprocess.DEVNULL)
            last_cursor = None
            entries = []

            for raw_line in out.strip().split("\n"):
                if not raw_line.strip():
                    continue
                try:
                    entry = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                body = entry.get("MESSAGE", "")
                # journalctl sometimes outputs binary messages as int arrays
                if isinstance(body, list):
                    body = bytes(body).decode("utf-8", errors="replace")
                body = str(body)
                if not body.strip():
                    continue

                # Use __REALTIME_TIMESTAMP (microseconds) or _SOURCE_REALTIME_TIMESTAMP
                ts_us = entry.get("__REALTIME_TIMESTAMP")
                ts_ns = int(ts_us) * 1000 if ts_us else int(time.time() * 1_000_000_000)

                sev_map = {"6": "INFO", "4": "WARN", "3": "ERROR", "7": "DEBUG",
                           "5": "NOTICE", "2": "CRIT", "1": "ALERT", "0": "EMERG"}
                priority = entry.get("PRIORITY", "6")
                severity = sev_map.get(priority, "INFO")

                entries.append(make_entry(service, body, severity=severity, ts_ns=ts_ns))
                last_cursor = entry.get("__CURSOR", last_cursor)

            if entries:
                qw.ingest(entries)
                if last_cursor:
                    cp.set(key, last_cursor)
                log(f"  → ingested {len(entries)} lines from journal:{unit}")
            else:
                log(f"  → 0 new lines from journal:{unit}")

        except FileNotFoundError:
            pass
        except Exception as e:
            log(f"backfill journal {unit} failed: {e}", "WARN")


def backfill_file(qw: QuickwitClient, cp: Checkpoint, path: str, service: str):
    """Bulk-load a log file. Idempotent via inode+offset tracking."""
    key = f"file:{path}"
    log(f"backfilling file: {path}")
    try:
        st = os.stat(path)
        cp_data = cp.get(key) or {}
        prev_ino = cp_data.get("ino")
        prev_offset = cp_data.get("offset", 0)

        # If inode changed (log rotation), start from scratch
        if prev_ino and prev_ino != st.st_ino:
            log(f"  → file rotated, re-reading from start")
            prev_offset = 0

        current_size = st.st_size
        if current_size <= prev_offset:
            log(f"  → 0 new bytes")
            return

        # Read new bytes only
        with open(path) as f:
            f.seek(prev_offset)
            new_bytes = f.read()

        if not new_bytes.strip():
            cp.set(key, {"ino": st.st_ino, "offset": current_size, "mtime": st.st_mtime})
            return

        entries = []
        for line in new_bytes.split("\n"):
            line = line.strip()
            if line:
                entries.append(make_entry(service, line))

        if entries:
            qw.ingest(entries)
            log(f"  → ingested {len(entries)} lines ({current_size - prev_offset} new bytes)")

        cp.set(key, {"ino": st.st_ino, "offset": current_size, "mtime": st.st_mtime})

    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"backfill file {path} failed: {e}", "WARN")


# ── Follow Tailers ──────────────────────────────────────────────────────

def follow_podman(qw: QuickwitClient):
    """Tail all podman containers, detecting new ones every 30s."""
    seen_by_user: dict[str, set[str]] = {}
    for user, name in _list_containers():
        seen_by_user.setdefault(user, set()).add(name)
        t = threading.Thread(target=_tail_container, args=(qw, user, name), daemon=True)
        t.start()

    while qw.running:
        for user in PODMAN_USERS:
            seen = seen_by_user.get(user, set())
            try:
                cmd = _podman_cmd(user, ["ps", "--format", "{{.Names}}"])
                out = subprocess.check_output(cmd, text=True, timeout=15)
                containers = {n.strip() for n in out.split("\n") if n.strip()}

                for name in containers - seen:
                    t = threading.Thread(target=_tail_container, args=(qw, user, name), daemon=True,
                                         name=f"tail-{user}-{name}")
                    t.start()
                    seen.add(name)

                seen &= containers
            except Exception:
                pass

        for _ in range(30):
            if not qw.running:
                return
            time.sleep(1)


def _tail_container(qw: QuickwitClient, user: str, name: str):
    service = f"container:{name}"
    try:
        cmd = _podman_cmd(user, ["logs", "-f", "--since", "30s", name])
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
        for line in proc.stdout:
            if not qw.running:
                proc.terminate()
                return
            line = line.rstrip("\n")
            if line:
                qw.add(make_entry(service, line))
    except Exception as e:
        log(f"container {user}:{name} tail stopped: {e}", "WARN")


def follow_journald(qw: QuickwitClient):
    for unit in SYSTEMD_UNITS:
        t = threading.Thread(target=_tail_journal_unit, args=(qw, unit), daemon=True)
        t.start()


def _tail_journal_unit(qw: QuickwitClient, unit: str):
    service = f"systemd:{unit}"
    try:
        proc = subprocess.Popen(
            ["journalctl", "-f", "-u", unit, "-o", "cat", "--since", "1min"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        for line in proc.stdout:
            if not qw.running:
                proc.terminate()
                return
            line = line.rstrip("\n")
            if line:
                qw.add(make_entry(service, line))
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"journal {unit} tail stopped: {e}", "DEBUG")


def follow_file(qw: QuickwitClient, path: str, service: str):
    try:
        proc = subprocess.Popen(["tail", "-f", "-n", "0", path],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, bufsize=1)
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
    args = set(sys.argv[1:])
    backfill = "--backfill" in args or "--once" in args
    backfill_only = "--backfill-only" in args or "--once" in args
    daemon = "--daemon" in args

    if daemon and os.path.exists(PIDFILE):
        with open(PIDFILE) as f:
            pid = f.read().strip()
        if os.path.exists(f"/proc/{pid}"):
            log(f"already running (pid {pid})")
            return
        os.unlink(PIDFILE)

    if daemon:
        with open(PIDFILE, "w") as f:
            f.write(str(os.getpid()))

    qw = QuickwitClient()
    cp = Checkpoint()

    def shutdown(signum, frame):
        log(f"received signal {signum}, shutting down")
        qw.running = False
        qw.flush()
        cp.save()
        if daemon and os.path.exists(PIDFILE):
            os.unlink(PIDFILE)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # ── Backfill Phase ──
    if backfill or backfill_only:
        log("starting backfill phase")
        backfill_podman(qw, cp)
        backfill_journald(qw, cp)
        if os.path.exists(CONTROLLER_LOG):
            backfill_file(qw, cp, CONTROLLER_LOG, "controller")
        cp.save()
        log(f"backfill complete")

        if backfill_only:
            qw.flush()
            return

    # ── Follow Phase ──
    threads = [
        threading.Thread(target=follow_podman, args=(qw,), daemon=True),
        threading.Thread(target=follow_journald, args=(qw,), daemon=True),
    ]
    if os.path.exists(CONTROLLER_LOG):
        threads.append(threading.Thread(target=follow_file, args=(qw, CONTROLLER_LOG, "controller"),
                                        daemon=True))

    for t in threads:
        t.start()

    log(f"log collector started in follow mode (index={INDEX_ID}, url={QUICKWIT_URL})")

    try:
        while qw.running:
            time.sleep(FLUSH_SECONDS)
            qw.flush()
    except KeyboardInterrupt:
        shutdown(0, None)
    finally:
        cp.save()


if __name__ == "__main__":
    main()
