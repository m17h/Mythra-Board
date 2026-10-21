import { center, type Point } from "./geometry";
import { rectOf } from "./layout";
import { LINKABLE, type BoardNode, type LinkEdge } from "./types";

const GAP_X = 80;
const GAP_Y = 22;

/** Each item's outgoing links (the "children" in a mind map), in board order. */
export function childrenOf(nodes: BoardNode[], edges: LinkEdge[]): Map<string, string[]> {
  const ids = new Set(nodes.filter((n) => LINKABLE.has(n.type)).map((n) => n.id));
  const map = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const list = map.get(e.source);
    if (list) list.push(e.target);
    else map.set(e.source, [e.target]);
  }
  return map;
}

/** Everything reachable by following links out of `id` (not including `id`). */
export function descendants(id: string, children: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === id || out.has(next)) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

/** Items hidden because a branch above them is folded. */
export function hiddenItems(nodes: BoardNode[], edges: LinkEdge[]): Set<string> {
  const folded = nodes.filter((n) => n.data.collapsed);
  if (!folded.length) return new Set();
  const children = childrenOf(nodes, edges);
  const hidden = new Set<string>();
  for (const f of folded) for (const d of descendants(f.id, children)) hidden.add(d);
  return hidden;
}

/**
 * New positions that arrange the branches growing out of `rootId` into a neat tree. The root
 * stays put; branches on its left stay on the left. Folded branches move as a block.
 */
export function tidyTree(rootId: string, nodes: BoardNode[], edges: LinkEdge[]): Map<string, Point> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  const moves = new Map<string, Point>();
  if (!root) return moves;
  const allChildren = childrenOf(nodes, edges);

  // Give every reachable item a single parent (the first path that finds it).
  const tree = new Map<string, string[]>();
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (byId.get(id)?.data.collapsed && id !== rootId) continue;
    const kids: string[] = [];
    for (const c of allChildren.get(id) ?? []) {
      if (seen.has(c) || !byId.has(c)) continue;
      seen.add(c);
      kids.push(c);
      queue.push(c);
    }
    // Keep the current top-to-bottom order of siblings.
    kids.sort((a, b) => byId.get(a)!.position.y - byId.get(b)!.position.y);
    tree.set(id, kids);
  }

  const rect = (id: string) => rectOf(byId.get(id)!);
  const heights = new Map<string, number>();
  const blockHeight = (id: string): number => {
    const own = rect(id).height;
    const kids = tree.get(id) ?? [];
    const kidsHeight = kids.reduce((sum, k) => sum + blockHeight(k), 0) + GAP_Y * Math.max(0, kids.length - 1);
    const h = Math.max(own, kidsHeight);
    heights.set(id, h);
    return h;
  };

  const rootRect = rect(rootId);
  const rootMid = center(rootRect);
  const rootKids = tree.get(rootId) ?? [];
  const sides: Record<"left" | "right", string[]> = { left: [], right: [] };
  for (const k of rootKids) sides[center(rect(k)).x < rootMid.x ? "left" : "right"].push(k);

  // Column widths per depth and side, so each column lines up.
  const columns = { left: [] as number[], right: [] as number[] };
  const measure = (id: string, depth: number, side: "left" | "right") => {
    columns[side][depth] = Math.max(columns[side][depth] ?? 0, rect(id).width);
    for (const k of tree.get(id) ?? []) measure(k, depth + 1, side);
  };
  for (const side of ["left", "right"] as const) for (const k of sides[side]) measure(k, 0, side);
  const columnX = (side: "left" | "right", depth: number, width: number) => {
    let x = side === "right" ? rootRect.x + rootRect.width + GAP_X : rootRect.x - GAP_X;
    for (let d = 0; d < depth; d++) x += side === "right" ? columns.right[d] + GAP_X : -(columns.left[d] + GAP_X);
    return side === "right" ? x : x - width;
  };

  const place = (id: string, top: number, depth: number, side: "left" | "right") => {
    const r = rect(id);
    const block = heights.get(id)!;
    moves.set(id, { x: columnX(side, depth, r.width), y: top + (block - r.height) / 2 });
    const kids = tree.get(id) ?? [];
    const kidsHeight = kids.reduce((sum, k) => sum + heights.get(k)!, 0) + GAP_Y * Math.max(0, kids.length - 1);
    let y = top + (block - kidsHeight) / 2;
    for (const k of kids) {
      place(k, y, depth + 1, side);
      y += heights.get(k)! + GAP_Y;
    }
  };

  for (const side of ["left", "right"] as const) {
    const kids = sides[side];
    if (!kids.length) continue;
    const total = kids.reduce((sum, k) => sum + blockHeight(k), 0) + GAP_Y * (kids.length - 1);
    let y = rootMid.y - total / 2;
    for (const k of kids) {
      place(k, y, 0, side);
      y += heights.get(k)! + GAP_Y;
    }
  }

  // Folded branches keep their shape and travel with the item they're folded under.
  for (const n of nodes) {
    if (!n.data.collapsed || n.id === rootId) continue;
    const to = moves.get(n.id);
    if (!to) continue;
    const dx = to.x - n.position.x;
    const dy = to.y - n.position.y;
    for (const d of descendants(n.id, allChildren)) {
      if (moves.has(d) || d === rootId) continue;
      const dn = byId.get(d);
      if (dn) moves.set(d, { x: dn.position.x + dx, y: dn.position.y + dy });
    }
  }
  return moves;
}

/** Items that start a tree: they link out, but nothing links into them. */
export function treeRoots(nodes: BoardNode[], edges: LinkEdge[]): string[] {
  const children = childrenOf(nodes, edges);
  const targets = new Set(edges.map((e) => e.target));
  return [...children.keys()].filter((id) => !targets.has(id));
}
