/**
 * mneme facts — View and manage Ledger facts.
 *
 * Usage:
 *   mneme facts            List all facts files with summaries
 *   mneme facts <name>     Show contents of a specific facts file
 *   mneme facts --stats    Show statistics (line counts, budget usage)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log, color } from "../utils.mjs";

const FACTS_DIR = ".ledger/facts";
const PROPOSALS_DIR = ".ledger/proposals";
const LINE_BUDGET_PER_FILE = 200;
const LINE_BUDGET_TOTAL = 800;

/**
 * List all facts files with line counts.
 */
function listFacts(showStats) {
  if (!existsSync(FACTS_DIR)) {
    log.fail(
      ".ledger/facts/ not found — run `mneme init` to create it.",
    );
    process.exit(1);
  }

  const files = readdirSync(FACTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    log.warn("No facts files found. Create them with `mneme init`.");
    return;
  }

  let totalLines = 0;

  console.log(color.bold("\nLedger Facts"));
  console.log(color.dim("──────────────────────────────────────────"));

  for (const file of files) {
    const filePath = join(FACTS_DIR, file);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").length;
    totalLines += lines;

    const name = file.replace(/\.md$/, "");
    const pct = Math.round((lines / LINE_BUDGET_PER_FILE) * 100);

    // Extract first heading as description
    const heading = content
      .split("\n")
      .find((l) => l.startsWith("# "));
    const desc = heading ? heading.replace(/^#\s*/, "").trim() : "";

    const budgetColor =
      pct > 80 ? color.red : pct > 60 ? color.yellow : color.green;

    console.log(
      `  ${color.green("●")} ${color.bold(name)}  ${color.dim(desc)}`,
    );
    if (showStats) {
      console.log(
        `    ${lines} lines ${budgetColor(`(${pct}% of ${LINE_BUDGET_PER_FILE}-line budget)`)}`,
      );
    }
  }

  console.log(color.dim("──────────────────────────────────────────"));

  const totalPct = Math.round((totalLines / LINE_BUDGET_TOTAL) * 100);
  const totalColor =
    totalPct > 80 ? color.red : totalPct > 60 ? color.yellow : color.green;

  console.log(
    `  ${files.length} file(s), ${totalColor(`${totalLines}/${LINE_BUDGET_TOTAL} lines (${totalPct}%)`)}`,
  );
  console.log();

  if (totalPct > 80) {
    log.warn(
      "Facts approaching size budget — review and prune stale entries.",
    );
  }

  // Show pending proposals count
  if (existsSync(PROPOSALS_DIR)) {
    const pending = readdirSync(PROPOSALS_DIR)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => {
        try {
          const p = JSON.parse(readFileSync(join(PROPOSALS_DIR, f), "utf-8"));
          return p.status === "pending";
        } catch {
          return false;
        }
      });
    if (pending.length > 0) {
      log.warn(
        `${pending.length} pending proposal(s) — run ${color.bold("mneme review")} to review`,
      );
    }
  }
}

/**
 * Show contents of a specific facts file.
 */
function showFact(name) {
  // Allow with or without .md extension
  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  const filePath = join(FACTS_DIR, fileName);

  if (!existsSync(filePath)) {
    log.fail(`Facts file not found: ${filePath}`);

    // Suggest available files
    if (existsSync(FACTS_DIR)) {
      const available = readdirSync(FACTS_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
      if (available.length > 0) {
        console.log(`\nAvailable: ${available.join(", ")}`);
      }
    }
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  console.log();
  console.log(content);
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function facts(args) {
  const showStats = args.includes("--stats") || args.includes("-s");
  const filtered = args.filter((a) => !a.startsWith("-") && a !== "facts");

  if (filtered.length > 0) {
    showFact(filtered[0]);
  } else {
    listFacts(showStats);
  }
}
