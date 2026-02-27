/**
 * mneme init — Initialize three-layer memory architecture in the current directory.
 *
 * Steps:
 *   1. Install dependencies (git, dolt, bd)
 *   2. git init (if needed)
 *   3. Scaffold .ledger/facts/, .opencode/prompt.md, AGENTS.md, .gitignore
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
 * Templates prefixed with "opencode-" are for the opencode integration layer.
 */
const SCAFFOLD = {
  "AGENTS.md": "AGENTS.md",
  ".opencode/prompt.md": "opencode-prompt.md",
  ".ledger/facts/architecture.md": "facts-architecture.md",
  ".ledger/facts/invariants.md": "facts-invariants.md",
  ".ledger/facts/performance_rules.md": "facts-performance_rules.md",
  ".ledger/facts/pitfalls.md": "facts-pitfalls.md",
  ".gitignore": "gitignore",
  // opencode integration files
  "opencode.json": "opencode-json",
  ".opencode/plugins/mneme.ts": "opencode-plugin-mneme-ts",
  ".opencode/oh-my-opencode.jsonc": "opencode-oh-my-opencode-jsonc",
  ".opencode/package.json": "opencode-package-json",
  ".opencode/.gitignore": "opencode-dotgitignore",
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

    const templatePath = LOCALIZABLE.has(templateName)
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

import { DOLT_DATA_DIR, DOLT_PORT, isPortOpen, findDoltProcess, startDoltServer, killDoltProcess } from "../dolt.mjs";

function ensureDoltServer() {
  // Check if port is already in use
  if (isPortOpen()) {
    const info = findDoltProcess();

    if (info && info.dataDir === DOLT_DATA_DIR) {
      // Same data-dir, already running — nothing to do
      log.ok(`dolt server already running ${color.dim(`(port ${DOLT_PORT}, data-dir ${DOLT_DATA_DIR})`)}`);
      return true;
    }

    if (info) {
      // Dolt running but with a different data-dir — kill and restart
      log.warn(`dolt server on port ${DOLT_PORT} uses a different data-dir, restarting...`);
      killDoltProcess();
    } else {
      // Port occupied by something else entirely
      log.fail(`Port ${DOLT_PORT} is in use by a non-dolt process. Set MNEME_DOLT_PORT to use a different port.`);
      return false;
    }
  }

  log.info(`Starting dolt server (port ${DOLT_PORT}, data-dir ${DOLT_DATA_DIR})...`);
  if (startDoltServer()) {
    log.ok(`dolt server started ${color.dim(`(port ${DOLT_PORT})`)}`);
    return true;
  }

  log.fail(`dolt server failed to start. Check ${DOLT_DATA_DIR}/server.log`);
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

// ── Opencode plugin dependencies ────────────────────────────────────────────

function installOpencodePlugins() {
  if (!existsSync(".opencode/package.json")) {
    log.warn(".opencode/package.json not found, skipping plugin install");
    return false;
  }

  if (existsSync(".opencode/node_modules")) {
    log.ok(`.opencode/node_modules/ ${color.dim("(already installed)")}`);
    return true;
  }

  log.info("Installing opencode plugin dependencies...");

  // Prefer bun (faster), fall back to npm
  const pkgMgr = has("bun") ? "bun" : has("npm") ? "npm" : null;
  if (!pkgMgr) {
    log.warn("Neither bun nor npm found — cannot install plugin dependencies");
    log.info("  Run 'npm install' or 'bun install' in .opencode/ manually");
    return false;
  }

  // Use official registry to avoid issues with local mirror not having these packages
  const installCmd = pkgMgr === "npm"
    ? "npm install --registry=https://registry.npmjs.org"
    : "bun install";
  const code = runLive(installCmd, { cwd: join(process.cwd(), ".opencode"), timeout: 60_000 });
  if (code === 0) {
    log.ok(`opencode plugins installed via ${pkgMgr}`);
    return true;
  }

  log.warn(`Failed to install opencode plugins (${pkgMgr} install exited ${code})`);
  log.info("  Run 'npm install' or 'bun install' in .opencode/ manually");
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
  log.step(1, 5, "Install dependencies");
  const gitOk = installGit();
  if (!gitOk) {
    log.fail("git is required. Aborting.");
    process.exit(1);
  }
  checkOpencode();
  const doltOk = installDolt();
  const bdOk = installBd();

  // Step 2: Git init
  log.step(2, 5, "Initialize git");
  initGit();

  // Step 3: Scaffold files
  log.step(3, 5, "Scaffold project structure");
  const { created, skipped } = scaffoldFiles(locale);
  log.info(`  ${created} file(s) created, ${skipped} already existed`);

  // Step 4: Install opencode plugin dependencies
  log.step(4, 5, "Install opencode plugins");
  installOpencodePlugins();

  // Step 5: Dolt + Beads
  log.step(5, 5, "Initialize beads");
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
  mneme ready                    # Check available tasks
  mneme doctor               # Verify everything is healthy
`);
}
