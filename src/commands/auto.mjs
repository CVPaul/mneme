/**
 * mneme auto — Dual-agent autonomous supervisor loop.
 *
 * Architecture (default: daemon + TUI):
 *   1. Start opencode serve (if not already running)
 *   2. Fork self as background daemon (prompt driver)
 *   3. exec opencode attach (foreground TUI)
 *
 * The daemon drives prompts in the background while the user views
 * everything through opencode's TUI. User can type directly in TUI
 * to intervene — the daemon detects this via SSE and pauses.
 *
 * Use --headless for the original CLI mode (no TUI, streaming to stdout).
 *
 * Uses two agents in the same opencode session:
 *   - Planner (default: gpt-4.1): analyzes goal, breaks down tasks, reviews results
 *   - Executor (default: claude-opus-4.6): writes code, runs commands, implements changes
 *
 * Usage:
 *   mneme auto                              # Daemon + TUI mode (default)
 *   mneme auto "Build auth module"          # Start with a specific goal
 *   mneme auto --headless                   # CLI mode (no TUI)
 *   mneme auto --attach http://localhost:4096
 *   mneme auto --port 4096
 *   mneme auto --planner github-copilot/gpt-4.1  --executor github-copilot/claude-opus-4.6
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fork, execSync } from "node:child_process";
import {
  startOpencodeServer,
  attachOpencodeServer,
  parseModelSpec,
  findOpencodeProcess,
} from "../opencode-server.mjs";
import { createClient } from "../opencode-client.mjs";
import { color, log, run, has } from "../utils.mjs";

// ── Default models ──────────────────────────────────────────────────────────

const DEFAULT_PLANNER = "github-copilot/gpt-4.1";
const DEFAULT_EXECUTOR = "github-copilot/claude-opus-4.6";

// ── Log file path ───────────────────────────────────────────────────────────

const LOG_FILE = ".mneme-auto.log";

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    goal: null,
    attach: null,
    port: 4097,
    maxCycles: 50, // planner-executor cycles
    planner: DEFAULT_PLANNER,
    executor: DEFAULT_EXECUTOR,
    headless: false, // --headless: use original CLI mode
    _daemon: false, // --_daemon: internal flag for forked daemon process
    _daemonUrl: null, // --_daemon-url: server URL passed to daemon
    _daemonSessionId: null, // --_daemon-session: session ID passed to daemon
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--attach" && argv[i + 1]) {
      opts.attach = argv[++i];
    } else if (arg.startsWith("--attach=")) {
      opts.attach = arg.split("=").slice(1).join("=");
    } else if (arg === "--port" && argv[i + 1]) {
      opts.port = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--port=")) {
      opts.port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--max-cycles" && argv[i + 1]) {
      opts.maxCycles = parseInt(argv[++i], 10);
    } else if (arg === "--planner" && argv[i + 1]) {
      opts.planner = argv[++i];
    } else if (arg.startsWith("--planner=")) {
      opts.planner = arg.split("=").slice(1).join("=");
    } else if (arg === "--executor" && argv[i + 1]) {
      opts.executor = argv[++i];
    } else if (arg.startsWith("--executor=")) {
      opts.executor = arg.split("=").slice(1).join("=");
    } else if (arg === "--headless") {
      opts.headless = true;
    } else if (arg === "--_daemon") {
      opts._daemon = true;
    } else if (arg === "--_daemon-url" && argv[i + 1]) {
      opts._daemonUrl = argv[++i];
    } else if (arg.startsWith("--_daemon-url=")) {
      opts._daemonUrl = arg.split("=").slice(1).join("=");
    } else if (arg === "--_daemon-session" && argv[i + 1]) {
      opts._daemonSessionId = argv[++i];
    } else if (arg.startsWith("--_daemon-session=")) {
      opts._daemonSessionId = arg.split("=").slice(1).join("=");
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
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

function showHelp() {
  console.log(`
${color.bold("mneme auto")} — Dual-agent autonomous supervisor

Usage:
  mneme auto                         Daemon + TUI mode (default)
  mneme auto "Build auth module"     Start with a specific goal
  mneme auto --headless              CLI mode (no TUI, streams to stdout)
  mneme auto --attach URL            Attach to existing server
  mneme auto --port PORT             Use specific port (default: 4097)

Options:
  --planner MODEL    Planner model (default: ${DEFAULT_PLANNER})
  --executor MODEL   Executor model (default: ${DEFAULT_EXECUTOR})
  --max-cycles N     Max planner-executor cycles (default: 50)
  --headless         Use CLI mode instead of TUI
  --attach URL       Attach to running opencode server
  --port PORT        Port for auto-started server

Behavior when no goal is provided:
  Asks whether to pick from existing beads or discuss a plan with the
  Planner first. In TUI mode, the Planner presents current tasks and
  suggestions — discuss interactively, then type /go to start execution.

Default mode (daemon + TUI):
  Opens the opencode TUI. The auto-driver runs in the background,
  alternating planner/executor prompts. Type directly in the TUI
  to intervene — the daemon pauses while you interact.

Headless mode (--headless):
  Streams agent output to stdout. Commands while running:
  Type any message   Inject feedback (sent to planner next turn)
  /go                Finish goal discussion and start execution
  /status            Show bead status
  /skip              Skip current bead
  /abort             Abort current turn
  /quit              Stop and exit
`);
}

// ── File logger (for daemon mode) ───────────────────────────────────────────

/**
 * Create a file-based logger for daemon mode.
 * Replaces all console output. Truncates the log file on start.
 */
function createFileLogger(logPath) {
  // Truncate on start
  writeFileSync(logPath, `[mneme auto daemon] Started at ${new Date().toISOString()}\n`);

  function write(level, msg) {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    appendFileSync(logPath, `[${ts}] [${level}] ${msg}\n`);
  }

  return {
    info: (msg) => write("INFO", msg),
    ok: (msg) => write("OK", msg),
    warn: (msg) => write("WARN", msg),
    fail: (msg) => write("FAIL", msg),
  };
}

// ── Bead management ─────────────────────────────────────────────────────────

function getReadyBeads() {
  const output = run("bd ready --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return parseBeadText(run("bd ready") || "");
  }
}

