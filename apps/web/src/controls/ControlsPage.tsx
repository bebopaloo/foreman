import type {
  ControlsRegisterResponse,
  ControlsRegisterRow,
  ControlsReleaseRow,
  ControlsReleasesResponse,
  ControlsWaiverRow,
  ControlsWaiversResponse,
} from "@foreman/shared";
import { useQuery } from "@tanstack/react-query";
import {
  fetchControls,
  fetchControlsRegister,
  fetchControlsReleases,
  fetchControlsWaivers,
} from "../api.ts";
import { usePagedList } from "../list/index.ts";
import { useScope } from "../scope/index.ts";
import { ArtefactsSection } from "./ArtefactsSection.tsx";
import { EscalationsSection } from "./EscalationsSection.tsx";
import { ModulesSection } from "./ModulesSection.tsx";
import { ReleasesSection } from "./ReleasesSection.tsx";
import { WaiversSection } from "./WaiversSection.tsx";
import "./controls.css";

/** The Controls view asks again each 60 seconds while the tab is visible. The queries pause in a hidden tab. */
export const CONTROLS_REFRESH_MS = 60_000;

export function ControlsPage() {
  const { scope, clientsSettled, unknownClient } = useScope();
  // Nothing loads until the scope is known to be a real client.
  const enabled = clientsSettled && !unknownClient;

  const controls = useQuery({
    queryKey: ["controls", "document", scope],
    queryFn: ({ signal }) => fetchControls(scope, signal),
    enabled,
    refetchInterval: CONTROLS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const waivers = usePagedList<ControlsWaiverRow, ControlsWaiversResponse>({
    queryKey: ["controls", "waivers", scope],
    fetchPage: (cursor, signal) => fetchControlsWaivers(scope, cursor, signal),
    enabled,
    refetchInterval: CONTROLS_REFRESH_MS,
  });
  const releases = usePagedList<ControlsReleaseRow, ControlsReleasesResponse>({
    queryKey: ["controls", "releases", scope],
    fetchPage: (cursor, signal) => fetchControlsReleases(scope, cursor, signal),
    enabled,
    refetchInterval: CONTROLS_REFRESH_MS,
  });
  const register = usePagedList<ControlsRegisterRow, ControlsRegisterResponse>({
    queryKey: ["controls", "register", scope],
    fetchPage: (cursor, signal) => fetchControlsRegister(scope, cursor, signal),
    enabled,
    refetchInterval: CONTROLS_REFRESH_MS,
  });

  if (unknownClient) return null;

  const { data } = controls;
  return (
    <>
      <h1>Controls</h1>
      <p className="muted">
        Source: the factory config and Control files on the forge, the Release records, the tracker
        Releases and the Control events. Plain text and counts, no finding text.
      </p>
      {controls.isError ? (
        <p role="alert" className="note note-warn">
          The Controls data cannot be read. The API may be stopped: start it with pnpm dev, then
          reload this page.
        </p>
      ) : null}
      {controls.isPending ? <p role="status">Reading the Controls.</p> : null}
      {data === undefined ? null : (
        <div className="controls-view">
          <ModulesSection data={data} />
          <EscalationsSection escalations={data.escalations} />
          <div className="controls-grid">
            <WaiversSection data={data} list={waivers} />
            <ReleasesSection data={data} list={releases} />
          </div>
          <ArtefactsSection data={data} list={register} />
        </div>
      )}
    </>
  );
}
