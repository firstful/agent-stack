/**
 * perf.ts — Performance metrics collection and history for the agent-stack controller.
 *
 * Collects system-level and per-container performance snapshots at 5-minute intervals:
 *   - System CPU utilisation (delta-based from /proc/stat)
 *   - Memory usage (from `free -m` or /proc/meminfo fallback)
 *   - Disk I/O throughput (delta-based from /proc/diskstats)
 *   - Load average (from /proc/loadavg)
 *   - Per-container stats from podman stats (CPU, memory, network, block I/O)
 *   - Top-CPU and top-memory processes from ps aux
 *
 * Snapshots are persisted to runtime/perf-history.json (max 288 entries = 24 h).
 * All parsers are wrapped in try-catch so a single flaky command never crashes
 * the collection tick.  The module maintains in-memory state for CPU and disk
 * deltas between successive readings.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { RUNTIME_DIR } from "./config";

// ── Config ──

export const PERF_HISTORY_FILE = path.join(RUNTIME_DIR, "perf-history.json");
export const MAX_SNAPSHOTS = 288; // 24 hours at 5-minute intervals

let _historyFile = PERF_HISTORY_FILE;

/**
 * Override the default performance history file path (used by tests).
 * Calling this replaces the internal path used by loadHistory/saveHistory.
 * @param filepath - Absolute path to the perf-history JSON file
 */
export function setHistoryFile(filepath: string): void {
  _historyFile = filepath;
}
function historyFile(): string {
  return _historyFile;
}

// ── Types ──

export interface SystemSnapshot {
  ts: string;
  cpuPercent: number;
  memPercent: number;
  memUsedMB: number;
  memTotalMB: number;
  loadAvg: [number, number, number];
  diskReadKBps: number;
  diskWriteKBps: number;
}

export interface ContainerSnapshot {
  name: string;
  cpuPercent: number;
  memUsageMB: number;
  memPercent: number;
  netInKB: number;
  netOutKB: number;
  blockInKB: number;
  blockOutKB: number;
}

export interface ProcessSnapshot {
  pid: number;
  user: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  memMB: number;
}

export interface PerfSnapshot {
  system: SystemSnapshot;
  containers: ContainerSnapshot[];
  topCpuProcesses: ProcessSnapshot[];
  topMemProcesses: ProcessSnapshot[];
}

export interface PerfHistory {
  snapshots: PerfSnapshot[];
}

// ── State ──

// In-memory previous readings for delta calculations
let prevCpuStat: CpuStat | null = null;
let prevDiskStats: Map<string, DiskStat> | null = null;
let prevSnapshotTime = 0;

interface CpuStat {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

interface DiskStat {
  device: string;
  sectorsRead: number;
  sectorsWritten: number;
}

// ── Helpers ──

/**
 * Execute a shell command safely, returning empty string on failure.
 * Used throughout perf collection so a single flaky command never crashes
 * the snapshot tick.  All non-public helpers inherit this resilience.
 */
function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 30000 }).toString().trim();
  } catch {
    return "";
  }
}

/**
 * Safe exec alias for rootless podman commands.
 * The controller runs as user `reeds`, so direct podman exec is fine.
 * This function exists as a readable alias to document intent:
 * commands routed through safeExecAsReeds() are podman operations
 * that could fail if the podman socket is missing during startup.
 */
function safeExecAsReeds(cmd: string): string {
  return safeExec(cmd);
}

// ── CPU ──

/**
 * Parse per-CPU time counters from /proc/stat.
 * Returns a CpuStat struct with all tick counters for the aggregate CPU line.
 * Used as input to calcCpuPercent() to compute a delta-based utilisation
 * percentage between two successive readings.
 */
function parseCpuStat(): CpuStat {
  const line = fs.readFileSync("/proc/stat", "utf-8").split("\n")[0];
  const parts = line.trim().split(/\s+/);
  return {
    user: parseInt(parts[1] || "0", 10),
    nice: parseInt(parts[2] || "0", 10),
    system: parseInt(parts[3] || "0", 10),
    idle: parseInt(parts[4] || "0", 10),
    iowait: parseInt(parts[5] || "0", 10),
    irq: parseInt(parts[6] || "0", 10),
    softirq: parseInt(parts[7] || "0", 10),
    steal: parseInt(parts[8] || "0", 10),
  };
}

