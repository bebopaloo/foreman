import type { AnchorHTMLAttributes } from "react";
import { withScope } from "./scope.ts";
import { useScope } from "./ScopeProvider.tsx";

type ScopedLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** A link inside Foreman. It keeps the Client scope in its `client` value. */
export function ScopedLink({ to, ...rest }: ScopedLinkProps) {
  const { scope } = useScope();
  return <a {...rest} href={withScope(to, scope)} />;
}
