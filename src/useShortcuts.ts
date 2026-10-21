import { Position, useReactFlow } from "@xyflow/react";
import { useEffect, useRef, type RefObject } from "react";
import { addImages, asUrl, isImageFile } from "./images";
import { boardStore, type Clip, type Tool } from "./store";
import { DEFAULT_NOTE_WIDTH } from "./types";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  n: "note",
  t: "text",
  s: "shape",
  f: "frame",
  p: "pen",
  e: "eraser",
  a: "arrow",
  l: "lasso",
};

type Options = {
  pointer: RefObject<{ x: number; y: number } | null>;
  toggleHelp: () => void;
  toggleMap: () => void;
  pickImage: () => void;
  goHome: () => void;
  exportPng: () => void;
  openPalette: () => void;
  openFind: () => void;
};

/** Board-wide keyboard shortcuts and copy/paste. Ignored while you're typing. */
export function useShortcuts(options: Options) {
  const rf = useReactFlow();
  // Read the latest callbacks without re-binding listeners (and losing the copy buffer) every render.
  const opts = useRef(options);
  opts.current = options;
  const { pointer } = options;

  useEffect(() => {
    let lastCopy: { text: string; clip: Clip } | null = null;
    let lastPaste: { x: number; y: number; count: number } | null = null;

    /** The pointer's position on the board, if it is over the board. */
    const pointerOnBoard = () => {
      const p = pointer.current;
      if (!p || !document.elementFromPoint(p.x, p.y)?.closest(".react-flow__pane, .react-flow__node")) return null;
      return rf.screenToFlowPosition(p);
    };
    const viewCenter = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key === "[") {
        e.preventDefault();
        opts.current.goHome();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        boardStore.getState().stopEditing();
        opts.current.openPalette();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        boardStore.getState().stopEditing();
        opts.current.openFind();
        return;
      }
      if (isTyping(e.target) || e.isComposing) return;
      const s = boardStore.getState();
      const key = e.key;
      const lower = key.toLowerCase();
      // Keys pressed while an editor is still opening belong to it, not to shortcuts.
      if (s.editingId && !mod) return;
      const selected = s.nodes.filter((n) => n.selected);
      const links = s.edges.filter((x) => x.selected);
      const handled = () => e.preventDefault();

      if (mod) {
        if (lower === "z") (e.shiftKey ? s.redo() : s.undo(), handled());
        else if (lower === "y") (s.redo(), handled());
        else if (lower === "a") (s.selectAll(), handled());
        else if (lower === "d") (s.duplicateSelection(), handled());
        else if (e.altKey && e.code === "KeyG") (s.frameSelection(), handled());
        else if (e.shiftKey && e.code === "KeyE") (opts.current.exportPng(), handled());
        else if (e.shiftKey && e.code === "BracketRight") (s.reorder(selected.map((n) => n.id), "front"), handled());
        else if (e.shiftKey && e.code === "BracketLeft") (s.reorder(selected.map((n) => n.id), "back"), handled());
        else if (key === "=" || key === "+") (void rf.zoomIn({ duration: 150 }), handled());
        else if (key === "-") (void rf.zoomOut({ duration: 150 }), handled());
        else if (key === "0") (void rf.zoomTo(1, { duration: 200 }), handled());
        return;
      }
      if (e.altKey) return;

      if (e.shiftKey && e.code === "Digit1") return void (rf.fitView({ padding: 0.25, maxZoom: 1, duration: 250 }), handled());
      if (e.shiftKey && e.code === "Digit2") {
        if (selected.length) void rf.fitView({ nodes: selected.map((n) => ({ id: n.id })), padding: 0.3, maxZoom: 1.5, duration: 250 });
        return handled();
      }
      if (e.shiftKey && e.code === "Digit0") return void (rf.zoomTo(1, { duration: 200 }), handled());

      switch (key) {
        case "Backspace":
        case "Delete":
          s.deleteSelection();
          return handled();
        case "Escape":
          if (s.tool !== "select") s.setTool("select");
          else s.clearSelection();
          return;
        case "Enter":
          if (selected.length === 1 && !links.length && selected[0].type !== "image" && selected[0].type !== "ink")
            s.startEditing(selected[0].id);
          else if (links.length === 1 && !selected.length) s.startEditingLabel(links[0].id);
          return handled();
        case "Tab":
          if (selected.length === 1) s.addLinkedNote(selected[0].id, e.shiftKey ? Position.Left : Position.Right);
          return handled();
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          const step = e.shiftKey ? 20 : 2;
          const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
          const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
          s.nudgeSelection(dx, dy);
          return handled();
        }
        case "?":
          opts.current.toggleHelp();
          return handled();
      }
      if (e.shiftKey) return;
      if (TOOL_KEYS[lower]) s.setTool(TOOL_KEYS[lower]);
      else if (lower === "i") opts.current.pickImage();
      else if (lower === "c" && selected.length === 1) s.toggleCollapse(selected[0].id);
      else if (lower === "m") opts.current.toggleMap();
    };

    // WebKit only enables Copy/Cut/Paste on a non-text page if these are cancelled.
    const enable = (e: Event) => {
      if (!isTyping(document.activeElement)) e.preventDefault();
    };

    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (isTyping(document.activeElement)) return;
      const s = boardStore.getState();
      const clip = s.copySelection();
      if (!clip) return;
      e.preventDefault();
      const text = clip.nodes
        .map((n) => [n.data.title, n.data.text || n.data.url].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n");
      e.clipboardData?.setData("text/plain", text || " ");
      lastCopy = { text: text || " ", clip };
      lastPaste = null;
      if (cut) s.deleteSelection();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      const s = boardStore.getState();
      const images = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!images.length && !text) return;
      e.preventDefault();
      let at = pointerOnBoard();
      // Repeated pastes at the same spot fan out instead of stacking exactly.
      if (at && lastPaste && Math.hypot(at.x - lastPaste.x, at.y - lastPaste.y) < 1) {
        lastPaste.count += 1;
        at = { x: at.x + lastPaste.count * 24, y: at.y + lastPaste.count * 24 };
      } else if (at) {
        lastPaste = { ...at, count: 0 };
      }
      if (images.length) {
        void addImages(images, at ?? viewCenter());
        return;
      }
      if (lastCopy && text === lastCopy.text) {
        s.paste(lastCopy.clip, at ?? undefined);
        return;
      }
      const body = text.trim();
      if (!body) return;
      const url = asUrl(body);
      if (url) {
        const p = at ?? viewCenter();
        s.addItem("link", { x: p.x - 140, y: p.y - 37 }, { data: { url } });
        return;
      }
      const width = body.length > 160 ? 360 : DEFAULT_NOTE_WIDTH;
      const c = viewCenter();
      s.addNote(at ?? { x: c.x - width / 2, y: c.y - 30 }, { data: { text: body }, width });
    };

    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("beforecopy", enable);
    document.addEventListener("beforecut", enable);
    document.addEventListener("beforepaste", enable);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("beforecopy", enable);
      document.removeEventListener("beforecut", enable);
      document.removeEventListener("beforepaste", enable);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", onPaste);
    };
  }, [rf, pointer]);
}