function getInProgressBeads() {
  const output = run("bd list --status=in_progress --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getOpenBeads() {
  const output = run("bd list --status=open --json");
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getBeadDetails(id) {
  return run(`bd show ${id}`) || "";
}

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

function readFacts() {
  const factsDir = ".ledger/facts";
  if (!existsSync(factsDir)) return "";
  const files = readdirSync(factsDir).filter((f) => f.endsWith(".md"));
  const parts = [];
  for (const file of files) {
    const content = readFileSync(join(factsDir, file), "utf-8");
    parts.push(`## ${file}\n\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}

function readAgentsRules() {
  if (existsSync("AGENTS.md")) {
    return readFileSync("AGENTS.md", "utf-8");
  }
  return "";
}

/**
 * Build the initial system context (sent as first message, noReply).
 */
function buildSystemContext(opts) {
  let ctx = "# Session Context (injected by mneme auto)\n\n";
  ctx +=
    "This session uses a dual-agent architecture:\n";
  ctx += `  - **Planner** (${opts.planner}): analyzes goals, breaks down tasks, reviews results, decides next steps\n`;
  ctx += `  - **Executor** (${opts.executor}): implements code changes, runs commands, updates beads\n\n`;
  ctx +=
    "The planner and executor alternate turns. Both agents can see the full conversation.\n";
  ctx +=
    "The planner should output structured instructions. The executor should follow them.\n\n";

  const agents = readAgentsRules();
  if (agents) {
    ctx += "## Agent Rules (AGENTS.md)\n\n" + agents + "\n\n";
  }

  const facts = readFacts();
  if (facts) {
    ctx += "## Long-term Facts (Ledger)\n\n" + facts + "\n\n";
  }

  return ctx;
}

/**
 * Build the planner's initial prompt for a bead.
 */
function buildPlannerBeadPrompt(beadId) {
  const details = getBeadDetails(beadId);
  return `## Role: Planner

You are the PLANNER. Your job is to analyze the task, break it into concrete steps, and give clear instructions to the Executor.

## Current Task (Bead: ${beadId})

\`\`\`
${details}
\`\`\`

## Instructions

1. Analyze this task carefully
2. Break it into specific, actionable steps
3. Give the Executor clear instructions for what to implement FIRST
4. Be specific about file paths, function names, and expected behavior
5. Use \`mneme update ${beadId} --notes="..."\` to track progress
6. When the task is fully complete, include "TASK_DONE" in your response

Output your plan and the first instruction for the Executor.`;
}

/**
 * Build the planner's initial prompt for a user-specified goal.
 */
function buildPlannerGoalPrompt(goal) {
  return `## Role: Planner

You are the PLANNER. Your job is to analyze the goal, create a plan, and give clear instructions to the Executor.

## Goal

> ${goal}

## Instructions

1. Check existing beads with \`mneme ready\` and \`mneme list --status=open\`
2. If this maps to an existing bead, claim it: \`mneme update <id> --status=in_progress\`
3. If not, create a new bead: \`mneme create --title="..." --description="..." --type=task -p 2\`
4. Break the goal into specific, actionable steps
5. Give the Executor clear instructions for what to implement FIRST
6. When all work is complete, include "TASK_DONE" in your response

Output your plan and the first instruction for the Executor.`;
}

/**
 * Build the planner's review prompt (after seeing executor results).
 */
function buildPlannerReviewPrompt(userFeedback) {
  let prompt = `## Role: Planner

Review the Executor's work above. Then decide:

1. If more work is needed: give the next specific instruction for the Executor
2. If there were errors: explain what went wrong and how to fix it
3. If the task is fully complete: say "TASK_DONE" and summarize what was accomplished

Be specific and actionable.`;

  if (userFeedback) {
    prompt += `\n\n## User Feedback\n\nThe user has provided input that takes priority:\n\n> ${userFeedback}\n\nIncorporate this into your next instruction.`;
  }

  return prompt;
}

/**
 * Build the planner's discovery prompt — for interactive goal discussion
 * when no goal was provided on the command line.
 */
function buildPlannerDiscoveryPrompt() {
  // Gather current project state for context
  const readyBeads = run("bd ready") || "";
  const openBeads = run("bd list --status=open") || "";
  const inProgressBeads = run("bd list --status=in_progress") || "";

  let beadContext = "";
  if (inProgressBeads && !inProgressBeads.includes("No ")) {
    beadContext += `### In-progress tasks:\n\`\`\`\n${inProgressBeads}\n\`\`\`\n\n`;
  }
  if (readyBeads && !readyBeads.includes("No ready")) {
    beadContext += `### Ready tasks (unblocked):\n\`\`\`\n${readyBeads}\n\`\`\`\n\n`;
  }
  if (openBeads && !openBeads.includes("No ")) {
    beadContext += `### Open tasks:\n\`\`\`\n${openBeads}\n\`\`\`\n\n`;
  }

  return `## Role: Planner (Goal Discovery)

You are the PLANNER in discovery mode. No goal was provided, so your job is to help the user decide what to work on.

${beadContext ? `## Current Task State\n\n${beadContext}` : "## No existing tasks found.\n\n"}## Instructions

1. Review the project state above (existing tasks, facts, codebase)
2. Suggest 2-3 concrete goals the user could work on, prioritized by impact
3. For each suggestion, explain WHY it's a good next step
4. Ask the user which direction they'd like to go, or if they have something else in mind

Keep your suggestions specific and actionable. The user will discuss with you and then type **\`/go\`** when they're ready to start execution.

**Important**: This is a conversation. Respond to the user's input naturally. When they type \`/go\`, the system will finalize the goal and begin the planner-executor loop.`;
}

/**
 * Build a prompt to finalize the goal after /go is received.
 * The planner should summarize the agreed goal and produce the first
 * executor instruction.
 */
function buildPlannerFinalizeGoalPrompt() {
  return `## Role: Planner (Finalize Goal)

The user has typed \`/go\`, signaling they're ready to start execution.

Based on our discussion above, do the following:

1. Summarize the agreed goal in 1-2 sentences
2. Check existing beads with \`mneme ready\` and \`mneme list --status=open\`
3. If this maps to an existing bead, claim it: \`mneme update <id> --status=in_progress\`
4. If not, create a new bead: \`mneme create --title="..." --description="..." --type=task -p 2\`
5. Break the goal into specific, actionable steps
6. Give the Executor clear instructions for what to implement FIRST
7. When all work is complete (in future turns), include "TASK_DONE" in your response

Output your plan and the first instruction for the Executor.`;
}

/**
 * Build the executor's prompt (wrapping the planner's output).
 */
function buildExecutorPrompt() {
  return `## Role: Executor

You are the EXECUTOR. Follow the Planner's instructions above.

Rules:
- Implement exactly what the Planner asked for
- Run tests/builds if the Planner requested it
- Use \`mneme update <id> --notes="..."\` to record progress
- Use \`mneme close <id> --reason="..."\` when told the task is done
- Commit changes with clear messages
- Report what you did when finished so the Planner can review`;
}

// ── User input handling (headless mode only) ────────────────────────────────

/**
 * Non-blocking stdin reader with message queue.
 * Only used in --headless mode.
 */
function createInputQueue() {
  const queue = [];
  let rl = null;
  let closed = false;

  function start() {
    if (!process.stdin.isTTY) return;
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/stop") {
        console.log(color.dim("  -> quitting after current turn..."));
        queue.push({ type: "quit" });
      } else if (trimmed === "/status") {
        queue.push({ type: "status" });
      } else if (trimmed === "/skip") {
        console.log(
          color.dim("  -> will skip current bead after this cycle"),
        );
        queue.push({ type: "skip" });
      } else if (trimmed === "/abort") {
        console.log(color.dim("  -> aborting current turn..."));
        queue.push({ type: "abort" });
      } else {
        queue.push({ type: "message", text: trimmed });
        console.log(
          color.dim("  -> queued, will send to planner next cycle"),
        );
      }
    });

    rl.on("close", () => {
      closed = true;
    });
  }

  function drain() {
    return queue.splice(0);
  }

  function pushBack(item) {
    queue.unshift(item);
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

  return {
    start,
    drain,
    pushBack,
    hasMessages,
    stop,
    get closed() {
      return closed;
    },
  };
}

// ── Event display (streaming, headless mode) ────────────────────────────────

/**
 * Subscribe to SSE events and display agent output in real-time.
 * Returns an object with methods to control display and detect turn completion.
 *
 * Also tracks `lastOutputTime` so callers can detect stalls.
 * Only used in --headless mode.
 */
function createEventDisplay(client) {
  let running = false;
  let connected = false;
  let turnResolve = null;
  let currentRole = null;
  let lastOutputTime = 0;
  let hasReceivedAny = false;

  const printedTextLengths = new Map();
  const displayedToolStates = new Map();
  const deltaParts = new Set();

  async function start() {
    running = true;
    try {
      const iterator = await client.events.subscribe();
      connected = true;
      hasReceivedAny = false;
      log.ok("SSE event stream connected");
      for await (const event of iterator) {
        if (!running) break;
        if (!hasReceivedAny) hasReceivedAny = true;
        handleEvent(event);
      }
    } catch (err) {
      connected = false;
      if (running) {
        console.error(
          color.dim(`\n  [events] Stream error: ${err.message}`),
        );
        await sleep(2000);
        if (running) {
          log.info("Reconnecting SSE...");
          start().catch(() => {});
        }
      }
    }
  }

  function handleEvent(event) {
    const type = event.type || "";
    const props = event.properties || {};

    switch (type) {
      case "message.part.delta": {
        const partId = props.partID || props.partId;
        if (partId) deltaParts.add(partId);
        if (props.field === "text" && props.delta) {
          process.stdout.write(props.delta);
          lastOutputTime = Date.now();
        }
        break;
      }

      case "message.part.updated": {
        if (!props.part) break;
        const part = props.part;
        const partId = part.id || `${props.messageID}-${props.index}`;

        if (
          part.type === "tool-invocation" ||
          part.type === "tool-result"
        ) {
          displayToolPart(part, partId);
          lastOutputTime = Date.now();
        }
        if (part.type === "text" && part.text) {
          const prev = printedTextLengths.get(partId) || 0;
          if (prev === 0 && !deltaParts.has(partId)) {
            process.stdout.write(part.text);
            lastOutputTime = Date.now();
          }
          printedTextLengths.set(partId, part.text.length);
        }
        break;
      }

      case "session.status": {
        const status = props.status?.type || props.status;
        if (status && status !== "busy" && status !== "pending") {
          if (turnResolve) {
            turnResolve(status);
            turnResolve = null;
          }
        }
        break;
      }

      case "session.updated": {
        const info = props.info || props.session || {};
        const status = info.status?.type || info.status;
        if (status && status !== "busy" && status !== "running" && status !== "pending") {
          if (turnResolve) {
            turnResolve(status);
            turnResolve = null;
          }
        }
        break;
      }

      case "message.updated": {
        const info = props.info || {};
        if (info.finish && info.finish !== "pending") {
          lastOutputTime = Date.now();
        }
        break;
      }

      default:
        break;
    }
  }

  function displayToolPart(part, partId) {
    const inv = part.toolInvocation || {};
    const toolName = inv.toolName || part.tool || "tool";
    const state = inv.state || part.state || "call";
    const lastState = displayedToolStates.get(partId);

    if (state === "call" && lastState !== "call") {
      const argsStr = summarizeArgs(inv.args);
      console.log(
        `\n${color.bold(`  * ${toolName}`)}${argsStr ? color.dim(` ${argsStr}`) : ""}`,
      );
      displayedToolStates.set(partId, "call");
    } else if (state === "result" && lastState !== "result") {
      const result = inv.result ?? part.result ?? "";
      const resultStr =
        typeof result === "string" ? result : JSON.stringify(result);
      if (resultStr) {
        const lines = resultStr.split("\n");
        const preview = lines.slice(0, 8);
        if (lines.length > 8)
          preview.push(
            color.dim(`  ... (${lines.length - 8} more lines)`),
          );
        console.log(
          color.dim(preview.map((l) => "  " + l).join("\n")),
        );
      }
      displayedToolStates.set(partId, "result");
    }
  }

  function summarizeArgs(args) {
    if (!args) return "";
    if (typeof args === "string") {
      return args.length > 80 ? args.slice(0, 80) + "..." : args;
    }
    const pairs = [];
    for (const [k, v] of Object.entries(args)) {
      const val =
        typeof v === "string"
          ? v.length > 50
            ? v.slice(0, 50) + "..."
            : v
          : JSON.stringify(v);
      pairs.push(`${k}=${val}`);
    }
    const str = pairs.join(" ");
    return str.length > 120 ? str.slice(0, 120) + "..." : str;
  }

  function waitForTurnEnd() {
    return new Promise((resolve) => {
      turnResolve = resolve;
    });
  }

  function resetTurn(role) {
    currentRole = role;
    printedTextLengths.clear();
    displayedToolStates.clear();
    deltaParts.clear();
  }

  function stop() {
    running = false;
    if (turnResolve) {
      turnResolve("stopped");
      turnResolve = null;
    }
  }

  return {
    start,
    stop,
    waitForTurnEnd,
    resetTurn,
    get lastOutputTime() { return lastOutputTime; },
    get connected() { return connected; },
    get hasReceivedAny() { return hasReceivedAny; },
  };
}

// ── Daemon event monitor (silent, for daemon mode) ──────────────────────────

/**
 * SSE listener for daemon mode — tracks turn completion and detects
 * user-initiated messages, but produces NO stdout output.
 * All logging goes to file.
 */
function createDaemonEventMonitor(client, dlog) {
  let running = false;
  let connected = false;
  let turnResolve = null;
  let lastOutputTime = 0;
  let hasReceivedAny = false;

  // Track known prompt texts we sent — to distinguish user messages
  const knownPromptTexts = new Set();

  // Callback for user message detection
  let onUserMessage = null;

  async function start() {
    running = true;
    try {
      const iterator = await client.events.subscribe();
      connected = true;
      hasReceivedAny = false;
      dlog.ok("SSE event stream connected (daemon)");
      for await (const event of iterator) {
        if (!running) break;
        if (!hasReceivedAny) hasReceivedAny = true;
        handleEvent(event);
      }
    } catch (err) {
      connected = false;
      if (running) {
        dlog.warn(`SSE stream error: ${err.message}`);
        await sleep(2000);
        if (running) {
          dlog.info("Reconnecting SSE...");
          start().catch(() => {});
        }
      }
    }
  }

  function handleEvent(event) {
    const type = event.type || "";
    const props = event.properties || {};

    switch (type) {
      case "message.part.delta": {
        // Just track that output is happening
        if (props.field === "text" && props.delta) {
          lastOutputTime = Date.now();
        }
        break;
      }

      case "message.part.updated": {
        if (props.part) {
          lastOutputTime = Date.now();
        }
        break;
      }

      case "session.status": {
        const status = props.status?.type || props.status;
        if (status && status !== "busy" && status !== "pending") {
          if (turnResolve) {
            turnResolve(status);
            turnResolve = null;
          }
        }
        break;
      }

      case "session.updated": {
        const info = props.info || props.session || {};
        const status = info.status?.type || info.status;
        if (status && status !== "busy" && status !== "running" && status !== "pending") {
          if (turnResolve) {
            turnResolve(status);
            turnResolve = null;
          }
        }
        break;
      }

      case "message.updated": {
        const info = props.info || {};
        // Detect user-initiated messages: role === "user" with text we didn't send
        const role = info.role;
        if (role === "user" && info.parts) {
          const text = info.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text || "")
            .join("\n")
            .trim();
          if (text && !knownPromptTexts.has(text)) {
            dlog.info(`User message detected: "${text.slice(0, 80)}..."`);
            if (onUserMessage) onUserMessage(text);
          }
        }
        if (info.finish && info.finish !== "pending") {
          lastOutputTime = Date.now();
        }
        break;
      }

      default:
        break;
    }
  }

  function waitForTurnEnd() {
    return new Promise((resolve) => {
      turnResolve = resolve;
    });
  }

  function resetTurn() {
    // Nothing visual to reset in daemon mode
  }

  function registerPrompt(text) {
    // Register a prompt text so we can distinguish our prompts from user's
    knownPromptTexts.add(text.trim());
  }

  function stop() {
    running = false;
    if (turnResolve) {
      turnResolve("stopped");
      turnResolve = null;
    }
  }

  return {
    start,
    stop,
    waitForTurnEnd,
    resetTurn,
    registerPrompt,
    set onUserMessage(fn) { onUserMessage = fn; },
    get onUserMessage() { return onUserMessage; },
    get lastOutputTime() { return lastOutputTime; },
    get connected() { return connected; },
    get hasReceivedAny() { return hasReceivedAny; },
  };
}

// ── Turn execution (headless mode) ──────────────────────────────────────────

/**
 * Send a message and wait for the turn to complete (headless mode).
 * Handles /abort and /quit from input queue during execution.
 * Prints heartbeat every 15s when no output is flowing.
 *
 * @returns {{ status: string, aborted: boolean, quit: boolean }}
 */
async function executeTurnHeadless(
  client,
  sessionId,
  prompt,
  modelSpec,
  eventDisplay,
  inputQueue,
) {
  eventDisplay.resetTurn();

  const body = {
    parts: [{ type: "text", text: prompt }],
  };
  if (modelSpec) {
    body.model = modelSpec;
  }

  await client.session.promptAsync(sessionId, body);

  // Quick check for immediate model errors
  await sleep(2000);
  try {
    const sessions = await client.session.list();
    const s = sessions?.find?.((ss) => ss.id === sessionId);
    if (s && s.status && s.status !== "running" && s.status !== "pending") {
      const msgs = await client.session.messages(sessionId);
      const lastMsg = msgs?.[msgs.length - 1];
      const errInfo = lastMsg?.info?.error;
      if (errInfo) {
        const errMsg = errInfo.data?.message || errInfo.name || "unknown";
        log.fail(`Model error: ${errMsg}`);
        return { status: "error", aborted: true, quit: false };
      }
    }
  } catch {
    // Ignore probe failures
  }

  const HEARTBEAT_INTERVAL = 15_000;
  const SILENCE_WARN = 30_000;
  const SILENCE_ABORT = 120_000;
  const turnStartTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;
    let warnedSilence = false;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearInterval(pollId);
      clearInterval(heartbeatId);
      resolve(result);
    };

    eventDisplay.waitForTurnEnd().then((status) => {
      done({ status, aborted: false, quit: false });
    });

    const heartbeatId = setInterval(() => {
      if (resolved) return;
      const now = Date.now();
      const elapsed = Math.round((now - turnStartTime) / 1000);
      const lastOut = eventDisplay.lastOutputTime;
      const silenceMs = lastOut > 0 ? now - lastOut : now - turnStartTime;

      if (silenceMs >= SILENCE_ABORT) {
        console.log(
          color.dim(`\n  [${elapsed}s] no output for ${Math.round(silenceMs / 1000)}s, auto-aborting`),
        );
        client.session.abort(sessionId).catch(() => {});
        done({ status: "aborted", aborted: true, quit: false });
        return;
      }

      if (silenceMs >= SILENCE_WARN && !warnedSilence) {
        warnedSilence = true;
        console.log(
          color.dim(`\n  [${elapsed}s] no output for ${Math.round(silenceMs / 1000)}s (will abort at ${SILENCE_ABORT / 1000}s)`),
        );
        return;
      }

      if (silenceMs >= HEARTBEAT_INTERVAL) {
        process.stdout.write(
          color.dim(`  [${elapsed}s] `),
        );
      }
    }, HEARTBEAT_INTERVAL);

    const pollId = setInterval(() => {
      if (!inputQueue.hasMessages()) return;
      const items = inputQueue.drain();
      for (const item of items) {
        if (item.type === "quit") {
          client.session.abort(sessionId).catch(() => {});
          done({ status: "quit", aborted: false, quit: true });
          return;
        }
        if (item.type === "abort") {
          client.session.abort(sessionId).catch(() => {});
          done({ status: "aborted", aborted: true, quit: false });
          return;
        }
        if (item.type === "status") {
          showBeadStatus();
        }
        if (item.type === "message" || item.type === "skip") {
          inputQueue.pushBack(item);
        }
      }
    }, 200);
  });
}

