import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from "@xyflow/react";
import {
  borderPoint,
  headInset,
  headPath,
  center,
  isHorizontal,
  offset,
  outlineOf,
  pickSides,
  sideFacing,
  sideNormal,
  sidePoint,
  unit,
  type Anchor,
  type Outline,
  type Point,
  type Rect,
} from "./geometry";
import { rectOf } from "./layout";
import type { BoardNode, LinkArrow, LinkCurve, LinkEdge, LinkHead, LinkWidth } from "./types";

/** Space between an arrow tip and the item it points at. */
const TIP_GAP = 3;
const ARROW_LENGTH = 11;
/** Preferred distance between link ends that share a side. */
const END_SPACING = 22;

export type LinkGeometry = { path: string; heads: string[]; labelX: number; labelY: number };
/** Where a link attaches at each end, and for elbow links where along the way it bends (0–1). */
export type LinkEnds = [Anchor, Anchor] & { step?: number };

const flip = (p: Point): Point => ({ x: -p.x, y: -p.y });

function pathBetween(curve: LinkCurve, from: Anchor, to: Anchor, fromPoint: Point, toPoint: Point, step = 0.5): [string, number, number] {
  if (curve === "straight") {
    const [path, x, y] = getStraightPath({ sourceX: fromPoint.x, sourceY: fromPoint.y, targetX: toPoint.x, targetY: toPoint.y });
    return [path, x, y];
  }
  const args = {
    sourceX: fromPoint.x,
    sourceY: fromPoint.y,
    sourcePosition: from.side,
    targetX: toPoint.x,
    targetY: toPoint.y,
    targetPosition: to.side,
  };
  if (curve === "elbow") {
    const [path, x, y] = getSmoothStepPath({ ...args, borderRadius: 10, offset: 18, stepPosition: step });
    return [path, x, y];
  }
  const [path, x, y] = getBezierPath({ ...args, curvature: 0.3 });
  return [path, x, y];
}

/** The drawn path, arrow ends and label position for a link between two anchors. */
export function linkGeometry(ends: LinkEnds, curve: LinkCurve, arrow: LinkArrow, head: LinkHead = "arrow", width: LinkWidth = 2): LinkGeometry {
  const [sa, sb] = ends;
  // Direction each arrow points: into the item it touches.
  const intoB = curve === "straight" ? unit(sa, sb) : flip(sideNormal(sb.side));
  const intoA = curve === "straight" ? unit(sb, sa) : flip(sideNormal(sa.side));
  const length = ARROW_LENGTH * (width === 3 ? 1.3 : width === 1 ? 0.85 : 1);

  const heads: string[] = [];
  let start: Point = sa;
  let end: Point = sb;
  if (arrow !== "none") {
    const tip = offset(sb, intoB, -TIP_GAP);
    heads.push(headPath(head, tip, intoB, length));
    end = offset(tip, intoB, -headInset(head, length));
  }
  if (arrow === "both") {
    const tip = offset(sa, intoA, -TIP_GAP);
    heads.push(headPath(head, tip, intoA, length));
    start = offset(tip, intoA, -headInset(head, length));
  }
  const [path, labelX, labelY] = pathBetween(curve, sa, sb, start, end, ends.step);
  return { path, heads, labelX, labelY };
}

type EndSlot = { edge: string; end: 0 | 1; rect: Rect; outline: Outline; side: Position; other: Point };

/**
 * Where every link attaches. Curved and elbow links use side midpoints, but when several
 * links share a side their ends are spread out, ordered by where the other item is so the
 * lines don't cross. Straight links aim at each other's centres, so they never bunch up.
 */
