import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from "@xyflow/react";
import {
  arrowHead,
  borderPoint,
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
import type { BoardNode, LinkArrow, LinkCurve, LinkEdge } from "./types";

/** Space between an arrow tip and the item it points at. */
const TIP_GAP = 3;
const ARROW_LENGTH = 11;
/** Preferred distance between link ends that share a side. */
const END_SPACING = 22;

export type LinkGeometry = { path: string; heads: string[]; labelX: number; labelY: number };
export type LinkEnds = [Anchor, Anchor];

const flip = (p: Point): Point => ({ x: -p.x, y: -p.y });

function pathBetween(curve: LinkCurve, from: Anchor, to: Anchor, fromPoint: Point, toPoint: Point): [string, number, number] {
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
    const [path, x, y] = getSmoothStepPath({ ...args, borderRadius: 10, offset: 18 });
    return [path, x, y];
  }
  const [path, x, y] = getBezierPath({ ...args, curvature: 0.3 });
  return [path, x, y];
}

/** The drawn path, arrowheads and label position for a link between two anchors. */
export function linkGeometry([sa, sb]: LinkEnds, curve: LinkCurve, arrow: LinkArrow): LinkGeometry {
  // Direction each arrow points: into the item it touches.
  const intoB = curve === "straight" ? unit(sa, sb) : flip(sideNormal(sb.side));
  const intoA = curve === "straight" ? unit(sb, sa) : flip(sideNormal(sa.side));

  const heads: string[] = [];
  let start: Point = sa;
  let end: Point = sb;
  if (arrow !== "none") {
    const tip = offset(sb, intoB, -TIP_GAP);
    heads.push(arrowHead(tip, intoB, ARROW_LENGTH));
    end = offset(tip, intoB, -(ARROW_LENGTH - 2));
  }
  if (arrow === "both") {
    const tip = offset(sa, intoA, -TIP_GAP);
    heads.push(arrowHead(tip, intoA, ARROW_LENGTH));
    start = offset(tip, intoA, -(ARROW_LENGTH - 2));
  }
  const [path, labelX, labelY] = pathBetween(curve, sa, sb, start, end);
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
    const [sa, sb] = pickSides(ra, rb);
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
      result.set(slot.edge, ends);
    });
  }
  return result;
}

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
      if (prev && sameAnchor(prev[0], ends[0]) && sameAnchor(prev[1], ends[1])) next.set(id, prev);
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
