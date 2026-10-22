import { useEffect, useState } from "react";
import { refreshBoardIndex } from "../navigation";
import { deleteForever, listTrash, restoreBoard, TRASH_KEEP_DAYS, type TrashedBoard } from "../persistence";
import { useEscape, useLeave } from "../useDismiss";
import Thumbnail from "./Thumbnail";

const daysLeft = (deletedAt: number) => Math.max(0, TRASH_KEEP_DAYS - Math.floor((Date.now() - deletedAt) / 86_400_000));

/** Boards you deleted in the last 30 days: bring them back, or remove them for good. */
export function TrashDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const [leaving, close] = useLeave(onClose);
  const [items, setItems] = useState<TrashedBoard[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  useEscape(close);

  const refresh = () => listTrash().then(setItems, () => setItems([]));
  useEffect(() => {
    void refresh();
  }, []);

  const restore = async (id: string) => {
    await restoreBoard(id);
    await refreshBoardIndex();
    onRestored();
    await refresh();
  };
  const remove = async (id: string) => {
    await deleteForever(id);
    await refresh();
  };
  const empty = async () => {
    for (const t of items ?? []) await deleteForever(t.doc.id);
    setConfirmEmpty(false);
    await refresh();
  };

  return (
    <>
      <div className={`palette-scrim${leaving ? " is-leaving" : ""}`} onPointerDown={close} />
      <div className={`dialog trash${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Recently deleted" onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog__title">Recently deleted</div>
        <div className="settings__note">Deleted boards stay here for {TRASH_KEEP_DAYS} days, then they're removed for good.</div>
        <div className="trash__list">
          {items === null ? null : items.length === 0 ? (
            <div className="home-empty">Nothing here.</div>
          ) : (
            items.map(({ doc, deletedAt }) => (
              <div key={doc.id} className="trash__item">
                <div className={`trash__thumb bg--${doc.background}`}>
                  <Thumbnail nodes={doc.nodes} edges={doc.edges} />
                </div>
                <div className="trash__meta">
                  <div className="trash__title">{doc.title}</div>
                  <div className="trash__sub">
                    {doc.nodes.length} item{doc.nodes.length === 1 ? "" : "s"} · {daysLeft(deletedAt)} day{daysLeft(deletedAt) === 1 ? "" : "s"} left
                  </div>
                </div>
                <button type="button" className="secondary-btn" onClick={() => void restore(doc.id)}>
                  Restore
                </button>
                <button type="button" className="secondary-btn trash__forever" onClick={() => void remove(doc.id)}>
                  Delete forever
                </button>
              </div>
            ))
          )}
        </div>
        <div className="dialog__actions">
          {items && items.length > 0 &&
            (confirmEmpty ? (
              <>
                <span className="trash__warn">Remove all {items.length} for good?</span>
                <button type="button" className="secondary-btn trash__forever" onClick={() => void empty()}>
                  Yes, empty
                </button>
                <button type="button" className="secondary-btn" onClick={() => setConfirmEmpty(false)}>
                  Keep them
                </button>
              </>
            ) : (
              <button type="button" className="secondary-btn" onClick={() => setConfirmEmpty(true)}>
                Empty…
              </button>
            ))}
          <span className="dialog__spacer" />
          <button type="button" className="primary-btn" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
