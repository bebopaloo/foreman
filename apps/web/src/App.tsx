import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api.ts";
import { Header } from "./Header.tsx";
import { useScope } from "./scope/index.ts";

export function App() {
  const { unknownClient, clientsSettled } = useScope();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    // Nothing loads until the scope is known to be a real client.
    enabled: clientsSettled && !unknownClient,
  });

  let message: string | null = null;
  if (!unknownClient) {
    if (!clientsSettled || health.isPending) {
      message = "Checking the API.";
    } else if (health.isError) {
      message = "The API cannot be reached. Start it with pnpm dev, then reload this page.";
    } else {
      message = `API status: ${health.data.status}`;
    }
  }

  return (
    <>
      <Header />
      <main>
        <h1>foreman</h1>
        {message === null ? null : <p role="status">{message}</p>}
      </main>
      {health.isSuccess && !unknownClient ? <footer>Foreman {health.data.version}</footer> : null}
    </>
  );
}
