import { Position } from "@xyflow/react";
import type { ShapeKind } from "./types";

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export type Anchor = Point & { side: Position };

/** The outline links attach to. Everything except ellipse/diamond shapes is a box. */
export type Outline = "box" | "ellipse" | "diamond";
export const outlineOf = (shape: ShapeKind | undefined): Outline =>
  shape === "ellipse" ? "ellipse" : shape === "diamond" ? "diamond" : "box";

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const isHorizontal = (side: Position) => side === Position.Left || side === Position.Right;

export const sideNormal = (side: Position): Point => {
  switch (side) {
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
  }
};

/**
 * A point on `side` of the rect, `along` px from that side's midpoint (down for
 * left/right sides, right for top/bottom). Ellipses and diamonds curve inwards
 * away from the midpoint, so the point is pulled in to sit on the outline.
 */
export function sidePoint(r: Rect, side: Position, along = 0, outline: Outline = "box"): Anchor {
  const c = center(r);
  const n = sideNormal(side);
  const hw = r.width / 2;
  const hh = r.height / 2;
  const half = isHorizontal(side) ? hh : hw;
  const depth = isHorizontal(side) ? hw : hh;
  const t = Math.min(Math.abs(along) / Math.max(half, 1), 1);
  const reach = outline === "ellipse" ? depth * Math.sqrt(1 - t * t) : outline === "diamond" ? depth * (1 - t) : depth;
  return isHorizontal(side)
    ? { x: c.x + n.x * reach, y: c.y + along, side }
    : { x: c.x + along, y: c.y + n.y * reach, side };
}

/** The side of `from` that faces the point `to`, judged relative to the rect's shape. */
export function sideFacing(from: Rect, to: Point): Position {
  const c = center(from);
  const dx = (to.x - c.x) / Math.max(from.width, 1);
  const dy = (to.y - c.y) / Math.max(from.height, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/**
 * Choose which sides two items should connect on. Items side by side link their left and
 * right sides, items stacked link top and bottom. Items set diagonally apart link from the
 * side too (as long as there's a clear gap across), which keeps mind-map branches and
 * flowchart side-branches tidy.
 */
export function pickSides(a: Rect, b: Rect): [Position, Position] {
  const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  const ca = center(a);
  const cb = center(b);
  if (gapX >= gapY || (gapX >= 24 && gapY > 0)) {
    return cb.x >= ca.x ? [Position.Right, Position.Left] : [Position.Left, Position.Right];
  }
  return cb.y >= ca.y ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom];
}

/** Where the line from the rect's centre towards `toward` crosses its outline. */
export function borderPoint(r: Rect, toward: Point, outline: Outline = "box"): Anchor {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const side = sideFacing(r, toward);
  if (dx === 0 && dy === 0) return sidePoint(r, Position.Right);
  const hw = Math.max(r.width / 2, 0.5);
  const hh = Math.max(r.height / 2, 0.5);
  let scale: number;
  if (outline === "ellipse") scale = 1 / Math.hypot(dx / hw, dy / hh);
  else if (outline === "diamond") scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else scale = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * scale, y: c.y + dy * scale, side };
}

/** Move a point by `distance` along a unit direction. */
export const offset = (p: Point, dir: Point, distance: number): Point => ({
  x: p.x + dir.x * distance,
  y: p.y + dir.y * distance,
});

export const unit = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

/** SVG path for a filled arrowhead whose tip is at `tip`, pointing along `dir`. */
export function arrowHead(tip: Point, dir: Point, length = 11, width = 9): string {
  const base = offset(tip, dir, -length);
  const px = -dir.y * (width / 2);
  const py = dir.x * (width / 2);
  return `M ${tip.x} ${tip.y} L ${base.x + px} ${base.y + py} L ${base.x - px} ${base.y - py} Z`;
}

export function rectsBounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const rectsOverlap = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;

export const containsPoint = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Shortest distance from `p` to the segment a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
