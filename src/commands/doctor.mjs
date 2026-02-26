/**
 * mneme doctor — Check dependencies and project health.
 */

import { has, run, log, color } from "../utils.mjs";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";

/**
 * Check a single dependency. Returns true if OK.
 */
function checkCmd(name, versionCmd) {
  if (!has(name)) {
    log.fail(`${name} not installed`);
    return false;
  }
  const ver = run(versionCmd) ?? "unknown";
  log.ok(`${name} ${color.dim(ver)}`);
  return true;
}

/**
 * Check if dolt server is reachable by bd.
 */
function checkDoltServer() {
  if (!has("bd")) return false;
  const result = run("bd list --status=open 2>&1");
  if (result !== null && !result.includes("unreachable") && !result.includes("Error")) {
    log.ok("dolt server reachable");
    return true;
  }
  log.warn("dolt server not running or not reachable");
  return false;
}

/**
 * Check project structure.
 */
function checkStructure() {
  const checks = [
    [".git/", "git repository"],
    [".openclaw/facts/", "OpenClaw facts directory"],
    [".opencode/prompt.md", "OpenCode session prompt"],
    ["AGENTS.md", "Agent behavior rules"],
    [".beads/", "Beads data directory"],
  ];

  let allOk = true;
  for (const [path, label] of checks) {
    if (existsSync(path)) {
      log.ok(label);
    } else {
      log.warn(`${label} ${color.dim(`(${path} not found)`)}`);
      allOk = false;
    }
  }

  // Check facts files
  if (existsSync(".openclaw/facts/")) {
    const files = readdirSync(".openclaw/facts/").filter((f) =>
      f.endsWith(".md"),
    );
    log.info(`  ${files.length} facts file(s): ${files.join(", ")}`);
  }

  return allOk;
}

export async function doctor() {
  console.log(`\n${color.bold("mneme doctor")} — checking health\n`);

  console.log(color.bold("Dependencies:"));
  const gitOk = checkCmd("git", "git --version");
  const opencodeOk = checkCmd("opencode", "opencode --version 2>/dev/null | head -1");
  const doltOk = checkCmd("dolt", "dolt version");
  const bdOk = checkCmd("bd", "bd version 2>/dev/null | head -1");
  const serverOk = checkDoltServer();

  console.log(`\n${color.bold("Project structure:")}`);
  const structOk = checkStructure();

  console.log();
  if (gitOk && opencodeOk && doltOk && bdOk && serverOk && structOk) {
    log.ok(color.bold("All checks passed"));
  } else {
    log.warn(
      color.bold("Some checks failed. Run `mneme init` to fix."),
    );
    process.exit(1);
  }
}
