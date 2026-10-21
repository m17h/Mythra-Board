import {
  applyEdgeChanges,
  applyNodeChanges,
  Position,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { createStore, useStore } from "zustand";
import { center, containsPoint, rectsBounds, type Point, type Rect } from "./geometry";
import { decorate, defaultSize, freeSpot, itemsInFrame, rectOf } from "./layout";
import { hiddenItems, tidyTree, treeRoots } from "./mindmap";
import { snapMove, type Guide } from "./snap";
import {
  AUTO_HEIGHT,
  LINKABLE,
  type ArrangeMode,
  type BoardBackground,
  type BoardStyle,
  type BoardNode,
  type Color,
  type ItemData,
  type ItemType,
  type LinkArrow,
  type LinkData,
  type LinkEdge,
  type LinkStyle,
  type ShapeKind,
  type Size,
} from "./types";

export type Tool = "select" | "hand" | "note" | "text" | "shape" | "frame" | "arrow" | "pen" | "eraser" | "lasso";

export type EditField = "title" | "body";

export type Clip = { nodes: BoardNode[]; links: LinkEdge[] };

/** Everything that is saved for a board. */
export type BoardDoc = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  background: BoardBackground;
  style: BoardStyle;
  viewport: Viewport | null;
  nodes: BoardNode[];
  edges: LinkEdge[];
};

const HISTORY_LIMIT = 200;
/** How close (in screen pixels) an edge must be before it snaps. */
const SNAP_DISTANCE = 6;
/** Only items this close to the dragged ones are considered for snapping. */
const SNAP_RANGE = 3000;
const SNAP_KEY = "mythra-board:snapping";

let snapZoom = 1;
let snapPaused = false;
/** Tell snapping the current zoom, so the snap distance feels the same at any zoom. */
export const setSnapZoom = (zoom: number) => {
  snapZoom = zoom || 1;
};
/** Holding Option drags freely. */
export const pauseSnapping = (paused: boolean) => {
  snapPaused = paused;
};
const readSnapping = () => {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SNAP_KEY) !== "0";
  } catch {
    return true;
  }
};
const PASTE_OFFSET = 32;
/** Room around a free arrow so its ends and arrowheads aren't clipped. */
const ARROW_PAD = 16;

/** Where each item goes to line up (or spread out evenly) inside `bounds`. */
export function arrangePositions(
  items: (Rect & { id: string })[],
  bounds: Rect,
  mode: ArrangeMode,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (mode === "distributeX" || mode === "distributeY") {
    const horizontal = mode === "distributeX";
    const sorted = [...items].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const used = sorted.reduce((sum, r) => sum + (horizontal ? r.width : r.height), 0);
    const span = horizontal ? bounds.width : bounds.height;
    const gap = (span - used) / Math.max(1, sorted.length - 1);
    let at = horizontal ? bounds.x : bounds.y;
    for (const r of sorted) {
      out.set(r.id, horizontal ? { x: round(at), y: r.y } : { x: r.x, y: round(at) });
      at += (horizontal ? r.width : r.height) + gap;
    }
    return out;
  }
  for (const r of items) {
    const p = { x: r.x, y: r.y };
    if (mode === "left") p.x = bounds.x;
    if (mode === "right") p.x = bounds.x + bounds.width - r.width;
    if (mode === "hcenter") p.x = bounds.x + (bounds.width - r.width) / 2;
    if (mode === "top") p.y = bounds.y;
    if (mode === "bottom") p.y = bounds.y + bounds.height - r.height;
    if (mode === "vmiddle") p.y = bounds.y + (bounds.height - r.height) / 2;
    out.set(r.id, { x: round(p.x), y: round(p.y) });
  }
  return out;
}

/** The item box for a free arrow from `a` to `b`, with its ends relative to that box. */
export function arrowBox(a: Point, b: Point) {
  const x = Math.min(a.x, b.x) - ARROW_PAD;
  const y = Math.min(a.y, b.y) - ARROW_PAD;
  return {
    position: { x, y },
    width: Math.abs(a.x - b.x) + ARROW_PAD * 2,
    height: Math.abs(a.y - b.y) + ARROW_PAD * 2,
    ends: [a.x - x, a.y - y, b.x - x, b.y - y] as [number, number, number, number],
  };
}
const FRAME_PADDING = 36;

