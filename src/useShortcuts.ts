import { Position, useReactFlow } from "@xyflow/react";
import { useEffect, useRef, type RefObject } from "react";
import { addFiles, asUrl, isAttachable } from "./images";
import { nearestInDirection, rectOf } from "./layout";
import { markKeyHandled } from "./menuEvents";
import { hiddenItems } from "./mindmap";
import { fromSaved, toSaved } from "./persistence";
import { boardStore, type Clip, type Tool } from "./store";
import { DEFAULT_NOTE_WIDTH, type ArrangeMode } from "./types";

/** Clipboard type for items copied from a board. */
const CLIP_TYPE = "application/x-mythra-items";

/**
 * The last thing copied, kept outside any one board so it can be pasted on another.
 * (The clipboard copy above is preferred; this covers systems that drop custom types.)
 */
let lastCopy: { text: string; clip: Clip } | null = null;

function readClip(data: DataTransfer | null): Clip | null {
  try {
    const raw = data?.getData(CLIP_TYPE);
    if (!raw) return null;
    const clip = JSON.parse(raw) as Clip;
    if (!Array.isArray(clip?.nodes) || !Array.isArray(clip?.links)) return null;
    // Run it through the same checks as opening a saved board.
    const blank = { id: "clip", title: "", createdAt: 0, updatedAt: 0, pinned: false, background: "dots" as const, style: "clean" as const, viewport: null };
    const safe = fromSaved(toSaved({ ...blank, nodes: clip.nodes, edges: clip.links }));
    return safe.nodes.length ? { nodes: safe.nodes, links: safe.edges } : null;
  } catch {
    return null;
  }
}

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
  present: () => void;
};

/** Board-wide keyboard shortcuts and copy/paste. Ignored while you're typing. */
export function useShortcuts(options: Options) {
  const rf = useReactFlow();
  // Read the latest callbacks without re-binding listeners (and losing the copy buffer) every render.
  const opts = useRef(options);
  opts.current = options;
  const { pointer } = options;

  useEffect(() => {
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
        markKeyHandled();
        opts.current.goHome();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        markKeyHandled();
        boardStore.getState().stopEditing();
        opts.current.openPalette();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        markKeyHandled();
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
      const handled = () => {
        e.preventDefault();
        markKeyHandled();
      };

      // ⌥ + arrow keys move the selection to the nearest item in that direction.
      if (e.altKey && !e.metaKey && !e.ctrlKey && key.startsWith("Arrow")) {
        const dir = key.slice(5).toLowerCase() as "left" | "right" | "up" | "down";
        const hidden = hiddenItems(s.nodes, s.edges);
        const candidates = s.nodes.filter((n) => !hidden.has(n.id) && n.type !== "frame" && n.type !== "ink");
        const current = selected.length === 1 ? selected[0] : null;
        let next: string | null;
        if (current) {
          next = nearestInDirection(rectOf(current), candidates.filter((n) => n.id !== current.id).map((n) => ({ id: n.id, ...rectOf(n) })), dir);
        } else {
          // Nothing selected yet: start from the item nearest the middle of the screen.
          const mid = viewCenter();
          next = candidates.reduce<{ id: string; d: number } | null>((acc, n) => {
            const r = rectOf(n);
            const d = Math.hypot(r.x + r.width / 2 - mid.x, r.y + r.height / 2 - mid.y);
            return !acc || d < acc.d ? { id: n.id, d } : acc;
          }, null)?.id ?? null;
        }
        if (next) {
          s.selectOnly([next]);
          const r = rectOf(s.nodes.find((n) => n.id === next)!);
          const vp = rf.getViewport();
          const sx = r.x * vp.zoom + vp.x;
          const sy = r.y * vp.zoom + vp.y;
          if (sx < 40 || sy < 40 || sx + r.width * vp.zoom > window.innerWidth - 40 || sy + r.height * vp.zoom > window.innerHeight - 80)
            void rf.setCenter(r.x + r.width / 2, r.y + r.height / 2, { zoom: vp.zoom, duration: 200 });
        }
        return handled();
      }
      if (e.altKey && !e.metaKey && !(e.ctrlKey && e.code === "KeyG")) {
        // Option-key alignment, as in most design apps.
        const ids = selected.map((n) => n.id);
        const modes: Record<string, ArrangeMode> = e.ctrlKey
          ? { KeyH: "distributeX", KeyV: "distributeY" }
          : { KeyA: "left", KeyH: "hcenter", KeyD: "right", KeyW: "top", KeyV: "vmiddle", KeyS: "bottom" };
        if (ids.length > 1 && modes[e.code]) (s.arrange(ids, modes[e.code]), handled());
        return;
      }

      if (mod) {
        if (lower === "z") (e.shiftKey ? s.redo() : s.undo(), handled());
        else if (lower === "y") (s.redo(), handled());
        else if (lower === "a") (s.selectAll(), handled());
        else if (lower === "d") (s.duplicateSelection(), handled());
        else if (e.altKey && e.code === "KeyG") (s.frameSelection(), handled());
        else if (e.code === "KeyG" && e.shiftKey) (s.ungroup(selected.map((n) => n.id)), handled());
        else if (e.code === "KeyG") (s.group(selected.map((n) => n.id)), handled());
        else if (e.shiftKey && e.code === "KeyL") (s.setLocked(selected.map((n) => n.id), !selected.every((n) => n.data.locked)), handled());
        else if (e.shiftKey && e.code === "KeyE") (opts.current.exportPng(), handled());
        else if (e.shiftKey && e.code === "KeyP") (opts.current.present(), handled());
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
          if (s.croppingId) s.setCropping(null);
          else if (s.tool !== "select") s.setTool("select");
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
      // The items themselves, so they paste intact on any board, in any window.
      e.clipboardData?.setData(CLIP_TYPE, JSON.stringify(clip));
      lastCopy = { text: text || " ", clip };
      lastPaste = null;
      if (cut) s.deleteSelection();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      const s = boardStore.getState();
      const images = [...(e.clipboardData?.files ?? [])].filter(isAttachable);
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
        void addFiles(images, at ?? viewCenter());
        return;
      }
      const copied = readClip(e.clipboardData) ?? (lastCopy && text === lastCopy.text ? lastCopy.clip : null);
      if (copied) {
        s.paste(copied, at ?? undefined);
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
