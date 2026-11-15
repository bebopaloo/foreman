import { useScope } from "./ScopeProvider.tsx";

export function ScopeSelector() {
  const { scope, setScope, clients, unknownClient } = useScope();
  const names = clients ?? (scope === null ? [] : [scope]);
  return (
    <div className="scope">
      <span id="scope-label" className="scope-label">
        Client scope
      </span>
      <div role="group" aria-labelledby="scope-label" className="scope-options">
        <button
          type="button"
          aria-pressed={scope === null}
          onClick={() => {
            setScope(null);
          }}
        >
          All
        </button>
        {names.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={scope === name}
            onClick={() => {
              setScope(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {scope === null ? (
        <span className="scope-pill scope-pill-all">Showing all clients</span>
      ) : (
        <span className={unknownClient ? "scope-pill scope-pill-unknown" : "scope-pill"}>
          {unknownClient ? "Unknown client" : `Showing only ${scope}`}
        </span>
      )}
    </div>
  );
}
