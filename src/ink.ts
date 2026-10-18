import { getStroke } from "perfect-freehand";
import type { Size } from "./types";

export const PEN_WIDTH: Record<Size, number> = { s: 3.5, m: 6, l: 11 };

/** Turn flat [x, y, pressure, …] points into a filled, smooth SVG outline. */
export function strokePath(points: number[], size: Size, last = true): string {
  const input: [number, number, number][] = [];
  for (let i = 0; i + 2 < points.length; i += 3) input.push([points[i], points[i + 1], points[i + 2]]);
  const outline = getStroke(input, {
    size: PEN_WIDTH[size],
    thinning: 0.5,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: true,
    last,
  });
  if (!outline.length) return "";
  let d = `M ${outline[0][0].toFixed(1)} ${outline[0][1].toFixed(1)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` ${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
  }
  return d + " Z";
}
