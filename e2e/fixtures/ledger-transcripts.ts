const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day of `now` shifted by `daysAgo`, as `YYYY-MM-DD`. */
export function ledgerDay(now: Date, daysAgo = 0): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

const folderOf = (project: string): string => project.replace(/[^A-Za-z0-9]/g, "-");

interface Line {
  id: string;
  session: string;
  project: string;
  time: string;
}

const base = ({ session, project, time }: Line) => ({
  sessionId: session,
  timestamp: time,
  cwd: project,
  gitBranch: "main",
});

/** One synthetic real message of the Operator. The text is a fake marker. */
const message = (line: Line): string =>
  JSON.stringify({
    type: "user",
    uuid: line.id,
    ...base(line),
    message: { role: "user", content: "SYNTHETIC-PROMPT-TEXT" },
  });

/** One synthetic assistant turn of 1.5M tokens. */
const turn = (line: Line): string =>
  JSON.stringify({
    type: "assistant",
    ...base(line),
    message: {
      id: line.id,
      model: "synthetic-priced-1",
      content: [{ type: "text", text: "SYNTHETIC-REPLY-TEXT" }],
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
    },
  });

const APP = "/synthetic/acme/app";
const TOOLS = "/synthetic/bebopaloo/tools";
const SPIKE = "/synthetic/spike-cli";

/**
 * The transcripts of one day, today in UTC. `acme/app` has real messages at 09:00, 09:10, 09:20, 10:00 and
 * 10:05 (29 minutes of Interactive time), `bebopaloo/tools` one at 14:00 and `spike-cli`, which no repo
 * list entry matches, one at 16:00 (2 minutes each). Each project also has one turn of 1.5M tokens.
 */
export function ledgerTranscripts(now: Date): Record<string, string> {
  const day = ledgerDay(now);
  const at = (clock: string) => `${day}T${clock}:00.000Z`;
  const file = (project: string, session: string, lines: string[]) => ({
    [`projects/${folderOf(project)}/${session}.jsonl`]: `${lines.join("\n")}\n`,
  });
  const line = (project: string, session: string, id: string, clock: string): Line => ({
    id,
    session,
    project,
    time: at(clock),
  });
  return {
    ...file(
      APP,
      "ledger-app-1",
      ["09:00", "09:10", "09:20", "10:00", "10:05"].map((clock, index) =>
        message(line(APP, "ledger-app-1", `app-u${index.toString()}`, clock)),
      ),
    ),
    ...file(APP, "ledger-app-2", [turn(line(APP, "ledger-app-2", "app-t1", "11:00"))]),
    ...file(TOOLS, "ledger-tools-1", [
      message(line(TOOLS, "ledger-tools-1", "tools-u1", "14:00")),
      turn(line(TOOLS, "ledger-tools-1", "tools-t1", "14:01")),
    ]),
    ...file(SPIKE, "ledger-spike-1", [
      message(line(SPIKE, "ledger-spike-1", "spike-u1", "16:00")),
      turn(line(SPIKE, "ledger-spike-1", "spike-t1", "16:01")),
    ]),
  };
}

/** The count of days of `ledgerLongTranscripts`. */
export const LEDGER_LONG_DAYS = 130;

/** One real message at 09:00 on each of 130 days, in `acme/app`: 130 ledger rows. */
export function ledgerLongTranscripts(now: Date): Record<string, string> {
  const lines = Array.from({ length: LEDGER_LONG_DAYS }, (_, daysAgo) =>
    message({
      id: `long-u${daysAgo.toString()}`,
      session: "ledger-long-1",
      project: APP,
      time: `${ledgerDay(now, daysAgo)}T09:00:00.000Z`,
    }),
  );
  return { [`projects/${folderOf(APP)}/ledger-long-1.jsonl`]: `${lines.join("\n")}\n` };
}
