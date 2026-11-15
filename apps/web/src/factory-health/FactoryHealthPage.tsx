import type {
  FactoryRunRow,
  FactoryRunsResponse,
  PluginRow,
  PluginVersionsResponse,
  RuleDriftRepo,
  RuleDriftResponse,
} from "@foreman/shared";
import { fetchFactoryRuns, fetchPluginVersions, fetchRuleDrift } from "../api.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { PluginVersions } from "./PluginVersions.tsx";
import { RuleDrift } from "./RuleDrift.tsx";
import { UnattendedRuns } from "./UnattendedRuns.tsx";
import "./factory-health.css";

/** The page asks again for its three routes each 60 seconds while the tab is visible. */
export const FACTORY_HEALTH_REFRESH_MS = 60_000;

export function FactoryHealthPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  // Nothing loads until the scope is known to be a real client.
  const enabled = clientsSettled && !unknownClient;

  const plugins = usePagedList<PluginRow, PluginVersionsResponse>({
    queryKey: ["factory-health", "plugins"],
    fetchPage: (cursor, signal) => fetchPluginVersions(cursor, signal),
    enabled,
    refetchInterval: FACTORY_HEALTH_REFRESH_MS,
  });
  const drift = usePagedList<RuleDriftRepo, RuleDriftResponse>({
    queryKey: ["factory-health", "rule-drift", scope],
    fetchPage: (cursor, signal) => fetchRuleDrift(scope, cursor, signal),
    enabled,
    refetchInterval: FACTORY_HEALTH_REFRESH_MS,
  });
  const runs = usePagedList<FactoryRunRow, FactoryRunsResponse>({
    queryKey: ["factory-health", "runs", scope],
    fetchPage: (cursor, signal) => fetchFactoryRuns(scope, cursor, signal),
    enabled,
    refetchInterval: FACTORY_HEALTH_REFRESH_MS,
  });

  if (unknownClient) return null;

  return (
    <>
      <h1>Factory health</h1>
      <p className="muted">
        Source: the Claude config folder, the forge and the night log. Names, versions and counts
        only, no rule text.
      </p>
      <div className="health-view">
        <PluginVersions list={plugins} />
        <RuleDrift list={drift} />
        <UnattendedRuns list={runs} />
      </div>
    </>
  );
}
