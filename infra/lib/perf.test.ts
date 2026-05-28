import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import {
  MAX_SNAPSHOTS,
  setHistoryFile,
  loadHistory,
  collectSnapshot,
  getHistory,
  getLatestSnapshot,
} from "./perf";

const tempFile = path.join(os.tmpdir(), `perf-test-${Date.now()}.json`);

before(() => {
  setHistoryFile(tempFile);
});

after(() => {
  try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
});

describe("loadHistory", () => {
  it("returns empty history when file does not exist", () => {
    const history = loadHistory();
    assert.deepStrictEqual(history, { snapshots: [] });
  });
});

describe("collectSnapshot", () => {
  it("collects a snapshot and stores it", () => {
    const snapshot = collectSnapshot();
    assert.ok(snapshot);
    assert.ok(typeof snapshot.system.cpuPercent === "number");
    assert.ok(typeof snapshot.system.memPercent === "number");
    assert.ok(Array.isArray(snapshot.containers));
    assert.ok(Array.isArray(snapshot.topCpuProcesses));
    assert.ok(Array.isArray(snapshot.topMemProcesses));

    const history = getHistory();
    assert.ok(history.snapshots.length > 0);
    const latest = getLatestSnapshot();
    assert.ok(latest);
    assert.strictEqual(latest.system.ts, snapshot.system.ts);
  });
});

describe("rolling window", () => {
  it("trims old snapshots beyond MAX_SNAPSHOTS", () => {
    // Force a large fake history into the temp file
    const fakeSnapshots = Array.from({ length: MAX_SNAPSHOTS + 10 }, (_, i) => ({
      system: {
        ts: new Date(Date.now() - i * 60000).toISOString(),
        cpuPercent: i % 100,
        memPercent: i % 100,
        memUsedMB: i,
        memTotalMB: 16000,
        loadAvg: [0, 0, 0] as [number, number, number],
        diskReadKBps: 0,
        diskWriteKBps: 0,
      },
      containers: [],
      topCpuProcesses: [],
      topMemProcesses: [],
    }));

    fs.writeFileSync(tempFile, JSON.stringify({ snapshots: fakeSnapshots }));

    collectSnapshot();

    const history = getHistory();
    assert.strictEqual(history.snapshots.length, MAX_SNAPSHOTS);
  });
});