export function computeLinkEnds(nodes: BoardNode[], edges: LinkEdge[]): Map<string, LinkEnds> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result = new Map<string, LinkEnds>();
  const slots = new Map<string, EndSlot[]>();
  const steps = new Map<string, number>();
  // Steering links around items costs a little time per link, so very big boards skip it.
  const avoid = nodes.length <= 600;
  let blockers: { id: string; r: Rect }[] | null = null;
  const obstacles = () =>
    (blockers ??= nodes.filter((n) => n.type !== "frame" && n.type !== "ink" && n.type !== "arrow" && !n.hidden).map((n) => ({ id: n.id, r: rectOf(n) })));

  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const ra = rectOf(a);
    const rb = rectOf(b);
    const oa = outlineOf(a.data.shape);
    const ob = outlineOf(b.data.shape);
    if (e.data?.curve === "straight") {
      result.set(e.id, [borderPoint(ra, center(rb), oa), borderPoint(rb, center(ra), ob)]);
      continue;
    }
    let [sa, sb] = pickSides(ra, rb);
    if (avoid) {
      const route = clearRoute(ra, rb, a.id, b.id, sa, sb, obstacles());
      if (route) {
        [sa, sb] = route.sides;
        if (route.step !== 0.5 && e.data?.curve === "elbow") steps.set(e.id, route.step);
      }
    }
    const add = (key: string, slot: EndSlot) => {
      const list = slots.get(key);
      if (list) list.push(slot);
      else slots.set(key, [slot]);
    };
    add(`${a.id}|${sa}`, { edge: e.id, end: 0, rect: ra, outline: oa, side: sa, other: center(rb) });
    add(`${b.id}|${sb}`, { edge: e.id, end: 1, rect: rb, outline: ob, side: sb, other: center(ra) });
  }

  for (const list of slots.values()) {
    const { rect, side, outline } = list[0];
    const horizontal = isHorizontal(side);
    list.sort((p, q) => (horizontal ? p.other.y - q.other.y : p.other.x - q.other.x) || (p.edge < q.edge ? -1 : 1));
    const length = horizontal ? rect.height : rect.width;
    const margin = Math.min(16, length / 4);
    const step = list.length > 1 ? Math.min(END_SPACING, (length - 2 * margin) / (list.length - 1)) : 0;
    list.forEach((slot, i) => {
      const along = (i - (list.length - 1) / 2) * step;
      const anchor = sidePoint(rect, side, along, outline);
      const ends = result.get(slot.edge) ?? ([anchor, anchor] as LinkEnds);
      ends[slot.end] = anchor;
      const bend = steps.get(slot.edge);
      if (bend !== undefined) ends.step = bend;
      result.set(slot.edge, ends);
    });
  }
  return result;
}

type Segment = [Point, Point];

/** Roughly the path a link takes between two sides, as straight segments. */
function roughRoute(a: Anchor, b: Anchor, step: number): Segment[] {
  const ha = isHorizontal(a.side);
  const hb = isHorizontal(b.side);
  if (a.side === b.side) {
    // Out of the same side of both: around the outside of whichever reaches further.
    const out = sideNormal(a.side);
    if (ha) {
      const x = out.x > 0 ? Math.max(a.x, b.x) + 18 : Math.min(a.x, b.x) - 18;
      return [[a, { x, y: a.y }], [{ x, y: a.y }, { x, y: b.y }], [{ x, y: b.y }, b]];
    }
    const y = out.y > 0 ? Math.max(a.y, b.y) + 18 : Math.min(a.y, b.y) - 18;
    return [[a, { x: a.x, y }], [{ x: a.x, y }, { x: b.x, y }], [{ x: b.x, y }, b]];
  }
  if (ha && hb) {
    const x = a.x + (b.x - a.x) * step;
    return [[a, { x, y: a.y }], [{ x, y: a.y }, { x, y: b.y }], [{ x, y: b.y }, b]];
  }
  if (!ha && !hb) {
    const y = a.y + (b.y - a.y) * step;
    return [[a, { x: a.x, y }], [{ x: a.x, y }, { x: b.x, y }], [{ x: b.x, y }, b]];
  }
  const corner = ha ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [[a, corner], [corner, b]];
}

/** Whether a straight, level or upright segment passes through a rect (with a little margin). */
function segmentHits([p, q]: Segment, r: Rect): boolean {
  const m = 4;
  const x1 = Math.min(p.x, q.x);
  const x2 = Math.max(p.x, q.x);
  const y1 = Math.min(p.y, q.y);
  const y2 = Math.max(p.y, q.y);
  return x2 > r.x + m && x1 < r.x + r.width - m && y2 > r.y + m && y1 < r.y + r.height - m;
}

const routeLength = (segments: Segment[]) => segments.reduce((sum, [p, q]) => sum + Math.abs(p.x - q.x) + Math.abs(p.y - q.y), 0);

/**
 * If the usual route between two items runs through other items, look for one that doesn't:
 * leaving from a different side, or bending nearer one end. Returns null to keep the usual.
 */
