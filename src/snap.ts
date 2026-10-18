import type { Rect } from "./geometry";

/** A guide line drawn while dragging: vertical (`x`) or horizontal (`y`), in board coordinates. */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const edgesX = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const edgesY = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];

/** The smallest shift (within `threshold`) that lines one of `mine` up with one of `theirs`. */
function bestShift(mine: number[], others: number[][], threshold: number): number {
  let best = 0;
  let found = false;
  for (const theirs of others) {
    for (const t of theirs) {
      for (const m of mine) {
        const d = t - m;
        if (Math.abs(d) <= threshold && (!found || Math.abs(d) < Math.abs(best))) {
          best = d;
          found = true;
        }
      }
    }
  }
  return best;
}

/** Add a guide, or stretch an existing one at the same spot to cover the new span. */
function addGuide(guides: Guide[], axis: "x" | "y", at: number, from: number, to: number) {
  const g = guides.find((x) => x.axis === axis && Math.abs(x.at - at) < 0.5);
  if (g) {
    g.from = Math.min(g.from, from);
    g.to = Math.max(g.to, to);
  } else {
    guides.push({ axis, at, from, to });
  }
}

/**
 * Snap a moving rect so its left/centre/right and top/middle/bottom line up with nearby
 * items, and return the guide lines to show for every alignment that results.
 */
export function snapMove(moving: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const dx = bestShift(edgesX(moving), others.map(edgesX), threshold);
  const dy = bestShift(edgesY(moving), others.map(edgesY), threshold);
  const m = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  for (const o of others) {
    for (const a of edgesX(m)) {
      if (edgesX(o).some((b) => Math.abs(a - b) < 0.5)) {
        addGuide(guides, "x", a, Math.min(m.y, o.y), Math.max(m.y + m.height, o.y + o.height));
      }
    }
    for (const a of edgesY(m)) {
      if (edgesY(o).some((b) => Math.abs(a - b) < 0.5)) {
        addGuide(guides, "y", a, Math.min(m.x, o.x), Math.max(m.x + m.width, o.x + o.width));
      }
    }
  }
  return { dx, dy, guides };
}
