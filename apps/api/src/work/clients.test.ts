import { describe, expect, it } from "vitest";
import { listClients } from "./clients.ts";
import type { RepoEntry } from "./repo-list.ts";

function repo(name: string, client: string | null): RepoEntry {
  return {
    position: 0,
    id: name,
    host: "github.com",
    owner: "o",
    name,
    client,
    path: `/p/${name}`,
    forge: null,
    tracker: null,
    enabled: true,
  };
}

describe("listClients", () => {
  it("counts the repos of each client and the unassigned repos", () => {
    const result = listClients([
      repo("a", "acme"),
      repo("b", "acme"),
      repo("c", "bebopaloo"),
      repo("d", null),
    ]);
    expect(result).toEqual({
      clients: [
        { name: "acme", repoCount: 2 },
        { name: "bebopaloo", repoCount: 1 },
      ],
      unassignedCount: 1,
    });
  });

  it("sorts the clients by name", () => {
    const result = listClients([repo("a", "zed"), repo("b", "alpha")]);
    expect(result.clients.map((client) => client.name)).toEqual(["alpha", "zed"]);
  });

  it("returns no clients for no repos", () => {
    expect(listClients([])).toEqual({ clients: [], unassignedCount: 0 });
  });
});
