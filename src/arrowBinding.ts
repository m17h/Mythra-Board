import { borderPoint, center, offset, outlineOf, unit, type Point } from "./geometry";
import { rectOf } from "./layout";
import type { BoardNode } from "./types";

/** Space between a stuck arrow end and the item it points at. */
const GAP = 6;
/** Room around a free arrow so its ends and arrowheads aren't clipped. */
const ARROW_PAD = 16;

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

/** A free arrow's two ends in board coordinates. */
export function arrowEnds(n: BoardNode): [Point, Point] {
  const [x1, y1, x2, y2] = n.data.ends ?? [0, 0, 0, 0];
  return [
    { x: n.position.x + x1, y: n.position.y + y1 },
    { x: n.position.x + x2, y: n.position.y + y2 },
  ];
}

/**
 * Where a stuck arrow's ends belong now: each stuck end sits just outside its item's
 * outline, facing the other end. Null if neither end is stuck to an item that still exists.
 */
export function stuckEnds(arrow: BoardNode, byId: Map<string, BoardNode>): [Point, Point] | null {
  const from = arrow.data.startId ? byId.get(arrow.data.startId) : undefined;
  const to = arrow.data.endId ? byId.get(arrow.data.endId) : undefined;
  if (!from && !to) return null;
  let [a, b] = arrowEnds(arrow);
  // Aim at the other item's centre if it is stuck too, otherwise at the loose end.
  const aimA = to ? center(rectOf(to)) : b;
  const aimB = from ? center(rectOf(from)) : a;
  const attach = (item: BoardNode, aim: Point) => {
    const r = rectOf(item);
    const edge = borderPoint(r, aim, outlineOf(item.data.shape));
    return offset(edge, unit(center(r), aim), GAP);
  };
  if (from) a = attach(from, aimA);
  if (to) b = attach(to, aimB);
  return [a, b];
}

const close = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) < 0.5);

/**
 * Bring stuck arrows up to date after items moved or resized. Only arrows stuck to one of
 * `changed` are updated, and an arrow that is itself moving is left alone.
 */
export function followItems(nodes: BoardNode[], changed: ReadonlySet<string>): BoardNode[] {
  if (!changed.size) return nodes;
  let byId: Map<string, BoardNode> | null = null;
  let out: BoardNode[] | null = null;
  nodes.forEach((n, i) => {
    if (n.type !== "arrow" || changed.has(n.id)) return;
    const { startId, endId } = n.data;
    if (!(startId && changed.has(startId)) && !(endId && changed.has(endId))) return;
    byId ??= new Map(nodes.map((x) => [x.id, x]));
    const ends = stuckEnds(n, byId);
    if (!ends) return;
    const box = arrowBox(ends[0], ends[1]);
    if (close([n.position.x, n.position.y, ...(n.data.ends ?? [])], [box.position.x, box.position.y, ...box.ends])) return;
    out ??= nodes.slice();
    out[i] = { ...n, position: box.position, width: box.width, height: box.height, data: { ...n.data, ends: box.ends } };
  });
  return out ?? nodes;
}

/** Arrows that moved on their own (without the items they were stuck to) come unstuck. */
export function unstickMoved(nodes: BoardNode[], moved: ReadonlySet<string>): BoardNode[] {
  let out: BoardNode[] | null = null;
  nodes.forEach((n, i) => {
    if (n.type !== "arrow" || !moved.has(n.id)) return;
    const { startId, endId } = n.data;
    const keepStart = startId && moved.has(startId);
    const keepEnd = endId && moved.has(endId);
    if ((!startId || keepStart) && (!endId || keepEnd)) return;
    const data = { ...n.data };
    if (!keepStart) delete data.startId;
    if (!keepEnd) delete data.endId;
    out ??= nodes.slice();
    out[i] = { ...n, data };
  });
  return out ?? nodes;
}
