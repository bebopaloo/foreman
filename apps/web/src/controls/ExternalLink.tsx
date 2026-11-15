import { safeLink } from "./labels.ts";

/** A link out to the forge or the tracker. It shows only for a web address of the cache. */
export function ExternalLink({
  href,
  shown,
  name,
}: {
  href: string | null;
  shown: string;
  name: string;
}) {
  const safe = safeLink(href);
  if (safe === null) return <span>{shown}</span>;
  return (
    <a href={safe} rel="noopener noreferrer" target="_blank">
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{name}</span>
    </a>
  );
}
