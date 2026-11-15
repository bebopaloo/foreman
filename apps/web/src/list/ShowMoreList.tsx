import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PagedList } from "./use-paged-list.ts";

export interface ShowMoreListProps<Row> {
  list: PagedList<Row>;
  /** The accessible name of the list. */
  label: string;
  rowKey: (row: Row) => string;
  renderRow: (row: Row) => ReactNode;
}

export function ShowMoreList<Row>({ list, label, rowKey, renderRow }: ShowMoreListProps<Row>) {
  const [announcement, setAnnouncement] = useState("");
  const [focusTick, setFocusTick] = useState(0);
  const focusIndex = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const rowElements = useRef<Map<number, HTMLLIElement>>(new Map());

  useEffect(() => {
    if (focusIndex.current === null) {
      return;
    }
    const row = rowElements.current.get(focusIndex.current);
    if (row) {
      row.focus();
      focusIndex.current = null;
    }
  }, [focusTick, list.rows.length]);

  async function onShowMore() {
    const before = list.rows.length;
    setFailed(false);
    const added = await list.showMore();
    if (added === 0) {
      setFailed(true);
      return;
    }
    setAnnouncement(`${added.toString()} more rows shown`);
    focusIndex.current = before;
    setFocusTick((tick) => tick + 1);
  }

  return (
    <div>
      <ul aria-label={label}>
        {list.rows.map((row, index) => (
          <li
            key={rowKey(row)}
            tabIndex={-1}
            ref={(element) => {
              if (element) {
                rowElements.current.set(index, element);
              } else {
                rowElements.current.delete(index);
              }
            }}
          >
            {renderRow(row)}
          </li>
        ))}
      </ul>
      {list.hasMore ? (
        <button type="button" onClick={() => void onShowMore()} disabled={list.isLoadingMore}>
          Show more
        </button>
      ) : null}
      {failed ? (
        <p role="alert">The next rows did not load. Select Show more to try again.</p>
      ) : null}
      <p role="status">{announcement}</p>
    </div>
  );
}
