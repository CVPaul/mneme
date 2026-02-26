/**
 * mneme auto — Dual-agent autonomous supervisor loop.
 *
 * Uses two agents in the same opencode session:
 *   - Planner (default: gpt-4.1): analyzes goal, breaks down tasks, reviews results
 *   - Executor (default: claude-opus-4.6): writes code, runs commands, implements changes
 *
 * The planner and executor alternate turns via per-message model switching.
 * Both see the full conversation history within the same session.
 *
 * Flow per cycle:
 *   1. Planner: receives goal/context → outputs structured instructions
 *   2. Executor: receives planner's instructions → implements changes
 *   3. Planner: reviews executor's output → more instructions or "DONE"
 *   4. Repeat until planner says done or user intervenes
 *
 * Usage:
 *   mneme auto                              # Auto-pick from ready beads
 *   mneme auto "Build auth module"          # Start with a specific goal
 *   mneme auto --attach http://localhost:4096
 *   mneme auto --port 4096
 *   mneme auto --planner github-copilot/gpt-5.2  --executor github-copilot/claude-opus-4.6
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  startOpencodeServer,
  attachOpencodeServer,
  parseModelSpec,
  stopOpencodeServer,
} from "../opencode-server.mjs";
import { color, log, run, has } from "../utils.mjs";

// ── Default models ──────────────────────────────────────────────────────────

const DEFAULT_PLANNER = "github-copilot/gpt-4.1";
const DEFAULT_EXECUTOR = "github-copilot/claude-opus-4.6";

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    goal: null,
    attach: null,
    port: 4097,
    maxCycles: 50, // planner-executor cycles
    planner: DEFAULT_PLANNER,
    executor: DEFAULT_EXECUTOR,
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
  mneme auto                         Auto-pick from ready beads
  mneme auto "Build auth module"     Start with a specific goal
  mneme auto --attach URL            Attach to existing server
  mneme auto --port PORT             Use specific port (default: 4097)

Options:
  --planner MODEL    Planner model (default: ${DEFAULT_PLANNER})
  --executor MODEL   Executor model (default: ${DEFAULT_EXECUTOR})
  --max-cycles N     Max planner-executor cycles (default: 50)
  --attach URL       Attach to running opencode server
  --port PORT        Port for auto-started server

Commands while running:
  Type any message   Inject feedback (sent to planner next turn)
  /status            Show bead status
  /skip              Skip current bead
  /abort             Abort current turn
  /quit              Stop and exit
`);
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

// ── User input handling ─────────────────────────────────────────────────────

/**
 * Non-blocking stdin reader with message queue.
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
        console.log(color.dim("  → quitting after current turn..."));
        queue.push({ type: "quit" });
      } else if (trimmed === "/status") {
        queue.push({ type: "status" });
      } else if (trimmed === "/skip") {
        console.log(
          color.dim("  → will skip current bead after this cycle"),
        );
        queue.push({ type: "skip" });
      } else if (trimmed === "/abort") {
        console.log(color.dim("  → aborting current turn..."));
        queue.push({ type: "abort" });
      } else {
        queue.push({ type: "message", text: trimmed });
        console.log(
          color.dim("  → queued, will send to planner next cycle"),
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

// ── Event display (streaming) ───────────────────────────────────────────────

/**
 * Subscribe to SSE events and display agent output in real-time.
 * Returns an object with methods to control display and detect turn completion.
 *
 * Also tracks `lastOutputTime` so callers can detect stalls.
 */
