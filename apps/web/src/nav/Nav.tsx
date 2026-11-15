import { ScopedLink } from "../scope/index.ts";
import { VIEWS, type View } from "./views.ts";

/** A view is current on its own path and on the pages below it, such as `/usage/projects/<id>`. */
function isCurrent(path: string, current: string): boolean {
  return path === current || (path !== "/" && current.startsWith(`${path}/`));
}

export function Nav({ views = VIEWS }: { views?: readonly View[] }) {
  const current = window.location.pathname;
  return (
    <nav aria-label="Views" className="nav">
      <ul>
        {views.map((view) => (
          <li key={view.path}>
            <ScopedLink
              to={view.path}
              aria-current={isCurrent(view.path, current) ? "page" : undefined}
            >
              {view.label}
            </ScopedLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
