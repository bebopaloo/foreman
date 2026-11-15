export interface InteractiveTimeRules {
  /** IANA time zone of the ledger days. */
  timeZone: string;
  idleMinutes: number;
  leadInMinutes: number;
}

export interface InteractiveTimeMessage {
  id: string;
  time: Date;
  projectKey: string;
}

export interface InteractiveTimeEntry {
  id: string;
  projectKey: string;
  /** `YYYY-MM-DD` in the ledger time zone. */
  day: string;
  seconds: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function ledgerDay(time: Date, timeZone: string): string {
  const parts = dayFormatter(timeZone).formatToParts(time);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 30 seconds and more round up. */
export function roundSecondsToMinutes(seconds: number): number {
  return Math.floor((seconds + 30) / 60);
}

function compareMessages(a: InteractiveTimeMessage, b: InteractiveTimeMessage): number {
  const byTime = a.time.getTime() - b.time.getTime();
  if (byTime !== 0) return byTime;
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/**
 * Puts the messages on one timeline and gives the seconds that each message adds:
 * the gap since the message before it when the gap is at most the idle cut-off,
 * else the lead-in. Gaps use UTC times, so a clock change adds or removes no time.
 */
export function interactiveTime(
  messages: readonly InteractiveTimeMessage[],
  rules: InteractiveTimeRules,
): InteractiveTimeEntry[] {
  const idleMs = rules.idleMinutes * 60_000;
  const leadInSeconds = rules.leadInMinutes * 60;
  let previous: number | undefined;
  return [...messages].sort(compareMessages).map((message) => {
    const time = message.time.getTime();
    const gapMs = previous === undefined ? undefined : time - previous;
    previous = time;
    const seconds =
      gapMs !== undefined && gapMs <= idleMs ? Math.floor(gapMs / 1000) : leadInSeconds;
    return {
      id: message.id,
      projectKey: message.projectKey,
      day: ledgerDay(message.time, rules.timeZone),
      seconds,
    };
  });
}