function createEventDisplay(client) {
  let running = false;
  let connected = false;
  let turnResolve = null;
  let currentRole = null; // "planner" | "executor" — for display prefixing
  let lastOutputTime = 0; // Date.now() of last SSE output
  let hasReceivedAny = false; // true once any event arrives

  // Track incremental text and tool display state
  const printedTextLengths = new Map();
  const displayedToolStates = new Map();

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
        // Try to reconnect after a brief delay
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
      case "message.part.updated": {
        if (!props.part) break;
        const part = props.part;
        const partId = part.id || `${props.messageID}-${props.index}`;

        if (part.type === "text" && part.text) {
          const prev = printedTextLengths.get(partId) || 0;
          const newText = part.text.slice(prev);
          if (newText) {
            process.stdout.write(newText);
            printedTextLengths.set(partId, part.text.length);
            lastOutputTime = Date.now();
          }
        } else if (
          part.type === "tool-invocation" ||
          part.type === "tool-result"
        ) {
          displayToolPart(part, partId);
          lastOutputTime = Date.now();
        }
        break;
      }

      case "session.updated": {
        const status = props.session?.status || props.status;
        if (status && status !== "running" && status !== "pending") {
          if (turnResolve) {
            turnResolve(status);
            turnResolve = null;
          }
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
        `\n${color.bold(`  ⚡ ${toolName}`)}${argsStr ? color.dim(` ${argsStr}`) : ""}`,
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

  /**
   * Wait for the current turn to complete via SSE.
   * Returns a promise that resolves with the session status.
   */
  function waitForTurnEnd() {
    return new Promise((resolve) => {
      turnResolve = resolve;
    });
  }

  function resetTurn(role) {
    currentRole = role;
    printedTextLengths.clear();
    displayedToolStates.clear();
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

// ── Turn execution ──────────────────────────────────────────────────────────

/**
 * Send a message and wait for the turn to complete.
 * Handles /abort and /quit from input queue during execution.
 * Prints heartbeat every 15s when no output is flowing.
 * Warns at 30s of silence, auto-aborts at 120s of silence.
 *
 * @returns {{ status: string, aborted: boolean, quit: boolean }}
 */
async function executeTurn(
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

  // Send async — returns immediately
  await client.session.promptAsync(sessionId, body);

  // Quick check: if model is invalid, the session may error out almost
  // instantly but promptAsync still returns 204. Poll once after a short
  // delay to catch this before entering the long wait loop.
  await sleep(2000);
  try {
    const sessions = await client.session.list();
    const s = sessions?.find?.((ss) => ss.id === sessionId);
    if (s && s.status && s.status !== "running" && s.status !== "pending") {
      // Session already finished — likely an immediate error
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
    // Ignore probe failures — fall through to normal wait
  }

  const HEARTBEAT_INTERVAL = 15_000; // print elapsed every 15s of silence
  const SILENCE_WARN = 30_000; // warn after 30s of no output
  const SILENCE_ABORT = 120_000; // auto-abort after 120s of no output
  const turnStartTime = Date.now();

  // Race: SSE turn completion vs user commands vs silence timeout
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

    // SSE completion
    eventDisplay.waitForTurnEnd().then((status) => {
      done({ status, aborted: false, quit: false });
    });

    // Heartbeat: show elapsed time when no output is flowing
    const heartbeatId = setInterval(() => {
      if (resolved) return;
      const now = Date.now();
      const elapsed = Math.round((now - turnStartTime) / 1000);
      const lastOut = eventDisplay.lastOutputTime;
      const silenceMs = lastOut > 0 ? now - lastOut : now - turnStartTime;

      // Silence auto-abort
      if (silenceMs >= SILENCE_ABORT) {
        console.log(
          color.dim(`\n  ⏱ ${elapsed}s elapsed — no output for ${Math.round(silenceMs / 1000)}s, auto-aborting`),
        );
        client.session.abort(sessionId).catch(() => {});
        done({ status: "aborted", aborted: true, quit: false });
        return;
      }

      // Silence warning
      if (silenceMs >= SILENCE_WARN && !warnedSilence) {
        warnedSilence = true;
        console.log(
          color.dim(`\n  ⏱ ${elapsed}s elapsed — no output for ${Math.round(silenceMs / 1000)}s (will abort at ${SILENCE_ABORT / 1000}s)`),
        );
        return;
      }

      // Regular heartbeat (only when silent for >HEARTBEAT_INTERVAL)
      if (silenceMs >= HEARTBEAT_INTERVAL) {
        process.stdout.write(
          color.dim(`  [${elapsed}s] `),
        );
      }
    }, HEARTBEAT_INTERVAL);

    // Poll input queue for /abort, /quit
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
          // Re-queue for processing between cycles
          inputQueue.pushBack(item);
        }
      }
    }, 200);
  });
}

function showBeadStatus() {
  console.log(`\n${color.bold("── Status ──")}`);
  const ready = run("bd ready") || "  (none)";
  const inProgress = run("bd list --status=in_progress") || "  (none)";
  console.log(`  ${color.bold("Ready:")} ${ready}`);
  console.log(`  ${color.bold("In Progress:")} ${inProgress}`);
  console.log("");
}

