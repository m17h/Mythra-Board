import { useEffect, useState } from "react";
import { currentDoc, flushSave, listVersions, loadVersion, snapshotNow } from "../persistence";
import { boardStore, useBoard, type BoardDoc } from "../store";
import { useEscape } from "../useDismiss";
import Thumbnail from "./Thumbnail";

function when(t: number, now = Date.now()): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === day.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === day.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

/**
 * Earlier versions of this board. The app keeps one every ten minutes or so while you
 * work; picking one previews it, and restoring it is a single step you can undo.
 */
export function VersionHistory({ onClose, onNotice }: { onClose: () => void; onNotice: (m: string) => void }) {
  const boardId = useBoard((s) => s.boardId);
  const [versions, setVersions] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [preview, setPreview] = useState<BoardDoc | null>(null);
  const [error, setError] = useState(false);
  useEscape(onClose);

  const refresh = () =>
    listVersions(boardId).then(setVersions, (err) => {
      console.error(err);
      setError(true);
      setVersions([]);
    });

  useEffect(() => {
    void refresh();
    // The list belongs to this board; refresh only when the board changes.
  }, [boardId]);

  useEffect(() => {
    if (picked === null) return setPreview(null);
    let live = true;
    loadVersion(boardId, picked).then(
      (doc) => live && setPreview(doc),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [boardId, picked]);

  const saveNow = async () => {
    await flushSave();
    await snapshotNow(currentDoc());
    await refresh();
    onNotice("Version saved");
  };

  const restore = async () => {
    if (!preview) return;
    // Keep what's on the board now as a version too, so restoring never loses anything.
    await flushSave();
    await snapshotNow(currentDoc());
    boardStore.getState().replaceContent(preview.nodes, preview.edges);
    onNotice("Restored. Press ⌘Z to undo.");
    onClose();
  };

  return (
    <div className="side-panel" role="dialog" aria-label="Version history">
      <div className="side-panel__head">
        <span>Version history</span>
        <button type="button" className="help-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <button type="button" className="popover__action" onClick={() => void saveNow()}>
        Save a version now
      </button>
      {preview && (
        <div className="version-preview">
          <div className={`version-preview__thumb bg--${preview.background}`}>
            <Thumbnail nodes={preview.nodes} edges={preview.edges} />
          </div>
          <div className="version-preview__meta">
            {preview.nodes.length} item{preview.nodes.length === 1 ? "" : "s"} · {preview.edges.length} link{preview.edges.length === 1 ? "" : "s"}
          </div>
          <button type="button" className="primary-btn version-preview__restore" onClick={() => void restore()}>
            Restore this version
          </button>
        </div>
      )}
      <div className="version-list">
        {versions === null ? null : versions.length === 0 ? (
          <div className="version-list__empty">
            {error ? "Version history couldn't be read." : "No earlier versions yet. They're saved automatically as you work."}
          </div>
        ) : (
          versions.map((t) => (
            <button
              key={t}
              type="button"
              className={`version-item${picked === t ? " is-active" : ""}`}
              onClick={() => setPicked(picked === t ? null : t)}
            >
              {when(t)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
