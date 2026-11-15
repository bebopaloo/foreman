import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api.ts";
import { DashPage } from "./dash/index.ts";
import { Header } from "./Header.tsx";
import { UsagePage } from "./usage/index.ts";
import { useScope } from "./scope/index.ts";
import { WorkPage } from "./work/index.ts";
import { SessionsPage } from "./sessions/index.ts";
import { ReviewsPage } from "./reviews/index.ts";

export function App() {
  const { unknownClient, clientsSettled } = useScope();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    // Nothing loads until the scope is known to be a real client.
    enabled: clientsSettled && !unknownClient,
  });

  return (
    <>
      <Header />
      <main>
        {window.location.pathname === "/" ? (
          <DashPage />
        ) : window.location.pathname === "/work" ? (
          <WorkPage />
        ) : window.location.pathname === "/usage" ? (
          <UsagePage />
        ) : window.location.pathname === "/sessions" ? (
          <SessionsPage />
        ) : window.location.pathname === "/reviews" ? (
          <ReviewsPage />
        ) : (
          <>
            <h1>Page not found</h1>
            <p>Foreman has no page at this address. Use a link in the header.</p>
          </>
        )}
        {health.isError ? (
          <p role="status" className="note note-warn">
            The API cannot be reached. Start it with pnpm dev, then reload this page.
          </p>
        ) : null}
      </main>
      {health.isSuccess && !unknownClient ? <footer>Foreman {health.data.version}</footer> : null}
    </>
  );
}
