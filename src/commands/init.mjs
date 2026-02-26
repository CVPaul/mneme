/**
 * mneme init — Initialize three-layer memory architecture in the current directory.
 *
 * Steps:
 *   1. Install dependencies (git, dolt, bd)
 *   2. git init (if needed)
 *   3. Scaffold .openclaw/facts/, .opencode/prompt.md, AGENTS.md, .gitignore
 *   4. Start dolt server + bd init
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { has, run, runLive, log, color, getPlatform } from "../utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, "..", "templates");

// Supported locales: "en" (default), "cn" (Chinese)
const SUPPORTED_LOCALES = new Set(["en", "cn"]);

// ── Template scaffolding ────────────────────────────────────────────────────

/**
 * Map of destination path (relative to project root) -> template filename.
 */
const SCAFFOLD = {
  "AGENTS.md": "AGENTS.md",
  ".opencode/prompt.md": "opencode-prompt.md",
  ".openclaw/facts/architecture.md": "facts-architecture.md",
  ".openclaw/facts/invariants.md": "facts-invariants.md",
  ".openclaw/facts/performance_rules.md": "facts-performance_rules.md",
  ".openclaw/facts/pitfalls.md": "facts-pitfalls.md",
  ".gitignore": "gitignore",
};

// Templates that have locale-specific versions (everything except .gitignore)
const LOCALIZABLE = new Set([
  "AGENTS.md",
  "opencode-prompt.md",
  "facts-architecture.md",
  "facts-invariants.md",
  "facts-performance_rules.md",
  "facts-pitfalls.md",
]);

