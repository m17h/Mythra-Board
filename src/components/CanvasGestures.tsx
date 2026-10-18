import { useReactFlow, ViewportPortal } from "@xyflow/react";
import { useEffect, useState, type RefObject } from "react";
import { distanceToSegment, type Point, type Rect } from "../geometry";
import { PEN_WIDTH, strokePath } from "../ink";
import { defaultSize } from "../layout";
import { boardStore, useBoard } from "../store";
import type { Color, ShapeKind, Size } from "../types";

type Preview =
  | { kind: "ink"; points: number[]; color: Color; size: Size }
  | { kind: "box"; rect: Rect; frame: boolean; shape: ShapeKind };

const CLICK_DISTANCE = 5;
const ERASER_RADIUS = 10;

const boxFrom = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** Ink strokes under the pointer (within `radius` of the stroke's centre line). */
function inkAt(p: Point, radius: number): string[] {
  const hits: string[] = [];
  for (const n of boardStore.getState().nodes) {
    const pts = n.type === "ink" ? n.data.points : null;
    if (!pts) continue;
    const ox = n.position.x;
    const oy = n.position.y;
    const w = n.width ?? 0;
    const h = n.height ?? 0;
    const reach = radius + PEN_WIDTH[n.data.size] / 2;
    if (p.x < ox - reach || p.y < oy - reach || p.x > ox + w + reach || p.y > oy + h + reach) continue;
    for (let i = 0; i + 5 < pts.length || i === 0; i += 3) {
      const a = { x: ox + pts[i], y: oy + pts[i + 1] };
      const b = i + 5 < pts.length ? { x: ox + pts[i + 3], y: oy + pts[i + 4] } : a;
      if (distanceToSegment(p, a, b) <= reach) {
        hits.push(n.id);
        break;
      }
    }
  }
  return hits;
}

/**
 * Pointer gestures on empty canvas for the drawing tools: pen strokes, the eraser,
 * and drag-to-size (or click-to-place) for shapes and sections.
 */
export function CanvasGestures({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const rf = useReactFlow();
  const tool = useBoard((s) => s.tool);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const root = container.current;
    if (!root || !["pen", "eraser", "shape", "frame"].includes(tool)) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target as Element).classList?.contains("react-flow__pane")) return;
      e.preventDefault();
      e.stopPropagation();
      const pane = e.target as HTMLElement;
      pane.setPointerCapture(e.pointerId);
      const store = boardStore.getState();
      const start = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const startScreen = { x: e.clientX, y: e.clientY };
      const points: number[] = [start.x, start.y, e.pressure || 0.5];
      let current = start;

      if (tool === "eraser") {
        store.begin();
        store.eraseNodes(inkAt(start, ERASER_RADIUS / rf.getZoom()));
      } else if (tool === "pen") {
        setPreview({ kind: "ink", points, color: store.penColor, size: store.penSize });
      }

      const onMove = (ev: PointerEvent) => {
        const events = ev.getCoalescedEvents?.().length ? ev.getCoalescedEvents() : [ev];
        for (const ce of events) {
          current = rf.screenToFlowPosition({ x: ce.clientX, y: ce.clientY });
          if (tool === "pen") points.push(current.x, current.y, ce.pressure || 0.5);
          if (tool === "eraser") {
            const hits = inkAt(current, ERASER_RADIUS / rf.getZoom());
            if (hits.length) boardStore.getState().eraseNodes(hits);
          }
        }
        if (tool === "pen") setPreview({ kind: "ink", points: points.slice(), color: store.penColor, size: store.penSize });
        if (tool === "shape" || tool === "frame") {
          setPreview({ kind: "box", rect: boxFrom(start, current), frame: tool === "frame", shape: store.shapeKind });
        }
      };

      const onUp = (ev: PointerEvent) => {
        pane.removeEventListener("pointermove", onMove);
        pane.removeEventListener("pointerup", onUp);
        pane.removeEventListener("pointercancel", onUp);
        setPreview(null);
        const s = boardStore.getState();
        if (tool === "eraser") return s.commit();
        if (tool === "pen") {
          s.addInk(points, s.penColor, s.penSize);
          return;
        }
        // Shapes and sections: a click places the default size, a drag sets the size.
        const clicked = Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < CLICK_DISTANCE;
        const type = tool === "frame" ? "frame" : "shape";
        const shape = s.shapeKind;
        const size = defaultSize(type, shape);
        const rect = clicked
          ? { x: start.x - size.width / 2, y: start.y - size.height / 2, ...size }
          : boxFrom(start, current);
        const id = s.addItem(type, { x: rect.x, y: rect.y }, {
          width: Math.max(rect.width, 40),
          height: Math.max(rect.height, 30),
          data: type === "shape" ? { shape } : { text: "Section" },
        });
        s.setTool("select");
        s.startEditing(id);
      };

      pane.addEventListener("pointermove", onMove);
      pane.addEventListener("pointerup", onUp);
      pane.addEventListener("pointercancel", onUp);
    };

    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [container, rf, tool]);

  if (!preview) return null;
  return (
    <ViewportPortal>
      {preview.kind === "ink" ? (
        <svg className={`ink ink--live color--${preview.color}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={strokePath(preview.points, preview.size, false)} />
        </svg>
      ) : (
        <div
          className={`draw-box${preview.frame ? " draw-box--frame" : ` draw-box--${preview.shape}`}`}
          style={{
            position: "absolute",
            transform: `translate(${preview.rect.x}px, ${preview.rect.y}px)`,
            width: preview.rect.width,
            height: preview.rect.height,
          }}
        />
      )}
    </ViewportPortal>
  );
}
