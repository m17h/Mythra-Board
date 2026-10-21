import { Position } from "@xyflow/react";
import { containsPoint, center, rectsOverlap, type Point, type Rect } from "./geometry";
import { AUTO_HEIGHT, DEFAULT_NOTE_WIDTH, type BoardNode, type ItemType, type ShapeKind } from "./types";

/** Rough height of a one-line note, used before the real size has been measured. */
export const NEW_NOTE_HEIGHT = 50;
const LINK_GAP_X = 90;
const LINK_GAP_Y = 60;
const SPACING = 24;

/** Starting size for each kind of item. */
export function defaultSize(type: ItemType, shape?: ShapeKind): { width: number; height: number } {
  switch (type) {
    case "text":
      return { width: 260, height: 40 };
    case "shape":
      switch (shape) {
        case "diamond":
          return { width: 170, height: 120 };
        case "ellipse":
          return { width: 170, height: 110 };
        case "triangle":
        case "star":
        case "hexagon":
          return { width: 160, height: 140 };
        case "cylinder":
          return { width: 140, height: 160 };
        case "arrow":
          return { width: 200, height: 100 };
        default:
          return { width: 180, height: 100 };
      }
    case "frame":
      return { width: 520, height: 360 };
    case "link":
      return { width: 280, height: 74 };
    case "image":
      return { width: 320, height: 240 };
    case "board":
      return { width: 260, height: 96 };
    case "arrow":
      return { width: 100, height: 40 };
    default:
      return { width: DEFAULT_NOTE_WIDTH, height: NEW_NOTE_HEIGHT };
  }
}

export const rectOf = (n: BoardNode): Rect => ({
  x: n.position.x,
  y: n.position.y,
  width: n.measured?.width ?? n.width ?? DEFAULT_NOTE_WIDTH,
  height: n.measured?.height ?? n.height ?? n.initialHeight ?? NEW_NOTE_HEIGHT,
});

/**
 * Display-only settings React Flow needs on each item: sections sit underneath everything,
 * and text items grow with their content.
 */
export function decorate(n: BoardNode): BoardNode {
  const out: BoardNode = { ...n };
  if (n.type === "frame") out.zIndex = -1;
  out.draggable = !n.data.locked;
  if (AUTO_HEIGHT.has(n.type)) {
    out.initialHeight = n.initialHeight ?? n.height ?? NEW_NOTE_HEIGHT;
    delete out.height;
  }
  return out;
}

/**
 * Where to put a new note linked to `from` on the given side: next to it, sliding along
 * that side (forwards first, then backwards) until it doesn't overlap another item.
 */
export function freeSpot(from: Rect, side: Position, others: Rect[]): Point {
  const w = DEFAULT_NOTE_WIDTH;
  const h = NEW_NOTE_HEIGHT;
  const horizontal = side === Position.Left || side === Position.Right;
  const base: Point = {
    [Position.Right]: { x: from.x + from.width + LINK_GAP_X, y: from.y + from.height / 2 - h / 2 },
    [Position.Left]: { x: from.x - LINK_GAP_X - w, y: from.y + from.height / 2 - h / 2 },
    [Position.Bottom]: { x: from.x + from.width / 2 - w / 2, y: from.y + from.height + LINK_GAP_Y },
    [Position.Top]: { x: from.x + from.width / 2 - w / 2, y: from.y - LINK_GAP_Y - h },
  }[side];
  const free = (p: Point) => !others.some((r) => rectsOverlap({ x: p.x, y: p.y, width: w, height: h }, r, SPACING / 2));
  for (const dir of [1, -1]) {
    for (let i = dir === 1 ? 0 : 1; i < 40; i++) {
      const p = horizontal ? { x: base.x, y: base.y + dir * i * (h + SPACING) } : { x: base.x + dir * i * (w + SPACING), y: base.y };
      if (free(p)) return p;
    }
  }
  return base;
}

/** Items whose centre sits inside the frame; they travel with it when it is dragged. */
export function itemsInFrame(frame: BoardNode, nodes: BoardNode[]): string[] {
  const r = rectOf(frame);
  return nodes.filter((n) => n.id !== frame.id && containsPoint(r, center(rectOf(n)))).map((n) => n.id);
}