// ── Supervisor loop ─────────────────────────────────────────────────────────

async function supervisorLoop(client, opts, inputQueue) {
  const plannerModel = parseModelSpec(opts.planner);
  const executorModel = parseModelSpec(opts.executor);

  // Create session first (needed for model probing)
  log.info("Creating session...");
  const session = await client.session.create({ title: "mneme auto" });
  const sessionId = session.id;
  log.ok(`Session: ${sessionId}`);

  // ── Validate models by sending a real test prompt ──
  // opencode models lists theoretical models, but the provider may reject them
  // at runtime (e.g. Copilot plan doesn't include gpt-5.x). Only a real API
  // call reveals this — sync prompt returns the error, async silently fails.
  log.info("Validating models (API probe)...");
  const probeModels = [
    { label: "Planner", spec: opts.planner, parsed: plannerModel },
    { label: "Executor", spec: opts.executor, parsed: executorModel },
  ];
  // Deduplicate if both use the same model
  const seen = new Set();
  for (const m of probeModels) {
    if (seen.has(m.spec)) continue;
    seen.add(m.spec);
    try {
      const result = await client.session.prompt(sessionId, {
        parts: [{ type: "text", text: "Say OK" }],
        model: m.parsed,
      });
      // Check if the response contains an error
      const err = result?.info?.error;
      if (err) {
        const msg = err.data?.message || err.name || "unknown error";
        log.fail(`${m.label} model "${m.spec}" rejected by provider: ${msg}`);
        console.log(color.dim("  Tip: run 'opencode models' to see listed models, but not all may be available on your plan."));
        throw new Error(`${m.label} model unavailable: ${msg}`);
      }
      log.ok(`${m.label} model verified: ${m.spec}`);
    } catch (probeErr) {
      if (probeErr.message.includes("unavailable") || probeErr.message.includes("rejected")) {
        throw probeErr; // re-throw our own errors
      }
      // API call itself failed — might be a transient issue
      log.warn(`${m.label} model probe inconclusive: ${probeErr.message}`);
    }
  }

  // Start SSE event display
  const eventDisplay = createEventDisplay(client);
  eventDisplay.start().catch(() => {});

  // Inject system context (noReply)
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

  try {
    while (cycle < opts.maxCycles) {
      // ── Process queued user commands between cycles ──
      let userFeedback = null;
      let shouldSkip = false;

      if (inputQueue.hasMessages()) {
        const items = inputQueue.drain();
        for (const item of items) {
          if (item.type === "quit") {
            log.info("User requested quit.");
            return;
          }
          if (item.type === "skip") {
            shouldSkip = true;
          }
          if (item.type === "status") {
            showBeadStatus();
          }
          if (item.type === "message") {
            userFeedback = item.text;
          }
        }
      }

      if (shouldSkip) {
        log.info("Skipping current bead...");
        // Fall through to pick next bead
      }

      // ── Pick a task (first cycle or after skip) ──
      let plannerPrompt = null;

      if (cycle === 0) {
        // First cycle: use goal or pick a bead
        if (opts.goal) {
          plannerPrompt = buildPlannerGoalPrompt(opts.goal);
        } else {
          plannerPrompt = pickBeadForPlanner();
        }
      } else {
        // Subsequent cycles: planner reviews executor's work
        plannerPrompt = buildPlannerReviewPrompt(userFeedback);
      }

      if (!plannerPrompt) {
        // No work available
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

      // ── Planner turn ──
      console.log(
        `\n${color.bold(`── Cycle ${cycle} · Planner`)} ${color.dim(`(${opts.planner})`)} ${color.bold("────────────────────")}`,
      );

      log.info(`Sending prompt to Planner (${opts.planner})...`);
      eventDisplay.resetTurn("planner");
      const plannerResult = await executeTurn(
        client,
        sessionId,
        plannerPrompt,
        plannerModel,
        eventDisplay,
        inputQueue,
      );
      console.log(""); // newline after output

      if (plannerResult.quit) {
        log.info("User requested quit.");
        return;
      }
      if (plannerResult.aborted) {
        log.info("Planner turn aborted.");
        continue;
      }

      // Check if planner said TASK_DONE — we need to read the last message
      // from the session to see the planner's output
      let plannerSaidDone = false;
      try {
        const messages = await client.session.messages(sessionId);
        if (messages && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          const text = extractMessageText(lastMsg);
          if (text.includes("TASK_DONE")) {
            plannerSaidDone = true;
          }
        }
      } catch {
        // Can't check, proceed with executor turn
      }

      if (plannerSaidDone) {
        log.ok("Planner declared task complete.");
        // Pick next bead on next cycle
        cycle = 0; // reset cycle counter for next task
        const nextBead = pickBeadForPlanner();
        if (!nextBead) {
          log.ok("No more tasks. Finished.");
          break;
        }
        // plannerPrompt for next iteration will be set at top of loop
        continue;
      }

      // ── Executor turn ──
      console.log(
        `\n${color.bold(`── Cycle ${cycle} · Executor`)} ${color.dim(`(${opts.executor})`)} ${color.bold("───────────────────")}`,
      );

      const executorPrompt = buildExecutorPrompt();
      log.info(`Sending prompt to Executor (${opts.executor})...`);
      eventDisplay.resetTurn("executor");
      const executorResult = await executeTurn(
        client,
        sessionId,
        executorPrompt,
        executorModel,
        eventDisplay,
        inputQueue,
      );
      console.log(""); // newline after output

      if (executorResult.quit) {
        log.info("User requested quit.");
        return;
      }
      if (executorResult.aborted) {
        log.info("Executor turn aborted.");
        // Planner will review on next cycle
      }

      // Small pause between cycles
      await sleep(1000);
    }

    if (cycle >= opts.maxCycles) {
      log.warn(`Reached max cycles (${opts.maxCycles}). Stopping.`);
    }
  } finally {
    eventDisplay.stop();
  }
}

/**
 * Try to pick a bead and return a planner prompt for it.
 * Returns null if no beads available.
 */
function pickBeadForPlanner() {
  // Check in-progress first
  const inProgress = getInProgressBeads();
  if (inProgress.length > 0) {
    const beadId = extractBeadId(inProgress[0]);
    if (beadId) {
      log.info(`Resuming: ${beadId}`);
      return buildPlannerBeadPrompt(beadId);
    }
  }

  // Check ready beads
  const ready = getReadyBeads();
  if (ready.length === 0) return null;

  const beadId = extractBeadId(ready[0]);
  if (!beadId) return null;

  // Claim it
  run(`bd update ${beadId} --status=in_progress`);
  log.info(`Picked: ${beadId}`);
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

// ── Main entry point ────────────────────────────────────────────────────────

export async function auto(argv) {
  const opts = parseArgs(argv);

  if (!has("opencode")) {
    log.fail(
      "opencode is not installed. Run: curl -fsSL https://opencode.ai/install | bash",
    );
    process.exit(1);
  }

  console.log(
    `\n${color.bold("mneme auto")} — dual-agent autonomous supervisor\n`,
  );
  console.log(
    `  ${color.bold("Planner:")}  ${opts.planner}`,
  );
  console.log(
    `  ${color.bold("Executor:")} ${opts.executor}\n`,
  );
  console.log(color.dim("Commands while running:"));
  console.log(
    color.dim("  Type any message  → inject feedback to planner"),
  );
  console.log(color.dim("  /status           → show bead status"));
  console.log(color.dim("  /skip             → skip current bead"));
  console.log(color.dim("  /abort            → abort current turn"));
  console.log(color.dim("  /quit             → stop and exit\n"));

  // Start or attach to server
  let serverCtx;
  try {
    if (opts.attach) {
      serverCtx = await attachOpencodeServer(opts.attach);
      log.ok(
        `Attached to ${serverCtx.url} (v${serverCtx.version})`,
      );
    } else {
      serverCtx = await startOpencodeServer({ port: opts.port });
      if (serverCtx.alreadyRunning) {
        log.ok(
          `Server already running at ${serverCtx.url} (v${serverCtx.version})`,
        );
      } else {
        log.ok(
          `Server started at ${serverCtx.url} (v${serverCtx.version})`,
        );
      }
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
    // Only kill server if WE started it
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