function scaffoldFiles(locale = "en") {
  let created = 0;
  let skipped = 0;

  for (const [dest, templateName] of Object.entries(SCAFFOLD)) {
    if (existsSync(dest)) {
      log.ok(`${dest} ${color.dim("(already exists)")}`);
      skipped++;
      continue;
    }

    // Ensure parent directory exists
    const dir = dirname(dest);
    if (dir !== "." && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const templatePath = LOCALIZABLE.has(templateName) && locale !== "en"
      ? join(TEMPLATES_DIR, locale, templateName)
      : join(TEMPLATES_DIR, templateName);
    const content = readFileSync(templatePath, "utf-8");

    // For .gitignore, we append rather than overwrite if it already exists
    writeFileSync(dest, content, "utf-8");
    log.ok(`${dest} ${color.dim("(created)")}`);
    created++;
  }

  // If .gitignore already existed, ensure our entries are in it
  if (existsSync(".gitignore") && skipped > 0) {
    const existing = readFileSync(".gitignore", "utf-8");
    const templateContent = readFileSync(
      join(TEMPLATES_DIR, "gitignore"),
      "utf-8",
    );

    // Check if our marker entries are present
    if (!existing.includes(".beads/dolt/")) {
      appendFileSync(".gitignore", `\n# Added by mneme init\n${templateContent}`);
      log.ok(`.gitignore ${color.dim("(mneme entries appended)")}`);
    }
  }

  return { created, skipped };
}

// ── Dependency installation ─────────────────────────────────────────────────

function installGit() {
  if (has("git")) {
    const ver = run("git --version") ?? "";
    log.ok(`git ${color.dim(ver)}`);
    return true;
  }

  log.info("Installing git...");
  const { os } = getPlatform();

  if (os === "darwin") {
    runLive("xcode-select --install 2>/dev/null || true");
  } else if (os === "linux") {
    if (has("apt-get")) runLive("sudo apt-get update -qq && sudo apt-get install -y -qq git");
    else if (has("dnf")) runLive("sudo dnf install -y git");
    else if (has("yum")) runLive("sudo yum install -y git");
    else if (has("pacman")) runLive("sudo pacman -S --noconfirm git");
    else {
      log.fail("Cannot auto-install git. Please install manually.");
      return false;
    }
  } else {
    log.fail(`Unsupported platform for auto-install: ${os}. Please install git manually.`);
    return false;
  }

  return has("git");
}

function checkOpencode() {
  if (has("opencode")) {
    const ver = run("opencode --version 2>/dev/null | head -1") ?? "";
    log.ok(`opencode ${color.dim(ver)}`);
    return true;
  }

  log.warn(
    "opencode not installed — mneme wraps opencode for the AI agent experience",
  );
  log.info("  Install: https://opencode.ai");
  log.info('  After installing, run `mneme` to start or `mneme doctor` to verify');
  return false;
}

function installDolt() {
  if (has("dolt")) {
    const ver = run("dolt version") ?? "";
    log.ok(`dolt ${color.dim(ver)}`);
    return true;
  }

  log.info("Installing dolt...");
  const code = runLive(
    "curl -fsSL https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash",
    { timeout: 120_000 },
  );

  if (code === 0 && has("dolt")) {
    log.ok("dolt installed");
    return true;
  }

  log.fail("Failed to install dolt. See https://github.com/dolthub/dolt");
  return false;
}

function installBd() {
  if (has("bd")) {
    const ver = run("bd version 2>/dev/null | head -1") ?? "";
    log.ok(`bd ${color.dim(ver)}`);
    return true;
  }

  log.info("Installing bd (beads)...");

  // Strategy: brew > npm > GitHub release binary
  if (has("brew")) {
    log.info("  via Homebrew...");
    if (runLive("brew install beads") === 0 && has("bd")) {
      log.ok("bd installed via brew");
      return true;
    }
  }

  if (has("npm")) {
    log.info("  via npm...");
    if (runLive("npm install -g @beads/bd") === 0 && has("bd")) {
      log.ok("bd installed via npm");
      return true;
    }
  }

  // Fallback: download binary from GitHub releases
  log.info("  via GitHub release binary...");
  const { os, arch } = getPlatform();
  const osMap = { linux: "linux", darwin: "darwin", win32: "windows" };
  const archMap = { x64: "amd64", arm64: "arm64" };
  const osStr = osMap[os];
  const archStr = archMap[arch];

  if (!osStr || !archStr) {
    log.fail(`Unsupported platform: ${os}/${arch}. Please install bd manually.`);
    return false;
  }

  // Fetch latest version tag
  const latestJson = run(
    'curl -fsSL https://api.github.com/repos/steveyegge/beads/releases/latest',
    { timeout: 30_000 },
  );
  if (!latestJson) {
    log.fail("Failed to fetch beads release info.");
    return false;
  }

  let version;
  try {
    const data = JSON.parse(latestJson);
    version = data.tag_name?.replace(/^v/, "");
  } catch {
    log.fail("Failed to parse beads release info.");
    return false;
  }

  const ext = os === "win32" ? "zip" : "tar.gz";
  const url = `https://github.com/steveyegge/beads/releases/download/v${version}/beads_${version}_${osStr}_${archStr}.${ext}`;

  const dlCmd =
    ext === "tar.gz"
      ? `curl -fsSL "${url}" -o /tmp/beads.tar.gz && tar xzf /tmp/beads.tar.gz -C /tmp/ && install /tmp/bd /usr/local/bin/bd`
      : `curl -fsSL "${url}" -o /tmp/beads.zip && unzip -o /tmp/beads.zip -d /tmp/beads && install /tmp/beads/bd.exe /usr/local/bin/bd`;

  if (runLive(dlCmd, { timeout: 60_000 }) === 0 && has("bd")) {
    log.ok("bd installed via GitHub release");
    return true;
  }

  log.fail("Failed to install bd. See https://github.com/steveyegge/beads");
  return false;
}

// ── Dolt server + bd init ───────────────────────────────────────────────────

/**
 * Shared dolt data directory. All projects store their databases here,
 * isolated by database name (e.g. beads_projectA, beads_projectB).
 * One dolt server on port 3307 serves all projects on this machine.
 */
const DOLT_DATA_DIR = process.env.MNEME_DOLT_DATA_DIR
  || join(process.env.HOME, ".dolt", "databases");

const DOLT_PORT = parseInt(process.env.MNEME_DOLT_PORT || "3307", 10);

function ensureDoltServer() {
  if (!existsSync(DOLT_DATA_DIR)) {
    mkdirSync(DOLT_DATA_DIR, { recursive: true });
  }

  // Check if a dolt server is already running and reachable
  const test = run("bd list --status=open 2>&1");
  if (test !== null && !test.includes("unreachable") && !test.includes("connection refused")) {
    log.ok(`dolt server already running ${color.dim(`(port ${DOLT_PORT})`)}`);
    return true;
  }

  log.info(`Starting dolt server (port ${DOLT_PORT}, data-dir ${DOLT_DATA_DIR})...`);
  const logFile = join(DOLT_DATA_DIR, "server.log");

  // Start in background — shared data dir, all project databases coexist
  run(
    `nohup dolt sql-server --host 127.0.0.1 --port ${DOLT_PORT} --data-dir "${DOLT_DATA_DIR}" > "${logFile}" 2>&1 &`,
  );

  // Wait for server to be ready (up to 10s)
  for (let i = 0; i < 10; i++) {
    run("sleep 1");
    const check = run("bd list --status=open 2>&1");
    if (check !== null && !check.includes("unreachable") && !check.includes("connection refused")) {
      log.ok(`dolt server started ${color.dim(`(port ${DOLT_PORT})`)}`);
      return true;
    }
  }

  log.fail(`dolt server failed to start. Check ${logFile}`);
  return false;
}

function initBeads() {
  if (existsSync(".beads/config.yaml")) {
    log.ok(`.beads/ ${color.dim("(already initialized)")}`);
    return true;
  }

  log.info("Initializing beads...");
  const code = runLive("bd init");
  if (code === 0) {
    log.ok("beads initialized");
    return true;
  }

  log.fail("bd init failed");
  return false;
}

function initGit() {
  if (existsSync(".git")) {
    log.ok(`.git/ ${color.dim("(already initialized)")}`);
    return true;
  }

  log.info("Initializing git...");
  if (runLive("git init -q") === 0) {
    log.ok("git initialized");
    return true;
  }

  log.fail("git init failed");
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function init(args = []) {
  // Parse locale from args: `mneme init cn` → locale "cn"
  const locale = args.length > 0 && SUPPORTED_LOCALES.has(args[0]) ? args[0] : "en";

  console.log(`
${color.bold("mneme init")} — Three-layer memory architecture for AI agents${locale !== "en" ? ` (${locale})` : ""}
`);

  const { os, arch } = getPlatform();
  log.info(`Platform: ${os} ${arch}`);

  // Step 1: Dependencies
  log.step(1, 4, "Install dependencies");
  const gitOk = installGit();
  if (!gitOk) {
    log.fail("git is required. Aborting.");
    process.exit(1);
  }
  checkOpencode();
  const doltOk = installDolt();
  const bdOk = installBd();

  // Step 2: Git init
  log.step(2, 4, "Initialize git");
  initGit();

  // Step 3: Scaffold files
  log.step(3, 4, "Scaffold project structure");
  const { created, skipped } = scaffoldFiles(locale);
  log.info(`  ${created} file(s) created, ${skipped} already existed`);

  // Step 4: Dolt + Beads
  log.step(4, 4, "Initialize beads");
  if (doltOk && bdOk) {
    const serverOk = ensureDoltServer();
    if (serverOk) {
      initBeads();
    }
  } else {
    log.warn("Skipping beads init (dolt or bd not installed)");
    log.warn("Run `mneme doctor` after installing dependencies to check status");
  }

  // Done
  console.log(`
${color.bold("===============================")}
  ${color.green("mneme init complete")}
${color.bold("===============================")}

${color.bold("Next steps:")}
  mneme                      # Start coding with AI agent
  bd ready                   # Check available tasks
  mneme doctor               # Verify everything is healthy
`);
}
