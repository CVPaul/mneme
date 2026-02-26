/**
 * Shared dolt server utilities.
 *
 * Used by both `mneme init` and `mneme server`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./utils.mjs";

/**
 * Shared dolt data directory. All projects store their databases here,
 * isolated by database name (e.g. beads_projectA, beads_projectB).
 * One dolt server on port 3307 serves all projects on this machine.
 */
export const DOLT_DATA_DIR = process.env.MNEME_DOLT_DATA_DIR
  || join(process.env.HOME, ".dolt", "databases");

export const DOLT_PORT = parseInt(process.env.MNEME_DOLT_PORT || "3307", 10);

/**
 * Check if a TCP port is accepting connections.
 */
export function isPortOpen(port = DOLT_PORT) {
  return run(`bash -c 'echo > /dev/tcp/127.0.0.1/${port}' 2>&1`) !== null;
}

/**
 * Find dolt sql-server process(es) on the given port.
 * Returns { proc, pid, dataDir } or null if not found.
 *
 * Prefers the actual dolt binary process over bash wrappers.
 */
export function findDoltProcess(port = DOLT_PORT) {
  const psOutput = run(`ps aux 2>/dev/null`) ?? "";
  const doltLines = psOutput.split("\n").filter((line) =>
    line.includes("dolt") && line.includes("sql-server") && line.includes(`${port}`)
    && !line.includes("grep")
  );

  if (doltLines.length === 0) return null;

  // Prefer the actual dolt binary process over a bash wrapper
  const proc = doltLines.find((l) => !l.includes("bash -c") && /\bdolt\s+sql-server\b/.test(l))
    || doltLines[0];

  const pid = proc.trim().split(/\s+/)[1];

  // Extract --data-dir value from the process command line
  const dataDirMatch = proc.match(/--data-dir\s+(\S+)/);
  const dataDir = dataDirMatch ? dataDirMatch[1] : null;

  return { proc, pid, dataDir, allLines: doltLines };
}

/**
 * Ensure the dolt data directory exists.
 */
export function ensureDataDir() {
  if (!existsSync(DOLT_DATA_DIR)) {
    mkdirSync(DOLT_DATA_DIR, { recursive: true });
  }
}

/**
 * Start the dolt server in the background. Returns true if started successfully.
 * Does NOT check if already running — caller should check first.
 */
export function startDoltServer() {
  ensureDataDir();

  const logFile = join(DOLT_DATA_DIR, "server.log");

  run(
    `nohup dolt sql-server --host 127.0.0.1 --port ${DOLT_PORT} --data-dir "${DOLT_DATA_DIR}" > "${logFile}" 2>&1 &`,
  );

  // Wait for server to be ready (up to 10s)
  for (let i = 0; i < 10; i++) {
    run("sleep 1");
    if (isPortOpen()) {
      return true;
    }
  }

  return false;
}

/**
 * Kill a dolt process by PID. Also attempts to kill related wrapper processes.
 */
export function killDoltProcess(port = DOLT_PORT) {
  const info = findDoltProcess(port);
  if (!info) return false;

  // Kill all matching dolt lines (binary + wrapper)
  const pids = info.allLines
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean);

  for (const pid of pids) {
    run(`kill ${pid} 2>/dev/null`);
  }

  // Wait briefly for process to exit
  run("sleep 1");
  return !isPortOpen(port);
}
