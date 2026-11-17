import type { Finding, FindingsResponse } from "@foreman/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { ScopeProvider } from "../scope/index.ts";
import { fakeApi } from "../test-render.tsx";
import { server } from "../test-server.ts";
import { FindingsSection } from "./FindingsSection.tsx";
import { parseFindingsFilters } from "./findings-url-state.ts";

const row = { open: 0, fixed: 0, refuted: 0, deferred: 0, waived: 0, disagreed: 0, total: 0 };

function finding(over: Partial<Finding> = {}): Finding {
  return {
    fingerprint: "0123456789abcdef",
    repo: "acme/app",
    pr: 7,
    issue: null,
    round: 2,
    pass: "Security",
    category: "injection",
    severity: "major",
    status: "verified",
    outcome: "open",
    file: "src/db.ts",
    line: 12,
    thread: "https://github.com/acme/app/pull/7#discussion_r1",
    time: "2026-11-15T10:00:00Z",
    link: "https://github.com/acme/app/pull/7",
    ...over,
  };
}

function body(over: Partial<FindingsResponse> = {}): FindingsResponse {
  return {
    folder: "ok",
    skippedLines: 0,
    skippedFiles: 0,
    security: {
      bySeverity: {
        blocker: row,
        major: { ...row, open: 2, fixed: 1, refuted: 1, total: 4 },
        minor: { ...row, deferred: 1, total: 1 },
        info: row,
      },
    },
    repos: ["acme/app", "acme/web"],
    passes: ["Correctness", "Security"],
    total: 1,
    items: [finding()],
    nextCursor: null,
    ...over,
  };
}

const requests: string[] = [];

function serve(response: FindingsResponse | ((url: URL) => FindingsResponse)) {
  requests.length = 0;
  fakeApi();
  server.use(
    http.get("*/api/reviews/findings", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      return HttpResponse.json(typeof response === "function" ? response(url) : response);
    }),
  );
}

function show(search = "") {
  window.history.replaceState(null, "", `/reviews${search}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScopeProvider>
        <FindingsSection refreshMs={60_000} />
      </ScopeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/reviews");
});

describe("FindingsSection", () => {
  it("shows the security roll-up", async () => {
    serve(body());
    show();
    const table = await screen.findByRole("table", {
      name: "Security findings by severity and outcome",
    });
    const major = within(table).getByRole("row", { name: /major/ });
    expect(
      within(major)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2", "1", "1", "0", "0", "0", "4"]);
    expect(within(table).getByRole("row", { name: /minor/ })).toHaveTextContent("1");
  });

  it("shows a row of the table with its links", async () => {
    serve(body());
    show();
    const table = await screen.findByRole("table", { name: "Findings of the last 30 days" });
    const rows = within(table).getAllByRole("row");
    const data = rows[1] ?? rows[0];
    if (data === undefined) throw new Error("No row");
    expect(data).toHaveTextContent("acme/app");
    expect(data).toHaveTextContent("src/db.ts:12");
    expect(data).toHaveTextContent("open");
    const [pull, thread] = within(data).getAllByRole("link");
    expect(pull).toHaveAttribute("href", "https://github.com/acme/app/pull/7");
    expect(thread).toHaveAttribute("href", "https://github.com/acme/app/pull/7#discussion_r1");
  });

  it("does not make a link of an address that is not a web address", async () => {
    serve(body({ items: [finding({ thread: "javascript:alert(1)", link: null })] }));
    show();
    const table = await screen.findByRole("table", { name: "Findings of the last 30 days" });
    expect(within(table).queryByRole("link")).toBeNull();
  });

  it("shows the empty state with the factory version", async () => {
    serve(body({ folder: "missing", repos: [], passes: [], total: 0, items: [] }));
    show();
    expect(await screen.findByText(/factory-core 0\.39\.0/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the count of skipped lines", async () => {
    serve(body({ skippedLines: 3 }));
    show();
    expect(await screen.findByText(/3 lines and 0 files skipped/)).toBeInTheDocument();
  });

  it("sends a filter to the API and writes it to the URL", async () => {
    serve(body());
    show();
    const select = await screen.findByLabelText("Severity");
    await userEvent.selectOptions(select, "minor");
    await screen.findByText("1 finding after the filters");
    expect(window.location.search).toBe("?findings_severity=minor");
    expect(requests.at(-1)).toContain("severity=minor");
  });

  it("reads the filters from the URL and ignores a value that is not valid", async () => {
    serve(body());
    show("?findings_status=refuted&findings_severity=huge");
    await screen.findByRole("table", { name: "Findings of the last 30 days" });
    expect(requests[0]).toContain("status=refuted");
    expect(requests[0]).not.toContain("severity");
  });

  it("loads the next page", async () => {
    serve((url) =>
      url.searchParams.get("cursor") === null
        ? body({ nextCursor: "next", total: 2 })
        : body({ items: [finding({ fingerprint: "b", pr: 8 })], total: 2 }),
    );
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await screen.findByText("#8");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});

describe("parseFindingsFilters", () => {
  it("keeps the valid values", () => {
    expect(
      parseFindingsFilters("?findings_repo=acme/app&findings_outcome=none&findings_pass=Security"),
    ).toEqual({ repo: "acme/app", outcome: "none", pass: "Security" });
  });
});
