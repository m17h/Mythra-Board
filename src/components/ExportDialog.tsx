import { useState } from "react";
import { exportBoardFile } from "../boardFile";
import { hiddenItems } from "../mindmap";
import { currentDoc } from "../persistence";
import { boardStore } from "../store";

type Format = "png" | "svg" | "pdf" | "mythra";

const FORMATS: [Format, string, string][] = [
  ["png", "PNG", "A picture, great for sharing"],
  ["svg", "SVG", "Sharp at any size; opens in design apps"],
  ["pdf", "PDF", "A document you can print or send"],
  ["mythra", "Board file", "The whole board, to back up or open later"],
];

const nextFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Export the board (or just the selection) as a picture, PDF or board file. */
export function ExportDialog({ onClose, onNotice }: { onClose: () => void; onNotice: (message: string | null) => void }) {
  const s = boardStore.getState();
  const selectedCount = s.nodes.filter((n) => n.selected).length;
  const [format, setFormat] = useState<Format>("png");
  const [scope, setScope] = useState<"board" | "selection">(selectedCount ? "selection" : "board");
  const [background, setBackground] = useState(true);
  const [busy, setBusy] = useState(false);

  /** The items to export, captured before selection outlines are cleared. */
  const pick = async () => {
    const state = boardStore.getState();
    const hidden = hiddenItems(state.nodes, state.edges);
    const visible = state.nodes.filter((n) => !hidden.has(n.id));
    const nodes = scope === "selection" ? visible.filter((n) => n.selected) : visible;
    state.stopEditing();
    state.clearSelection();
    // Let the deselection paint so selection outlines don't end up in the picture.
    await nextFrames();
    return { nodes, edges: boardStore.getState().edges };
  };

  const run = async (copy: boolean) => {
    setBusy(true);
    onNotice(copy ? "Copying…" : "Exporting…");
    try {
      if (format === "mythra" && !copy) {
        const saved = await exportBoardFile(currentDoc());
        onNotice(saved ? "Board file saved" : null);
      } else {
        const { nodes, edges } = await pick();
        if (!nodes.length) {
          onNotice("There's nothing to export yet");
          return;
        }
        const exporter = await import("../exportImage");
        if (copy) {
          await exporter.copyItemsAsImage(nodes, edges, { background });
          onNotice("Copied to the clipboard");
        } else {
          const saved = await exporter.exportItems(format as "png" | "svg" | "pdf", nodes, edges, s.title, { background });
          onNotice(saved ? "Exported" : null);
        }
      }
      onClose();
    } catch (err) {
      console.error("Export failed", err);
      onNotice(copy ? "Couldn't copy the picture" : "Couldn't export the board");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="palette-scrim" onPointerDown={busy ? undefined : onClose} />
      <div
        className="dialog"
        role="dialog"
        aria-label="Export"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !busy) onClose();
        }}
      >
        <div className="dialog__title">Export</div>
        <div className="dialog__section">
          <div className="popover__label">Format</div>
          <div className="format-list">
            {FORMATS.map(([f, name, desc]) => (
              <button
                key={f}
                type="button"
                className={`format-option${format === f ? " is-active" : ""}`}
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
              >
                <span className="format-option__name">{name}</span>
                <span className="format-option__desc">{desc}</span>
              </button>
            ))}
          </div>
        </div>
        {format !== "mythra" && (
          <>
            <div className="dialog__section">
              <div className="popover__label">What to include</div>
              <div className="segmented segmented--compact">
                <button type="button" className={`segmented__item${scope === "board" ? " is-active" : ""}`} onClick={() => setScope("board")}>
                  Whole board
                </button>
                <button
                  type="button"
                  className={`segmented__item${scope === "selection" ? " is-active" : ""}`}
                  disabled={!selectedCount}
                  onClick={() => setScope("selection")}
                >
                  Selection{selectedCount ? ` (${selectedCount})` : ""}
                </button>
              </div>
            </div>
            {format !== "pdf" && (
              <label className="menu__item menu__toggle dialog__toggle">
                <span>Include the board background</span>
                <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
                <span className="switch" aria-hidden />
              </label>
            )}
          </>
        )}
        <div className="dialog__actions">
          {format !== "mythra" && (
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => void run(true)}>
              Copy as picture
            </button>
          )}
          <span className="dialog__spacer" />
          <button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void run(false)}>
            {busy ? "Working…" : "Export…"}
          </button>
        </div>
      </div>
    </>
  );
}
