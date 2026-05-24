import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Service } from "./types";
import { SUDO_PASSWORD_FILE, SYSTEMD_UNIT_PREFIX } from "./config";

const SUDO_PASSWORD = fs.readFileSync(SUDO_PASSWORD_FILE, "utf-8").trim() + "\n";

function sh(cmd: string): string {
  return execSync(cmd, { stdio: "pipe" }).toString();
}

function sudoExec(cmd: string, stdin?: string): string {
  return execSync(`sudo -S ${cmd}`, {
    input: SUDO_PASSWORD + (stdin || ""),
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
}

function unitName(name: string): string {
  return `agent-stack-${name}.service`;
}

function unitPath(name: string): string {
  return `/etc/systemd/system/${unitName(name)}`;
}

export function exists(name: string): boolean {
  try {
    sh(`systemctl cat ${unitName(name)}`);
    return true;
  } catch {
    return false;
  }
}

export function isRunning(name: string): boolean {
  try {
    const out = sh(`systemctl is-active ${unitName(name)}`).trim();
    return out === "active";
  } catch {
    return false;
  }
}

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

export function ensure(service: Service): void {
  console.log(`[service] ensuring ${service.name}`);
  const content = generateUnitContent(service);
  const dst = unitPath(service.name);
  let needsUpdate = true;
  try {
    const existing = fs.readFileSync(dst, "utf-8");
    needsUpdate = existing !== content;
  } catch {
    // file doesn't exist, needs creation
  }
  if (needsUpdate) {
    const tmp = `/tmp/agent-stack-${service.name}.service`;
    fs.writeFileSync(tmp, content, "utf-8");
    sudoExec(`cp ${tmp} ${dst}`);
    fs.unlinkSync(tmp);
    try {
      sudoExec("systemctl daemon-reload");
    } catch {
      /* ignore */
    }
    try {
      sudoExec(`systemctl enable ${unitName(service.name)}`);
    } catch {
      /* ignore */
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