// ── Turn execution (daemon mode) ────────────────────────────────────────────

/**
 * Send a message and wait for the turn to complete (daemon mode).
 * No stdout output — all logging to file. No input queue.
 *
 * @returns {{ status: string, aborted: boolean }}
 */
async function executeTurnDaemon(
  client,
  sessionId,
  prompt,
  modelSpec,
  monitor,
  dlog,
) {
  monitor.resetTurn();
  monitor.registerPrompt(prompt);

  const body = {
    parts: [{ type: "text", text: prompt }],
  };
  if (modelSpec) {
    body.model = modelSpec;
  }

  await client.session.promptAsync(sessionId, body);

  // Quick check for immediate model errors
  await sleep(2000);
  try {
    const sessions = await client.session.list();
    const s = sessions?.find?.((ss) => ss.id === sessionId);
    if (s && s.status && s.status !== "running" && s.status !== "pending") {
      const msgs = await client.session.messages(sessionId);
      const lastMsg = msgs?.[msgs.length - 1];
      const errInfo = lastMsg?.info?.error;
      if (errInfo) {
        const errMsg = errInfo.data?.message || errInfo.name || "unknown";
        dlog.fail(`Model error: ${errMsg}`);
        return { status: "error", aborted: true };
      }
    }
  } catch {
    // Ignore probe failures
  }

  const SILENCE_ABORT = 120_000;
  const turnStartTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearInterval(silenceCheckId);
      resolve(result);
    };

    monitor.waitForTurnEnd().then((status) => {
      done({ status, aborted: false });
    });

    // Check for silence timeouts
    const silenceCheckId = setInterval(() => {
      if (resolved) return;
      const now = Date.now();
      const elapsed = Math.round((now - turnStartTime) / 1000);
      const lastOut = monitor.lastOutputTime;
      const silenceMs = lastOut > 0 ? now - lastOut : now - turnStartTime;

      if (silenceMs >= SILENCE_ABORT) {
        dlog.warn(`${elapsed}s elapsed, no output for ${Math.round(silenceMs / 1000)}s — auto-aborting`);
        client.session.abort(sessionId).catch(() => {});
        done({ status: "aborted", aborted: true });
      }
    }, 15_000);
  });
}