function clearRoute(
  ra: Rect,
  rb: Rect,
  aId: string,
  bId: string,
  sa: Position,
  sb: Position,
  others: { id: string; r: Rect }[],
): { sides: [Position, Position]; step: number } | null {
  const ca = center(ra);
  const cb = center(rb);
  // Only items near the two ends can be in the way.
  const box = {
    x: Math.min(ra.x, rb.x) - 60,
    y: Math.min(ra.y, rb.y) - 60,
    width: Math.max(ra.x + ra.width, rb.x + rb.width) - Math.min(ra.x, rb.x) + 120,
    height: Math.max(ra.y + ra.height, rb.y + rb.height) - Math.min(ra.y, rb.y) + 120,
  };
  const near = others.filter((o) => o.id !== aId && o.id !== bId && rectsTouch(o.r, box)).map((o) => o.r);
  if (!near.length) return null;
  const hits = (segments: Segment[]) => near.reduce((n, r) => n + (segments.some((seg) => segmentHits(seg, r)) ? 1 : 0), 0);
  const route = (x: Position, y: Position, step: number) => roughRoute(sidePoint(ra, x), sidePoint(rb, y), step);
  if (!hits(route(sa, sb, 0.5))) return null;

  const right = cb.x >= ca.x;
  const below = cb.y >= ca.y;
  const hA = right ? Position.Right : Position.Left;
  const hB = right ? Position.Left : Position.Right;
  const vA = below ? Position.Bottom : Position.Top;
  const vB = below ? Position.Top : Position.Bottom;
  const gapX = Math.max(rb.x - (ra.x + ra.width), ra.x - (rb.x + rb.width));
  const gapY = Math.max(rb.y - (ra.y + ra.height), ra.y - (rb.y + rb.height));
  const options: [Position, Position][] = [[sa, sb]];
  if (gapX > 10) options.push([hA, hB]);
  if (gapY > 10) options.push([vA, vB]);
  // L-shapes: out of one item's side and into the other's top or bottom (or the reverse).
  if (cb.x > ra.x + ra.width + 10 || cb.x < ra.x - 10) {
    if (ca.y < rb.y) options.push([hA, Position.Top]);
    else if (ca.y > rb.y + rb.height) options.push([hA, Position.Bottom]);
  }
  if (cb.y > ra.y + ra.height + 10 || cb.y < ra.y - 10) {
    if (ca.x < rb.x) options.push([vA, Position.Left]);
    else if (ca.x > rb.x + rb.width) options.push([vA, Position.Right]);
  }
  // Around the outside: out of the same side of both items, like a flowchart's "No" branch.
  if (gapY > 40) options.push([hA, hA], [hB, hB]);
  if (gapX > 40) options.push([vA, vA], [vB, vB]);
  let best: { sides: [Position, Position]; step: number; score: number } | null = null;
  for (const [x, y] of options) {
    const sameAxis = isHorizontal(x) === isHorizontal(y) && x !== y;
    for (const step of sameAxis ? [0.5, 0.2, 0.8] : [0.5]) {
      const segments = route(x, y, step);
      const usual = x === sa && y === sb && step === 0.5;
      const score = hits(segments) * 10000 + routeLength(segments) + (usual ? 0 : x === y ? 90 : 40);
      if (!best || score < best.score) best = { sides: [x, y], step, score };
    }
  }
  return best && (best.sides[0] !== sa || best.sides[1] !== sb || best.step !== 0.5) ? best : null;
}

const rectsTouch = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const sameAnchor = (p: Anchor, q: Anchor) => p.x === q.x && p.y === q.y && p.side === q.side;

let memo: { nodes: BoardNode[]; edges: LinkEdge[]; ends: Map<string, LinkEnds> } | null = null;

/**
 * Link ends for the current board, recomputed only when items or links change. Ends that
 * didn't move keep the same object, so their links skip re-rendering.
 */
export function linkEnds(nodes: BoardNode[], edges: LinkEdge[]): Map<string, LinkEnds> {
  if (memo && memo.nodes === nodes && memo.edges === edges) return memo.ends;
  const next = computeLinkEnds(nodes, edges);
  if (memo) {
    for (const [id, ends] of next) {
      const prev = memo.ends.get(id);
      if (prev && sameAnchor(prev[0], ends[0]) && sameAnchor(prev[1], ends[1]) && prev.step === ends.step) next.set(id, prev);
    }
  }
  memo = { nodes, edges, ends: next };
  return next;
}

/** The line drawn while dragging out a new link from `from` towards the pointer. */
export function previewGeometry(from: Rect, pointer: Point, to: Rect | null): string {
  if (to) {
    const [sa, sb] = pickSides(from, to);
    const a = sidePoint(from, sa);
    const b = sidePoint(to, sb);
    return linkGeometry([a, b], "curved", "none").path;
  }
  const side = sideFacing(from, pointer);
  const anchor = sidePoint(from, side);
  const opposite = {
    [Position.Left]: Position.Right,
    [Position.Right]: Position.Left,
    [Position.Top]: Position.Bottom,
    [Position.Bottom]: Position.Top,
  }[side];
  return pathBetween("curved", anchor, { ...pointer, side: opposite }, anchor, pointer)[0];
}