/**
 * Compute CPU utilisation percentage from two successive /proc/stat snapshots.
 * Calculates the ratio of active ticks to total ticks between prev and curr,
 * yielding the fraction of time the CPU(s) spent doing work over the interval.
 * @returns 0 – 100, clamped to valid range
 */
function calcCpuPercent(prev: CpuStat, curr: CpuStat): number {
  const prevActive =
    prev.user +
    prev.nice +
    prev.system +
    prev.irq +
    prev.softirq +
    prev.steal;
  const prevTotal = prevActive + prev.idle + prev.iowait;
  const currActive =
    curr.user +
    curr.nice +
    curr.system +
    curr.irq +
    curr.softirq +
    curr.steal;
  const currTotal = currActive + curr.idle + curr.iowait;
  const diffActive = currActive - prevActive;
  const diffTotal = currTotal - prevTotal;
  if (diffTotal <= 0) return 0;
  return Math.min(100, Math.max(0, (100 * diffActive) / diffTotal));
}

// ── Disk ──

/**
 * Parse block-device I/O counters from /proc/diskstats.
 * Filters to whole block devices (those present in /sys/block) so
 * partition siblings are excluded.  Each entry tracks cumulative
 * sector reads/writes for delta-based throughput calculation.
 */
function parseDiskStats(): Map<string, DiskStat> {
  const map = new Map<string, DiskStat>();
  const lines = fs.readFileSync("/proc/diskstats", "utf-8").split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const device = parts[2];
    // Skip partitions (devices ending with digits that are not the whole name
    // of a known disk). A simple heuristic: skip if it contains a digit after a letter
    // and isn't a whole NVMe device like nvme0n1.
    // Simpler: only include devices that lsblk would list as disk.
    // We'll filter later by checking if device exists in /sys/block.
    if (!fs.existsSync(`/sys/block/${device}`)) continue;
    map.set(device, {
      device,
      sectorsRead: parseInt(parts[5], 10),
      sectorsWritten: parseInt(parts[9], 10),
    });
  }
  return map;
}

/**
 * Compute aggregate disk read/write throughput in KB/s from two
 * successive /proc/diskstats snapshots.  Sector count is multiplied
 * by 512 (bytes per sector) and divided by elapsed seconds.
 * @returns readKBps and writeKBps (aggregated across all block devices)
 */
function calcDiskThroughput(
  prev: Map<string, DiskStat>,
  curr: Map<string, DiskStat>,
  seconds: number
): { readKBps: number; writeKBps: number } {
  let readSectors = 0;
  let writeSectors = 0;
  for (const [device, stat] of curr) {
    const p = prev.get(device);
    if (!p) continue;
    readSectors += Math.max(0, stat.sectorsRead - p.sectorsRead);
    writeSectors += Math.max(0, stat.sectorsWritten - p.sectorsWritten);
  }
  const bytesPerSector = 512;
  return {
    readKBps: (readSectors * bytesPerSector) / 1024 / seconds,
    writeKBps: (writeSectors * bytesPerSector) / 1024 / seconds,
  };
}

// ── System ──

/**
 * Parse system load average from /proc/loadavg.
 * @returns [1min, 5min, 15min] load averages, or [0,0,0] on read failure
 */
function parseLoadAvg(): [number, number, number] {
  try {
    const line = fs.readFileSync("/proc/loadavg", "utf-8").trim();
    const parts = line.split(" ");
    return [
      parseFloat(parts[0]),
      parseFloat(parts[1]),
      parseFloat(parts[2]),
    ];
  } catch {
    return [0, 0, 0];
  }
}

/**
 * Parse memory usage from `free -m` output, falling back to /proc/meminfo.
 * Returns used/total in megabytes and a percentage.  The fallback path
 * computes `used = total - available` to match `free` semantics.
 */
