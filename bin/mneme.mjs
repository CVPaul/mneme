#!/usr/bin/env node

/**
 * mneme CLI — Three-layer memory architecture for AI coding agents.
 *
 * Wraps opencode with three-layer memory initialization and management.
 *
 * Usage:
 *   mneme              Start opencode (same as `mneme start`)
 *   mneme init         Initialize mneme in the current directory
 *   mneme doctor       Check dependencies and project health
 *   mneme start        Start opencode TUI
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

// mneme's own commands
const MNEME_COMMANDS = new Set([
  "init",
  "doctor",
  "version",
  "--version",
  "-v",
  "help",
  "--help",
  "-h",
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
  mneme init                    Initialize mneme in the current directory
  mneme doctor                  Check dependencies and project health
  mneme version                 Print version

  mneme start                   Start opencode TUI (same as bare mneme)
  mneme run [message..]         Run opencode with a message (non-interactive)
  mneme <opencode-cmd> [args..] Pass through to opencode (e.g. mneme web, mneme serve)

Quickstart:
  mkdir my-project && cd my-project
  mneme init
  mneme
`);
    break;
  default:
    // Everything else: pass through to opencode.
    // - `mneme` (no args)        → opencode
    // - `mneme start`            → opencode
    // - `mneme run "fix the bug"` → opencode run "fix the bug"
    // - `mneme web`              → opencode web
    // - `mneme serve`            → opencode serve
    launchOpencode(args);
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

  // Find opencode binary
  const result = spawnSync("opencode", ocArgs, {
    stdio: "inherit",
    // Pass through the full environment, plus ensure TERM is set for TUI
    env: { ...process.env },
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(
        "Error: opencode is not installed or not in PATH.\n" +
          "Install it: https://opencode.ai\n" +
          'Or run "mneme doctor" to check dependencies.',
      );
      process.exit(1);
    }
    console.error(`Error launching opencode: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
