/**
 * Shared opencode server utilities.
 *
 * Used by both `mneme auto` and `mneme server`.
 * Mirrors the pattern in dolt.mjs — find, start, stop, status.
 */

import { spawn } from "node:child_process";
import { run, has } from "./utils.mjs";
import { createClient } from "./opencode-client.mjs";

/** Default port for opencode serve in auto mode. */
export const OPENCODE_DEFAULT_PORT = 4097;

/**
 * Parse "provider/model" string into { providerID, modelID }.
 * E.g. "github-copilot/gpt-5.2" → { providerID: "github-copilot", modelID: "gpt-5.2" }
 */
export function parseModelSpec(spec) {
  if (!spec) return null;
  const slash = spec.indexOf("/");
  if (slash < 0) return { providerID: "", modelID: spec };
  return { providerID: spec.slice(0, slash), modelID: spec.slice(slash + 1) };
}

/**
 * Find a running opencode serve process on any port.
 * Returns { pid, port, proc } or null.
 */
export function findOpencodeProcess(port = null) {
  const psOutput = run("ps aux 2>/dev/null") ?? "";
  // Match "opencode serve" specifically — not "language-server" etc.
  const lines = psOutput.split("\n").filter(
    (l) =>
      /\bopencode\b.*\bserve\b/.test(l) &&
      !l.includes("language-server") &&
      !l.includes("grep") &&
      !l.includes("bash -c"),
  );

  if (lines.length === 0) return null;

  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    const pid = fields[1];
    // Extract --port from the command line
    const portMatch = line.match(/--port\s+(\d+)/);
    const procPort = portMatch ? parseInt(portMatch[1], 10) : null;

    if (port !== null && procPort !== null && procPort !== port) {
      continue; // wrong port, skip
    }

    return { pid, port: procPort, proc: line, allLines: lines };
  }

  // If port filter didn't match, return first process anyway
  if (port !== null && lines.length > 0) return null;

  const fields = lines[0].trim().split(/\s+/);
  return { pid: fields[1], port: null, proc: lines[0], allLines: lines };
}

/**
 * Check if an opencode server is reachable at the given URL.
 * Returns health info { healthy, version } or null.
 */
export async function checkOpencodeHealth(baseUrl) {
  try {
    const client = createClient(baseUrl);
    const health = await client.health();
    if (health && health.healthy) return health;
  } catch {
    // not reachable
  }
  return null;
}

/**
 * Start opencode serve as a background child process.
 * Returns { client, serverProcess, url, port } or throws.
 *
 * @param {object} opts
 * @param {number} [opts.port=OPENCODE_DEFAULT_PORT]
 * @param {number} [opts.timeout=30000] - Max ms to wait for server ready
 * @param {boolean} [opts.detached=false] - If true, the process survives parent exit
 */
export async function startOpencodeServer(opts = {}) {
  const port = opts.port || OPENCODE_DEFAULT_PORT;
  const timeout = opts.timeout || 30_000;
  const detached = opts.detached ?? false;

  if (!has("opencode")) {
    throw new Error(
      "opencode is not installed. Run: curl -fsSL https://opencode.ai/install | bash",
    );
  }

  // Check if already running on this port
  const url = `http://127.0.0.1:${port}`;
  const existing = await checkOpencodeHealth(url);
  if (existing) {
    return {
      client: createClient(url),
      serverProcess: null, // not ours to kill
      url,
      port,
      alreadyRunning: true,
      version: existing.version,
    };
  }

  // When detached, use "ignore" for all stdio so parent can exit cleanly.
  // When attached (e.g. auto mode), pipe stdout/stderr for error reporting.
  const stdio = detached
    ? ["ignore", "ignore", "ignore"]
    : ["ignore", "pipe", "pipe"];

  const serverProcess = spawn("opencode", ["serve", "--port", String(port)], {
    stdio,
    detached,
  });

  // If detached, unref so parent can exit
  if (detached) {
    serverProcess.unref();
  }

  // Capture output for error reporting (only when piped)
  let serverOutput = "";
  if (!detached) {
    serverProcess.stdout.on("data", (d) => {
      serverOutput += d.toString();
    });
    serverProcess.stderr.on("data", (d) => {
      serverOutput += d.toString();
    });
  }

  // Handle early death
  let died = false;
  serverProcess.on("exit", (code) => {
    if (!died) {
      died = true;
      serverOutput += `\n[process exited with code ${code}]`;
    }
  });

  const client = createClient(url);

  // Poll health until ready
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (died) break;
    try {
      const health = await client.health();
      if (health && health.healthy) {
        return {
          client,
          serverProcess,
          url,
          port,
          alreadyRunning: false,
          version: health.version,
        };
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Failed to start
  serverProcess.kill();
  throw new Error(
    `opencode server failed to start within ${timeout / 1000}s on port ${port}.\n${serverOutput}`,
  );
}

/**
 * Stop an opencode serve process by port or PID.
 * Returns true if successfully stopped.
 */
export function stopOpencodeServer(port = null) {
  const info = findOpencodeProcess(port);
  if (!info) return false;

  const pids = info.allLines
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean);

  for (const pid of pids) {
    run(`kill ${pid} 2>/dev/null`);
  }

  // Wait briefly for process to exit
  run("sleep 1");

  // Verify it's gone
  const after = findOpencodeProcess(port);
  return !after;
}

/**
 * Attach to an existing opencode server.
 * Returns { client, url } or throws.
 */
export async function attachOpencodeServer(baseUrl) {
  const health = await checkOpencodeHealth(baseUrl);
  if (!health) {
    throw new Error(`Cannot connect to opencode server at ${baseUrl}`);
  }
  return {
    client: createClient(baseUrl),
    serverProcess: null,
    url: baseUrl,
    alreadyRunning: true,
    version: health.version,
  };
}