export type BoardState = {
  boardId: string;
  title: string;
  createdAt: number;
  pinned: boolean;
  background: BoardBackground;
  style: BoardStyle;
  nodes: BoardNode[];
  edges: LinkEdge[];
  viewport: Viewport | null;

  tool: Tool;
  shapeKind: ShapeKind;
  penColor: Color;
  penSize: Size;
  /** Arrowheads for new free arrows: "none" draws plain lines. */
  arrowHead: LinkArrow;
  setArrowHead: (head: LinkArrow) => void;
  editingId: string | null;
  /** Which part of the item is being typed into. */
  editingField: EditField;
  editingLabelId: string | null;
  connecting: boolean;
  linkStyle: LinkStyle;
  /** Line items up with each other while dragging. */
  snapping: boolean;
  guides: Guide[];
  /** The section that dragged items are over. */
  dropFrameId: string | null;
  past: string[];
  future: string[];

  onNodesChange: (changes: NodeChange<BoardNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<LinkEdge>[]) => void;

  begin: () => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  beginDrag: (ids: string[]) => void;
  endDrag: () => void;

  load: (doc: BoardDoc) => void;
  setTitle: (title: string) => void;
  setBackground: (background: BoardBackground) => void;
  setStyle: (style: BoardStyle) => void;
  setTool: (tool: Tool) => void;
  setShapeKind: (shape: ShapeKind) => void;
  setPen: (opts: { color?: Color; size?: Size }) => void;
  setViewport: (viewport: Viewport) => void;
  setConnecting: (connecting: boolean) => void;

  addItem: (
    type: ItemType,
    position: Point,
    opts?: { edit?: boolean; data?: Partial<ItemData>; width?: number; height?: number; select?: boolean },
  ) => string;
  addNote: (position: Point, opts?: { edit?: boolean; data?: Partial<ItemData>; width?: number }) => string;
  addInk: (points: number[], color: Color, size: Size) => string | null;
  addLinkedNote: (fromId: string, side: Position) => string | null;
  addConnectedNote: (fromId: string, position: Point) => string | null;
  setText: (id: string, text: string) => void;
  setColor: (ids: string[], color: Color) => void;
  setSize: (ids: string[], size: Size) => void;
  setShape: (ids: string[], shape: ShapeKind) => void;
  /** Change look settings (outline, text style, alignment…) on several items in one step. */
  styleItems: (ids: string[], patch: Partial<ItemData>, only?: ReadonlySet<ItemType>) => void;
  /** Show or remove a note's card title. */
  toggleTitle: (id: string) => void;
  setItemTitle: (id: string, title: string) => void;
  toggleTask: (id: string, line: number) => void;
  /** Fold or unfold everything an item links out to. */
  toggleCollapse: (id: string) => void;
  /** Arrange mind-map branches neatly, from the given items (or every tree on the board). */
  tidyUp: (rootIds?: string[]) => number;
  /** A free-standing arrow or line between two board points. */
  addArrow: (from: Point, to: Point, opts?: { arrowHead?: LinkArrow; color?: Color; size?: Size }) => string;
  /** Move a free arrow's ends (board coordinates). Wrap in begin/commit. */
  setArrowEnds: (id: string, from: Point, to: Point) => void;
  /** A card that opens another board. */
  addBoardCard: (boardId: string, title: string, at: Point) => string;
  frameSelection: () => string | null;
  startEditing: (id: string, field?: EditField) => void;
  stopEditing: () => void;

  canConnect: (source: string, target: string) => boolean;
  connect: (source: string, target: string) => string | null;
  updateLink: (id: string, patch: Partial<LinkData>) => void;
  reverseLink: (id: string) => void;
  startEditingLabel: (id: string | null) => void;

  selectOnly: (ids: string[], edgeIds?: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  deleteNodes: (ids: string[]) => void;
  /** Remove items without recording a step; wrap in begin/commit (used by the eraser). */
  eraseNodes: (ids: string[]) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  reorder: (ids: string[], to: "front" | "back") => void;
  /** Lock (or unlock) items against moving, resizing, editing and deleting. */
  setLocked: (ids: string[], locked: boolean) => void;
  group: (ids: string[]) => void;
  ungroup: (ids: string[]) => void;
  /** Line items up along an edge or centre, or space them evenly. */
  arrange: (ids: string[], mode: ArrangeMode) => void;
  setSnapping: (on: boolean) => void;
  /** Swap in different content (e.g. an older version) as one undoable step. */
  replaceContent: (nodes: BoardNode[], edges: LinkEdge[]) => void;
  copySelection: () => Clip | null;
  paste: (clip: Clip, at?: Point) => void;
  duplicateSelection: () => void;
};

const round = (v: number) => Math.round(v * 10) / 10;

function cleanData(d: ItemData): ItemData {
  const out: ItemData = { text: d.text ?? "", color: d.color ?? "plain", size: d.size ?? "m" };
  if (d.shape) out.shape = d.shape;
  if (d.asset) out.asset = d.asset;
  if (d.points) out.points = d.points;
  if (d.url) out.url = d.url;
  if (d.title !== undefined) out.title = d.title;
  if (d.textStyle) out.textStyle = d.textStyle;
  if (d.align) out.align = d.align;
  if (d.outline !== undefined) out.outline = d.outline;
  if (d.outlineColor) out.outlineColor = d.outlineColor;
  if (d.outlineStyle && d.outlineStyle !== "solid") out.outlineStyle = d.outlineStyle;
  if (d.boardId) out.boardId = d.boardId;
  if (d.collapsed) out.collapsed = true;
  if (d.ends) out.ends = d.ends.map(round) as ItemData["ends"];
  if (d.arrowHead) out.arrowHead = d.arrowHead;
  if (d.locked) out.locked = true;
  if (d.group) out.group = d.group;
  if (d.fill && d.fill !== "solid") out.fill = d.fill;
  return out;
}

/** Only the parts of an item that belong in history and on disk. */
export function cleanNode(n: BoardNode): BoardNode {
  const out: BoardNode = {
    id: n.id,
    type: n.type,
    position: { x: round(n.position.x), y: round(n.position.y) },
    width: n.width ?? n.measured?.width ?? defaultSize(n.type).width,
    data: cleanData(n.data),
  };
  if (!AUTO_HEIGHT.has(n.type)) out.height = n.height ?? n.measured?.height ?? defaultSize(n.type, n.data.shape).height;
  return out;
}

export function cleanEdge(e: LinkEdge): LinkEdge {
  const d = e.data ?? defaultLinkData();
  return {
    id: e.id,
    type: "link",
    source: e.source,
    target: e.target,
    data: { label: d.label, curve: d.curve, arrow: d.arrow, dash: d.dash },
  };
}

const serialize = (nodes: BoardNode[], edges: LinkEdge[]) =>
  JSON.stringify({ n: nodes.map(cleanNode), e: edges.map(cleanEdge) });

export const defaultLinkData = (style?: LinkStyle): LinkData => ({
  label: "",
  curve: style?.curve ?? "curved",
  arrow: style?.arrow ?? "end",
  dash: style?.dash ?? "solid",
});

export function makeItem(
  type: ItemType,
  position: Point,
  data?: Partial<ItemData>,
  size?: { width?: number; height?: number },
): BoardNode {
  const base = defaultSize(type, data?.shape);
  const node: BoardNode = {
    id: nanoid(10),
    type,
    position,
    width: size?.width ?? base.width,
    data: { text: "", color: "plain", size: "m", ...data },
  };
  if (AUTO_HEIGHT.has(type)) node.initialHeight = size?.height ?? base.height;
  else node.height = size?.height ?? base.height;
  return decorate(node);
}

export const makeLink = (source: string, target: string, data?: Partial<LinkData>): LinkEdge => ({
  id: nanoid(10),
  type: "link",
  source,
  target,
  data: { ...defaultLinkData(), ...data },
});

/** Frames go first so they draw underneath everything else. */
const withFramesFirst = (nodes: BoardNode[]) => {
  const frames = nodes.filter((n) => n.type === "frame");
  return frames.length ? [...frames, ...nodes.filter((n) => n.type !== "frame")] : nodes;
};

const deselected = <T extends { selected?: boolean }>(items: T[]) =>
  items.map((x) => (x.selected ? { ...x, selected: false } : x));

export function createBoardStore() {
  // A history entry pushed by `begin`/`commit`, waiting to see whether anything changed.
  let pending: string | null = null;
  // An item created for immediate typing; abandoned if it is left empty.
  let fresh: { id: string; historyLength: number } | null = null;
  // Items riding along with frames that are being dragged.
  let dragChildren = new Map<string, string[]>();
  let dragActive = false;

  return createStore<BoardState>()((set, get) => {
    const snapshot = () => serialize(get().nodes, get().edges);

    const pushHistory = (entry: string) => {
      const past = [...get().past, entry];
      if (past.length > HISTORY_LIMIT) past.shift();
      set({ past, future: [] });
    };

    /** Run a change as one undoable step. */
    const record = (change: () => void) => {
      if (pending !== null) get().commit();
      const before = snapshot();
      change();
      if (snapshot() !== before) pushHistory(before);
    };

    const restore = (entry: string) => {
      const { n, e } = JSON.parse(entry) as { n: BoardNode[]; e: LinkEdge[] };
      // Reuse known sizes so restored items don't blink while they are re-measured.
      const sizes = new Map(get().nodes.map((x) => [x.id, x.measured]));
      const nodes = n.map((x) => decorate({ ...x, measured: sizes.get(x.id) }));
      set({ nodes, edges: e, editingId: null, editingLabelId: null });
    };

    const linkExists = (a: string, b: string) =>
      get().edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

    const updateData = (ids: string[], patch: (n: BoardNode) => Partial<ItemData> | null) => {
      const idSet = new Set(ids);
      record(() =>
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (!idSet.has(n.id)) return n;
            const p = patch(n);
            return p ? { ...n, data: { ...n.data, ...p } } : n;
          }),
        })),
      );
    };

    return {
      boardId: "",
      title: "Untitled board",
      createdAt: 0,
      pinned: false,
      background: "dots",
      style: "clean",
      nodes: [],
      edges: [],
      viewport: null,
      tool: "select",
      shapeKind: "rect",
      penColor: "plain",
      penSize: "m",
      arrowHead: "end",
      editingId: null,
      editingField: "body",
      editingLabelId: null,
      connecting: false,
      linkStyle: { curve: "curved", arrow: "end", dash: "solid" },
      snapping: readSnapping(),
      guides: [],
      dropFrameId: null,
      past: [],
      future: [],

      onNodesChange: (changes) => {
        const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
        // The final change when a drag ends has `dragging: false` but must be snapped too,
        // or the item jumps back to the raw pointer position when you let go.
        const drags = changes.filter(
          (c): c is NodeChange<BoardNode> & { type: "position" } =>
            c.type === "position" && !!c.position && (!!c.dragging || dragActive),
        );
        let all = changes;
        if (drags.length) {
          const byId = new Map(get().nodes.map((n) => [n.id, n]));
          const moving = new Set(drags.map((c) => c.id));
          for (const c of drags) for (const k of dragChildren.get(c.id) ?? []) moving.add(k);

          // Line the dragged items up with their neighbours.
          const rects = drags.flatMap((c) => {
            const n = byId.get(c.id);
            return n ? [{ ...rectOf(n), x: c.position!.x, y: c.position!.y }] : [];
          });
          const group = rectsBounds(rects);
          let guides: Guide[] = [];
          let dropFrameId: string | null = null;
          if (group) {
            if (get().snapping && !snapPaused) {
              const others = get()
                .nodes.filter((n) => !moving.has(n.id) && n.type !== "ink")
                .map(rectOf)
                .filter((r) => Math.abs(r.x - group.x) < SNAP_RANGE && Math.abs(r.y - group.y) < SNAP_RANGE);
              const snap = snapMove(group, others, SNAP_DISTANCE / snapZoom);
              guides = snap.guides;
              if (snap.dx || snap.dy) {
                for (const c of drags) c.position = { x: c.position!.x + snap.dx, y: c.position!.y + snap.dy };
                group.x += snap.dx;
                group.y += snap.dy;
              }
            }
            // Show which section the dragged items will land in.
            if (!drags.some((c) => byId.get(c.id)?.type === "frame")) {
              const mid = center(group);
              let best = Infinity;
              for (const n of get().nodes) {
                if (n.type !== "frame" || moving.has(n.id)) continue;
                const r = rectOf(n);
                if (containsPoint(r, mid) && r.width * r.height < best) {
                  best = r.width * r.height;
                  dropFrameId = n.id;
                }
              }
            }
          }
          if (JSON.stringify(guides) !== JSON.stringify(get().guides)) set({ guides });
          if (dropFrameId !== get().dropFrameId) set({ dropFrameId });

          // Sections carry their contents along.
          const extra: NodeChange<BoardNode>[] = [];
          const placed = new Set(drags.map((c) => c.id));
          for (const c of drags) {
            const kids = dragChildren.get(c.id);
            const frame = byId.get(c.id);
            if (!kids || !frame) continue;
            const dx = c.position!.x - frame.position.x;
            const dy = c.position!.y - frame.position.y;
            if (!dx && !dy) continue;
            for (const k of kids) {
              const n = byId.get(k);
              if (!n || placed.has(k)) continue;
              placed.add(k);
              extra.push({ type: "position", id: k, position: { x: n.position.x + dx, y: n.position.y + dy } });
            }
          }
          if (extra.length) all = [...changes, ...extra];
        }
        // Selecting one member of a group selects the whole group.
        const picked = all.filter((c) => c.type === "select" && c.selected).map((c) => (c as { id: string }).id);
        if (picked.length) {
          const groups = new Set(get().nodes.filter((n) => picked.includes(n.id) && n.data.group).map((n) => n.data.group));
          if (groups.size) {
            const already = new Set(picked);
            const mates = get()
              .nodes.filter((n) => n.data.group && groups.has(n.data.group) && !already.has(n.id) && !n.selected)
              .map((n): NodeChange<BoardNode> => ({ type: "select", id: n.id, selected: true }));
            if (mates.length) all = [...all, ...mates];
          }
        }
        set((s) => ({
          nodes: applyNodeChanges(all, s.nodes),
          edges: removed.size ? s.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) : s.edges,
        }));
      },
      onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

      begin: () => {
        if (pending !== null) get().commit();
        pending = snapshot();
      },
      commit: () => {
        const before = pending;
        pending = null;
        if (before !== null && before !== snapshot()) pushHistory(before);
      },
      undo: () => {
        get().stopEditing();
        const { past, future } = get();
        if (!past.length) return;
        const current = snapshot();
        const entry = past[past.length - 1];
        set({ past: past.slice(0, -1), future: [...future, current] });
        restore(entry);
      },
      redo: () => {
        get().stopEditing();
        const { past, future } = get();
        if (!future.length) return;
        const current = snapshot();
        const entry = future[future.length - 1];
        set({ future: future.slice(0, -1), past: [...past, current] });
        restore(entry);
      },

      beginDrag: (ids) => {
        get().begin();
        dragActive = true;
        const dragged = new Set(ids);
        const nodes = get().nodes;
        dragChildren = new Map();
        for (const n of nodes) {
          if (n.type !== "frame" || !dragged.has(n.id)) continue;
          dragChildren.set(n.id, itemsInFrame(n, nodes).filter((id) => !dragged.has(id)));
        }
      },
      endDrag: () => {
        dragActive = false;
        dragChildren = new Map();
        set({ guides: [], dropFrameId: null });
        get().commit();
      },

      load: (doc) => {
        pending = null;
        fresh = null;
        set({
          boardId: doc.id,
          title: doc.title,
          createdAt: doc.createdAt,
          pinned: doc.pinned,
          background: doc.background,
          style: doc.style,
          viewport: doc.viewport,
          nodes: withFramesFirst(doc.nodes.map(decorate)),
          edges: doc.edges,
          past: [],
          future: [],
          tool: "select",
          editingId: null,
          editingLabelId: null,
          connecting: false,
        });
      },
      setTitle: (title) => set({ title }),
      setBackground: (background) => set({ background }),
      setStyle: (style) => set({ style }),
      setTool: (tool) => {
        get().stopEditing();
        set({ tool });
      },
      setShapeKind: (shapeKind) => set({ shapeKind, tool: "shape" }),
      setPen: ({ color, size }) =>
        set((s) => ({ penColor: color ?? s.penColor, penSize: size ?? s.penSize, tool: "pen" })),
      setArrowHead: (arrowHead) => set({ arrowHead, tool: "arrow" }),
      setViewport: (viewport) => set({ viewport }),
      setConnecting: (connecting) => set({ connecting }),

      addItem: (type, position, opts) => {
        get().stopEditing();
        const item = makeItem(type, position, opts?.data, { width: opts?.width, height: opts?.height });
        const select = opts?.select ?? true;
        record(() =>
          set((s) => {
            const nodes = select ? deselected(s.nodes) : s.nodes;
            const added = { ...item, selected: select };
            return {
              nodes: type === "frame" ? [added, ...nodes] : [...nodes, added],
              edges: select ? deselected(s.edges) : s.edges,
            };
          }),
        );
        if (opts?.edit) {
          if (type === "note" || type === "text") fresh = { id: item.id, historyLength: get().past.length };
          get().startEditing(item.id);
        }
        return item.id;
      },

      addNote: (position, opts) => get().addItem("note", position, opts),

      addInk: (points, color, size) => {
        if (points.length < 3) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; i += 3) {
          minX = Math.min(minX, points[i]);
          maxX = Math.max(maxX, points[i]);
          minY = Math.min(minY, points[i + 1]);
          maxY = Math.max(maxY, points[i + 1]);
        }
        const pad = 12;
        const x = minX - pad;
        const y = minY - pad;
        const rel = points.map((v, i) => (i % 3 === 0 ? round(v - x) : i % 3 === 1 ? round(v - y) : Math.round(v * 100) / 100));
        return get().addItem(
          "ink",
          { x, y },
          { data: { points: rel, color, size }, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2, select: false },
        );
      },

      addLinkedNote: (fromId, side) => {
        const from = get().nodes.find((n) => n.id === fromId);
        if (!from || !LINKABLE.has(from.type)) return null;
        const others = get().nodes.filter((n) => n.type !== "frame").map(rectOf);
        return get().addConnectedNote(fromId, freeSpot(rectOf(from), side, others));
      },

      addConnectedNote: (fromId, position) => {
        const from = get().nodes.find((n) => n.id === fromId);
        if (!from) return null;
        get().stopEditing();
        const color = from.type === "note" || from.type === "shape" ? from.data.color : "plain";
        const note = makeItem("note", position, { color, size: from.data.size === "l" ? "m" : from.data.size });
        const link = makeLink(fromId, note.id, get().linkStyle);
        record(() =>
          set((s) => ({
            nodes: [...deselected(s.nodes), { ...note, selected: true }],
            edges: [...deselected(s.edges), link],
          })),
        );
        fresh = { id: note.id, historyLength: get().past.length };
        get().startEditing(note.id);
        return note.id;
      },

      setText: (id, text) =>
        set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)) })),
      setColor: (ids, color) => updateData(ids, () => ({ color })),
      setSize: (ids, size) => updateData(ids, () => ({ size })),
      setShape: (ids, shape) => updateData(ids, (n) => (n.type === "shape" ? { shape } : null)),
      styleItems: (ids, patch, only) => updateData(ids, (n) => (!only || only.has(n.type) ? patch : null)),

      setItemTitle: (id, title) =>
        set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)) })),

      toggleTitle: (id) => {
        const item = get().nodes.find((n) => n.id === id);
        if (!item || item.type !== "note") return;
        const adding = item.data.title === undefined;
        // Adding a title to the note you're typing in keeps you typing in it.
        const editingThis = get().editingId === id;
        if (!editingThis) get().stopEditing();
        record(() =>
          set((s) => ({
            nodes: s.nodes.map((n) => {
              if (n.id !== id) return n;
              const data = { ...n.data };
              if (adding) data.title = "";
              else delete data.title;
              return { ...n, data };
            }),
          })),
        );
        if (editingThis) {
          get().begin();
          set({ editingField: adding ? "title" : "body" });
        } else if (adding) {
          get().startEditing(id, "title");
        }
      },

      toggleTask: (id, line) =>
        updateData([id], (n) => {
          const lines = n.data.text.split("\n");
          const m = /^(\s*[-*] \[)( |x|X)(\])/.exec(lines[line] ?? "");
          if (!m) return null;
          lines[line] = m[1] + (m[2] === " " ? "x" : " ") + lines[line].slice(m[1].length + 1);
          return { text: lines.join("\n") };
        }),

      toggleCollapse: (id) => {
        get().stopEditing();
        updateData([id], (n) => ({ collapsed: !n.data.collapsed }));
        // Hidden items shouldn't stay selected.
        const hidden = hiddenItems(get().nodes, get().edges);
        if (hidden.size) set((s) => ({ nodes: s.nodes.map((n) => (n.selected && hidden.has(n.id) ? { ...n, selected: false } : n)) }));
      },

      tidyUp: (rootIds) => {
        const { nodes, edges } = get();
        const roots = rootIds?.length ? rootIds : treeRoots(nodes, edges);
        const moves = new Map<string, Point>();
        for (const r of roots) for (const [id, p] of tidyTree(r, nodes, edges)) if (!moves.has(id)) moves.set(id, p);
        if (!moves.size) return 0;
        get().stopEditing();
        record(() =>
          set((s) => ({
            nodes: s.nodes.map((n) => {
              const p = moves.get(n.id);
              return p ? { ...n, position: { x: round(p.x), y: round(p.y) } } : n;
            }),
          })),
        );
        return moves.size;
      },

      addArrow: (from, to, opts) => {
        const box = arrowBox(from, to);
        return get().addItem("arrow", box.position, {
          width: box.width,
          height: box.height,
          data: { ends: box.ends, arrowHead: opts?.arrowHead ?? "end", color: opts?.color ?? "plain", size: opts?.size ?? "m" },
        });
      },

      setArrowEnds: (id, from, to) => {
        const box = arrowBox(from, to);
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, position: box.position, width: box.width, height: box.height, data: { ...n.data, ends: box.ends } }
              : n,
          ),
        }));
      },

      addBoardCard: (boardId, title, at) => {
        const size = defaultSize("board");
        return get().addItem("board", { x: at.x - size.width / 2, y: at.y - size.height / 2 }, { data: { boardId, text: title } });
      },

      frameSelection: () => {
        const selected = get().nodes.filter((n) => n.selected);
        const bounds = rectsBounds(selected.map(rectOf));
        if (!bounds) return null;
        const id = get().addItem(
          "frame",
          { x: bounds.x - FRAME_PADDING, y: bounds.y - FRAME_PADDING },
          { width: bounds.width + FRAME_PADDING * 2, height: bounds.height + FRAME_PADDING * 2, data: { text: "Section" } },
        );
        get().startEditing(id);
        return id;
      },

      startEditing: (id, field = "body") => {
        if (get().editingId === id) {
          set({ editingField: field });
          return;
        }
        get().stopEditing();
        const item = get().nodes.find((n) => n.id === id);
        if (!item || item.data.locked) return;
        get().begin();
        set({ editingId: id, editingField: field, editingLabelId: null });
      },

      stopEditing: () => {
        const id = get().editingId;
        if (!id) return;
        set({ editingId: null });
        const item = get().nodes.find((n) => n.id === id);
        const wasFresh = fresh?.id === id ? fresh : null;
        fresh = null;
        if (item && wasFresh && !item.data.text.trim() && !item.data.title?.trim()) {
          // Nothing was typed into a brand-new note: remove it as if it never existed.
          pending = null;
          set((s) => ({
            nodes: s.nodes.filter((n) => n.id !== id),
            edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          }));
          // Forget every step since it was created, so undo doesn't bring back an empty note.
          if (get().past.length >= wasFresh.historyLength) set((s) => ({ past: s.past.slice(0, wasFresh.historyLength - 1) }));
          return;
        }
        get().commit();
      },

      canConnect: (source, target) => {
        if (!source || !target || source === target) return false;
        const types = new Map(get().nodes.map((n) => [n.id, n.type]));
        const a = types.get(source);
        const b = types.get(target);
        return !!a && !!b && LINKABLE.has(a) && LINKABLE.has(b) && !linkExists(source, target);
      },

      connect: (source, target) => {
        if (!get().canConnect(source, target)) return null;
        const link = makeLink(source, target, get().linkStyle);
        record(() => set((s) => ({ edges: [...s.edges, link] })));
        return link.id;
      },

      updateLink: (id, patch) => {
        record(() =>
          set((s) => ({
            edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...defaultLinkData(), ...e.data, ...patch } } : e)),
          })),
        );
        // New links copy the look of the last link you styled.
        const { label: _label, ...style } = patch;
        if (Object.keys(style).length) set((s) => ({ linkStyle: { ...s.linkStyle, ...style } }));
      },

      reverseLink: (id) =>
        record(() =>
          set((s) => ({
            edges: s.edges.map((e) => (e.id === id ? { ...e, source: e.target, target: e.source } : e)),
          })),
        ),

      startEditingLabel: (id) => {
        get().stopEditing();
        set({ editingLabelId: id });
      },

      selectOnly: (ids, edgeIds = []) => {
        const n = new Set(ids);
        const e = new Set(edgeIds);
        set((s) => ({
          nodes: s.nodes.map((x) => (!!x.selected === n.has(x.id) ? x : { ...x, selected: n.has(x.id) })),
          edges: s.edges.map((x) => (!!x.selected === e.has(x.id) ? x : { ...x, selected: e.has(x.id) })),
        }));
      },
      selectAll: () => {
        const hidden = hiddenItems(get().nodes, get().edges);
        get().selectOnly(get().nodes.filter((n) => !hidden.has(n.id)).map((n) => n.id));
      },
      clearSelection: () => get().selectOnly([]),

      deleteSelection: () => {
        const { nodes, edges } = get();
        const ids = nodes.filter((n) => n.selected && !n.data.locked).map((n) => n.id);
        const edgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
        if (!ids.length && !edgeIds.size) return;
        const idSet = new Set(ids);
        get().stopEditing();
        record(() =>
          set((s) => ({
            nodes: s.nodes.filter((n) => !idSet.has(n.id)),
            edges: s.edges.filter((e) => !edgeIds.has(e.id) && !idSet.has(e.source) && !idSet.has(e.target)),
          })),
        );
      },

      deleteNodes: (ids) => {
        const locked = new Set(get().nodes.filter((n) => n.data.locked).map((n) => n.id));
        const idSet = new Set(ids.filter((id) => !locked.has(id)));
        if (!idSet.size) return;
        get().stopEditing();
        record(() =>
          set((s) => ({
            nodes: s.nodes.filter((n) => !idSet.has(n.id)),
            edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
          })),
        );
      },

      eraseNodes: (ids) => {
        const idSet = new Set(ids);
        set((s) => ({
          nodes: s.nodes.filter((n) => !idSet.has(n.id)),
          edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
        }));
      },

      reorder: (ids, to) => {
        const idSet = new Set(ids);
        record(() =>
          set((s) => {
            const picked = s.nodes.filter((n) => idSet.has(n.id));
            const rest = s.nodes.filter((n) => !idSet.has(n.id));
            const nodes = to === "front" ? [...rest, ...picked] : [...picked, ...rest];
            return { nodes: withFramesFirst(nodes) };
          }),
        );
      },

      setLocked: (ids, locked) => {
        const idSet = new Set(ids);
        if (locked && idSet.has(get().editingId ?? "")) get().stopEditing();
        record(() =>
          set((s) => ({
            nodes: s.nodes.map((n) => {
              if (!idSet.has(n.id)) return n;
              const data = { ...n.data };
              if (locked) data.locked = true;
              else delete data.locked;
              return { ...n, draggable: !locked, data };
            }),
          })),
        );
      },

      group: (ids) => {
        if (ids.length < 2) return;
        const g = nanoid(8);
        get().styleItems(ids, { group: g });
      },

      ungroup: (ids) => {
        const groups = new Set(get().nodes.filter((n) => ids.includes(n.id) && n.data.group).map((n) => n.data.group));
        if (!groups.size) return;
        record(() =>
          set((s) => ({
            nodes: s.nodes.map((n) => {
              if (!n.data.group || !groups.has(n.data.group)) return n;
              const data = { ...n.data };
              delete data.group;
              return { ...n, data };
            }),
          })),
        );
      },

      arrange: (ids, mode) => {
        const idSet = new Set(ids);
        const items = get().nodes.filter((n) => idSet.has(n.id) && !n.data.locked);
        const all = get().nodes.filter((n) => idSet.has(n.id));
        const bounds = rectsBounds(all.map(rectOf));
        if (items.length < 2 || !bounds) return;
        const moves = arrangePositions(items.map((n) => ({ id: n.id, ...rectOf(n) })), bounds, mode);
        record(() =>
          set((s) => ({ nodes: s.nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)) })),
        );
      },

      replaceContent: (nodes, edges) => {
        get().stopEditing();
        record(() => set({ nodes: withFramesFirst(nodes.map(decorate)), edges }));
      },

      setSnapping: (snapping) => {
        set({ snapping });
        if (typeof window === "undefined") return;
        try {
          localStorage.setItem(SNAP_KEY, snapping ? "1" : "0");
        } catch {
          // Not being able to remember the setting is harmless.
        }
      },

      nudgeSelection: (dx, dy) => {
        if (!get().nodes.some((n) => n.selected)) return;
        record(() =>
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.selected && !n.data.locked ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
            ),
          })),
        );
      },

      copySelection: () => {
        const all = get().nodes;
        const ids = new Set(all.filter((n) => n.selected).map((n) => n.id));
        if (!ids.size) return null;
        // A section brings everything inside it along.
        for (const n of all) if (n.type === "frame" && ids.has(n.id)) for (const k of itemsInFrame(n, all)) ids.add(k);
        const nodes = all.filter((n) => ids.has(n.id)).map(cleanNode);
        const links = get()
          .edges.filter((e) => ids.has(e.source) && ids.has(e.target))
          .map(cleanEdge);
        return { nodes, links };
      },

      paste: (clip, at) => {
        if (!clip.nodes.length) return;
        get().stopEditing();
        const minX = Math.min(...clip.nodes.map((n) => n.position.x));
        const minY = Math.min(...clip.nodes.map((n) => n.position.y));
        const dx = at ? at.x - minX : PASTE_OFFSET;
        const dy = at ? at.y - minY : PASTE_OFFSET;
        const idMap = new Map<string, string>();
        // Copies of a group form a new group of their own.
        const groupMap = new Map<string, string>();
        const nodes = clip.nodes.map((n) => {
          const id = nanoid(10);
          idMap.set(n.id, id);
          const clean = cleanNode(n);
          const g = clean.data.group;
          if (g && !groupMap.has(g)) groupMap.set(g, nanoid(8));
          if (g) clean.data = { ...clean.data, group: groupMap.get(g) };
          return decorate({ ...clean, id, selected: true, position: { x: n.position.x + dx, y: n.position.y + dy } });
        });
        const links = clip.links
          .filter((e) => idMap.has(e.source) && idMap.has(e.target))
          .map((e) => ({ ...cleanEdge(e), id: nanoid(10), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
        record(() =>
          set((s) => ({
            nodes: withFramesFirst([...deselected(s.nodes), ...nodes]),
            edges: [...deselected(s.edges), ...links],
          })),
        );
      },

      duplicateSelection: () => {
        const clip = get().copySelection();
        if (clip) get().paste(clip);
      },
    };
  });
}

export const boardStore = createBoardStore();

export function useBoard<T>(selector: (s: BoardState) => T): T {
  return useStore(boardStore, selector);
}
