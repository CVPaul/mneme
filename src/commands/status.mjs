/**
 * mneme status — Unified dashboard for all three memory layers.
 *
 * Shows:
 *   Layer 1 (Ledger): Facts files summary (count, total lines)
 *   Layer 2 (Beads):    Task counts by status, ready tasks
 *   Layer 3 (OpenCode): Git working tree state, unpushed commits
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { run, log, color } from "../utils.mjs";

// ── Layer 1: Ledger ───────────────────────────────────────────────────────

function showLedger() {
  console.log(color.bold("\n  Layer 1 — Ledger (Long-term Facts)"));
  console.log(color.dim("  ─────────────────────────────────────"));

  const factsDir = ".ledger/facts";
  if (!existsSync(factsDir)) {
    log.warn("  .ledger/facts/ not found — run `mneme init`");
    return;
  }

  const files = readdirSync(factsDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    log.warn("  No facts files found");
    return;
  }

  let totalLines = 0;
  for (const file of files) {
    const filePath = join(factsDir, file);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").length;
    totalLines += lines;
    const name = file.replace(/\.md$/, "");
    console.log(`  ${color.green("●")} ${name} ${color.dim(`(${lines} lines)`)}`);
  }

  console.log(
    color.dim(`\n  ${files.length} file(s), ${totalLines} total lines`),
  );

  // Warn if approaching the 800-line budget
  if (totalLines > 600) {
    log.warn(
      `  Facts approaching size budget (${totalLines}/800 lines) — consider pruning`,
    );
  }
}

// ── Layer 2: Beads ──────────────────────────────────────────────────────────

function showBeads() {
  console.log(color.bold("\n  Layer 2 — Beads (Task State)"));
  console.log(color.dim("  ────────────────────────────"));

  if (!existsSync(".beads/config.yaml")) {
    log.warn("  .beads/ not initialized — run `mneme init`");
    return;
  }

  // Get counts by status
  const openOut = run("bd list --status=open 2>&1");
  const ipOut = run("bd list --status=in_progress 2>&1");
  const blockedOut = run("bd blocked 2>&1");
  const readyOut = run("bd ready 2>&1");

  const countLines = (output) => {
    if (!output || output.includes("No issues") || output.includes("Error")) return 0;
    // Count lines that look like bead entries (start with ○, ◐, ●, ✓, or ❄, or contain mneme-/bd-)
    return output
      .split("\n")
      .filter((l) => /^[○◐●✓❄]/.test(l.trim()) || /\b(mneme|bd)-[a-z0-9]+\b/.test(l))
      .length;
  };

  const openCount = countLines(openOut);
  const ipCount = countLines(ipOut);
  const blockedCount = countLines(blockedOut);
  const readyCount = countLines(readyOut);

  console.log(`  ${color.green("○")} Open:        ${openCount}`);
  console.log(`  ${color.yellow("◐")} In progress: ${ipCount}`);
  console.log(`  ${color.red("●")} Blocked:     ${blockedCount}`);
  console.log(`  ${color.blue("▶")} Ready:       ${readyCount}`);

  // Show ready tasks
  if (readyOut && !readyOut.includes("No issues") && readyCount > 0) {
    console.log(color.dim("\n  Ready to work on:"));
    const lines = readyOut.split("\n").filter((l) => /^[○◐]/.test(l.trim()));
    for (const line of lines) {
      console.log(`    ${line.trim()}`);
    }
  }
}

// ── Layer 3: OpenCode (Session Context) ─────────────────────────────────────

function showOpenCode() {
  console.log(color.bold("\n  Layer 3 — OpenCode (Session Context)"));
  console.log(color.dim("  ─────────────────────────────────────"));

  if (!existsSync(".git")) {
    log.warn("  Not a git repository");
    return;
  }

  // Working tree status
  const status = run("git status --porcelain 2>&1");
  if (status === null) {
    log.warn("  Could not read git status");
    return;
  }

  if (status === "") {
    console.log(`  ${color.green("●")} Working tree clean`);
  } else {
    const lines = status.split("\n").filter(Boolean);
    const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
    const added = lines.filter((l) => l.startsWith("A ") || l.startsWith("??")).length;
    const deleted = lines.filter((l) => l.startsWith(" D") || l.startsWith("D ")).length;
    const staged = lines.filter((l) => /^[MADRC]/.test(l)).length;

    const parts = [];
    if (modified > 0) parts.push(`${modified} modified`);
    if (added > 0) parts.push(`${added} new`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    if (staged > 0) parts.push(`${staged} staged`);

    console.log(`  ${color.yellow("●")} ${parts.join(", ")}`);
  }

  // Unpushed commits
  const unpushed = run("git log @{u}..HEAD --oneline 2>&1");
  if (unpushed === null || unpushed.includes("no upstream")) {
    console.log(`  ${color.dim("●")} No remote tracking branch`);
  } else if (unpushed === "") {
    console.log(`  ${color.green("●")} Up to date with remote`);
  } else {
    const count = unpushed.split("\n").filter(Boolean).length;
    console.log(`  ${color.yellow("●")} ${count} unpushed commit(s)`);
  }

  // Current branch
  const branch = run("git branch --show-current 2>&1");
  if (branch) {
    console.log(`  ${color.dim("●")} Branch: ${branch}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function status() {
  console.log(`\n${color.bold("mneme status")} — three-layer memory dashboard`);

  showLedger();
  showBeads();
  showOpenCode();

  console.log();
}
