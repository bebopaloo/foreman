import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "./test-server.ts";
import { fakeApi, renderApp } from "./test-render.tsx";

function openAt(url: string) {
  window.history.replaceState(null, "", url);
}

describe("the Client scope", () => {
  it("takes the scope from the URL and keeps it in every link", async () => {
    fakeApi();
    openAt("/?client=acme");
    renderApp();
    expect(await screen.findByText("Showing only acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "acme" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Foreman" })).toHaveAttribute("href", "/?client=acme");
  });

  it("opens in the stored scope when the URL has no client value", async () => {
    fakeApi();
    window.localStorage.setItem("foreman.scope", "acme");
    renderApp();
    expect(await screen.findByText("Showing only acme")).toBeInTheDocument();
    expect(window.location.search).toBe("?client=acme");
  });

  it("opens in All, in its own style, when nothing is stored", async () => {
    fakeApi();
    renderApp();
    const pill = await screen.findByText("Showing all clients");
    expect(pill).toHaveClass("scope-pill-all");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens in All when the browser storage cannot be read", async () => {
    fakeApi();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp();
    expect(await screen.findByText("Showing all clients")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("lists All and each client, and a choice goes into the URL and the storage", async () => {
    fakeApi();
    renderApp();
    const group = await screen.findByRole("group", { name: "Client scope" });
    await within(group).findByRole("button", { name: "bebopaloo" });
    await userEvent.click(within(group).getByRole("button", { name: "acme" }));
    expect(window.location.search).toBe("?client=acme");
    expect(window.localStorage.getItem("foreman.scope")).toBe("acme");
    expect(screen.getByRole("link", { name: "Foreman" })).toHaveAttribute("href", "/?client=acme");
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(window.location.search).toBe("");
    expect(window.localStorage.getItem("foreman.scope")).toBeNull();
  });

  it("shows Unknown client and no data for a client that the repo list lacks", async () => {
    fakeApi();
    let healthCalls = 0;
    server.use(
      http.get("*/api/health", () => {
        healthCalls += 1;
        return HttpResponse.json({ status: "ok", version: "1.2.3" });
      }),
    );
    openAt("/?client=globex");
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown client");
    expect(screen.queryByText(/Showing all clients/)).not.toBeInTheDocument();
    expect(screen.queryByText(/API status/)).not.toBeInTheDocument();
    expect(healthCalls).toBe(0);
  });
});

describe("the connection state", () => {
  it("shows Connected and the oldest data time of the repos in scope", async () => {
    fakeApi({
      repos: [
        { id: "a", fullName: "acme/app", client: "acme", dataAsOf: "2026-11-15T09:42:00.000Z" },
        { id: "b", fullName: "acme/api", client: "acme", dataAsOf: "2026-11-15T09:50:00.000Z" },
        {
          id: "c",
          fullName: "bebopaloo/foreman",
          client: "bebopaloo",
          dataAsOf: "2026-11-14T01:00:00.000Z",
        },
      ],
    });
    openAt("/?client=acme");
    renderApp();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    const time = await screen.findByText(/\d{2}\/\d{2}\/\d{2}/);
    expect(time).toHaveAttribute("datetime", "2026-11-15T09:42:00.000Z");
  });

  it("says Not connected and why when the owners have no token", async () => {
    fakeApi({ owners: [{ host: "github.com", owner: "acme", state: "not connected: no token" }] });
    renderApp();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("github.com/acme: not connected: no token")).toBeInTheDocument();
    expect(screen.getByText("not yet")).toBeInTheDocument();
  });

  it("says Partly connected when one owner fails", async () => {
    fakeApi({
      owners: [
        { host: "github.com", owner: "acme", state: "connected" },
        { host: "github.com", owner: "bebopaloo", state: "token rejected" },
      ],
    });
    renderApp();
    expect(await screen.findByText("Partly connected")).toBeInTheDocument();
  });

  it("tells the user when the last fetch failed", async () => {
    fakeApi({ state: "failed", reason: "forge timeout" });
    renderApp();
    expect(await screen.findByText(/The last fetch failed: forge timeout/)).toBeInTheDocument();
  });

  it("says when the connection state cannot be read", async () => {
    fakeApi();
    server.use(http.get("*/api/work/status", () => new HttpResponse(null, { status: 500 })));
    renderApp();
    expect(await screen.findByText("The connection state cannot be read.")).toBeInTheDocument();
  });

  it("notes the repos with no client, in All only", async () => {
    fakeApi({ unassignedCount: 1 });
    renderApp();
    expect(await screen.findByText(/1 repo has no client/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "acme" }));
    expect(screen.queryByText(/no client/)).not.toBeInTheDocument();
  });
});

describe("the Refresh button", () => {
  it("sends the work and the usage refresh, and waits while the fetch runs", async () => {
    const calls = fakeApi();
    renderApp();
    const button = await screen.findByRole("button", { name: "Refresh" });
    await userEvent.click(button);
    await waitFor(() => {
      expect(calls.sort()).toEqual(["POST /api/usage/refresh", "POST /api/work/refresh"]);
    });
  });

  it("shows a note when the refresh request fails", async () => {
    fakeApi();
    server.use(http.post("*/api/work/refresh", () => new HttpResponse(null, { status: 403 })));
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("The refresh request failed. Try again.")).toBeInTheDocument();
  });
});

describe("the theme button", () => {
  it("is in the header", async () => {
    fakeApi();
    renderApp();
    const banner = await screen.findByRole("banner");
    expect(within(banner).getByRole("button", { name: /^Theme: / })).toBeInTheDocument();
  });
});
