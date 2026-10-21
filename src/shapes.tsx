import type { CSSProperties } from "react";
import type { ShapeKind } from "./types";

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: "Box",
  ellipse: "Circle",
  diamond: "Diamond",
  triangle: "Triangle",
  hexagon: "Hexagon",
  star: "Star",
  cylinder: "Cylinder",
  arrow: "Arrow",
};

function starPath(points = 5, inner = 0.45): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner * 50 : 50;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(52 + r * Math.sin(a) * 1.04).toFixed(2)}`);
  }
  return `M${out.join(" L")} Z`;
}

/**
 * Outlines drawn as SVG in a 100×100 box that stretches to the shape's size. Boxes and
 * circles are plain CSS borders instead, so their corners stay crisp at any size.
 */
export const SHAPE_PATHS: Partial<Record<ShapeKind, string>> = {
  diamond: "M50 0 L100 50 L50 100 L0 50 Z",
  triangle: "M50 0 L100 100 L0 100 Z",
  hexagon: "M24 0 L76 0 L100 50 L76 100 L24 100 L0 50 Z",
  star: starPath(),
  cylinder: "M0 12 A50 12 0 0 1 100 12 L100 88 A50 12 0 0 1 0 88 Z",
  arrow: "M0 26 L64 26 L64 0 L100 50 L64 100 L64 74 L0 74 Z",
};

/** Extra lines drawn on top of a shape's fill (the cylinder's front rim). */
export const SHAPE_DETAILS: Partial<Record<ShapeKind, string>> = {
  cylinder: "M0 12 A50 12 0 0 0 100 12",
};

/** Padding (as % of the shape) that keeps a label inside the outline. */
export const LABEL_INSETS: Partial<Record<ShapeKind, CSSProperties>> = {
  diamond: { padding: "8% 22%" },
  triangle: { padding: "42% 24% 6%" },
  hexagon: { padding: "6% 18%" },
  star: { padding: "30% 28% 20%" },
  cylinder: { padding: "26% 10% 10%" },
  arrow: { padding: "24% 34% 24% 6%" },
};

/** A small drawing of a shape kind, for toolbars and menus. */
export function ShapeGlyph({ kind }: { kind: ShapeKind }) {
  const common = {
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "rect")
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      </svg>
    );
  if (kind === "ellipse")
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
      </svg>
    );
  return (
    <svg viewBox="-12 -12 124 124" {...common}>
      <path d={SHAPE_PATHS[kind]} vectorEffect="non-scaling-stroke" />
      {SHAPE_DETAILS[kind] && <path d={SHAPE_DETAILS[kind]} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
