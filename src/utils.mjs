/**
 * Shared utilities: colored output, command execution, platform detection.
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform, arch } from "node:os";

// ── Colors ──────────────────────────────────────────────────────────────────

const isColorSupported =
  process.env.FORCE_COLOR !== "0" && process.stdout.isTTY;

const c = (code) => (isColorSupported ? `\x1b[${code}m` : "");

export const color = {
  red: (s) => `${c("0;31")}${s}${c("0")}`,
  green: (s) => `${c("0;32")}${s}${c("0")}`,
  yellow: (s) => `${c("1;33")}${s}${c("0")}`,
  blue: (s) => `${c("0;34")}${s}${c("0")}`,
  dim: (s) => `${c("2")}${s}${c("0")}`,
  bold: (s) => `${c("1")}${s}${c("0")}`,
};

export const log = {
  info: (msg) => console.log(`${color.blue("==>")} ${msg}`),
  ok: (msg) => console.log(`${color.green("[OK]")} ${msg}`),
  warn: (msg) => console.log(`${color.yellow("[!!]")} ${msg}`),
  fail: (msg) => console.log(`${color.red("[FAIL]")} ${msg}`),
  step: (n, total, msg) =>
    console.log(`\n${color.bold(`--- ${n}/${total}`)} ${msg} ---`),
};

// ── Command execution ───────────────────────────────────────────────────────

/**
 * Check if a command exists in PATH.
 */
export function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command and return stdout (trimmed). Returns null on failure.
 */
export function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts.timeout ?? 60_000,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a command, inheriting stdio (user sees output). Returns exit code.
 */
export function runLive(cmd, opts = {}) {
  try {
    execSync(cmd, {
      stdio: "inherit",
      timeout: opts.timeout ?? 120_000,
      ...opts,
    });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

// ── Platform detection ──────────────────────────────────────────────────────

export function getPlatform() {
  const os = platform(); // 'linux', 'darwin', 'win32'
  const ar = arch(); // 'x64', 'arm64'
  return { os, arch: ar };
}

// ── File helpers ────────────────────────────────────────────────────────────

export { existsSync };