function parseMemory(): { usedMB: number; totalMB: number; percent: number } {
  try {
    const out = execSync("free -m").toString();
    const match = out.match(/Mem:\s+(\d+)\s+(\d+)/);
    if (match) {
      const total = parseInt(match[1], 10);
      const used = parseInt(match[2], 10);
      return {
        totalMB: total,
        usedMB: used,
        percent: Math.round((100 * used) / total * 10) / 10,
      };
    }
  } catch {
    // fall through
  }
  // Fallback to /proc/meminfo
  try {
    const text = fs.readFileSync("/proc/meminfo", "utf-8");
    const totalMatch = text.match(/MemTotal:\s+(\d+)/);
    const availMatch = text.match(/MemAvailable:\s+(\d+)/);
    if (totalMatch && availMatch) {
      const total = parseInt(totalMatch[1], 10) / 1024;
      const avail = parseInt(availMatch[1], 10) / 1024;
      const used = total - avail;
      return {
        totalMB: Math.round(total),
        usedMB: Math.round(used),
        percent: Math.round((100 * used) / total * 10) / 10,
      };
    }
  } catch {
    // ignore
  }
  return { totalMB: 0, usedMB: 0, percent: 0 };
}

// ── Parsing Utilities ──

/**
 * Parse a size string (e.g. "18.6MB", "345.4kB", "1.678GB") to kilobytes.
 * Handles B, kB, MB, GB, TB units.  Returns 0 for unparseable input.
 * Used by parsePodmanStats to normalise podman stats output.
 */
function parseSizeToKB(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9.]+)\s*(B|kB|MB|GB|TB)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  switch (unit) {
    case "B":
      return num / 1024;
    case "KB":
      return num;
    case "MB":
      return num * 1024;
    case "GB":
      return num * 1024 * 1024;
    case "TB":
      return num * 1024 * 1024 * 1024;
    default:
      return num;
  }
}

/**
 * Parse a percentage string (e.g. "12.5%") to its numeric value.
 * Strips the trailing '%' character and returns the float.
 * Returns 0 for unparseable input.
 */
function parsePercent(value: string): number {
  const trimmed = value.trim().replace("%", "");
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
}

// ── Container Stats ──

/**
 * Collect per-container resource usage via `podman stats --no-stream`.
 * Parses tab-delimited output into structured ContainerSnapshot records.
 * Each record includes: name, CPU%, memory usage, network I/O, and block I/O.
 * Returns an empty array if podman is unavailable or no containers exist.
 */
function parsePodmanStats(): ContainerSnapshot[] {
  const out = safeExecAsReeds(
    'podman stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"'
  );
  if (!out) return [];
  const containers: ContainerSnapshot[] = [];
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 6) continue;
    const [name, cpuStr, memUsageStr, memPercStr, netIOStr, blockIOStr] = parts;
    if (!name) continue;

    // memUsageStr: "18.6MB / 16.71GB"
    const memUsedStr = memUsageStr.split("/")[0]?.trim() || "0B";
    const memUsageMB = parseSizeToKB(memUsedStr) / 1024;

    // netIOStr: "345.4kB / 1.678kB"
    const [netInStr, netOutStr] = netIOStr.split("/");
    const netInKB = parseSizeToKB(netInStr || "0B");
    const netOutKB = parseSizeToKB(netOutStr || "0B");

    // blockIOStr: "0B / 0B"
    const [blockInStr, blockOutStr] = blockIOStr.split("/");
    const blockInKB = parseSizeToKB(blockInStr || "0B");
    const blockOutKB = parseSizeToKB(blockOutStr || "0B");

    containers.push({
      name: name.trim(),
      cpuPercent: parsePercent(cpuStr),
      memUsageMB: Math.round(memUsageMB * 100) / 100,
      memPercent: parsePercent(memPercStr),
      netInKB: Math.round(netInKB * 100) / 100,
      netOutKB: Math.round(netOutKB * 100) / 100,
      blockInKB: Math.round(blockInKB * 100) / 100,
      blockOutKB: Math.round(blockOutKB * 100) / 100,
    });
  }
  return containers;
}

// ── Process Stats ──

/**
 * Collect top processes by CPU or memory usage.
 * Runs `ps aux` sorted by the chosen metric and returns the top 20 entries
 * as ProcessSnapshot records.  Podman's own stat processes are filtered out
 * to avoid polluting the results with monitoring noise.
 * @param sortBy - "cpu" or "mem" — the column to sort by descending
 */
