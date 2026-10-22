import { Position, useReactFlow } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Point } from "../geometry";
import { aiSupported } from "../ai";
import { askClaude, QUICK } from "../assistant/ask";
import { childrenOf } from "../mindmap";
import { keyLabel } from "../platform";
import { boardStore } from "../store";
import { DEFAULT_NOTE_WIDTH, EDITABLE, LINKABLE } from "../types";

export type MenuTarget = { x: number; y: number; kind: "items" | "link" | "pane" };

type Entry = { label: string; keys?: string; danger?: boolean; run: () => void } | "divider";

/** The right-click menu for items, links and the empty board. */
export function ContextMenu({
  target,
  onClose,
  onExport,
  onPickBoard,
}: {
  target: MenuTarget;
  onClose: () => void;
  onExport: () => void;
  onPickBoard: (at: Point) => void;
}) {
  const rf = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const s = boardStore.getState();

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.min(target.x, window.innerWidth - width - 8),
      top: Math.min(target.y, window.innerHeight - height - 8),
    });
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const selected = s.nodes.filter((n) => n.selected);
  const single = selected.length === 1 ? selected[0] : null;
  const ids = selected.map((n) => n.id);
  const at = rf.screenToFlowPosition({ x: target.x, y: target.y });
  const hasKids = single ? (childrenOf(s.nodes, s.edges).get(single.id)?.length ?? 0) > 0 : false;

  let entries: Entry[];
  if (target.kind === "items") {
    entries = [
      ...(single && EDITABLE.has(single.type) ? [{ label: "Edit text", keys: "↩", run: () => s.startEditing(single.id) }] : []),
      ...(single && LINKABLE.has(single.type)
        ? [{ label: "Add linked note", keys: "⇥", run: () => s.addLinkedNote(single.id, Position.Right) }]
        : []),
      ...(single?.type === "note"
        ? [
            {
              label: "Add a to-do",
              run: () => {
                const text = single.data.text;
                s.startEditing(single.id);
                s.setText(single.id, `${text}${text && !text.endsWith("\n") ? "\n" : ""}- [ ] `);
              },
            },
          ]
        : []),
      ...(single && (hasKids || single.data.collapsed)
        ? [
            { label: single.data.collapsed ? "Unfold branch" : "Fold branch", keys: "C", run: () => s.toggleCollapse(single.id) },
            ...(hasKids ? [{ label: "Tidy up branch", run: () => void s.tidyUp([single.id]) }] : []),
          ]
        : []),
      ...(single && aiSupported() && ["note", "text", "shape"].includes(single.type)
        ? [
            { label: "✨ Brainstorm ideas", run: () => void askClaude(QUICK.brainstorm, [single.id]) },
            { label: "✨ Turn into a mind map", run: () => void askClaude(QUICK.mindMap, [single.id]) },
          ]
        : []),
      { label: "Duplicate", keys: "⌘D", run: () => s.duplicateSelection() },
      { label: "Copy", keys: "⌘C", run: () => document.execCommand("copy") },
      "divider",
      ...(selected.every((n) => n.data.locked)
        ? [{ label: "Unlock", keys: "⇧⌘L", run: () => s.setLocked(ids, false) }]
        : [{ label: "Lock", keys: "⇧⌘L", run: () => s.setLocked(ids, true) }]),
      ...(selected.some((n) => n.data.group)
        ? [{ label: "Ungroup", keys: "⇧⌘G", run: () => s.ungroup(ids) }]
        : selected.length > 1
          ? [{ label: "Group", keys: "⌘G", run: () => s.group(ids) }]
          : []),
      { label: "Bring to front", keys: "⇧⌘]", run: () => s.reorder(ids, "front") },
      { label: "Send to back", keys: "⇧⌘[", run: () => s.reorder(ids, "back") },
      ...(single?.type === "frame" ? [] : [{ label: "Put in a section", keys: "⌥⌘G", run: () => void s.frameSelection() }]),
      { label: "Zoom to fit", keys: "⇧2", run: () => void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.3, maxZoom: 1.5, duration: 250 }) },
      "divider",
      ...(selected.every((n) => n.data.locked) ? [] : [{ label: "Delete", keys: "⌫", danger: true, run: () => s.deleteNodes(ids) }]),
    ];
  } else if (target.kind === "link") {
    const link = s.edges.find((e) => e.selected);
    entries = link
      ? [
          { label: link.data?.label ? "Edit label" : "Add label", keys: "↩", run: () => s.startEditingLabel(link.id) },
          { label: "Flip direction", run: () => s.reverseLink(link.id) },
          "divider",
          { label: "Delete link", keys: "⌫", danger: true, run: () => s.deleteSelection() },
        ]
      : [];
  } else {
    entries = [
      { label: "Add note here", keys: "N", run: () => void s.addNote({ x: at.x - DEFAULT_NOTE_WIDTH / 2, y: at.y - 22 }, { edit: true }) },
      { label: "Add text here", keys: "T", run: () => void s.addItem("text", { x: at.x - 8, y: at.y - 20 }, { edit: true }) },
      { label: "Link a board here…", run: () => onPickBoard(at) },
      "divider",
      { label: "Select all", keys: "⌘A", run: () => s.selectAll() },
      { label: "Fit everything", keys: "⇧1", run: () => void rf.fitView({ padding: 0.25, maxZoom: 1, duration: 250 }) },
      { label: "Tidy up mind maps", run: () => void s.tidyUp() },
      { label: s.snapping ? "Turn off snapping" : "Turn on snapping", run: () => s.setSnapping(!s.snapping) },
      "divider",
      { label: "Export…", keys: "⇧⌘E", run: onExport },
    ];
  }

  return (
    <>
      <div className="menu-scrim" onPointerDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div ref={ref} className="menu context-menu" role="menu" style={pos}>
        {entries.map((entry, i) =>
          entry === "divider" ? (
            <div key={i} className="menu__sep" />
          ) : (
            <MenuItem
              key={entry.label}
              keys={entry.keys}
              danger={entry.danger}
              onClick={() => {
                onClose();
                entry.run();
              }}
            >
              {entry.label}
            </MenuItem>
          ),
        )}
      </div>
    </>
  );
}

function MenuItem({ children, keys, danger, onClick }: { children: ReactNode; keys?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu__item${danger ? " is-danger" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <span>{children}</span>
      {keys && <kbd className="menu__keys">{keyLabel(keys)}</kbd>}
    </button>
  );
}
