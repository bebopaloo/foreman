import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchWorkClients } from "../api.ts";
import { initialScope, readUrlScope, withScope, writeStoredScope, type Scope } from "./scope.ts";

interface ScopeValue {
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** The clients of the repo list, or null while they load or when the request failed. */
  clients: readonly string[] | null;
  unassignedCount: number;
  /** True when the request for the clients has ended, with a list or with an error. */
  clientsSettled: boolean;
  /** True when the scope names a client that the repo list does not have. */
  unknownClient: boolean;
}

const ScopeContext = createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(() => initialScope(window.location.search));
  const clientsQuery = useQuery({
    queryKey: ["work", "clients"],
    queryFn: ({ signal }) => fetchWorkClients(signal),
  });

  // A scope from storage goes into the URL, so a copied URL and every link keep it.
  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const wanted = withScope(current, scope);
    if (wanted !== current) window.history.replaceState(window.history.state, "", wanted);
  }, [scope]);

  useEffect(() => {
    const onPopState = () => {
      setScopeState(readUrlScope(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const setScope = useCallback((next: Scope) => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.pushState(window.history.state, "", withScope(current, next));
    writeStoredScope(next);
    setScopeState(next);
  }, []);

  const value = useMemo<ScopeValue>(() => {
    const clients = clientsQuery.data?.clients.map((client) => client.name) ?? null;
    return {
      scope,
      setScope,
      clients,
      clientsSettled: !clientsQuery.isPending,
      unassignedCount: clientsQuery.data?.unassignedCount ?? 0,
      unknownClient: scope !== null && clients !== null && !clients.includes(scope),
    };
  }, [scope, setScope, clientsQuery.data, clientsQuery.isPending]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const value = useContext(ScopeContext);
  if (value === null) throw new Error("useScope needs a ScopeProvider");
  return value;
}
