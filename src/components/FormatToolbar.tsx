import { NodeToolbar, Position } from "@xyflow/react";
import { useEffect, useState, type ReactNode } from "react";
import { activeLineStyle, toggleInline, toggleLines, type Edit, type InlineStyle, type LineStyle } from "../format";
import { keyLabel } from "../platform";
import { boardStore, useBoard } from "../store";
import { BoardLinkIcon, ChecklistIcon } from "./icons";

/** The text box being typed in for an item, if any. */
const editorFor = (id: string) =>
  document.querySelector<HTMLTextAreaElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] textarea.item-editor:not(.note__title)`);

/**
 * Replace the text box's content with a formatted version as a native edit, so ⌘Z
 * undoes it like typing, then restore the selection.
 */
function applyEdit(el: HTMLTextAreaElement, next: Edit) {
  const old = el.value;
  let a = 0;
  while (a < old.length && a < next.text.length && old[a] === next.text[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.text.length - a && old[old.length - 1 - b] === next.text[next.text.length - 1 - b]) b++;
  el.focus({ preventScroll: true });
  el.setSelectionRange(a, old.length - b);
  const inserted = next.text.slice(a, next.text.length - b);
  if (!document.execCommand("insertText", false, inserted)) {
    el.setRangeText(inserted);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(next.start, next.end);
}

/** Apply an inline or line style to whatever is selected in the text box. */
export function formatText(el: HTMLTextAreaElement, style: InlineStyle | LineStyle) {
  const edit = { text: el.value, start: el.selectionStart, end: el.selectionEnd };
  const next = ["heading", "bullet", "number", "task"].includes(style)
    ? toggleLines(edit, style as LineStyle)
    : toggleInline(edit, style as InlineStyle);
  applyEdit(el, next);
}

const BUTTONS: [InlineStyle | LineStyle, string, ReactNode][] = [
  ["bold", "Bold (⌘B)", <b key="b">B</b>],
  ["italic", "Italic (⌘I)", <i key="i">I</i>],
  ["strike", "Strikethrough (⇧⌘X)", <s key="s">S</s>],
  ["heading", "Heading", <span key="h" className="fmt-h">H</span>],
  ["bullet", "Bulleted list", <span key="u">•≡</span>],
  ["number", "Numbered list", <span key="n" className="fmt-num">1.</span>],
  ["task", "Checklist", <ChecklistIcon key="t" />],
  ["link", "Link to a board ([[ ]])", <BoardLinkIcon key="l" />],
];

/** Formatting buttons shown above a note, text or shape while you type in it. */
export function FormatToolbar() {
  const target = useBoard((s) => {
    if (!s.editingId || s.editingField !== "body") return null;
    const n = s.nodes.find((x) => x.id === s.editingId);
    return n && (n.type === "note" || n.type === "text" || n.type === "shape") ? n.id : null;
  });
  const [line, setLine] = useState<LineStyle | null>(null);

  // Show which line style the cursor is on.
  useEffect(() => {
    if (!target) return;
    const update = () => {
      const el = editorFor(target);
      setLine(el && document.activeElement === el ? activeLineStyle(el.value, el.selectionStart) : null);
    };
    document.addEventListener("selectionchange", update);
    update();
    return () => document.removeEventListener("selectionchange", update);
  }, [target]);

  if (!target) return null;
  return (
    <NodeToolbar nodeId={target} isVisible position={Position.Top} offset={14}>
      <div className="floating-bar format-bar" role="toolbar" aria-label="Text formatting">
        {BUTTONS.map(([style, label, glyph], i) => (
          <span key={style} className="format-bar__group">
            {(i === 3 || i === 7) && <span className="bar-divider" />}
            <button
              type="button"
              className={`tool-btn${line === style ? " is-active" : ""}`}
              title={keyLabel(label)}
              aria-label={keyLabel(label)}
              // Keep the cursor in the text box.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const el = editorFor(target);
                if (el) formatText(el, style);
              }}
            >
              {glyph}
            </button>
          </span>
        ))}
        <span className="bar-divider" />
        <button
          type="button"
          className="format-bar__done"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            boardStore.getState().stopEditing();
            boardStore.getState().selectOnly([target]);
          }}
        >
          Done
        </button>
      </div>
    </NodeToolbar>
  );
}
