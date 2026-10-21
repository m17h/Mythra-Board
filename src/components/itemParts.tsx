import { Handle, NodeResizeControl, NodeResizer, Position, ResizeControlVariant } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { childrenOf, descendants } from "../mindmap";
import { formatText } from "./FormatToolbar";
import { boardStore, useBoard, type EditField } from "../store";
import { MAX_NOTE_WIDTH, MIN_NOTE_WIDTH } from "../types";

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

const beginResize = () => boardStore.getState().begin();
const endResize = () => boardStore.getState().commit();

/** The four link dots, plus an invisible target covering the item so links can be dropped anywhere on it. */
export function LinkHandles({ id, collapsed }: { id: string; collapsed?: boolean }) {
  return (
    <>
      {collapsed && <FoldBadge id={id} />}
      <Handle type="target" position={Position.Top} id="body" className="body-handle" isConnectableStart={false} />
      {SIDES.map((side) => (
        <Handle
          key={side}
          type="source"
          position={side}
          id={side}
          className="dot-handle"
          title="Drag to link · Click to add a linked note"
          onClick={(e) => {
            e.stopPropagation();
            boardStore.getState().addLinkedNote(id, side);
          }}
        />
      ))}
    </>
  );
}

/** Shown on a folded item: how many items are tucked away, and a click to unfold them. */
function FoldBadge({ id }: { id: string }) {
  const count = useBoard((s) => descendants(id, childrenOf(s.nodes, s.edges)).size);
  return (
    <button
      type="button"
      className="fold-badge nodrag"
      title="Show the hidden branch (C)"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        boardStore.getState().toggleCollapse(id);
      }}
    >
      +{count}
    </button>
  );
}

/** Grab strips on the left and right edges for changing width. */
export function WidthResizers() {
  return (
    <>
      {[Position.Right, Position.Left].map((p) => (
        <NodeResizeControl
          key={p}
          position={p}
          resizeDirection="horizontal"
          variant={ResizeControlVariant.Line}
          minWidth={MIN_NOTE_WIDTH}
          maxWidth={MAX_NOTE_WIDTH}
          className="width-handle"
          onResizeStart={beginResize}
          onResizeEnd={endResize}
        />
      ))}
    </>
  );
}

/** Corner and edge handles for items with a free width and height. */
export function BoxResizer({ visible, keepAspectRatio, minWidth = 60, minHeight = 40 }: {
  visible: boolean;
  keepAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
}) {
  return (
    <NodeResizer
      isVisible={visible}
      keepAspectRatio={keepAspectRatio}
      minWidth={minWidth}
      minHeight={minHeight}
      handleClassName="box-handle"
      lineClassName="box-line"
      onResizeStart={beginResize}
      onResizeEnd={endResize}
    />
  );
}

/**
 * The in-place text editor used by every item you can type into. It grows with its text,
 * takes focus as soon as the item can accept it, and finishes on Esc or ⌘Enter. A note
 * with a card title has two of these (title and body); focus moves between them freely.
 */
export function TextEditor({
  id,
  text,
  field = "body",
  className = "",
  placeholder = "Type an idea…",
  singleLine,
  canBranch,
}: {
  id: string;
  text: string;
  field?: EditField;
  className?: string;
  placeholder?: string;
  singleLine?: boolean;
  canBranch?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const active = useBoard((s) => s.editingId === id && s.editingField === field);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!active) return;
    // A brand-new item may not be visible (and so can't take focus) until it has been
    // measured, so keep trying for a few frames.
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const el = ref.current;
      if (!el) return;
      if (document.activeElement === el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) {
        if (singleLine && field === "body") el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
      } else if (tries++ < 30) {
        frame = requestAnimationFrame(focus);
      }
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [active, singleLine, field]);

  const finish = () => {
    boardStore.getState().stopEditing();
    boardStore.getState().selectOnly([id]);
  };

  const write = (value: string) => {
    const v = singleLine ? value.replace(/\n/g, " ") : value;
    if (field === "title") boardStore.getState().setItemTitle(id, v);
    else boardStore.getState().setText(id, v);
  };

  return (
    <textarea
      ref={ref}
      className={`item-editor nodrag nowheel nopan ${className}`}
      value={text}
      placeholder={placeholder}
      spellCheck={!singleLine}
      rows={1}
      onFocus={() => {
        if (!active) boardStore.getState().startEditing(id, field);
      }}
      onChange={(e) => write(e.target.value)}
      onBlur={(e) => {
        // Moving between a card's title and body keeps editing going.
        const next = e.relatedTarget as Element | null;
        if (next?.closest(`.react-flow__node[data-id="${CSS.escape(id)}"]`)) return;
        if (boardStore.getState().editingId === id) boardStore.getState().stopEditing();
      }}
      onKeyDown={(e) => {
        // ⌘B / ⌘I / ⇧⌘X format the selected text.
        const mod = e.metaKey || e.ctrlKey;
        const style = !mod || singleLine ? null : e.key.toLowerCase() === "b" ? "bold" : e.key.toLowerCase() === "i" ? "italic" : e.shiftKey && e.key.toLowerCase() === "x" ? "strike" : null;
        if (style) {
          e.preventDefault();
          formatText(e.currentTarget, style);
          return;
        }
        if (field === "title" && (e.key === "Enter" || e.key === "ArrowDown") && !e.metaKey) {
          // From a card title, Enter moves on to the body.
          e.preventDefault();
          boardStore.getState().startEditing(id, "body");
          return;
        }
        if (e.key === "Tab" && canBranch) {
          // Finish this item and branch straight into a new linked note.
          e.preventDefault();
          if (!text.trim() && field === "body") return;
          boardStore.getState().stopEditing();
          boardStore.getState().addLinkedNote(id, e.shiftKey ? Position.Left : Position.Right);
          return;
        }
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey || singleLine))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
