/**
 * mneme review — Review, approve, or reject Ledger fact proposals.
 *
 * Usage:
 *   mneme review                   List all pending proposals
 *   mneme review <id> --approve    Approve and write to facts
 *   mneme review <id> --reject     Reject proposal
 *   mneme review <id>              Show proposal details
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { log, color } from "../utils.mjs";

const PROPOSALS_DIR = ".ledger/proposals";
const FACTS_DIR = ".ledger/facts";

/**
 * Load all proposals, optionally filtered by status.
 */
function loadProposals(status) {
  if (!existsSync(PROPOSALS_DIR)) return [];

  return readdirSync(PROPOSALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(PROPOSALS_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((p) => !status || p.status === status)
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}

/**
 * Load a single proposal by ID.
 */
function loadProposal(id) {
  const filePath = join(PROPOSALS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Save a proposal back to disk.
 */
function saveProposal(proposal) {
  const filePath = join(PROPOSALS_DIR, `${proposal.id}.json`);
  writeFileSync(filePath, JSON.stringify(proposal, null, 2) + "\n", "utf-8");
}

/**
 * List pending proposals.
 */
function listPending() {
  const pending = loadProposals("pending");

  if (pending.length === 0) {
    log.ok("No pending proposals");
    return;
  }

  console.log(
    `\n${color.bold("Pending proposals")} (${pending.length})\n`,
  );

  for (const p of pending) {
    const date = p.created.split("T")[0];
    console.log(
      `  ${color.yellow("○")} ${color.bold(p.id)}  → ${p.file} (${p.action})  ${color.dim(date)}`,
    );
    console.log(`    ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}`);
    console.log(`    ${color.dim(`Reason: ${p.reason}`)}`);
    console.log();
  }

  console.log(color.dim("  Approve: mneme review <id> --approve"));
  console.log(color.dim("  Reject:  mneme review <id> --reject"));
  console.log(color.dim("  Detail:  mneme review <id>"));
}

/**
 * Show full detail of a proposal.
 */
function showProposal(proposal) {
  const statusColor =
    proposal.status === "pending"
      ? color.yellow
      : proposal.status === "approved"
        ? color.green
        : color.red;

  console.log(`
${color.bold("Proposal")} ${color.bold(proposal.id)}  [${statusColor(proposal.status.toUpperCase())}]

  Target:  ${proposal.file} (${proposal.action})
  Created: ${proposal.created}

${color.bold("Content:")}
${proposal.content}

${color.bold("Reason:")}
  ${proposal.reason}
`);
}

/**
 * Approve a proposal: append/create fact content.
 */
function approveProposal(proposal) {
  const targetPath = join(FACTS_DIR, proposal.file);

  if (proposal.action === "append") {
    if (!existsSync(targetPath)) {
      log.fail(`Target file not found: ${targetPath}`);
      process.exit(1);
    }
    // Append with a blank line separator
    appendFileSync(targetPath, `\n${proposal.content}\n`, "utf-8");
    log.ok(`Appended to ${proposal.file}`);
  } else if (proposal.action === "create") {
    if (existsSync(targetPath)) {
      log.warn(`File already exists: ${targetPath} — appending instead`);
      appendFileSync(targetPath, `\n${proposal.content}\n`, "utf-8");
    } else {
      const dir = join(FACTS_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(targetPath, proposal.content + "\n", "utf-8");
      log.ok(`Created ${proposal.file}`);
    }
  }

  // Update proposal status
  proposal.status = "approved";
  proposal.reviewed = new Date().toISOString();
  saveProposal(proposal);

  log.ok(`Proposal ${color.bold(proposal.id)} approved`);
}

/**
 * Reject a proposal.
 */
function rejectProposal(proposal) {
  proposal.status = "rejected";
  proposal.reviewed = new Date().toISOString();
  saveProposal(proposal);

  log.ok(`Proposal ${color.bold(proposal.id)} rejected`);
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function review(args) {
  const doApprove = args.includes("--approve");
  const doReject = args.includes("--reject");
  const id = args.find((a) => !a.startsWith("-"));

  // No ID → list pending
  if (!id) {
    listPending();
    return;
  }

  // Load proposal
  const proposal = loadProposal(id);
  if (!proposal) {
    log.fail(`Proposal not found: ${id}`);
    const pending = loadProposals("pending");
    if (pending.length > 0) {
      console.log(
        `\nPending: ${pending.map((p) => p.id).join(", ")}`,
      );
    }
    process.exit(1);
  }

  // Action: approve or reject
  if (doApprove) {
    if (proposal.status !== "pending") {
      log.warn(`Proposal already ${proposal.status}`);
      process.exit(1);
    }
    showProposal(proposal);
    approveProposal(proposal);
  } else if (doReject) {
    if (proposal.status !== "pending") {
      log.warn(`Proposal already ${proposal.status}`);
      process.exit(1);
    }
    rejectProposal(proposal);
  } else {
    // Just show detail
    showProposal(proposal);
  }
}
