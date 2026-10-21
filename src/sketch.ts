import type { Point } from "./geometry";

/** A small, repeatable random number generator, so a line wobbles the same way every time. */
function seeded(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Points along an SVG path made of M, L, Q and C commands (absolute), about `step` apart. */
export function samplePath(d: string, step = 10): Point[] {
  const tokens = d.match(/[MLQC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pts: Point[] = [];
  let i = 0;
  let cur: Point = { x: 0, y: 0 };
  const num = () => parseFloat(tokens[i++]);
  const pt = () => ({ x: num(), y: num() });
  const add = (fn: (t: number) => Point, approxLength: number) => {
    const n = Math.max(1, Math.ceil(approxLength / step));
    for (let k = 1; k <= n; k++) pts.push(fn(k / n));
  };
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let cmd = "M";
  while (i < tokens.length) {
    if (/[MLQC]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") {
      cur = pt();
      pts.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      const a = cur;
      const b = pt();
      add((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), dist(a, b));
      cur = b;
    } else if (cmd === "Q") {
      const a = cur;
      const c = pt();
      const b = pt();
      add((t) => {
        const u = 1 - t;
        return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
      }, dist(a, c) + dist(c, b));
      cur = b;
    } else if (cmd === "C") {
      const a = cur;
      const c1 = pt();
      const c2 = pt();
      const b = pt();
      add((t) => {
        const u = 1 - t;
        return {
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        };
      }, dist(a, c1) + dist(c1, c2) + dist(c2, b));
      cur = b;
    } else {
      i++;
    }
  }
  return pts;
}

/**
 * A hand-drawn version of a path: drawn twice, each pass wobbling gently and slightly
 * differently, like a pen going over a line. The same `seed` always gives the same wobble.
 */
export function roughPath(d: string, seed: string, amount = 1.4): string {
  const pts = samplePath(d, 12);
  if (pts.length < 2) return d;
  const rand = seeded(seed);
  const pass = () => {
    // Slow, smooth wobble: a couple of sine waves with random phase, plus slightly loose ends.
    const p1 = rand() * Math.PI * 2;
    const p2 = rand() * Math.PI * 2;
    const out = pts.map((p, k) => {
      const prev = pts[Math.max(0, k - 1)];
      const next = pts[Math.min(pts.length - 1, k + 1)];
      const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      const nx = -(next.y - prev.y) / len;
      const ny = (next.x - prev.x) / len;
      const w = amount * (Math.sin(k * 0.45 + p1) * 0.7 + Math.sin(k * 1.3 + p2) * 0.3);
      return { x: p.x + nx * w, y: p.y + ny * w };
    });
    let s = `M ${out[0].x.toFixed(1)} ${out[0].y.toFixed(1)}`;
    for (let k = 1; k < out.length - 1; k++) {
      const mid = { x: (out[k].x + out[k + 1].x) / 2, y: (out[k].y + out[k + 1].y) / 2 };
      s += ` Q ${out[k].x.toFixed(1)} ${out[k].y.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)}`;
    }
    const last = out[out.length - 1];
    return s + ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  };
  return `${pass()} ${pass()}`;
}
