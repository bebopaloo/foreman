import type { WorkSet } from "@foreman/shared";
import { createContext, useContext, type ReactNode } from "react";

export const LIST_PANEL_ID = "list-panel";

export interface PanelControl {
  /** The `set` of the open panel, or null. */
  current: WorkSet | null;
  /** Opens the panel of a stat, replaces the open panel, or closes the panel of the same stat. */
  toggle: (set: WorkSet) => void;
}

const PanelContext = createContext<PanelControl | null>(null);

export const PanelProvider = PanelContext.Provider;

export function usePanelControl(): PanelControl {
  const value = useContext(PanelContext);
  if (value === null) throw new Error("usePanelControl needs a PanelProvider");
  return value;
}

export interface StatButtonProps {
  set: WorkSet;
  /** False shows the content with no button: a value of 0 or "–", or a stat that cannot open a panel. */
  enabled: boolean;
  className?: string;
  children: ReactNode;
}

/** A stat of the dash that opens its List panel. With `enabled` false it is plain content. */
export function StatButton({ set, enabled, className, children }: StatButtonProps) {
  const { current, toggle } = usePanelControl();
  if (!enabled) return <>{children}</>;
  const open = current === set;
  return (
    <button
      type="button"
      className={`stat-button${open ? " stat-open" : ""}${className === undefined ? "" : ` ${className}`}`}
      data-stat={set}
      aria-expanded={open}
      aria-controls={LIST_PANEL_ID}
      onClick={() => {
        toggle(set);
      }}
    >
      {children}
    </button>
  );
}
