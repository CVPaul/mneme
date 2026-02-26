#!/usr/bin/env node

/**
 * mneme CLI — Three-layer memory architecture for AI coding agents.
 *
 * Unified entry point that routes to:
 *   1. mneme's own commands (init, doctor, status, compact, facts)
 *   2. opencode commands (run, web, serve, etc.)
 *   3. bd/beads commands (ready, list, create, close, etc.)
 *
 * Usage:
 *   mneme              Start opencode (same as `mneme start`)
 *   mneme init         Initialize mneme in the current directory
 *   mneme doctor       Check dependencies and project health
 *   mneme status       Show three-layer memory dashboard
 *   mneme compact      Pre-compaction persistence check
 *   mneme facts        View OpenClaw facts
 *   mneme ready        Show ready tasks (bd ready)
 *   mneme list         List tasks (bd list)
 *   mneme create       Create task (bd create)
 *   mneme close        Close task (bd close)
 *   mneme run [msg..]  Run opencode with a message (non-interactive)
 *   mneme <opencode-subcommand> [args..]   Pass through to opencode
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const args = process.argv.slice(2);
const [command] = args;

// Simple bold helper for help text
const bold = (s) =>
  process.stdout.isTTY && process.env.FORCE_COLOR !== "0"
    ? `\x1b[1m${s}\x1b[0m`
    : s;

// ── Command routing ─────────────────────────────────────────────────────────

// mneme's own commands
const MNEME_COMMANDS = new Set([
  "init",
  "doctor",
  "status",
  "compact",
  "facts",
  "version",
  "--version",
  "-v",
  "help",
  "--help",
  "-h",
]);

// bd (beads) subcommands promoted to mneme top-level — the essential set
// for agent workflow. All other commands default to opencode.
const BD_COMMANDS = new Set([
  "ready",
  "list",
  "show",
  "create",
  "update",
  "close",
  "blocked",
  "dep",
]);

switch (command) {
  case "init": {
    const { init } = await import("../src/commands/init.mjs");
    await init();
    break;
  }
  case "doctor": {
    const { doctor } = await import("../src/commands/doctor.mjs");
    await doctor();
    break;
  }
  case "status": {
    const { status } = await import("../src/commands/status.mjs");
    await status();
    break;
  }
  case "compact": {
    const { compact } = await import("../src/commands/compact.mjs");
    await compact();
    break;
  }
  case "facts": {
    const { facts } = await import("../src/commands/facts.mjs");
    await facts(args.slice(1));
    break;
  }
  case "version":
  case "--version":
  case "-v":
    console.log(`mneme ${pkg.version}`);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`
mneme ${pkg.version} — Three-layer memory architecture for AI coding agents

Usage:
  mneme                         Start opencode TUI

  ${bold("Memory management:")}
  mneme init                    Initialize mneme in the current directory
  mneme doctor                  Check dependencies and project health
  mneme status                  Show three-layer memory dashboard
  mneme compact                 Pre-compaction persistence check
  mneme facts [name] [--stats]  View OpenClaw facts

  ${bold("Task management (beads):")}
  mneme ready                   Show tasks with no blockers
  mneme list [--status=STATUS]  List tasks
  mneme show <id>               Show task details
  mneme create --title="..."    Create a new task
  mneme update <id> [--notes..] Update a task
  mneme close <id> [--reason..] Close a task
  mneme blocked                 Show blocked tasks
  mneme dep add <child> <parent>  Add dependency

  ${bold("AI agent (opencode):")}
  mneme start                   Start opencode TUI (same as bare mneme)
  mneme run [message..]         Run opencode non-interactively
  mneme web                     Start web interface
  mneme serve                   Start headless server

  mneme version                 Print version

Quickstart:
  mkdir my-project && cd my-project
  mneme init
  mneme
`);
    break;
  default:
    // Route: bd commands → bd, everything else → opencode (default)
    if (!command) {
      // bare `mneme` → launch opencode TUI
      launchOpencode([]);
    } else if (BD_COMMANDS.has(command)) {
      launchBd(args);
    } else {
      launchOpencode(args);
    }
    break;
}

/**
 * Launch opencode, forwarding arguments.
 * `mneme start` is an alias for bare `opencode` (no args).
 */
function launchOpencode(args) {
  // Resolve "start" alias: `mneme start` → `opencode` (no subcommand)
  let ocArgs = [...args];
  if (ocArgs[0] === "start") {
    ocArgs = ocArgs.slice(1);
  }

  launchExternal("opencode", ocArgs, {
    notFoundMsg:
      "Error: opencode is not installed or not in PATH.\n" +
      "Install it: https://opencode.ai\n" +
      'Or run "mneme doctor" to check dependencies.',
  });
}

/**
 * Launch bd (beads), forwarding arguments.
 * `mneme bd ready` → `bd ready`
 */
function launchBd(args) {
  launchExternal("bd", args, {
    notFoundMsg:
      "Error: bd (beads) is not installed or not in PATH.\n" +
      "Run `mneme init` to install it, or see https://github.com/steveyegge/beads",
  });
}

/**
 * Launch an external binary, forwarding arguments and inheriting stdio.
 */
function launchExternal(bin, args, { notFoundMsg }) {
  const result = spawnSync(bin, args, {
    stdio: "inherit",
    env: { ...process.env },
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(notFoundMsg);
      process.exit(1);
    }
    console.error(`Error launching ${bin}: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
