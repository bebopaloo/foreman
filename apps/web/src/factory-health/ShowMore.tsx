import { useState } from "react";
import type { PagedList } from "../list/index.ts";

/** The Show more button of a list. The new rows are announced, and a failed request shows a message. */
export function ShowMore<Row>({ list, name }: { list: PagedList<Row>; name: string }) {
  const [announcement, setAnnouncement] = useState("");
  const [failed, setFailed] = useState(false);

  async function onShowMore() {
    setFailed(false);
    const added = await list.showMore();
    if (added === 0) {
      setFailed(true);
      return;
    }
    setAnnouncement(`${added.toString()} more ${name} shown`);
  }

  return (
    <>
      {list.hasMore ? (
        <button type="button" onClick={() => void onShowMore()} disabled={list.isLoadingMore}>
          Show more
        </button>
      ) : null}
      {failed ? (
        <p role="alert">The next rows did not load. Select Show more to try again.</p>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
