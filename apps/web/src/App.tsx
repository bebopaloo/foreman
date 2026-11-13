import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api.ts";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
  });

  let message: string;
  if (health.isPending) {
    message = "Checking the API.";
  } else if (health.isError) {
    message = "The API cannot be reached. Start it with pnpm dev, then reload this page.";
  } else {
    message = `API status: ${health.data.status}`;
  }

  return (
    <main>
      <h1>foreman</h1>
      <p role="status">{message}</p>
    </main>
  );
}
