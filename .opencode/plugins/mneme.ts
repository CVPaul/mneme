import { tool, type Plugin } from "@opencode-ai/plugin";
import { execFileSync } from "node:child_process";

// Helper: run mneme CLI and capture output
function mneme(
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): string {
  try {
    return execFileSync("mneme", args, {
      encoding: "utf-8",
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      timeout: timeoutMs,
    }).trim();
  } catch (err: any) {
    const output = (err.stdout || "") + (err.stderr || "");
    if (output.trim()) return `[ERROR] ${output.trim()}`;
    return `[ERROR] mneme ${args.join(" ")} failed: ${err.message}`;
  }
}

const z = tool.schema;

export const MnemePlugin: Plugin = async (ctx) => {
  const cwd = ctx.directory;

  return {
    tool: {
      // ─── Beads (task management) ───────────────────────────

      mneme_ready: tool({
        description:
          "List tasks that are ready to work on (unblocked, with dependencies resolved). " +
          "Use this at the start of a session to find available work.",
        args: {},
        async execute(_args, _context) {
          return mneme(["ready"], cwd);
        },
      }),

      mneme_list: tool({
        description:
          "List beads (tasks) filtered by status. " +
          "Returns task IDs, titles, priorities, and statuses.",
        args: {
          status: z
            .enum(["open", "in_progress", "closed", "blocked"])
            .optional()
            .describe(
              "Filter by status. Omit to list all tasks.",
            ),
        },
        async execute(args, _context) {
          const cmdArgs = ["list"];
          if (args.status) cmdArgs.push(`--status=${args.status}`);
          return mneme(cmdArgs, cwd);
        },
      }),

      mneme_show: tool({
        description:
          "Show detailed information about a specific bead (task), " +
          "including description, notes, dependencies, and status.",
        args: {
          id: z.string().describe("The bead ID (e.g. mneme-j4l)"),
        },
        async execute(args, _context) {
          return mneme(["show", args.id], cwd);
        },
      }),

      mneme_create: tool({
        description:
          "Create a new bead (task). Every task must have a clear, " +
          "verifiable completion condition. " +
          "Bad: 'Improve performance'. Good: 'Reduce API response time below 200ms'.",
        args: {
          title: z.string().describe("Short, descriptive task title"),
          description: z
            .string()
            .optional()
            .describe("Detailed description of what needs to be done"),
          type: z
            .enum(["bug", "feature", "task", "epic", "chore"])
            .optional()
            .describe("Issue type (default: task)"),
          priority: z
            .enum(["0", "1", "2", "3", "4"])
            .optional()
            .describe(
              "Priority: 0=critical, 1=high, 2=medium (default), 3=low, 4=backlog",
            ),
        },
        async execute(args, _context) {
          const cmdArgs = ["create", `--title=${args.title}`];
          if (args.description)
            cmdArgs.push(`--description=${args.description}`);
          if (args.type) cmdArgs.push(`--type=${args.type}`);
          if (args.priority) cmdArgs.push(`-p`, args.priority);
          return mneme(cmdArgs, cwd);
        },
      }),

      mneme_update: tool({
        description:
          "Update a bead's status, notes, title, or description. " +
          "Use this to claim tasks (--status=in_progress), " +
          "record progress (--notes), or modify task details. " +
          "NEVER use 'bd edit' — always use this tool instead.",
        args: {
          id: z.string().describe("The bead ID to update"),
          status: z
            .enum(["open", "in_progress", "closed", "blocked"])
            .optional()
            .describe("New status"),
          notes: z
            .string()
            .optional()
            .describe("Progress notes to append"),
          title: z.string().optional().describe("New title"),
          description: z
            .string()
            .optional()
            .describe("New description"),
        },
        async execute(args, _context) {
          const cmdArgs = ["update", args.id];
          if (args.status) cmdArgs.push(`--status=${args.status}`);
          if (args.notes) cmdArgs.push(`--notes=${args.notes}`);
          if (args.title) cmdArgs.push(`--title=${args.title}`);
          if (args.description)
            cmdArgs.push(`--description=${args.description}`);
          return mneme(cmdArgs, cwd);
        },
      }),

      mneme_close: tool({
        description:
          "Close a completed bead with a summary of what was accomplished. " +
          "Use this when a task is fully done.",
        args: {
          id: z.string().describe("The bead ID to close"),
          reason: z
            .string()
            .describe("Summary of what was accomplished"),
        },
        async execute(args, _context) {
          return mneme(["close", args.id, `--reason=${args.reason}`], cwd);
        },
      }),

      mneme_blocked: tool({
        description:
          "List tasks that are blocked by unresolved dependencies.",
        args: {},
        async execute(_args, _context) {
          return mneme(["blocked"], cwd);
        },
      }),

      mneme_dep: tool({
        description:
          "Manage task dependencies. Add or remove a dependency " +
          "between a child task and its parent (blocker).",
        args: {
          action: z
            .enum(["add", "remove"])
            .describe("Whether to add or remove the dependency"),
          child: z
            .string()
            .describe("The child bead ID (the one being blocked)"),
          parent: z
            .string()
            .describe("The parent bead ID (the blocker)"),
        },
        async execute(args, _context) {
          return mneme(
            ["dep", args.action, args.child, args.parent],
            cwd,
          );
        },
      }),

      // ─── Ledger (long-term facts) ─────────────────────────

      mneme_facts: tool({
        description:
          "Read ledger facts — verified long-term knowledge about the project. " +
          "Without arguments, lists all facts files. " +
          "With a name, shows the contents of that specific facts file. " +
          "Facts take priority over conversation history and agent reasoning.",
        args: {
          name: z
            .string()
            .optional()
            .describe(
              "Facts file name (e.g. 'architecture', 'invariants'). Omit to list all.",
            ),
          stats: z
            .boolean()
            .optional()
            .describe("Show line counts and budget stats"),
        },
        async execute(args, _context) {
          const cmdArgs = ["facts"];
          if (args.name) cmdArgs.push(args.name);
          if (args.stats) cmdArgs.push("--stats");
          return mneme(cmdArgs, cwd);
        },
      }),

      mneme_propose_fact: tool({
        description:
          "Propose a new fact to the ledger. The proposal requires human approval " +
          "before it becomes a permanent fact. Before proposing, verify ALL conditions: " +
          "(1) information is verified, not a hypothesis; " +
          "(2) future sessions will repeatedly need it; " +
          "(3) it won't become stale quickly; " +
          "(4) no equivalent fact already exists.",
        args: {
          file: z
            .string()
            .describe(
              "Target facts file (e.g. 'architecture', 'pitfalls', 'invariants')",
            ),
          content: z.string().describe("The fact text to add"),
          reason: z
            .string()
            .describe("Why this qualifies as a long-term fact"),
          action: z
            .enum(["append", "create"])
            .optional()
            .describe(
              "'append' (default) to add to existing file, 'create' for a new file",
            ),
        },
        async execute(args, _context) {
          const cmdArgs = [
            "propose",
            `--file=${args.file}`,
            `--content=${args.content}`,
            `--reason=${args.reason}`,
          ];
          if (args.action) cmdArgs.push(`--action=${args.action}`);
          return mneme(cmdArgs, cwd);
        },
      }),

      // ─── Session status ────────────────────────────────────

      mneme_status: tool({
        description:
          "Show mneme project status: which database is in use, " +
          "Dolt server status, ledger stats, and active tasks summary.",
        args: {},
        async execute(_args, _context) {
          return mneme(["status"], cwd);
        },
      }),

      mneme_doctor: tool({
        description:
          "Run diagnostics on the mneme setup: checks Dolt, bd, " +
          "ledger directory, database connectivity, and configuration.",
        args: {},
        async execute(_args, _context) {
          return mneme(["doctor"], cwd);
        },
      }),
    },

    // Inject mneme state into compaction context so it survives compaction
    "experimental.session.compacting": async (_input, output) => {
      try {
        const ready = mneme(["ready"], cwd);
        const inProgress = mneme(["list", "--status=in_progress"], cwd);
        const factsOverview = mneme(["facts"], cwd);
        output.context.push(
          `\n## mneme state (persisted before compaction)\n\n` +
            `### In-progress tasks:\n${inProgress}\n\n` +
            `### Ready tasks:\n${ready}\n\n` +
            `### Ledger facts overview:\n${factsOverview}\n`,
        );
      } catch {
        // If mneme is unavailable, skip gracefully
      }
    },
  };
};
