import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { server } from "./test-server.ts";

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("shows the API status", async () => {
    server.use(
      http.get("*/api/health", () => HttpResponse.json({ status: "ok", version: "1.2.3" })),
    );
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("API status: ok")).toBeInTheDocument();
  });

  it("shows the Foreman version in the footer", async () => {
    server.use(
      http.get("*/api/health", () => HttpResponse.json({ status: "ok", version: "1.2.3" })),
    );
    renderApp();
    expect(await screen.findByRole("contentinfo")).toHaveTextContent("Foreman 1.2.3");
  });

  it("tells the user what to do when the API cannot be reached", async () => {
    server.use(http.get("*/api/health", () => new HttpResponse(null, { status: 500 })));
    renderApp();
    await screen.findByText(/cannot be reached/);
    expect(screen.getByRole("status")).toHaveTextContent(/cannot be reached.*pnpm dev/);
  });

  it("rejects a response that breaks the contract", async () => {
    server.use(
      http.get("*/api/health", () =>
        HttpResponse.json({ status: "ok", version: "1.2.3", extra: 1 }),
      ),
    );
    renderApp();
    expect(await screen.findByText(/cannot be reached/)).toBeInTheDocument();
  });
});
