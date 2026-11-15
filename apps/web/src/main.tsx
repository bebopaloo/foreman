import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ScopeProvider } from "./scope/index.ts";
import { initTheme } from "./theme/index.ts";
import "./theme/tokens.css";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The page has no #root element");
}

initTheme();

const queryClient = new QueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>
        <App />
      </ScopeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
