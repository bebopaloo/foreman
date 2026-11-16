import type { Build } from "@foreman/shared";
import { useEffect, useId, useState } from "react";
import { formatDuration } from "../format/index.ts";
import { safeLink } from "../work/labels.ts";
import { clock, RESULT_COLOURS } from "./last-run.ts";

export interface GanttBarProps {
  build: Build;
  /** Percent of the window, 0 to 100. */
  left: number;
  width: number;
}

/** A bar of the slot timeline: a link to the tracker issue, or a focusable image with no link. */
export function GanttBar({ build, left, width }: GanttBarProps) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  const href = safeLink(build.link);
  const name = `Issue ${build.issue.toString()} of ${build.repo}: ${build.result}, ${clock(build.start)} to ${clock(build.end)}`;
  const seconds = (Date.parse(build.end) - Date.parse(build.start)) / 1000;
  const common = {
    className: "seg",
    "aria-label": name,
    "aria-describedby": shown ? tooltipId : undefined,
    style: { background: RESULT_COLOURS[build.result] },
    onFocus: () => {
      setFocused(true);
      setDismissed(false);
    },
    onBlur: () => {
      setFocused(false);
    },
  };
  // The visible text is the start of the accessible name (WCAG 2.5.3).
  const label = `Issue ${build.issue.toString()} of ${build.repo}: ${build.result}`;

  return (
    <div
      className="bar"
      style={{ left: `${left.toString()}%`, width: `${width.toString()}%` }}
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      {href === null ? (
        <div role="img" tabIndex={0} {...common}>
          {label}
        </div>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" {...common}>
          {label}
        </a>
      )}
      {shown ? (
        <div
          id={tooltipId}
          role="tooltip"
          className={`bar-tooltip${left > 55 ? " bar-tooltip-end" : ""}`}
        >
          <div className="bar-tooltip-row">
            <strong>{build.repo}</strong>
            <span>#{build.issue}</span>
          </div>
          <div>{build.title ?? "not in the Work cache"}</div>
          <div className="bar-tooltip-row">
            <span>{clock(build.start)}</span>
            <span>{clock(build.end)}</span>
            <span>{formatDuration(seconds)}</span>
          </div>
          <div className="bar-tooltip-row">
            <span>{build.result}</span>
            <span>slot {build.lane}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
