import { describe, expect, it } from "vitest";
import {
  type InteractiveTimeMessage,
  type InteractiveTimeRules,
  interactiveTime,
  ledgerDay,
  roundSecondsToMinutes,
} from "./interactive-time.ts";

const RULES: InteractiveTimeRules = {
  timeZone: "Europe/London",
  idleMinutes: 15,
  leadInMinutes: 2,
};

function at(
  iso: string,
  id = iso,
  projectKey = "/synthetic/acme/payments-api",
): InteractiveTimeMessage {
  return { id, time: new Date(iso), projectKey };
}

function added(messages: InteractiveTimeMessage[], rules = RULES): number[] {
  return interactiveTime(messages, rules).map((entry) => entry.seconds / 60);
}

describe("interactiveTime", () => {
  it("adds the gap when it is within the idle cut-off, else the lead-in", () => {
    const messages = [
      at("2026-11-12T09:00:00Z"),
      at("2026-11-12T09:10:00Z"),
      at("2026-11-12T09:20:00Z"),
      at("2026-11-12T10:00:00Z"),
      at("2026-11-12T10:05:00Z"),
    ];
    expect(added(messages)).toEqual([2, 10, 10, 2, 5]);
  });

  it("counts a gap equal to the idle cut-off in full and one second more as a lead-in", () => {
    expect(added([at("2026-11-12T09:00:00Z"), at("2026-11-12T09:15:00Z")])).toEqual([2, 15]);
    expect(added([at("2026-11-12T11:00:00Z"), at("2026-11-12T11:15:01Z")])).toEqual([2, 2]);
  });

  it("adds the lead-in for the first message", () => {
    expect(added([at("2026-11-12T08:30:00Z")])).toEqual([2]);
  });

  it("returns nothing for no messages", () => {
    expect(interactiveTime([], RULES)).toEqual([]);
  });

  it("puts messages of all projects on one timeline", () => {
    const messages = [
      at("2026-11-12T09:00:00Z", "a", "acme"),
      at("2026-11-12T09:05:00Z", "b", "globex"),
      at("2026-11-12T09:12:00Z", "c", "acme"),
    ];
    const result = interactiveTime(messages, RULES);
    expect(result.map((entry) => [entry.projectKey, entry.seconds / 60])).toEqual([
      ["acme", 2],
      ["globex", 5],
      ["acme", 7],
    ]);
  });

  it("sorts by time, then by record id, whatever the input order", () => {
    const messages = [
      at("2026-11-12T09:05:00Z", "b"),
      at("2026-11-12T09:00:00Z", "z"),
      at("2026-11-12T09:00:00Z", "a"),
    ];
    const result = interactiveTime(messages, RULES);
    expect(result.map((entry) => entry.id)).toEqual(["a", "z", "b"]);
    expect(result.map((entry) => entry.seconds / 60)).toEqual([2, 0, 5]);
  });

  it("does not change the input list", () => {
    const messages = [at("2026-11-12T09:05:00Z"), at("2026-11-12T09:00:00Z")];
    interactiveTime(messages, RULES);
    expect(messages.map((message) => message.time.toISOString())).toEqual([
      "2026-11-12T09:05:00.000Z",
      "2026-11-12T09:00:00.000Z",
    ]);
  });

  it("gives a gap across midnight in full to the day of the later message", () => {
    const result = interactiveTime([at("2026-11-11T23:55:00Z"), at("2026-11-12T00:05:00Z")], RULES);
    expect(result.map((entry) => [entry.day, entry.seconds / 60])).toEqual([
      ["2026-11-11", 2],
      ["2026-11-12", 10],
    ]);
  });

  it("adds no time and removes none across a clock change", () => {
    expect(added([at("2026-10-25T00:55:00Z"), at("2026-10-25T01:05:00Z")])).toEqual([2, 10]);
    const [, second] = interactiveTime(
      [at("2026-10-25T00:55:00Z"), at("2026-10-25T01:05:00Z")],
      RULES,
    );
    expect(second?.day).toBe("2026-10-25");
  });

  it("uses the idle minutes and lead-in of the rules", () => {
    const messages = [
      at("2026-11-12T09:00:00Z"),
      at("2026-11-12T09:10:00Z"),
      at("2026-11-12T09:20:00Z"),
      at("2026-11-12T10:00:00Z"),
      at("2026-11-12T10:05:00Z"),
    ];
    const total = added(messages, { ...RULES, idleMinutes: 45 }).reduce((a, b) => a + b, 0);
    expect(total).toBe(67);
    expect(added([at("2026-11-12T09:00:00Z")], { ...RULES, leadInMinutes: 0 })).toEqual([0]);
  });

  it("works in whole seconds", () => {
    const result = interactiveTime(
      [at("2026-11-12T09:00:00.000Z"), at("2026-11-12T09:00:01.900Z")],
      RULES,
    );
    expect(result.map((entry) => entry.seconds)).toEqual([120, 1]);
  });
});

describe("ledgerDay", () => {
  it("gives the day in the ledger time zone", () => {
    expect(ledgerDay(new Date("2026-07-01T23:30:00Z"), "Europe/London")).toBe("2026-07-02");
    expect(ledgerDay(new Date("2026-12-01T23:30:00Z"), "Europe/London")).toBe("2026-12-01");
  });

  it("follows another time zone", () => {
    expect(ledgerDay(new Date("2026-11-12T23:30:00Z"), "Asia/Tokyo")).toBe("2026-11-13");
  });
});

describe("roundSecondsToMinutes", () => {
  it("rounds 30 seconds and more up", () => {
    expect([89, 29, 30].map(roundSecondsToMinutes)).toEqual([1, 0, 1]);
    expect(roundSecondsToMinutes(0)).toBe(0);
    expect(roundSecondsToMinutes(150)).toBe(3);
  });

  it("makes totals equal the sum of the rounded rows", () => {
    const rows = [89, 29, 30].map(roundSecondsToMinutes);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