// ── Status display (headless only) ─────────────────────────────────────────

function showBeadStatus() {
  console.log(`\n${color.bold("-- Status --")}`);
  const ready = run("bd ready") || "  (none)";
  const inProgress = run("bd list --status=in_progress") || "  (none)";
  console.log(`  ${color.bold("Ready:")} ${ready}`);
  console.log(`  ${color.bold("In Progress:")} ${inProgress}`);
  console.log("");
}

// ── Supervisor loop (headless mode — original CLI) ──────────────────────────

async function supervisorLoopHeadless(client, opts, inputQueue) {
  const plannerModel = parseModelSpec(opts.planner);
  const executorModel = parseModelSpec(opts.executor);

  log.info("Creating session...");
  const session = await client.session.create({ title: "mneme auto" });
  const sessionId = session.id;
  log.ok(`Session: ${sessionId}`);

  // Validate models
  log.info("Validating models (API probe)...");
  await validateModels(client, sessionId, opts, log);

  // Start SSE event display
  const eventDisplay = createEventDisplay(client);
  eventDisplay.start().catch(() => {});

  // Inject system context
  const systemContext = buildSystemContext(opts);
  try {
    await client.session.prompt(sessionId, {
      noReply: true,
      parts: [{ type: "text", text: systemContext }],
    });
    log.ok("Context injected");
  } catch (err) {
    log.warn(`Context injection: ${err.message}`);
  }

  let cycle = 0;
  let startMode = "beads"; // default: pick from beads

  // If no explicit goal, ask user whether to pick from beads or discuss a plan.
  if (!opts.goal) {
    const choice = await askStartModeHeadless(inputQueue);
    if (choice === "quit") {
      eventDisplay.stop();
      return;
    }
    startMode = choice; // "beads" or "discuss"
  }

  // If user chose to discuss, enter goal discussion before main loop.
  if (startMode === "discuss") {
    const goResult = await goalDiscussionHeadless(
      client, sessionId, plannerModel, eventDisplay, inputQueue,
    );
    if (!goResult) {
      log.info("User quit during goal discussion.");
      eventDisplay.stop();
      return;
    }
    // Goal discussion complete — planner finalize prompt has produced
    // the first executor instruction. Jump straight to executor turn.
    cycle++;
    console.log(
      `\n${color.bold(`-- Cycle ${cycle} / Executor`)} ${color.dim(`(${opts.executor})`)} ${color.bold("-------------------")}`,
    );
    const executorPrompt = buildExecutorPrompt();
    log.info(`Sending prompt to Executor (${opts.executor})...`);
    eventDisplay.resetTurn("executor");
    const executorResult = await executeTurnHeadless(
      client, sessionId, executorPrompt, executorModel,
      eventDisplay, inputQueue,
    );
    console.log("");
    if (executorResult.quit) { log.info("User requested quit."); eventDisplay.stop(); return; }
    if (executorResult.aborted) { log.info("Executor turn aborted."); }
    await sleep(1000);
    // Fall through to the main loop (cycle is now 1, will get planner review)
  }

  try {
    while (cycle < opts.maxCycles) {
      let userFeedback = null;
      let shouldSkip = false;

      if (inputQueue.hasMessages()) {
        const items = inputQueue.drain();
        for (const item of items) {
          if (item.type === "quit") {
            log.info("User requested quit.");
            return;
          }
          if (item.type === "skip") shouldSkip = true;
          if (item.type === "status") showBeadStatus();
          if (item.type === "message") userFeedback = item.text;
        }
      }

      if (shouldSkip) {
        log.info("Skipping current bead...");
      }

      let plannerPrompt = null;

      if (cycle === 0) {
        if (opts.goal) {
          plannerPrompt = buildPlannerGoalPrompt(opts.goal);
        } else {
          // No explicit goal, but beads exist — pick from beads
          plannerPrompt = pickBeadForPlanner(log);
        }
      } else {
        plannerPrompt = buildPlannerReviewPrompt(userFeedback);
      }

      if (!plannerPrompt) {
        const open = getOpenBeads();
        if (open.length === 0) {
          log.ok("All beads completed! Nothing left to do.");
          break;
        }
        log.warn("All beads blocked. Waiting for user input...");
        console.log(color.dim("  Type a message or /quit to exit."));
        await waitForInput(inputQueue);
        continue;
      }

      cycle++;

      // Planner turn
      console.log(
        `\n${color.bold(`-- Cycle ${cycle} / Planner`)} ${color.dim(`(${opts.planner})`)} ${color.bold("--------------------")}`,
      );

      log.info(`Sending prompt to Planner (${opts.planner})...`);
      eventDisplay.resetTurn("planner");
      const plannerResult = await executeTurnHeadless(
        client, sessionId, plannerPrompt, plannerModel,
        eventDisplay, inputQueue,
      );
      console.log("");

      if (plannerResult.quit) { log.info("User requested quit."); return; }
      if (plannerResult.aborted) { log.info("Planner turn aborted."); continue; }

      // Check TASK_DONE
      let plannerSaidDone = false;
      try {
        const messages = await client.session.messages(sessionId);
        if (messages && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          const text = extractMessageText(lastMsg);
          if (text.includes("TASK_DONE")) plannerSaidDone = true;
        }
      } catch { /* proceed */ }

      if (plannerSaidDone) {
        log.ok("Planner declared task complete.");
        cycle = 0;
        const nextBead = pickBeadForPlanner(log);
        if (!nextBead) { log.ok("No more tasks. Finished."); break; }
        continue;
      }

      // Executor turn
      console.log(
        `\n${color.bold(`-- Cycle ${cycle} / Executor`)} ${color.dim(`(${opts.executor})`)} ${color.bold("-------------------")}`,
      );

      const executorPrompt = buildExecutorPrompt();
      log.info(`Sending prompt to Executor (${opts.executor})...`);
      eventDisplay.resetTurn("executor");
      const executorResult = await executeTurnHeadless(
        client, sessionId, executorPrompt, executorModel,
        eventDisplay, inputQueue,
      );
      console.log("");

      if (executorResult.quit) { log.info("User requested quit."); return; }
      if (executorResult.aborted) { log.info("Executor turn aborted."); }

      await sleep(1000);
    }

    if (cycle >= opts.maxCycles) {
      log.warn(`Reached max cycles (${opts.maxCycles}). Stopping.`);
    }
  } finally {
    eventDisplay.stop();
  }
}

