/**
 * mneme server — Manage dolt and opencode servers.
 *
 * Subcommands:
 *   mneme server start    [dolt|opencode|all]  Start server(s)
 *   mneme server stop     [dolt|opencode|all]  Stop server(s)
 *   mneme server status   [dolt|opencode|all]  Show server status
 *   mneme server restart  [dolt|opencode|all]  Restart server(s)
 *
 * Without a target, defaults to "all".
 */

import {
  DOLT_DATA_DIR,
  DOLT_PORT,
  isPortOpen,
  findDoltProcess,
  startDoltServer,
  killDoltProcess,
} from "../dolt.mjs";
import {
  OPENCODE_DEFAULT_PORT,
  findOpencodeProcess,
  checkOpencodeHealth,
  startOpencodeServer,
  stopOpencodeServer,
} from "../opencode-server.mjs";
import { has, log, color } from "../utils.mjs";

// ── Dolt management ─────────────────────────────────────────────────────────

function showDoltStatus() {
  if (!has("dolt")) {
    log.fail("dolt is not installed");
    return false;
  }

  const open = isPortOpen();
  if (!open) {
    console.log(
      `  ${color.bold("dolt")}      ${color.red("stopped")} ${color.dim(`(port ${DOLT_PORT})`)}`,
    );
    return false;
  }

  const info = findDoltProcess();
  if (info) {
    const dirMatch = info.dataDir === DOLT_DATA_DIR;
    const dirStr = dirMatch
      ? color.dim(info.dataDir)
      : `${color.red(info.dataDir)} (expected: ${DOLT_DATA_DIR})`;

    console.log(
      `  ${color.bold("dolt")}      ${color.green("running")} ${color.dim(`port=${DOLT_PORT} pid=${info.pid}`)} data-dir=${dirStr}`,
    );

    if (!dirMatch) {
      log.warn("  Data dir mismatch. Run 'mneme server restart dolt' to fix.");
    }
    return true;
  } else {
    console.log(
      `  ${color.bold("dolt")}      ${color.yellow("unknown")} ${color.dim(`port ${DOLT_PORT} open but no dolt process found`)}`,
    );
    return false;
  }
}

function doltStart() {
  if (!has("dolt")) {
    log.fail("dolt is not installed. Run 'mneme init' or install manually.");
    return false;
  }

  if (isPortOpen()) {
    const info = findDoltProcess();
    if (info && info.dataDir === DOLT_DATA_DIR) {
      log.ok(
        `dolt already running ${color.dim(`(port ${DOLT_PORT}, PID ${info.pid})`)}`,
      );
      return true;
    }
    if (info) {
      log.warn(
        `dolt on port ${DOLT_PORT} uses different data-dir (${info.dataDir}), restarting...`,
      );
      killDoltProcess();
    } else {
      log.fail(
        `Port ${DOLT_PORT} is in use by a non-dolt process. Set MNEME_DOLT_PORT to use a different port.`,
      );
      return false;
    }
  }

  log.info(
    `Starting dolt server (port ${DOLT_PORT}, data-dir ${DOLT_DATA_DIR})...`,
  );
  if (startDoltServer()) {
    log.ok(`dolt started ${color.dim(`(port ${DOLT_PORT})`)}`);
    return true;
  } else {
    log.fail(`Failed to start dolt server. Check ${DOLT_DATA_DIR}/server.log`);
    return false;
  }
}

function doltStop() {
  if (!isPortOpen()) {
    log.info("dolt is not running.");
    return true;
  }
  const info = findDoltProcess();
  if (!info) {
    log.warn(`Port ${DOLT_PORT} is open but no dolt process found.`);
    return false;
  }
  log.info(`Stopping dolt (PID ${info.pid})...`);
  if (killDoltProcess()) {
    log.ok("dolt stopped.");
    return true;
  } else {
    log.fail("Failed to stop dolt. Try: kill " + info.pid);
    return false;
  }
}

// ── OpenCode management ─────────────────────────────────────────────────────

