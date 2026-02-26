/**
 * mneme propose — Propose a new fact for OpenClaw.
 *
 * Creates a pending proposal in `.openclaw/proposals/` that requires
 * human review via `mneme review` before being written to facts.
 *
 * Usage:
 *   mneme propose --file=architecture --content="..." --reason="..."
 *   mneme propose --file=pitfalls --content="..." --reason="..."
 *
 * Options:
 *   --file      Target facts file name (without .md extension)
 *   --content   The fact content to append
 *   --reason    Why this qualifies as a long-term fact
 *   --action    append (default) | create
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { log, color } from "../utils.mjs";

const PROPOSALS_DIR = ".openclaw/proposals";
const FACTS_DIR = ".openclaw/facts";

/**
 * Parse --key=value and --key "value" style args.
 */
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      // --key=value
      const key = arg.slice(2, eqIdx);
      result[key] = arg.slice(eqIdx + 1);
    } else {
      // --key value
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

/**
 * Generate a short proposal ID from timestamp + content hash.
 */
function generateId(content) {
  const ts = Date.now().toString(36);
  const hash = createHash("sha256")
    .update(content + ts)
    .digest("hex")
    .slice(0, 4);
  return `p-${ts.slice(-4)}${hash}`;
}

export async function propose(args) {
  const opts = parseArgs(args);

  // Validate required fields
  if (!opts.file) {
    console.error(`
Usage: mneme propose --file=<facts-file> --content="<fact>" --reason="<why>"

Options:
  --file      Target facts file (e.g. architecture, invariants, pitfalls)
  --content   The fact content to append
  --reason    Why this qualifies as a long-term fact
  --action    append (default) | create

Example:
  mneme propose --file=pitfalls --content="bd export does not exist in v0.56.1" --reason="Verified by testing; agents will hit this repeatedly"
`);
    process.exit(1);
  }

  if (!opts.content) {
    log.fail('--content is required. What fact do you want to propose?');
    process.exit(1);
  }

  if (!opts.reason) {
    log.fail('--reason is required. Why is this a long-term fact?');
    process.exit(1);
  }

  const action = opts.action || "append";
  if (action !== "append" && action !== "create") {
    log.fail(`Invalid action: ${action}. Use "append" or "create".`);
    process.exit(1);
  }

  // Validate target file exists (for append) or doesn't exist (for create)
  const targetFile = opts.file.endsWith(".md") ? opts.file : `${opts.file}.md`;
  const targetPath = join(FACTS_DIR, targetFile);

  if (action === "append" && !existsSync(targetPath)) {
    log.fail(`Facts file not found: ${targetPath}`);
    const available = existsSync(FACTS_DIR)
      ? readdirSync(FACTS_DIR)
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.replace(/\.md$/, ""))
      : [];
    if (available.length > 0) {
      console.log(`Available files: ${available.join(", ")}`);
    }
    console.log('Use --action=create to propose a new facts file.');
    process.exit(1);
  }

  // Create proposals directory
  if (!existsSync(PROPOSALS_DIR)) {
    mkdirSync(PROPOSALS_DIR, { recursive: true });
  }

  // Build proposal
  const id = generateId(opts.content);
  const proposal = {
    id,
    file: targetFile,
    action,
    content: opts.content,
    reason: opts.reason,
    status: "pending",
    created: new Date().toISOString(),
  };

  // Write proposal file
  const proposalPath = join(PROPOSALS_DIR, `${id}.json`);
  writeFileSync(proposalPath, JSON.stringify(proposal, null, 2) + "\n", "utf-8");

  log.ok(`Proposal created: ${color.bold(id)}`);
  console.log(`  File:    ${targetFile}`);
  console.log(`  Action:  ${action}`);
  console.log(`  Content: ${opts.content.slice(0, 80)}${opts.content.length > 80 ? "..." : ""}`);
  console.log(`  Reason:  ${opts.reason}`);
  console.log();
  console.log(color.dim(`Review with: mneme review`));
  console.log(color.dim(`Approve:     mneme review ${id} --approve`));
}
