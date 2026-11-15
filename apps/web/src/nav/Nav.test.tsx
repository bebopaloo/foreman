import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeProvider } from "../scope/index.ts";
import { Nav } from "./Nav.tsx";
import { VIEWS } from "./views.ts";
import { fakeApi } from "../test-render.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderNav(views = VIEWS) {
  fakeApi();
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ScopeProvider>
        <Nav views={views} />
      </ScopeProvider>
    </QueryClientProvider>,
  );
}

describe("Nav", () => {
  it("links only the views that exist", () => {
    renderNav();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Foreman dash",
      "Work",
      "Usage",
      "Sessions",
      "Reviews",
      "Controls",
    ]);
  });

  it("marks the current view and keeps the Client scope in the link", () => {
    window.history.replaceState(null, "", "/?client=acme");
    renderNav([
      { label: "Foreman dash", path: "/" },
      { label: "Usage", path: "/usage" },
    ]);
    expect(screen.getByRole("link", { name: "Foreman dash" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/usage?client=acme",
    );
    expect(screen.getByRole("link", { name: "Usage" })).not.toHaveAttribute("aria-current");
  });

  it("links Work in the scope and marks it on the Work page", () => {
    window.history.replaceState(null, "", "/work?client=acme");
    renderNav();
    const work = screen.getByRole("link", { name: "Work" });
    expect(work).toHaveAttribute("href", "/work?client=acme");
    expect(work).toHaveAttribute("aria-current", "page");
  });
});