// ── Supervisor loop (daemon mode) ───────────────────────────────────────────

async function supervisorLoopDaemon(client, sessionId, opts, dlog) {
  const plannerModel = parseModelSpec(opts.planner);
  const executorModel = parseModelSpec(opts.executor);

  // Start SSE event monitor (silent)
  const monitor = createDaemonEventMonitor(client, dlog);

  // Track whether user is interacting via TUI
  let userInteracting = false;
  let userTurnResolve = null;

  monitor.onUserMessage = (text) => {
    dlog.info(`User typed in TUI, pausing auto loop...`);
    userInteracting = true;
    // The user message triggers a model response. We need to wait for
    // that response to complete before resuming our auto loop.
    // The next session.status=idle will signal completion.
  };

  monitor.start().catch(() => {});

  // Inject system context
  const systemContext = buildSystemContext(opts);
  monitor.registerPrompt(systemContext);
  try {
    await client.session.prompt(sessionId, {
      noReply: true,
      parts: [{ type: "text", text: systemContext }],
    });
    dlog.ok("Context injected");
  } catch (err) {
    dlog.warn(`Context injection: ${err.message}`);
  }

  let cycle = 0;

  // If no explicit goal, enter goal discussion with planner.
  // The discovery prompt lists existing beads (if any) and suggestions.
  // User discusses in TUI, types /go when ready. If they want to pick
  // from beads, the planner will incorporate that into its plan.
  if (!opts.goal) {
    dlog.info("No goal specified — entering goal discussion with Planner.");
    const goResult = await goalDiscussionDaemon(
      client, sessionId, plannerModel, monitor, dlog,
    );
    if (!goResult) {
      dlog.info("Goal discussion ended without /go. Exiting.");
      monitor.stop();
      return;
    }
    // Goal discussion complete — planner finalize prompt has produced
    // the first executor instruction. Jump straight to executor turn.
    cycle++;
    dlog.info(`Cycle ${cycle} / Executor (${opts.executor}) [post-goal-discussion]`);
    const executorPrompt = buildExecutorPrompt();
    const executorResult = await executeTurnDaemon(
      client, sessionId, executorPrompt, executorModel, monitor, dlog,
    );
    if (executorResult.aborted) {
      dlog.warn("Executor turn aborted.");
    }
    await sleep(1000);
    // Fall through to the main loop (cycle is now 1, will get planner review)
  }

  try {
    while (cycle < opts.maxCycles) {
      // If user is interacting, wait for the model to finish responding
      // to their message before we send the next auto prompt
      if (userInteracting) {
        dlog.info("Waiting for user's turn to complete...");
        await monitor.waitForTurnEnd();
        userInteracting = false;
        dlog.info("User turn complete, resuming auto loop.");
        // After user intervention, planner should review
        // (fall through to planner review prompt)
      }

      let plannerPrompt = null;

      if (cycle === 0) {
        if (opts.goal) {
          plannerPrompt = buildPlannerGoalPrompt(opts.goal);
        } else {
          // No explicit goal, but beads exist — pick from beads
          plannerPrompt = pickBeadForPlanner(dlog);
        }
      } else {
        plannerPrompt = buildPlannerReviewPrompt(null);
      }

      if (!plannerPrompt) {
        const open = getOpenBeads();
        if (open.length === 0) {
          dlog.ok("All beads completed! Nothing left to do.");
          break;
        }
        dlog.warn("All beads blocked. Waiting 30s before retry...");
        await sleep(30_000);
        continue;
      }

      cycle++;

      // Planner turn
      dlog.info(`Cycle ${cycle} / Planner (${opts.planner})`);
      const plannerResult = await executeTurnDaemon(
        client, sessionId, plannerPrompt, plannerModel, monitor, dlog,
      );

      if (plannerResult.aborted) {
        dlog.warn("Planner turn aborted.");
        continue;
      }

      // Check TASK_DONE
      let plannerSaidDone = false;
      try {
        const messages = await client.session.messages(sessionId);
        if (messages && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          const text = extractMessageText(lastMsg);
          if (text.includes("TASK_DONE")) plannerSaidDone = true;
        }
      } catch { /* proceed */ }

      if (plannerSaidDone) {
        dlog.ok("Planner declared task complete.");
        cycle = 0;
        const nextBead = pickBeadForPlanner(dlog);
        if (!nextBead) { dlog.ok("No more tasks. Finished."); break; }
        continue;
      }

      // Executor turn
      dlog.info(`Cycle ${cycle} / Executor (${opts.executor})`);
      const executorPrompt = buildExecutorPrompt();
      const executorResult = await executeTurnDaemon(
        client, sessionId, executorPrompt, executorModel, monitor, dlog,
      );

      if (executorResult.aborted) {
        dlog.warn("Executor turn aborted.");
      }

      await sleep(1000);
    }

    if (cycle >= opts.maxCycles) {
      dlog.warn(`Reached max cycles (${opts.maxCycles}). Stopping.`);
    }
  } finally {
    monitor.stop();
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Validate models by sending a real test prompt.
 * Works with both console logger (log) and file logger (dlog).
 */
async function validateModels(client, sessionId, opts, logger) {
  const plannerModel = parseModelSpec(opts.planner);
  const executorModel = parseModelSpec(opts.executor);
  const probeModels = [
    { label: "Planner", spec: opts.planner, parsed: plannerModel },
    { label: "Executor", spec: opts.executor, parsed: executorModel },
  ];
  const seen = new Set();
  for (const m of probeModels) {
    if (seen.has(m.spec)) continue;
    seen.add(m.spec);
    try {
      const result = await client.session.prompt(sessionId, {
        parts: [{ type: "text", text: "Say OK" }],
        model: m.parsed,
      });
      const err = result?.info?.error;
      if (err) {
        const msg = err.data?.message || err.name || "unknown error";
        logger.fail(`${m.label} model "${m.spec}" rejected by provider: ${msg}`);
        throw new Error(`${m.label} model unavailable: ${msg}`);
      }
      logger.ok(`${m.label} model verified: ${m.spec}`);
    } catch (probeErr) {
      if (probeErr.message.includes("unavailable") || probeErr.message.includes("rejected")) {
        throw probeErr;
      }
      logger.warn(`${m.label} model probe inconclusive: ${probeErr.message}`);
    }
  }
}

/**
 * Try to pick a bead and return a planner prompt for it.
 * Returns null if no beads available.
 */
function pickBeadForPlanner(logger) {
  const inProgress = getInProgressBeads();
  if (inProgress.length > 0) {
    const beadId = extractBeadId(inProgress[0]);
    if (beadId) {
      logger.info(`Resuming: ${beadId}`);
      return buildPlannerBeadPrompt(beadId);
    }
  }

  const ready = getReadyBeads();
  if (ready.length === 0) return null;

  const beadId = extractBeadId(ready[0]);
  if (!beadId) return null;

  run(`bd update ${beadId} --status=in_progress`);
  logger.info(`Picked: ${beadId}`);
  return buildPlannerBeadPrompt(beadId);
}

function extractBeadId(bead) {
  return bead.id || bead.raw?.match(/([\w-]+)/)?.[1] || null;
}

function extractMessageText(msg) {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  if (msg.content) {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join("\n");
    }
  }
  if (msg.parts) {
    return msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("\n");
  }
  return "";
}

async function waitForInput(inputQueue) {
  while (!inputQueue.hasMessages() && !inputQueue.closed) {
    await sleep(500);
  }
}

/**
 * Ask the user whether to pick from beads or discuss a plan (headless mode).
 * Shows current beads state and waits for the user to choose.
 *
 * @returns {"beads"|"discuss"|"quit"}
 */
async function askStartModeHeadless(inputQueue) {
  const inProgress = getInProgressBeads();
  const ready = getReadyBeads();
  const hasBeads = inProgress.length > 0 || ready.length > 0;

  console.log(`\n${color.bold("-- What would you like to do?")} ${color.bold("--")}`);
  if (hasBeads) {
    if (inProgress.length > 0) {
      console.log(color.dim(`  In-progress beads: ${inProgress.length}`));
    }
    if (ready.length > 0) {
      console.log(color.dim(`  Ready beads: ${ready.length}`));
    }
  } else {
    console.log(color.dim("  No beads available."));
  }
  console.log("");
  if (hasBeads) {
    console.log(`  ${color.bold("1")}  Pick from beads (auto-select a task)`);
  }
  console.log(`  ${color.bold("2")}  Discuss with Planner (plan before execution)`);
  console.log(color.dim("\n  Type 1 or 2, or /quit to exit.\n"));

  while (true) {
    await waitForInput(inputQueue);
    const items = inputQueue.drain();
    for (const item of items) {
      if (item.type === "quit") return "quit";
      if (item.type === "message") {
        const t = item.text.trim();
        if (t === "1" && hasBeads) return "beads";
        if (t === "2") return "discuss";
        console.log(color.dim(`  Please type ${hasBeads ? "1 or 2" : "2"}, or /quit to exit.`));
      }
    }
  }
}

// ── Goal discussion (headless mode) ─────────────────────────────────────────

/**
 * Interactive goal discussion in headless mode.
 * Planner suggests goals, user discusses, user types /go to proceed.
 *
 * @returns {boolean} true if /go was received and discussion completed,
 *                    false if user quit.
 */
async function goalDiscussionHeadless(client, sessionId, plannerModel, eventDisplay, inputQueue) {
  console.log(
    `\n${color.bold("-- Goal Discussion")} ${color.dim("(type /go when ready to start execution)")} ${color.bold("--")}`,
  );
  console.log(color.dim("  Discuss with the Planner what to work on. Type /go to begin.\n"));

  // Send discovery prompt to planner
  const discoveryPrompt = buildPlannerDiscoveryPrompt();
  log.info("Sending discovery prompt to Planner...");
  eventDisplay.resetTurn("planner");
  const discoveryResult = await executeTurnHeadless(
    client, sessionId, discoveryPrompt, plannerModel,
    eventDisplay, inputQueue,
  );
  console.log("");

  if (discoveryResult.quit) return false;
  if (discoveryResult.aborted) {
    log.warn("Discovery prompt aborted. Retrying...");
  }

  // Discussion loop: user talks to planner until /go
  while (true) {
    // Wait for user input
    console.log(color.dim("\n  [waiting for your input... type /go to start, /quit to exit]\n"));
    await waitForInput(inputQueue);

    const items = inputQueue.drain();
    let userText = null;
    let goReceived = false;
    let quitReceived = false;

    for (const item of items) {
      if (item.type === "quit") {
        quitReceived = true;
        break;
      }
      if (item.type === "message") {
        // Check if the user typed /go
        if (item.text.toLowerCase().trim() === "/go") {
          goReceived = true;
          break;
        }
        userText = item.text;
      }
      if (item.type === "abort") {
        // Ignore /abort during discussion
      }
      if (item.type === "status") {
        showBeadStatus();
      }
      if (item.type === "skip") {
        // Ignore /skip during discussion
      }
    }

    if (quitReceived) return false;

    if (goReceived) {
      // Send finalize prompt to planner
      console.log(
        `\n${color.bold("-- Finalizing Goal")} ${color.bold("--------------------")}`,
      );
      log.info("Sending finalize prompt to Planner...");
      eventDisplay.resetTurn("planner");
      const finalizeResult = await executeTurnHeadless(
        client, sessionId, buildPlannerFinalizeGoalPrompt(), plannerModel,
        eventDisplay, inputQueue,
      );
      console.log("");

      if (finalizeResult.quit) return false;
      return true;
    }

    if (userText) {
      // Send user's message to planner for continued discussion
      const discussPrompt = `## Role: Planner (Goal Discussion)

The user says:

> ${userText}

Continue the goal discussion. Help the user refine what to work on.
When they're ready, remind them to type \`/go\` to begin execution.`;

      eventDisplay.resetTurn("planner");
      const discussResult = await executeTurnHeadless(
        client, sessionId, discussPrompt, plannerModel,
        eventDisplay, inputQueue,
      );
      console.log("");

      if (discussResult.quit) return false;
    }
  }
}

// ── Goal discussion (daemon mode) ───────────────────────────────────────────

/**
 * Goal discussion in daemon+TUI mode.
 * Sends a discovery prompt to planner, then waits for the user to
 * type /go in the TUI. While waiting, the user can freely discuss
 * with the planner via the TUI — the daemon stays paused.
 *
 * @returns {boolean} true if /go was received, false if daemon should exit.
 */
async function goalDiscussionDaemon(client, sessionId, plannerModel, monitor, dlog) {
  dlog.info("Starting goal discussion (no goal provided)");

  // Send discovery prompt
  const discoveryPrompt = buildPlannerDiscoveryPrompt();
  dlog.info("Sending discovery prompt to Planner...");
  const discoveryResult = await executeTurnDaemon(
    client, sessionId, discoveryPrompt, plannerModel, monitor, dlog,
  );

  if (discoveryResult.aborted) {
    dlog.warn("Discovery prompt aborted");
  }

  // Now wait for user to type /go in the TUI.
  // The monitor detects user messages via SSE. We listen for /go specifically.
  dlog.info("Waiting for user to type /go in TUI...");

  return new Promise((resolve) => {
    let resolved = false;

    // Save previous onUserMessage handler
    const prevHandler = monitor.onUserMessage;

    monitor.onUserMessage = (text) => {
      if (resolved) return;
      const trimmed = text.trim().toLowerCase();

      if (trimmed === "/go") {
        dlog.info("User typed /go — finalizing goal");
        resolved = true;

        // Restore previous handler
        monitor.onUserMessage = prevHandler || null;

        // Send finalize prompt
        (async () => {
          const finalizePrompt = buildPlannerFinalizeGoalPrompt();
          monitor.registerPrompt(finalizePrompt);
          dlog.info("Sending finalize prompt to Planner...");
          const finalizeResult = await executeTurnDaemon(
            client, sessionId, finalizePrompt, plannerModel, monitor, dlog,
          );
          if (finalizeResult.aborted) {
            dlog.warn("Finalize prompt aborted");
          }
          resolve(true);
        })();
        return;
      }

      // Any other user message: the user is discussing with the planner via
      // TUI. The TUI + opencode handle this automatically (user types →
      // model responds). The daemon just needs to wait for those turns to
      // complete before checking for /go again.
      dlog.info(`User discussing in TUI: "${text.slice(0, 60)}..."`);
      // Wait for the model's response to finish
      monitor.waitForTurnEnd().then(() => {
        dlog.info("Planner response to user complete, still waiting for /go");
      });
    };
  });
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function auto(argv) {
  const opts = parseArgs(argv);

  if (!has("opencode")) {
    log.fail(
      "opencode is not installed. Run: curl -fsSL https://opencode.ai/install | bash",
    );
    process.exit(1);
  }

  // ── Path 1: Internal daemon process (forked by main process) ──
  if (opts._daemon) {
    return runDaemonProcess(opts);
  }

  // ── Path 2: Headless mode (original CLI) ──
  if (opts.headless) {
    return runHeadlessMode(opts);
  }

  // ── Path 3: Default — daemon + TUI ──
  return runDaemonTuiMode(opts);
}

// ── Path 1: Daemon process ──────────────────────────────────────────────────

async function runDaemonProcess(opts) {
  const dlog = createFileLogger(LOG_FILE);
  dlog.info(`Daemon starting — goal: ${opts.goal || "(auto-pick)"}`);
  dlog.info(`Planner: ${opts.planner}, Executor: ${opts.executor}`);

  const url = opts._daemonUrl;
  if (!url) {
    dlog.fail("No server URL provided (--_daemon-url)");
    process.exit(1);
  }

  // Connect to the opencode serve instance
  const client = createClient(url);
  try {
    const health = await client.health();
    if (!health?.healthy) throw new Error("not healthy");
    dlog.ok(`Connected to server at ${url}`);
  } catch (err) {
    dlog.fail(`Cannot connect to server at ${url}: ${err.message}`);
    process.exit(1);
  }

  // Create or reuse session
  let sessionId = opts._daemonSessionId;
  if (!sessionId) {
    dlog.info("Creating session...");
    const session = await client.session.create({ title: "mneme auto" });
    sessionId = session.id;
    dlog.ok(`Session: ${sessionId}`);

    // Validate models in new session
    dlog.info("Validating models (API probe)...");
    try {
      await validateModels(client, sessionId, opts, dlog);
    } catch (err) {
      dlog.fail(`Model validation failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    dlog.ok(`Reusing session: ${sessionId}`);
  }

  // Handle signals for clean shutdown
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    dlog.info(`Received ${signal}, shutting down daemon...`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  // Monitor parent process (the TUI). When it exits, we should too.
  // In Node.js, when the parent exits, the daemon gets SIGHUP if not
  // fully detached. We also poll as a fallback.
  if (process.ppid) {
    const parentPid = process.ppid;
    const parentCheckId = setInterval(() => {
      try {
        // Signal 0 checks if process exists
        process.kill(parentPid, 0);
      } catch {
        dlog.info("Parent process exited, daemon shutting down.");
        clearInterval(parentCheckId);
        process.exit(0);
      }
    }, 5000);
    parentCheckId.unref?.();
  }

  // Run the daemon supervisor loop
  try {
    await supervisorLoopDaemon(client, sessionId, opts, dlog);
  } catch (err) {
    dlog.fail(`Daemon supervisor error: ${err.message}`);
  }

  dlog.ok("Daemon finished.");
  process.exit(0);
}

// ── Path 2: Headless mode (original CLI) ────────────────────────────────────

async function runHeadlessMode(opts) {
  console.log(
    `\n${color.bold("mneme auto")} — dual-agent autonomous supervisor (headless)\n`,
  );
  console.log(`  ${color.bold("Planner:")}  ${opts.planner}`);
  console.log(`  ${color.bold("Executor:")} ${opts.executor}\n`);
  console.log(color.dim("Commands while running:"));
  console.log(color.dim("  Type any message  -> inject feedback to planner"));
  console.log(color.dim("  /status           -> show bead status"));
  console.log(color.dim("  /skip             -> skip current bead"));
  console.log(color.dim("  /abort            -> abort current turn"));
  console.log(color.dim("  /quit             -> stop and exit\n"));

  let serverCtx;
  try {
    if (opts.attach) {
      serverCtx = await attachOpencodeServer(opts.attach);
      log.ok(`Attached to ${serverCtx.url} (v${serverCtx.version})`);
    } else {
      serverCtx = await startOpencodeServer({ port: opts.port });
      if (serverCtx.alreadyRunning) {
        log.ok(`Server already running at ${serverCtx.url} (v${serverCtx.version})`);
      } else {
        log.ok(`Server started at ${serverCtx.url} (v${serverCtx.version})`);
      }
    }
  } catch (err) {
    log.fail(err.message);
    process.exit(1);
  }

  const inputQueue = createInputQueue();
  inputQueue.start();

  try {
    await supervisorLoopHeadless(serverCtx.client, opts, inputQueue);
  } catch (err) {
    log.fail(`Supervisor error: ${err.message}`);
  } finally {
    inputQueue.stop();
    if (serverCtx.serverProcess) {
      log.info("Shutting down server...");
      serverCtx.serverProcess.kill("SIGTERM");
    }
    log.ok("mneme auto finished.");
  }
}

// ── Path 3: Daemon + TUI mode (default) ────────────────────────────────────

async function runDaemonTuiMode(opts) {
  console.log(
    `\n${color.bold("mneme auto")} — dual-agent autonomous supervisor\n`,
  );
  console.log(`  ${color.bold("Planner:")}  ${opts.planner}`);
  console.log(`  ${color.bold("Executor:")} ${opts.executor}`);
  console.log(`  ${color.bold("Mode:")}     daemon + TUI\n`);

  // Step 1: Start opencode serve (if not running)
  let serverUrl;
  let weStartedServer = false;

  if (opts.attach) {
    // User provided a URL
    serverUrl = opts.attach;
    log.info(`Using provided server: ${serverUrl}`);
    try {
      const client = createClient(serverUrl);
      const health = await client.health();
      if (!health?.healthy) throw new Error("not healthy");
      log.ok(`Server healthy (v${health.version})`);
    } catch (err) {
      log.fail(`Cannot connect to ${serverUrl}: ${err.message}`);
      process.exit(1);
    }
  } else {
    serverUrl = `http://127.0.0.1:${opts.port}`;
    // Check if already running
    try {
      const client = createClient(serverUrl);
      const health = await client.health();
      if (health?.healthy) {
        log.ok(`Server already running at ${serverUrl} (v${health.version})`);
      } else {
        throw new Error("not healthy");
      }
    } catch {
      // Need to start it
      log.info(`Starting opencode serve on port ${opts.port}...`);
      try {
        const ctx = await startOpencodeServer({ port: opts.port, detached: true });
        weStartedServer = !ctx.alreadyRunning;
        log.ok(`Server started at ${ctx.url} (v${ctx.version})`);
      } catch (err) {
        log.fail(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    }
  }

  // Step 2: Create session and validate models before forking daemon
  log.info("Creating session and validating models...");
  const client = createClient(serverUrl);
  let sessionId;
  try {
    const session = await client.session.create({ title: "mneme auto" });
    sessionId = session.id;
    log.ok(`Session: ${sessionId}`);
    await validateModels(client, sessionId, opts, log);
  } catch (err) {
    log.fail(`Setup failed: ${err.message}`);
    if (weStartedServer) {
      log.info("Stopping server we started...");
      run(`kill $(ps aux | grep 'opencode.*serve.*--port.*${opts.port}' | grep -v grep | awk '{print $2}') 2>/dev/null`);
    }
    process.exit(1);
  }

  // Step 3: Fork daemon process
  log.info("Forking daemon process...");

  // Build daemon argv
  const daemonArgs = [
    "auto",
    "--_daemon",
    "--_daemon-url", serverUrl,
    "--_daemon-session", sessionId,
    "--planner", opts.planner,
    "--executor", opts.executor,
    "--max-cycles", String(opts.maxCycles),
  ];
  if (opts.goal) {
    daemonArgs.push(opts.goal);
  }

  // Fork using the mneme CLI entry point
  const mnemeEntry = join(
    new URL(".", import.meta.url).pathname,
    "..", "..", "bin", "mneme.mjs",
  );

  const daemon = fork(mnemeEntry, daemonArgs, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  daemon.unref();
  // Disconnect IPC so parent can exit cleanly
  daemon.disconnect();

  log.ok(`Daemon forked (PID: ${daemon.pid})`);
  log.info(`Log file: ${LOG_FILE}`);

  // Small delay to let daemon connect before we launch TUI
  await sleep(1000);

  // Step 4: exec opencode attach (replaces this process)
  log.info(`Launching TUI: opencode attach ${serverUrl}`);
  console.log(color.dim("  Type directly in the TUI to intervene. The daemon pauses automatically.\n"));

  try {
    execSync(`opencode attach ${serverUrl}`, {
      stdio: "inherit",
      // This blocks until the TUI exits
    });
  } catch {
    // TUI exited (normal or error)
  }

  // TUI exited — kill daemon
  log.info("TUI exited.");
  try {
    process.kill(daemon.pid, "SIGTERM");
    log.info(`Sent SIGTERM to daemon (PID: ${daemon.pid})`);
  } catch {
    // Daemon may have already exited
  }

  // If we started the server and --attach wasn't used, optionally stop it
  // (leave it running — user can `mneme down` manually)
  log.ok("mneme auto finished.");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
