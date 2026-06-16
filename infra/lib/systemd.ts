import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Service } from "./types";
import { SUDO_PASSWORD_FILE, SYSTEMD_UNIT_PREFIX } from "./config";

const SUDO_PASSWORD = fs.readFileSync(SUDO_PASSWORD_FILE, "utf-8").trim() + "\n";

// ── Helpers ──

/**
 * Execute a shell command, capturing stdout as a string.
 * Used internally for systemctl queries (is-active, cat, list-units)
 * where only the textual output matters, not the exit code.
 * Unlike execSync with inherit stdio, this captures the output
 * so callers can parse it.
 */
function sh(cmd: string): string {
  return execSync(cmd, { stdio: "pipe" }).toString();
}

/**
 * Run a command via sudo -S (reads password from stdin).  Used for
 * systemctl operations that require root privileges.  The sudo password
 * is read from .sudo-password.txt at startup and piped as stdin.
 *
 * The password is stored in a file readable only by the reeds user,
 * and passed to sudo -S to avoid running the controller as root.
 * The -S flag tells sudo to read the password from stdin rather than
 * prompting on a terminal.
 */
function sudoExec(cmd: string, stdin?: string): string {
  return execSync(`sudo -S ${cmd}`, {
    input: SUDO_PASSWORD + (stdin || ""),
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
}

/** Return the full systemd unit name for a service: agent-stack-<name>.service.
 * This is the unit identifier used in all systemctl commands. */
function unitName(name: string): string {
  return `agent-stack-${name}.service`;
}

/** Return the full filesystem path for a service's systemd unit file
 * at /etc/systemd/system/agent-stack-<name>.service. */
function unitPath(name: string): string {
  return `/etc/systemd/system/${unitName(name)}`;
}

// ── Query ──

/**
 * Check whether a systemd unit file exists on disk.
 * Uses `systemctl cat` to verify the unit is known to systemd.
 * @returns true if the unit file exists
 */
export function exists(name: string): boolean {
  try {
    sh(`systemctl cat ${unitName(name)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a systemd service is currently active.
 * @returns true if the unit's is-active status returns "active"
 */
export function isRunning(name: string): boolean {
  try {
    const out = sh(`systemctl is-active ${unitName(name)}`).trim();
    return out === "active";
  } catch {
    return false;
  }
}

/**
 * List all agent-stack-managed systemd unit names.
 * Parses `systemctl list-units` output filtering for 'agent-stack-*.service'
 * and strips the prefix/suffix to return bare service names.
 * @returns Array of service names (empty if none found or systemctl fails)
 */
export function getManaged(): string[] {
  try {
    const out = sh(
      `systemctl list-units --no-pager --no-legend 'agent-stack-*.service'`
    );
    if (!out.trim()) return [];
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const m = line.trim().match(/^(\S+)/);
        return m
          ? m[1].replace("agent-stack-", "").replace(".service", "")
          : null;
      })
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

// ── Unit Management ──

/**
 * Generate the complete systemd unit file content for a service.
 * Maps the SystemdServiceConfig fields to systemd directives:
 *   - env{} → Environment=KEY=value lines
 *   - exec_reload → ExecReload=
 *   - exec_start → ExecStart=
 *   - restart → Restart=
 *   - user → User=
 * Produces a [Unit]/[Service]/[Install] stanza trio suitable
 * for placing at /etc/systemd/system/agent-stack-<name>.service.
 */
function generateUnitContent(service: Service): string {
  const svc = service.service!;
  const envLines = Object.entries(svc.env || {})
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join("\n");
  const execReload = svc.exec_reload
    ? `ExecReload=${svc.exec_reload}\n`
    : "";

  return `[Unit]
Description=Agent Stack managed service: ${service.name}
After=network-online.target

[Service]
Type=${svc.type || "simple"}
ExecStart=${svc.exec_start}
${execReload}${envLines ? envLines + "\n" : ""}Restart=${svc.restart || "always"}
RestartSec=5
User=${svc.user || "root"}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

// ── Lifecycle ──

/**
 * Ensure a systemd service unit exists and is running.
 * Creates/updates the unit file, reloads systemd, enables, and starts.
 *
 * The write pattern uses a temp file + sudo cp to avoid needing
 * the controller to run as root for writing to /etc/systemd/system.
 * See sudoExec() for the sudo -S password-pipe mechanism.
 */
export function ensure(service: Service): void {
  console.log(`[service] ensuring ${service.name}`);
  const content = generateUnitContent(service);
  const dst = unitPath(service.name);
  // Compare existing unit file content to avoid unnecessary
  // daemon-reload cycles on every reconciliation tick
  let needsUpdate = true;
  try {
    const existing = fs.readFileSync(dst, "utf-8");
    needsUpdate = existing !== content;
  } catch {
    // file doesn't exist, needs creation
  }
  if (needsUpdate) {
    // Write to temp file first (accessible by reeds user), then
    // sudo cp to the protected systemd directory.  This avoids
    // running the whole process as root.
    const tmp = `/tmp/agent-stack-${service.name}.service`;
    fs.writeFileSync(tmp, content, "utf-8");
    sudoExec(`cp ${tmp} ${dst}`);
    fs.unlinkSync(tmp);
    // Reload systemd to pick up new unit definitions
    try {
      sudoExec("systemctl daemon-reload");
    } catch {
      /* ignore — daemon-reload may fail if another reload is in progress */
    }
    // Enable for persistence across reboots
    try {
      sudoExec(`systemctl enable ${unitName(service.name)}`);
    } catch {
      /* ignore — enable may fail if unit is already enabled */
    }
  }
  if (!isRunning(service.name)) {
    console.log(`[service] starting ${service.name}`);
    try {
      sudoExec(`systemctl start ${unitName(service.name)}`);
    } catch (e: any) {
      console.error(
        `[service] failed to start ${service.name}: ${e.message}`
      );
    }
  } else {
    console.log(`[service] ${service.name} already running`);
  }
}

/**
 * Disable, stop, and remove a systemd service unit.
 */
export function remove(name: string): void {
  console.log(`[service] removing ${unitName(name)}`);
  try {
    sudoExec(`systemctl disable --now ${unitName(name)}`);
  } catch {
    /* ignore */
  }
  try {
    sudoExec(`rm -f ${unitPath(name)}`);
  } catch {
    /* ignore */
  }
  try {
    sudoExec("systemctl daemon-reload");
  } catch {
    /* ignore */
  }
}
