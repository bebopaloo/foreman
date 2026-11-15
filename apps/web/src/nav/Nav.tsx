import { ScopedLink } from "../scope/index.ts";
import { VIEWS, type View } from "./views.ts";

export function Nav({ views = VIEWS }: { views?: readonly View[] }) {
  const current = window.location.pathname;
  return (
    <nav aria-label="Views" className="nav">
      <ul>
        {views.map((view) => (
          <li key={view.path}>
            <ScopedLink to={view.path} aria-current={view.path === current ? "page" : undefined}>
              {view.label}
            </ScopedLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
