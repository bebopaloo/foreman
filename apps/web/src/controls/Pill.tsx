import type { Tone } from "./labels.ts";

/** A state with a text label. The colour comes from the theme tokens, and the text always says the state. */
export function Pill({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
