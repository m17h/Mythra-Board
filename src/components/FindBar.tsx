import { useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { childrenOf, descendants, hiddenItems } from "../mindmap";
import { boardIndex } from "../navigation";
import { boardStore, useBoard } from "../store";
import type { BoardNode } from "../types";

/** All the words on an item, for searching. */
function searchableText(n: BoardNode): string {
  const board = n.type === "board" ? boardIndex().find((b) => b.id === n.data.boardId)?.title : "";
  return [n.data.title, n.data.text, n.data.url, board].filter(Boolean).join(" ").toLowerCase();
}

/** ⌘F: find words on this board and step through the matches. */
export function FindBar({ onClose }: { onClose: () => void }) {
  const rf = useReactFlow();
  const nodes = useBoard((s) => s.nodes);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.select(), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => searchableText(n).includes(q))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id);
  }, [nodes, query]);

  // Show the current match: unfold anything hiding it, select it and bring it into view.
  const show = (i: number) => {
    const id = matches[i];
    if (!id) return;
    const s = boardStore.getState();
    if (hiddenItems(s.nodes, s.edges).has(id)) {
      const children = childrenOf(s.nodes, s.edges);
      for (const n of s.nodes) if (n.data.collapsed && descendants(n.id, children).has(id)) s.toggleCollapse(n.id);
    }
    s.selectOnly([id]);
    void rf.fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1.2, duration: 260 });
  };

  useEffect(() => {
    setIndex(0);
    if (matches.length) show(0);
    // Only jump when the search text changes, not when the board changes underneath.
  }, [query]);

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (index + dir + matches.length) % matches.length;
    setIndex(next);
    show(next);
  };

  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        className="find-bar__input"
        value={query}
        placeholder="Find on this board"
        aria-label="Find on this board"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
          if (e.key === "ArrowDown") (e.preventDefault(), step(1));
          if (e.key === "ArrowUp") (e.preventDefault(), step(-1));
        }}
      />
      <span className="find-bar__count">{query.trim() ? (matches.length ? `${index + 1} of ${matches.length}` : "No matches") : ""}</span>
      <button type="button" className="find-bar__btn" aria-label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" className="find-bar__btn" aria-label="Next match" disabled={!matches.length} onClick={() => step(1)}>
        ↓
      </button>
      <button type="button" className="find-bar__btn" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