function parseProcesses(sortBy: "cpu" | "mem"): ProcessSnapshot[] {
  const sortFlag = sortBy === "cpu" ? "--sort=-%cpu" : "--sort=-%mem";
  const out = safeExec(`ps aux ${sortFlag} | head -21`);
  if (!out) return [];
  const lines = out.split("\n");
  const processes: ProcessSnapshot[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
    // We need to split carefully because COMMAND can have spaces.
    const m = line.match(
      /^(\S+)\s+(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/
    );
    if (!m) continue;
    const pid = parseInt(m[2], 10);
    const cpu = parseFloat(m[3]);
    const mem = parseFloat(m[4]);
    const rss = parseInt(m[6], 10);
    const command = m[11].trim();
    // Skip the podman top helper processes that skew data
    if (command.includes("podman top") || command.includes("podman stats")) continue;
    processes.push({
      pid,
      user: m[1],
      command: command.length > 80 ? command.slice(0, 80) + "..." : command,
      cpuPercent: cpu,
      memPercent: mem,
      memMB: Math.round((rss / 1024) * 100) / 100,
    });
  }
  return processes.slice(0, 20);
}

// ── Persistence ──

/**
 * Load performance history from disk.
 */
export function loadHistory(): PerfHistory {
  try {
    const raw = fs.readFileSync(historyFile(), "utf-8");
    const parsed = JSON.parse(raw) as PerfHistory;
    if (!Array.isArray(parsed.snapshots)) return { snapshots: [] };
    return parsed;
  } catch {
    return { snapshots: [] };
  }
}

function saveHistory(history: PerfHistory): void {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(history, null, 2));
  } catch {
    // ignore write errors
  }
}

// ── Snapshot Collection ──

/**
 * Collect a full performance snapshot (system + containers + processes),
 * append it to the history, and trim to MAX_SNAPSHOTS.
 */
export function collectSnapshot(): PerfSnapshot {
  const now = Date.now();
  const currCpu = parseCpuStat();
  const currDisk = parseDiskStats();

  let cpuPercent = 0;
  let diskReadKBps = 0;
  let diskWriteKBps = 0;

  if (prevCpuStat && prevDiskStats && prevSnapshotTime > 0) {
    const seconds = Math.max(1, (now - prevSnapshotTime) / 1000);
    cpuPercent = calcCpuPercent(prevCpuStat, currCpu);
    const disk = calcDiskThroughput(prevDiskStats, currDisk, seconds);
    diskReadKBps = Math.round(disk.readKBps * 100) / 100;
    diskWriteKBps = Math.round(disk.writeKBps * 100) / 100;
  }

  prevCpuStat = currCpu;
  prevDiskStats = currDisk;
  prevSnapshotTime = now;

  const mem = parseMemory();
  const load = parseLoadAvg();
  const containers = parsePodmanStats();
  const topCpu = parseProcesses("cpu");
  const topMem = parseProcesses("mem");

  const snapshot: PerfSnapshot = {
    system: {
      ts: new Date(now).toISOString(),
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memPercent: mem.percent,
      memUsedMB: mem.usedMB,
      memTotalMB: mem.totalMB,
      loadAvg: load,
      diskReadKBps,
      diskWriteKBps,
    },
    containers,
    topCpuProcesses: topCpu,
    topMemProcesses: topMem,
  };

  // Append to history and trim
  const history = loadHistory();
  history.snapshots.push(snapshot);
  if (history.snapshots.length > MAX_SNAPSHOTS) {
    history.snapshots = history.snapshots.slice(-MAX_SNAPSHOTS);
  }
  saveHistory(history);

  return snapshot;
}

// ── API ──

/**
 * Return the full performance history.
 */
export function getHistory(): PerfHistory {
  return loadHistory();
}

/**
 * Return the most recent performance snapshot, or null if none exist.
 */
export function getLatestSnapshot(): PerfSnapshot | null {
  const history = loadHistory();
  return history.snapshots[history.snapshots.length - 1] || null;
}