const OC_PORT = parseInt(
  process.env.MNEME_OPENCODE_PORT || String(OPENCODE_DEFAULT_PORT),
  10,
);

async function showOpencodeStatus() {
  if (!has("opencode")) {
    log.fail("opencode is not installed");
    return false;
  }

  const info = findOpencodeProcess();
  if (!info) {
    console.log(
      `  ${color.bold("opencode")}  ${color.red("stopped")}`,
    );
    return false;
  }

  // Try to get health info
  const port = info.port || OC_PORT;
  const health = await checkOpencodeHealth(`http://127.0.0.1:${port}`);
  if (health) {
    console.log(
      `  ${color.bold("opencode")}  ${color.green("running")} ${color.dim(`port=${port} pid=${info.pid} v${health.version}`)}`,
    );
    return true;
  } else {
    console.log(
      `  ${color.bold("opencode")}  ${color.yellow("process found")} ${color.dim(`pid=${info.pid}`)} but not responding on port ${port}`,
    );
    return false;
  }
}

async function opencodeStart() {
  if (!has("opencode")) {
    log.fail(
      "opencode is not installed. Run: curl -fsSL https://opencode.ai/install | bash",
    );
    return false;
  }

  try {
    const result = await startOpencodeServer({
      port: OC_PORT,
      detached: true,
    });
    if (result.alreadyRunning) {
      log.ok(
        `opencode already running ${color.dim(`(${result.url}, v${result.version})`)}`,
      );
    } else {
      log.ok(
        `opencode started ${color.dim(`(${result.url}, v${result.version})`)}`,
      );
    }
    return true;
  } catch (err) {
    log.fail(err.message);
    return false;
  }
}

function opencodeStop() {
  const info = findOpencodeProcess();
  if (!info) {
    log.info("opencode is not running.");
    return true;
  }
  log.info(`Stopping opencode (PID ${info.pid})...`);
  if (stopOpencodeServer()) {
    log.ok("opencode stopped.");
    return true;
  } else {
    log.fail("Failed to stop opencode. Try: kill " + info.pid);
    return false;
  }
}

// ── Unified commands ────────────────────────────────────────────────────────

async function showStatus(target) {
  console.log(`\n${color.bold("mneme server status")}\n`);
  if (target === "dolt" || target === "all") {
    showDoltStatus();
  }
  if (target === "opencode" || target === "all") {
    await showOpencodeStatus();
  }
  console.log("");
}

async function doStart(target) {
  if (target === "dolt" || target === "all") {
    doltStart();
  }
  if (target === "opencode" || target === "all") {
    await opencodeStart();
  }
}

async function doStop(target) {
  if (target === "opencode" || target === "all") {
    opencodeStop();
  }
  if (target === "dolt" || target === "all") {
    doltStop();
  }
}

async function doRestart(target) {
  await doStop(target);
  await doStart(target);
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function server(args = []) {
  const sub = args[0];
  const target = args[1] || "all"; // dolt | opencode | all

  if (target !== "dolt" && target !== "opencode" && target !== "all") {
    log.fail(
      `Unknown target: ${target}. Use "dolt", "opencode", or "all" (default).`,
    );
    return;
  }

  switch (sub) {
    case "start":
      await doStart(target);
      break;
    case "stop":
      await doStop(target);
      break;
    case "status":
      await showStatus(target);
      break;
    case "restart":
      await doRestart(target);
      break;
    default:
      console.log(`
${color.bold("mneme server")} — Manage dolt and opencode servers

Usage:
  mneme server start   [TARGET]   Start server(s)
  mneme server stop    [TARGET]   Stop server(s)
  mneme server status  [TARGET]   Show server status
  mneme server restart [TARGET]   Restart server(s)

TARGET: dolt | opencode | all (default: all)

Environment:
  MNEME_DOLT_DATA_DIR     Dolt data directory (default: ~/.dolt/databases)
  MNEME_DOLT_PORT         Dolt port (default: 3307)
  MNEME_OPENCODE_PORT     OpenCode port (default: ${OPENCODE_DEFAULT_PORT})
`);
      break;
  }
}
