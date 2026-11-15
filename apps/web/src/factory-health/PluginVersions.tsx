import type { MarketplaceRow, PluginRow, PluginVersionsResponse } from "@foreman/shared";
import { MISSING, formatDate, formatTime } from "../format/index.ts";
import type { PagedList } from "../list/index.ts";
import { ShowMore } from "./ShowMore.tsx";
import { pluginLabel, showsMarketplaceVersion } from "./labels.ts";

type PluginList = PagedList<PluginRow, PluginVersionsResponse>;

function MarketplaceNote({ marketplace }: { marketplace: MarketplaceRow }) {
  return (
    <li>
      Marketplace copy <span className="mono">{marketplace.name}</span>
      {marketplace.sourceKind === null ? null : ` (${marketplace.sourceKind})`} as of{" "}
      {marketplace.lastUpdated === null
        ? MISSING
        : `${formatDate(marketplace.lastUpdated)} ${formatTime(marketplace.lastUpdated)}`}
      {marketplace.localFolder && marketplace.state === "readable"
        ? ": a local folder: Foreman reads its files as they are now"
        : null}
    </li>
  );
}

function Row({ row, marketplace }: { row: PluginRow; marketplace: MarketplaceRow | undefined }) {
  const label = pluginLabel(row, marketplace);
  return (
    <tr>
      <th scope="row" className="mono">
        {row.key}
      </th>
      <td className="mono">{row.installedVersion ?? MISSING}</td>
      <td>
        <span className={`pill pill-${label.tone}`}>{label.text}</span>
        {showsMarketplaceVersion(row) ? (
          <span className="marker">Marketplace {row.marketplaceVersion}</span>
        ) : null}
        {row.otherScopeInstalls > 0 ? (
          <span className="marker">
            {row.otherScopeInstalls.toString()}{" "}
            {row.otherScopeInstalls === 1 ? "install" : "installs"} in other scopes, not compared
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function PluginVersions({ list }: { list: PluginList }) {
  const first = list.firstPage;
  const marketplaces = new Map((first?.marketplaces ?? []).map((entry) => [entry.name, entry]));
  return (
    <section className="card health-section" aria-labelledby="health-plugins">
      <div className="section-head">
        <h2 id="health-plugins">Plugin versions</h2>
        <span className="muted">source: config folder · whole factory</span>
      </div>
      <p className="muted">The whole factory: the same in every scope</p>
      {list.isError ? (
        <p role="alert" className="note note-warn">
          The plugin versions cannot be read. The API may be stopped: start it with pnpm dev, then
          reload this page.
        </p>
      ) : null}
      {list.isPending && !list.isError ? <p role="status">Reading the plugin versions.</p> : null}
      {first?.pluginData === "missing" ? (
        <p className="note note-warn">
          No plugin data: <code>installed_plugins.json</code> is missing or not readable
        </p>
      ) : null}
      {first === undefined || first.pluginData === "missing" ? null : (
        <>
          {first.marketplaces.length === 0 ? null : (
            <ul className="plain-list muted" aria-label="Marketplaces">
              {first.marketplaces.map((entry) => (
                <MarketplaceNote key={entry.name} marketplace={entry} />
              ))}
            </ul>
          )}
          <p className="muted">
            Foreman makes no network call. A version that is newer than this copy does not show.
          </p>
          {first.skipped.files > 0 ? (
            <p className="note note-warn">
              {first.skipped.files.toString()} plugin {first.skipped.files === 1 ? "file" : "files"}{" "}
              skipped: too large, not valid or not readable.
            </p>
          ) : null}
          {list.rows.length === 0 ? (
            <p className="muted">No plugin is installed.</p>
          ) : (
            <div
              className="table-scroll"
              role="region"
              aria-label="Plugin versions table"
              tabIndex={0}
            >
              <table className="work-table health-table plugins-table">
                <caption className="sr-only">Plugin versions</caption>
                <thead>
                  <tr>
                    <th scope="col">Plugin</th>
                    <th scope="col">Installed</th>
                    <th scope="col">In the Marketplace</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
                    <Row key={row.key} row={row} marketplace={marketplaces.get(row.marketplace)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ShowMore list={list} name="plugins" />
        </>
      )}
    </section>
  );
}
