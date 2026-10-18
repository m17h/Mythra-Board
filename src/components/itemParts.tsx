import { Handle, NodeResizeControl, NodeResizer, Position, ResizeControlVariant } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { boardStore } from "../store";
import { MAX_NOTE_WIDTH, MIN_NOTE_WIDTH } from "../types";

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

const beginResize = () => boardStore.getState().begin();
const endResize = () => boardStore.getState().commit();

/** The four link dots, plus an invisible target covering the item so links can be dropped anywhere on it. */
export function LinkHandles({ id }: { id: string }) {
  return (
    <>
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
 * takes focus as soon as the item can accept it, and finishes on Esc or ⌘Enter.
 */
export function TextEditor({
  id,
  text,
  className = "",
  placeholder = "Type an idea…",
  singleLine,
  canBranch,
}: {
  id: string;
  text: string;
  className?: string;
  placeholder?: string;
  singleLine?: boolean;
  canBranch?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    // A brand-new item may not be visible (and so can't take focus) until it has been
    // measured, so keep trying for a few frames.
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) {
        if (singleLine) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
      } else if (tries++ < 30) {
        frame = requestAnimationFrame(focus);
      }
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [singleLine]);

  const finish = () => {
    boardStore.getState().stopEditing();
    boardStore.getState().selectOnly([id]);
  };

  return (
    <textarea
      ref={ref}
      className={`item-editor nodrag nowheel nopan ${className}`}
      value={text}
      placeholder={placeholder}
      spellCheck={!singleLine}
      rows={1}
      onChange={(e) => boardStore.getState().setText(id, singleLine ? e.target.value.replace(/\n/g, " ") : e.target.value)}
      onBlur={() => {
        if (boardStore.getState().editingId === id) boardStore.getState().stopEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab" && canBranch) {
          // Finish this item and branch straight into a new linked note.
          e.preventDefault();
          if (!text.trim()) return;
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
