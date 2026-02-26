#!/usr/bin/env node

/**
 * mneme CLI — Three-layer memory architecture for AI coding agents.
 *
 * Usage:
 *   mneme init     Initialize mneme in the current directory
 *   mneme doctor   Check if all dependencies are installed and healthy
 *   mneme version  Print version
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const [command] = process.argv.slice(2);

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
  case undefined:
    console.log(`
mneme ${pkg.version} — Three-layer memory architecture for AI coding agents

Usage:
  mneme init       Initialize mneme in the current directory
  mneme doctor     Check dependencies and project health
  mneme version    Print version

Quickstart:
  mkdir my-project && cd my-project
  mneme init
  opencode
`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "mneme help" for usage.');
    process.exit(1);
}
