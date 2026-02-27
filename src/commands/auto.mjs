/**
 * mneme auto — Launch opencode with oh-my-opencode agents and mneme tools.
 *
 * This is a simple launcher that:
 *   1. Ensures Dolt is running (required for beads task management)
 *   2. Launches opencode TUI (default) or headless mode (--headless)
 *
 * Agent orchestration (planning, delegation, auto-continuation) is handled
 * entirely by oh-my-opencode's built-in system (Sisyphus, Ralph Loop, etc.).
 * Mneme provides supplementary tools (beads/ledger) via the plugin in
 * .opencode/plugins/mneme.ts.
 *
 * Usage:
 *   mneme auto                           # Launch opencode TUI
 *   mneme auto "Build auth module"       # TUI with initial goal
 *   mneme auto --headless "Fix bug"      # Headless mode (opencode run)
 *   mneme auto --headless                # Headless, prompts for goal
 *   mneme auto --port 4096              # Specify serve port
 */

import { spawnSync } from "node:child_process";
import { isPortOpen, startDoltServer } from "../dolt.mjs";
import { has, log, color } from "../utils.mjs";

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    goal: null,
    headless: false,
    port: null, // let opencode pick a port unless specified
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--headless" || arg === "-H") {
      opts.headless = true;
    } else if (arg === "--port" && argv[i + 1]) {
      opts.port = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--port=")) {
      opts.port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    opts.goal = positional.join(" ");
  }

  return opts;
}

function printHelp() {
  console.log(`
${color.bold("mneme auto")} — Launch opencode with mneme tools and oh-my-opencode agents

${color.bold("USAGE")}
  mneme auto [options] [goal]

${color.bold("OPTIONS")}
  --headless, -H     Run in headless mode (opencode run, no TUI)
  --port <num>       Port for opencode serve (default: auto)
  -h, --help         Show this help

${color.bold("EXAMPLES")}
  mneme auto                           # Launch TUI
  mneme auto "Build auth module"       # TUI with initial message
  mneme auto --headless "Fix bug"      # Headless single run
  mneme auto -H                        # Headless, interactive

${color.bold("AGENT SYSTEM")}
  oh-my-opencode provides multi-agent orchestration:
  - ${color.blue("Sisyphus")}     Primary orchestrator (Tab to switch agents)
  - ${color.blue("Hephaestus")}   Deep coding agent
  - ${color.blue("Prometheus")}   Planning agent
  - ${color.blue("Atlas")}        Execution conductor

  Mneme provides supplementary tools:
  - ${color.blue("mneme_ready")}          List available tasks
  - ${color.blue("mneme_facts")}          Read ledger facts
  - ${color.blue("mneme_update")}         Update task status/notes
  - ${color.blue("mneme_propose_fact")}   Propose new facts
  - ... and more (see .opencode/plugins/mneme.ts)
`);
}

// ── Ensure Dolt is running ──────────────────────────────────────────────────

function ensureDolt() {
  if (!has("dolt")) {
    log.warn("dolt is not installed — beads task management will not work");
    return false;
  }
  if (!isPortOpen()) {
    log.info("Starting Dolt server...");
    const ok = startDoltServer();
    if (!ok) {
      log.warn("Failed to start Dolt server — beads tools may not work");
      return false;
    }
    log.ok("Dolt server started");
  }
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function auto(argv) {
  const opts = parseArgs(argv);

  // Ensure Dolt is running for beads
  ensureDolt();

  if (opts.headless) {
    // Headless mode: opencode run
    const args = ["run"];
    if (opts.port) args.push("--port", String(opts.port));
    if (opts.goal) {
      args.push(opts.goal);
    } else {
      // No goal provided — ask interactively
      const { createInterface } = await import("node:readline");
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const goal = await new Promise((resolve) => {
        rl.question(
          `${color.cyan("Goal")} ${color.dim("(what should the agent work on?)")}\n> `,
          (answer) => {
            rl.close();
            resolve(answer.trim());
          },
        );
      });
      if (!goal) {
        log.fail("No goal provided. Exiting.");
        process.exit(1);
      }
      args.push(goal);
    }

    log.info(`Running: opencode ${args.join(" ")}`);
    const result = spawnSync("opencode", args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    process.exit(result.status ?? 0);
  } else {
    // TUI mode: opencode [goal]
    // If a goal is provided, we pass it as positional arg
    // opencode TUI doesn't accept a message arg directly,
    // so we start TUI and let the user type or the prompt.md guides the agent
    const args = [];
    if (opts.port) args.push("--port", String(opts.port));

    if (opts.goal) {
      // Use 'opencode run' even in "TUI" mode when goal is provided,
      // or better: launch TUI and let the user paste the goal.
      // Actually, opencode TUI doesn't take an initial message.
      // So for goal-based usage, we should tell the user.
      console.log(
        `\n${color.bold("Goal:")} ${opts.goal}\n` +
          `${color.dim("Paste the goal into the TUI prompt to begin.\n")}`,
      );
    }

    log.info("Launching opencode TUI...");
    console.log(
      color.dim(
        "  Agents: Sisyphus, Hephaestus, Prometheus, Atlas (Tab to switch)",
      ),
    );
    console.log(
      color.dim("  Mneme tools: mneme_ready, mneme_facts, mneme_update, ..."),
    );
    console.log();

    const result = spawnSync("opencode", args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    process.exit(result.status ?? 0);
  }
}
