/**
 * mneme compact — Pre-compaction persistence checklist.
 *
 * Checks that state is properly persisted before context compaction:
 *   - In-progress beads have recent notes
 *   - No uncommitted changes
 *   - No unpushed commits
 *   - Suggests actions if anything is out of sync
 */

import { existsSync } from "node:fs";
import { run, log, color } from "../utils.mjs";

export async function compact() {
  console.log(
    `\n${color.bold("mneme compact")} — pre-compaction persistence check\n`,
  );

  let warnings = 0;
  let passes = 0;

  // Check 1: Uncommitted changes
  console.log(color.bold("Git state:"));
  const status = run("git status --porcelain 2>&1");
  if (status === null) {
    log.warn("Not a git repository");
    warnings++;
  } else if (status === "") {
    log.ok("Working tree clean");
    passes++;
  } else {
    const lines = status.split("\n").filter(Boolean);
    log.warn(
      `${lines.length} uncommitted change(s) — commit before compaction`,
    );
    for (const line of lines.slice(0, 5)) {
      console.log(`    ${line}`);
    }
    if (lines.length > 5) {
      console.log(color.dim(`    ... and ${lines.length - 5} more`));
    }
    warnings++;
  }

  // Check 2: Unpushed commits
  const unpushed = run("git log @{u}..HEAD --oneline 2>&1");
  if (unpushed && !unpushed.includes("no upstream") && unpushed !== "") {
    const count = unpushed.split("\n").filter(Boolean).length;
    log.warn(`${count} unpushed commit(s) — push before compaction`);
    warnings++;
  } else if (unpushed === "") {
    log.ok("All commits pushed");
    passes++;
  }

  // Check 3: In-progress beads
  console.log(`\n${color.bold("Beads state:")}`);
  if (!existsSync(".beads/config.yaml")) {
    log.warn("Beads not initialized");
    warnings++;
  } else {
    const ipOut = run("bd list --status=in_progress 2>&1");
    if (!ipOut || ipOut.includes("No issues")) {
      log.ok("No in-progress beads (nothing to persist)");
      passes++;
    } else {
      const beadLines = ipOut
        .split("\n")
        .filter((l) => /\b(mneme|bd)-[a-z0-9]+\b/.test(l) || /^[○◐●]/.test(l.trim()));

      if (beadLines.length === 0) {
        log.ok("No in-progress beads");
        passes++;
      } else {
        log.warn(
          `${beadLines.length} in-progress bead(s) — update notes with current progress:`,
        );
        for (const line of beadLines) {
          console.log(`    ${line.trim()}`);
        }
        console.log(
          color.dim(
            '\n    Use: bd update <id> --notes="current progress..."',
          ),
        );
        warnings++;
      }
    }

    // Check for open beads that might need status update
    const openOut = run("bd list --status=open 2>&1");
    if (openOut && !openOut.includes("No issues")) {
      const openLines = openOut
        .split("\n")
        .filter((l) => /\b(mneme|bd)-[a-z0-9]+\b/.test(l) || /^[○◐●]/.test(l.trim()));
      if (openLines.length > 0) {
        log.info(
          `${openLines.length} open bead(s) — review if any should be closed or updated`,
        );
      }
    }
  }

  // Check 4: Ledger facts
  console.log(`\n${color.bold("Ledger state:")}`);
  if (existsSync(".ledger/facts/")) {
    log.ok("Facts directory exists");
    log.info(
      "Review: any new long-term facts discovered this session? Propose with human confirmation.",
    );
    passes++;
  } else {
    log.warn("No .ledger/facts/ directory");
    warnings++;
  }

  // Summary
  console.log();
  if (warnings === 0) {
    log.ok(
      color.bold(
        "All clear — safe to compact. State is fully persisted.",
      ),
    );
  } else {
    log.warn(
      color.bold(
        `${warnings} warning(s) — persist state before allowing compaction.`,
      ),
    );
    console.log(
      color.dim(
        "\n  Remember: you can lose reasoning, but never lose state or facts.",
      ),
    );
  }
}
