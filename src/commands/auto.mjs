/**
 * mneme auto — Autonomous agent supervisor loop.
 *
 * Starts an opencode server (or attaches to existing), then continuously:
 *   1. Picks the highest-priority unblocked bead from `mneme ready`
 *   2. Composes a prompt with bead context + OpenClaw facts
 *   3. Sends it to opencode via HTTP API
 *   4. Streams progress to terminal
 *   5. Accepts user input at any time (queued, injected between turns)
 *   6. Updates bead status based on results
 *   7. Picks next bead and repeats
 *
 * Usage:
 *   mneme auto                    # Auto-pick from ready beads
 *   mneme auto "Build auth module" # Start with a specific goal
 *   mneme auto --attach http://localhost:4096  # Attach to existing server
 *   mneme auto --port 4096        # Use specific port for server
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createClient } from "../opencode-client.mjs";
import { color, log, run, has } from "../utils.mjs";

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    goal: null,
    attach: null,
    port: 4097, // default port for auto mode server
    maxTurns: 100, // safety limit
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--attach" && argv[i + 1]) {
      opts.attach = argv[++i];
    } else if (arg.startsWith("--attach=")) {
      opts.attach = arg.split("=")[1];
    } else if (arg === "--port" && argv[i + 1]) {
      opts.port = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--port=")) {
      opts.port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--max-turns" && argv[i + 1]) {
      opts.maxTurns = parseInt(argv[++i], 10);
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    opts.goal = positional.join(" ");
  }

  return opts;
}

// ── Server lifecycle ────────────────────────────────────────────────────────

/**
 * Start opencode serve as a child process.
 * Returns { client, serverProcess, url }.
 */
