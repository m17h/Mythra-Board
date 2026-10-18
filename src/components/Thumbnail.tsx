import { memo } from "react";
import { center, rectsBounds } from "../geometry";
import { rectOf } from "../layout";
import type { BoardNode, LinkEdge } from "../types";

const PAD = 40;

/** A lightweight drawing of a board's layout for the board picker. */
function Thumbnail({ nodes, edges }: { nodes: BoardNode[]; edges: LinkEdge[] }) {
  const rects = new Map(nodes.map((n) => [n.id, rectOf(n)]));
  const bounds = rectsBounds([...rects.values()]);
  if (!bounds) return <div className="thumb thumb--empty" />;
  // Keep small boards from being blown up to fill the card.
  const minW = 900;
  const minH = 560;
  const w = Math.max(bounds.width + PAD * 2, minW);
  const h = Math.max(bounds.height + PAD * 2, minH);
  const x = bounds.x + bounds.width / 2 - w / 2;
  const y = bounds.y + bounds.height / 2 - h / 2;
  return (
    <svg className="thumb" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {edges.map((e) => {
        const a = rects.get(e.source);
        const b = rects.get(e.target);
        if (!a || !b) return null;
        const p = center(a);
        const q = center(b);
        return <line key={e.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="thumb__link" />;
      })}
      {nodes.map((n) => {
        const r = rects.get(n.id)!;
        const c = `color--${n.data.color}`;
        switch (n.type) {
          case "frame":
            return <rect key={n.id} {...r} rx={14} className={`thumb__frame ${c}`} />;
          case "image":
            return <rect key={n.id} {...r} rx={6} className="thumb__image" />;
          case "text":
            return <rect key={n.id} x={r.x} y={r.y + r.height * 0.3} width={r.width * 0.7} height={r.height * 0.4} rx={6} className="thumb__text" />;
          case "ink": {
            const pts = n.data.points ?? [];
            let d = "";
            for (let i = 0; i + 2 < pts.length; i += 3) d += `${i ? "L" : "M"}${r.x + pts[i]} ${r.y + pts[i + 1]}`;
            return <path key={n.id} d={d} className={`thumb__ink ${c}`} />;
          }
          case "shape":
            if (n.data.shape === "ellipse")
              return <ellipse key={n.id} cx={r.x + r.width / 2} cy={r.y + r.height / 2} rx={r.width / 2} ry={r.height / 2} className={`thumb__shape ${c}`} />;
            if (n.data.shape === "diamond") {
              const { x: cx, y: cy } = center(r);
              return (
                <polygon
                  key={n.id}
                  points={`${cx},${r.y} ${r.x + r.width},${cy} ${cx},${r.y + r.height} ${r.x},${cy}`}
                  className={`thumb__shape ${c}`}
                />
              );
            }
            return <rect key={n.id} {...r} rx={12} className={`thumb__shape ${c}`} />;
          default:
            return <rect key={n.id} {...r} rx={12} className={`thumb__note ${c}`} />;
        }
      })}
    </svg>
  );
}

export default memo(Thumbnail);
