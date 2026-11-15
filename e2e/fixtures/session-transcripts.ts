const DAY_MS = 24 * 60 * 60 * 1000;

/** The day of the synthetic sessions: the UTC day before `now`, as `YYYY-MM-DD`. */
export function sessionsDay(now: Date): string {
  return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
}

interface LineOptions {
  session: string;
  time: string;
  cwd: string;
  branch?: string;
}

const base = ({ session, time, cwd, branch }: LineOptions) => ({
  sessionId: session,
  timestamp: time,
  cwd,
  gitBranch: branch ?? "HEAD",
});

/** One synthetic assistant record. Its text fields hold a fake marker that the index must drop. */
function assistant(id: string, options: LineOptions & { skill?: string; tokens?: number }): string {
  return JSON.stringify({
    type: "assistant",
    ...base(options),
    message: {
      id,
      model: "synthetic-priced-1",
      content: [
        { type: "text", text: "SYNTHETIC-REPLY-TEXT" },
        ...(options.skill === undefined
          ? []
          : [{ type: "tool_use", id: `tu-${id}`, name: "Skill", input: { skill: options.skill } }]),
      ],
      usage: { input_tokens: options.tokens ?? 1000, output_tokens: 200 },
    },
  });
}

/** One synthetic real message of the Operator, or with `command` a slash command. */
function operator(id: string, options: LineOptions & { command?: string }): string {
  const content =
    options.command === undefined
      ? "SYNTHETIC-PROMPT-TEXT"
      : `<command-message>${options.command}</command-message>\n<command-name>/${options.command}</command-name>\n<command-args></command-args>`;
  return JSON.stringify({
    type: "user",
    uuid: id,
    ...base(options),
    message: { role: "user", content },
  });
}

const lines = (...entries: string[]): string => `${entries.join("\n")}\n`;

const APP = "/synthetic/acme/app";
const TOOLS = "/synthetic/bebopaloo/tools";
const SPIKE = "/synthetic/spike-cli";
const folderOf = (project: string): string => project.replace(/[^A-Za-z0-9]/g, "-");

/**
 * The transcripts of three sessions on one day. The night run `sess-night-1` has a main conversation in
 * `acme/app`, 2 messages of the Operator, 2 `software-developer` sub-agents in worktrees of issues 11 and
 * 12, 2 `review-finder` sub-agents and one sub-agent with no meta file. `sess-attended-1` calls
 * `factory-next` in `bebopaloo/tools`. `sess-plain-1` has no skill, in a project with no repo list entry.
 */
export function sessionTranscripts(now: Date): Record<string, string> {
  const day = sessionsDay(now);
  const at = (clock: string) => `${day}T${clock}:00.000Z`;
  const night = "sess-night-1";
  const root = `projects/${folderOf(APP)}`;
  const worktree = (name: string) => `${APP}.worktrees/${name}`;
  const agent = (
    id: string,
    cwd: string,
    clocks: string[],
    meta: string | null,
  ): Record<string, string> => ({
    [`${root}/${night}/subagents/agent-${id}.jsonl`]: lines(
      ...clocks.map((clock, index) =>
        assistant(`${id}-${index.toString()}`, { session: night, time: at(clock), cwd }),
      ),
    ),
    ...(meta === null
      ? {}
      : {
          [`${root}/${night}/subagents/agent-${id}.meta.json`]: JSON.stringify({
            agentType: meta,
            toolUseId: `toolu_${id}`,
          }),
        }),
  });
  const mainLine = { session: night, cwd: APP, branch: "main" };

  return {
    [`${root}/${night}.jsonl`]: lines(
      operator("n-u1", { ...mainLine, time: at("08:59") }),
      assistant("n-m1", { ...mainLine, time: at("09:00"), skill: "factory-core:factory-run" }),
      assistant("n-m2", { ...mainLine, time: at("09:03"), skill: "factory-core:to-code" }),
      operator("n-u2", { ...mainLine, time: at("09:30") }),
    ),
    ...agent(
      "dev1",
      worktree("11-add-the-export"),
      ["09:05", "09:12", "09:20"],
      "software-developer",
    ),
    ...agent("dev2", worktree("12-fix-the-sort-order"), ["09:06", "09:25"], "software-developer"),
    ...agent("rev1", worktree("11-add-the-export"), ["09:21", "09:24"], "review-finder"),
    ...agent("rev2", worktree("11-add-the-export"), ["09:22", "09:28"], "review-finder"),
    ...agent("odd1", worktree("12-fix-the-sort-order"), ["09:30"], null),
    [`projects/${folderOf(TOOLS)}/sess-attended-1.jsonl`]: lines(
      operator("a-u1", {
        session: "sess-attended-1",
        cwd: TOOLS,
        branch: "main",
        time: at("10:00"),
        command: "factory-core:factory-next",
      }),
      assistant("a-m1", {
        session: "sess-attended-1",
        cwd: TOOLS,
        branch: "main",
        time: at("10:01"),
        skill: "factory-core:factory-next",
      }),
      assistant("a-m2", {
        session: "sess-attended-1",
        cwd: TOOLS,
        branch: "main",
        time: at("10:05"),
      }),
    ),
    [`projects/${folderOf(SPIKE)}/sess-plain-1.jsonl`]: lines(
      operator("p-u1", { session: "sess-plain-1", cwd: SPIKE, branch: "main", time: at("11:00") }),
      assistant("p-m1", { session: "sess-plain-1", cwd: SPIKE, branch: "main", time: at("11:01") }),
    ),
  };
}

/**
 * One more sub-agent of the night run `sess-night-1`, in a worktree of issue 7 of `partner/web`, a repo of
 * the client `acme`. It adds a work item in a repo that has no token.
 */
export function partnerTranscripts(now: Date): Record<string, string> {
  const day = sessionsDay(now);
  const night = "sess-night-1";
  const file = `projects/${folderOf(APP)}/${night}/subagents/agent-web1`;
  return {
    [`${file}.jsonl`]: lines(
      assistant("web1-0", {
        session: night,
        time: `${day}T09:10:00.000Z`,
        cwd: "/synthetic/partner/web.worktrees/7-fix-the-menu",
      }),
    ),
    [`${file}.meta.json`]: JSON.stringify({
      agentType: "software-developer",
      toolUseId: "toolu_web1",
    }),
  };
}

/** `count` sessions with one Turn each, 1 minute apart, in a project with no repo list entry. */
export function manySessionTranscripts(now: Date, count: number): Record<string, string> {
  const day = sessionsDay(now);
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const id = `sess-many-${index.toString().padStart(3, "0")}`;
      const clock = `${day}T09:${index.toString().padStart(2, "0")}:00.000Z`;
      return [
        `projects/${folderOf(SPIKE)}/${id}.jsonl`,
        lines(
          operator(`${id}-u`, { session: id, cwd: SPIKE, branch: "main", time: clock }),
          assistant(`${id}-a`, { session: id, cwd: SPIKE, branch: "main", time: clock }),
        ),
      ];
    }),
  );
}
