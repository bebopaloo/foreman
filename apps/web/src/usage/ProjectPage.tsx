import { useQuery } from "@tanstack/react-query";
import { fetchUsageProjects } from "../api.ts";
import { useScope } from "../scope/index.ts";
import { UsageView } from "./UsagePage.tsx";

const PREFIX = "/usage/projects/";

/** The Project ID of a path such as `/usage/projects/<Project ID>`, or null for any other path. */
export function projectIdOf(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** The page of one Project. It asks for usage only after the Project is known to be in the scope. */
export function ProjectPage({ projectId }: { projectId: string }) {
  const { scope, clientsSettled, unknownClient } = useScope();
  const projects = useQuery({
    queryKey: ["usage", "projects", scope],
    queryFn: ({ signal }) => fetchUsageProjects(scope, 1000, signal),
    enabled: clientsSettled && !unknownClient,
  });

  if (unknownClient) return null;
  if (projects.isError) {
    return (
      <>
        <h1>Project</h1>
        <p role="status" className="note note-warn">
          This page cannot load the Project. Try Refresh.
        </p>
      </>
    );
  }
  if (!projects.isSuccess) {
    return (
      <>
        <h1>Project</h1>
        <div role="status" aria-label="Loading the Project" className="skeleton tile-skeleton" />
      </>
    );
  }
  const project = projects.data.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) {
    return (
      <>
        <h1>Project</h1>
        <p role="status" className="note">
          No such Project in this scope.
        </p>
      </>
    );
  }
  return <UsageView key={project.id} project={project} />;
}