async function startServer(port) {
  log.info(`Starting opencode server on port ${port}...`);

  const serverProcess = spawn("opencode", ["serve", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // Capture server output for debugging
  let serverOutput = "";
  serverProcess.stdout.on("data", (d) => {
    serverOutput += d.toString();
  });
  serverProcess.stderr.on("data", (d) => {
    serverOutput += d.toString();
  });

  const url = `http://127.0.0.1:${port}`;
  const client = createClient(url);

  // Wait for server to be ready (poll health endpoint)
  const maxWait = 30_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const health = await client.health();
      if (health && health.healthy) {
        log.ok(`Server ready at ${url} (opencode ${health.version})`);
        return { client, serverProcess, url };
      }
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }

  serverProcess.kill();
  throw new Error(
    `Server failed to start within ${maxWait / 1000}s.\n${serverOutput}`,
  );
}

/**
 * Attach to an existing opencode server.
 */
async function attachServer(baseUrl) {
  log.info(`Attaching to server at ${baseUrl}...`);
  const client = createClient(baseUrl);

  try {
    const health = await client.health();
    if (!health || !health.healthy) {
      throw new Error("Server unhealthy");
    }
    log.ok(`Attached to ${baseUrl} (opencode ${health.version})`);
    return { client, serverProcess: null, url: baseUrl };
  } catch (err) {
    throw new Error(`Cannot connect to ${baseUrl}: ${err.message}`);
  }
}

// ── Bead management ─────────────────────────────────────────────────────────

/**
 * Get ready beads (unblocked, open). Returns parsed list or [].
 */
function getReadyBeads() {
  const output = run("bd ready --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    // Fallback: parse text output
    return parseBeadText(run("bd ready") || "");
  }
}

/**
 * Get all open beads.
 */
function getOpenBeads() {
  const output = run("bd list --status=open --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

/**
 * Get in-progress beads.
 */
function getInProgressBeads() {
  const output = run("bd list --status=in_progress --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

/**
 * Get bead details.
 */
function getBeadDetails(id) {
  return run(`bd show ${id}`) || "";
}

/**
 * Parse text output from bd (fallback when --json fails).
 */
function parseBeadText(text) {
  if (!text || text.includes("No ready work")) return [];
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const idMatch = line.match(/([\w-]+)\s/);
      return idMatch ? { id: idMatch[1], raw: line } : null;
    })
    .filter(Boolean);
}

// ── Prompt composition ──────────────────────────────────────────────────────

/**
 * Read OpenClaw facts as context string.
 */
function readFacts() {
  const factsDir = ".openclaw/facts";
  if (!existsSync(factsDir)) return "";

  const files = readdirSync(factsDir).filter((f) => f.endsWith(".md"));
  const parts = [];
  for (const file of files) {
    const content = readFileSync(join(factsDir, file), "utf-8");
    parts.push(`## ${file}\n\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Read AGENTS.md
 */
function readAgentsRules() {
  if (existsSync("AGENTS.md")) {
    return readFileSync("AGENTS.md", "utf-8");
  }
  return "";
}

/**
 * Build the system context for the session.
 * This is sent as the first message to establish context.
 */
function buildSystemContext() {
  const facts = readFacts();
  const agents = readAgentsRules();

  let context = "# Session Context (injected by mneme auto)\n\n";
  context +=
    "You are running in autonomous mode under mneme supervision.\n";
  context +=
    "mneme will feed you tasks from the beads system. Complete each task, then report what you did.\n";
  context +=
    "Use `mneme update <id> --notes=\"...\"` to record progress.\n";
  context +=
    "Use `mneme close <id> --reason=\"...\"` when a task is done.\n";
  context += "Use `mneme create --title=\"...\" ...` for newly discovered subtasks.\n\n";

  if (agents) {
    context += "## Agent Rules (AGENTS.md)\n\n";
    context += agents + "\n\n";
  }

  if (facts) {
    context += "## Long-term Facts (OpenClaw)\n\n";
    context += facts + "\n\n";
  }

  return context;
}

/**
 * Build prompt for working on a specific bead.
 */
function buildBeadPrompt(beadId) {
  const details = getBeadDetails(beadId);
  let prompt = `## Current Task\n\n`;
  prompt += `Work on the following bead. Here are its details:\n\n`;
  prompt += "```\n" + details + "\n```\n\n";
  prompt += `Instructions:\n`;
  prompt += `1. Understand the task from the description and notes above\n`;
  prompt += `2. Implement the required changes\n`;
  prompt += `3. Update progress with: mneme update ${beadId} --notes="your progress"\n`;
  prompt += `4. If the task is complete, close it: mneme close ${beadId} --reason="completion summary"\n`;
  prompt += `5. If you discover sub-tasks, create them: mneme create --title="..." --description="..." --type=task -p 2\n`;
  prompt += `6. Commit your changes with a clear commit message\n`;
  return prompt;
}

/**
 * Build prompt for a user-specified goal (no specific bead).
 */
function buildGoalPrompt(goal) {
  let prompt = `## Goal\n\n`;
  prompt += `The user wants you to accomplish the following:\n\n`;
  prompt += `> ${goal}\n\n`;
  prompt += `Instructions:\n`;
  prompt += `1. Check existing beads with \`mneme ready\` and \`mneme list --status=open\`\n`;
  prompt += `2. If this goal maps to an existing bead, claim it: mneme update <id> --status=in_progress\n`;
  prompt += `3. If not, create a new bead: mneme create --title="..." --description="..." --type=task -p 2\n`;
  prompt += `4. Work on the goal step by step\n`;
  prompt += `5. Update progress and close beads as you go\n`;
  prompt += `6. Commit your changes\n`;
  return prompt;
}

// ── User input handling ─────────────────────────────────────────────────────

/**
 * Non-blocking stdin reader with message queue.
 * User can type while the agent is working; messages are queued.
 */
function createInputQueue() {
  const queue = [];
  let rl = null;
  let closed = false;

  function start() {
    if (!process.stdin.isTTY) return; // non-interactive, skip

    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/stop") {
        queue.push({ type: "quit" });
        return;
      }

      if (trimmed === "/status") {
        queue.push({ type: "status" });
        return;
      }

      if (trimmed === "/skip") {
        queue.push({ type: "skip" });
        return;
      }

      // Regular message → inject into session
      queue.push({ type: "message", text: trimmed });
      console.log(
        color.dim(`  [queued] Will inject after current turn: "${trimmed}"`),
      );
    });

    rl.on("close", () => {
      closed = true;
    });
  }

  function drain() {
    const items = queue.splice(0);
    return items;
  }

  function hasMessages() {
    return queue.length > 0;
  }

  function stop() {
    if (rl) {
      rl.close();
      rl = null;
    }
    closed = true;
  }

  return { start, drain, hasMessages, stop, get closed() { return closed; } };
}

// ── Event display ───────────────────────────────────────────────────────────

/**
 * Subscribe to SSE events and display agent progress.
 * Runs in background, returns a controller to stop.
 */
function createEventDisplay(client) {
  let running = false;
  let iterator = null;

  async function start() {
    running = true;
    try {
      iterator = await client.events.subscribe();
      for await (const event of iterator) {
        if (!running) break;
        displayEvent(event);
      }
    } catch (err) {
      if (running) {
        // Connection lost, not intentional stop
        console.error(color.dim(`  [events] Stream ended: ${err.message}`));
      }
    }
  }

  function displayEvent(event) {
    const type = event.type || "";
    const props = event.properties || {};

    // Only show interesting events, skip noise
    if (type === "message.part.updated" && props.part) {
      const part = props.part;
      if (part.type === "text" && part.text) {
        // Show last line of text as progress indicator
        const lines = part.text.split("\n").filter((l) => l.trim());
        if (lines.length > 0) {
          const last = lines[lines.length - 1];
          const truncated =
            last.length > 100 ? last.slice(0, 100) + "..." : last;
          process.stdout.write(`\r${color.dim("  > " + truncated)}  `);
        }
      } else if (part.type === "tool-invocation") {
        const toolName = part.toolInvocation?.toolName || part.tool || "tool";
        process.stdout.write(
          `\r${color.dim(`  [${toolName}] working...`)}          `,
        );
      }
    } else if (type === "session.updated" && props.status === "completed") {
      process.stdout.write("\n");
    }
  }

  function stop() {
    running = false;
  }

  return { start, stop };
}

// ── Supervisor loop ─────────────────────────────────────────────────────────

/**
 * Main supervisor loop.
 */
async function supervisorLoop(client, opts, inputQueue) {
  // Create a session
  log.info("Creating session...");
  const session = await client.session.create({ title: "mneme auto" });
  const sessionId = session.id;
  log.ok(`Session created: ${sessionId}`);

  // Send system context as first message (noReply — just inject context)
  const systemContext = buildSystemContext();
  await client.session.prompt(sessionId, {
    noReply: true,
    parts: [{ type: "text", text: systemContext }],
  });
  log.ok("System context injected");

  // Start event display
  const eventDisplay = createEventDisplay(client);
  // Run in background (don't await)
  eventDisplay.start().catch(() => {});

  let turnCount = 0;

  // Determine first prompt
  let nextPrompt = null;
  if (opts.goal) {
    nextPrompt = buildGoalPrompt(opts.goal);
  }

  try {
    while (turnCount < opts.maxTurns) {
      // If no prompt queued, pick a bead
      if (!nextPrompt) {
        // Check in-progress beads first (resume)
        const inProgress = getInProgressBeads();
        if (inProgress.length > 0) {
          const bead = inProgress[0];
          const beadId = bead.id || bead.raw?.match(/([\w-]+)/)?.[1];
          if (beadId) {
            log.info(`Resuming in-progress bead: ${beadId}`);
            nextPrompt = buildBeadPrompt(beadId);
          }
        }
      }

      if (!nextPrompt) {
        // Check ready beads
        const ready = getReadyBeads();
        if (ready.length === 0) {
          log.info("No ready beads. Checking if there's open work...");
          const open = getOpenBeads();
          if (open.length === 0) {
            log.ok("All beads completed! Nothing left to do.");
            break;
          } else {
            log.warn(
              `${open.length} open bead(s) but all blocked. Waiting for user input...`,
            );
            // Wait for user to provide direction
            await waitForInput(inputQueue);
            const items = inputQueue.drain();
            const msg = items.find((i) => i.type === "message");
            if (msg) {
              nextPrompt = msg.text;
            }
            const quit = items.find((i) => i.type === "quit");
            if (quit) break;
            if (!nextPrompt) continue;
          }
        } else {
          const bead = ready[0];
          const beadId = bead.id || bead.raw?.match(/([\w-]+)/)?.[1];
          if (beadId) {
            // Claim it
            run(`bd update ${beadId} --status=in_progress`);
            log.info(`Picked bead: ${beadId}`);
            nextPrompt = buildBeadPrompt(beadId);
          }
        }
      }

      if (!nextPrompt) {
        log.warn("No task available. Waiting...");
        await sleep(5000);
        continue;
      }

      // Send prompt
      turnCount++;
      console.log(
        `\n${color.bold(`── Turn ${turnCount} ──────────────────────────────`)}`,
      );

      try {
        const result = await client.session.prompt(sessionId, {
          parts: [{ type: "text", text: nextPrompt }],
        });

        // Show response summary
        if (result && result.parts) {
          const textParts = result.parts.filter((p) => p.type === "text");
          if (textParts.length > 0) {
            const fullText = textParts.map((p) => p.text).join("\n");
            // Show last ~500 chars as summary
            const summary =
              fullText.length > 500
                ? "..." + fullText.slice(-500)
                : fullText;
            console.log(color.dim("\n  Response summary:"));
            console.log(
              summary
                .split("\n")
                .map((l) => "  " + l)
                .join("\n"),
            );
          }
        }
      } catch (err) {
        log.fail(`Turn failed: ${err.message}`);
        // Don't abort the loop — maybe next turn works
      }

      nextPrompt = null;

      // Process queued user input
      if (inputQueue.hasMessages()) {
        const items = inputQueue.drain();
        for (const item of items) {
          if (item.type === "quit") {
            log.info("User requested quit.");
            return;
          }
          if (item.type === "skip") {
            log.info("Skipping current bead...");
            nextPrompt = null; // will pick next bead
          }
          if (item.type === "status") {
            showStatus();
          }
          if (item.type === "message") {
            log.info(`Injecting user message: "${item.text}"`);
            nextPrompt = `## User Feedback\n\nThe user has provided the following input. Prioritize this over your current task plan:\n\n> ${item.text}\n\nAdjust your approach accordingly and continue working.`;
          }
        }
      }

      // Small pause between turns to avoid hammering
      await sleep(1000);
    }

    if (turnCount >= opts.maxTurns) {
      log.warn(`Reached max turns (${opts.maxTurns}). Stopping.`);
    }
  } finally {
    eventDisplay.stop();
  }
}

function showStatus() {
  console.log(`\n${color.bold("── Status ──")}`);
  const ready = run("bd ready") || "  (none)";
  const inProgress = run("bd list --status=in_progress") || "  (none)";
  console.log(`  ${color.bold("Ready:")} ${ready}`);
  console.log(`  ${color.bold("In Progress:")} ${inProgress}`);
}

async function waitForInput(inputQueue) {
  while (!inputQueue.hasMessages() && !inputQueue.closed) {
    await sleep(500);
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function auto(argv) {
  const opts = parseArgs(argv);

  // Preflight checks
  if (!has("opencode")) {
    log.fail("opencode is not installed. Run: curl -fsSL https://opencode.ai/install | bash");
    process.exit(1);
  }
  if (!has("bd")) {
    log.fail("bd (beads) is not installed. Run: mneme init");
    process.exit(1);
  }

  console.log(`\n${color.bold("mneme auto")} — autonomous agent supervisor\n`);
  console.log(color.dim("Commands while running:"));
  console.log(color.dim("  Type any message  → inject feedback into agent"));
  console.log(color.dim("  /status           → show bead status"));
  console.log(color.dim("  /skip             → skip current bead"));
  console.log(color.dim("  /quit             → stop and exit\n"));

  // Start or attach to server
  let serverCtx;
  try {
    if (opts.attach) {
      serverCtx = await attachServer(opts.attach);
    } else {
      serverCtx = await startServer(opts.port);
    }
  } catch (err) {
    log.fail(err.message);
    process.exit(1);
  }

  // Start input queue
  const inputQueue = createInputQueue();
  inputQueue.start();

  // Run supervisor
  try {
    await supervisorLoop(serverCtx.client, opts, inputQueue);
  } catch (err) {
    log.fail(`Supervisor error: ${err.message}`);
  } finally {
    inputQueue.stop();
    // Kill server if we started it
    if (serverCtx.serverProcess) {
      log.info("Shutting down server...");
      serverCtx.serverProcess.kill("SIGTERM");
    }
    log.ok("mneme auto finished.");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
