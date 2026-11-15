import { ConnectionBar } from "./connection/index.ts";
import { Nav } from "./nav/index.ts";
import { ScopedLink, ScopeSelector, useScope } from "./scope/index.ts";

export function Header() {
  const { unknownClient } = useScope();
  return (
    <header className="app-header">
      <div className="app-header-top">
        <ScopedLink to="/" className="brand">
          Foreman
        </ScopedLink>
        <ScopeSelector />
      </div>
      <Nav />
      <ConnectionBar />
      {unknownClient ? (
        <p role="alert" className="note note-warn">
          Unknown client. The repo list has no such client, so Foreman shows no data. Choose a
          client above.
        </p>
      ) : null}
    </header>
  );
}
