import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Rect } from "../geometry";
import { rectOf } from "../layout";
import { isTauri } from "../persistence";
import { boardStore } from "../store";
import { BackIcon } from "./icons";

type Slide = { id: string | null; title: string };

/**
 * Sections in reading order: rows from top to bottom (sections whose tops are roughly
 * level count as one row), each row left to right.
 */
export function slideOrder(frames: (Rect & { id: string })[]): string[] {
  const sorted = [...frames].sort((a, b) => a.y - b.y);
  const rows: (Rect & { id: string })[][] = [];
  for (const f of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(f.y - row[0].y) < Math.min(f.height, row[0].height) / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x).map((f) => f.id));
}

const LASER_LIFE_MS = 700;
type LaserPoint = { x: number; y: number; t: number };

/** Full-screen slideshow of the board's sections, with a laser pointer. */
export function Presentation({ onExit }: { onExit: () => void }) {
  const rf = useReactFlow();
  const slides = useMemo<Slide[]>(() => {
    const frames = boardStore.getState().nodes.filter((n) => n.type === "frame");
    if (!frames.length) return [{ id: null, title: boardStore.getState().title }];
    const byId = new Map(frames.map((f) => [f.id, f]));
    return slideOrder(frames.map((f) => ({ id: f.id, ...rectOf(f) }))).map((id) => ({ id, title: byId.get(id)!.data.text || "Untitled section" }));
  }, []);
  const [index, setIndex] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [laser, setLaser] = useState<LaserPoint[]>([]);
  const trail = useRef<LaserPoint[]>([]);
  const drawing = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (i: number, duration = 450) => {
      const slide = slides[i];
      if (!slide) return;
      if (slide.id) void rf.fitView({ nodes: [{ id: slide.id }], padding: 0.06, duration });
      else void rf.fitView({ padding: 0.12, duration });
    },
    [rf, slides],
  );

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i))), [slides.length]);

  useEffect(() => show(index), [index, show]);

  // Go full screen in the desktop app, and put the window back afterwards.
  useEffect(() => {
    if (!isTauri()) return;
    let wasFull = false;
    let live = true;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      wasFull = await win.isFullscreen().catch(() => false);
      if (live && !wasFull) await win.setFullscreen(true).catch(() => {});
    });
    return () => {
      live = false;
      if (!wasFull)
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(false).catch(() => {}));
    };
  }, []);

  // Keep the slide framed when the window changes size (e.g. entering full screen).
  useEffect(() => {
    const onResize = () => show(index, 0);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [index, show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While presenting, these keys belong to the slideshow, not the board.
      e.stopPropagation();
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) (e.preventDefault(), go(index + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) (e.preventDefault(), go(index - 1));
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(slides.length - 1);
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, index, onExit, slides.length]);

  // The controls fade away when the mouse is still.
  const wake = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 2500);
  };
  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Fade the laser trail out.
  useEffect(() => {
    if (!laser.length) return;
    const frame = requestAnimationFrame(() => {
      const now = performance.now();
      trail.current = trail.current.filter((p) => now - p.t < LASER_LIFE_MS);
      setLaser([...trail.current]);
    });
    return () => cancelAnimationFrame(frame);
  }, [laser]);

  const addLaser = (e: React.PointerEvent) => {
    trail.current.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    setLaser([...trail.current]);
  };

  const now = performance.now();
  return (
    <div
      className={`presentation${chrome ? "" : " is-idle"}`}
      onPointerMove={(e) => {
        wake();
        if (drawing.current) addLaser(e);
      }}
      onPointerDown={(e) => {
        drawing.current = true;
        (e.target as Element).setPointerCapture(e.pointerId);
        addLaser(e);
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
    >
      <svg className="laser" aria-hidden>
        {laser.slice(1).map((p, i) => {
          const prev = laser[i];
          const life = 1 - (now - p.t) / LASER_LIFE_MS;
          return <line key={p.t + i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} style={{ opacity: Math.max(0, life), strokeWidth: 2 + 4 * life }} />;
        })}
      </svg>
      <div className="presentation__bar" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="presentation__btn" aria-label="Previous slide" disabled={index === 0} onClick={() => go(index - 1)}>
          <BackIcon />
        </button>
        <span className="presentation__title">{slides[index]?.title}</span>
        <span className="presentation__count">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          className="presentation__btn presentation__btn--next"
          aria-label="Next slide"
          disabled={index === slides.length - 1}
          onClick={() => go(index + 1)}
        >
          <BackIcon />
        </button>
        <span className="bar-divider" />
        <button type="button" className="presentation__btn" aria-label="Stop presenting" onClick={onExit}>
          ×
        </button>
      </div>
    </div>
  );
}
