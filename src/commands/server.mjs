/**
 * mneme server — Manage the dolt SQL server.
 *
 * Subcommands:
 *   mneme server start    Start the dolt server
 *   mneme server stop     Stop the dolt server
 *   mneme server status   Show server status
 *   mneme server restart  Restart the dolt server
 */

import { DOLT_DATA_DIR, DOLT_PORT, isPortOpen, findDoltProcess, startDoltServer, killDoltProcess } from "../dolt.mjs";
import { has, log, color } from "../utils.mjs";

function showStatus() {
  if (!has("dolt")) {
    log.fail("dolt is not installed");
    return false;
  }

  const open = isPortOpen();
  if (!open) {
    log.info(`dolt server is ${color.red("stopped")} ${color.dim(`(port ${DOLT_PORT})`)}`);
    return false;
  }

  const info = findDoltProcess();
  if (info) {
    const dirMatch = info.dataDir === DOLT_DATA_DIR;
    const dirStatus = dirMatch
      ? color.green(info.dataDir)
      : `${color.red(info.dataDir)} (expected: ${DOLT_DATA_DIR})`;

    console.log(`
${color.bold("dolt server")} — ${color.green("running")}
  Port:      ${DOLT_PORT}
  PID:       ${info.pid}
  Data dir:  ${dirStatus}
`);

    if (!dirMatch) {
      log.warn("Data dir mismatch. Run 'mneme server restart' to fix.");
    }
  } else {
    log.info(`Port ${DOLT_PORT} is open but no dolt process found — may be a different service.`);
  }

  return true;
}

function doStart() {
  if (!has("dolt")) {
    log.fail("dolt is not installed. Run 'mneme init' or install manually.");
    process.exit(1);
  }

  if (isPortOpen()) {
    const info = findDoltProcess();
    if (info && info.dataDir === DOLT_DATA_DIR) {
      log.ok(`dolt server already running ${color.dim(`(port ${DOLT_PORT}, PID ${info.pid})`)}`);
      return;
    }
    if (info) {
      log.warn(`dolt server on port ${DOLT_PORT} uses different data-dir (${info.dataDir}), restarting...`);
      killDoltProcess();
    } else {
      log.fail(`Port ${DOLT_PORT} is in use by a non-dolt process. Set MNEME_DOLT_PORT to use a different port.`);
      process.exit(1);
    }
  }

  log.info(`Starting dolt server (port ${DOLT_PORT}, data-dir ${DOLT_DATA_DIR})...`);
  if (startDoltServer()) {
    log.ok(`dolt server started ${color.dim(`(port ${DOLT_PORT})`)}`);
  } else {
    log.fail(`Failed to start dolt server. Check ${DOLT_DATA_DIR}/server.log`);
    process.exit(1);
  }
}

function doStop() {
  if (!isPortOpen()) {
    log.info("dolt server is not running.");
    return;
  }

  const info = findDoltProcess();
  if (!info) {
    log.warn(`Port ${DOLT_PORT} is open but no dolt process found. Cannot stop.`);
    return;
  }

  log.info(`Stopping dolt server (PID ${info.pid})...`);
  if (killDoltProcess()) {
    log.ok("dolt server stopped.");
  } else {
    log.fail("Failed to stop dolt server. Try: kill " + info.pid);
  }
}

function doRestart() {
  if (isPortOpen()) {
    const info = findDoltProcess();
    if (info) {
      log.info(`Stopping dolt server (PID ${info.pid})...`);
      killDoltProcess();
    }
  }

  doStart();
}

export async function server(args = []) {
  const sub = args[0];

  switch (sub) {
    case "start":
      doStart();
      break;
    case "stop":
      doStop();
      break;
    case "status":
      showStatus();
      break;
    case "restart":
      doRestart();
      break;
    default:
      console.log(`
${color.bold("mneme server")} — Manage the dolt SQL server

Usage:
  mneme server start     Start the dolt server
  mneme server stop      Stop the dolt server
  mneme server status    Show server status
  mneme server restart   Restart the dolt server

Environment:
  MNEME_DOLT_DATA_DIR    Data directory (default: ~/.dolt/databases)
  MNEME_DOLT_PORT        Port (default: 3307)
`);
      break;
  }
}
