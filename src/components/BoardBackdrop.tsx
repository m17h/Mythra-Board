import { Background, BackgroundVariant, useStore } from "@xyflow/react";
import { memo } from "react";
import type { BoardBackground } from "../types";

/** Ruled lines, like a notebook page, that move and scale with the board. */
function RuledLines() {
  const [x, y, zoom] = useStore((s) => s.transform);
  const gap = 32 * zoom;
  return (
    <svg className="react-flow__background board-bg board-ruled" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <pattern id="mb-ruled" x={x % gap} y={y % gap} width={gap} height={gap} patternUnits="userSpaceOnUse">
        <line x1="0" y1={gap - 0.5} x2={gap} y2={gap - 0.5} />
      </pattern>
      <rect width="100%" height="100%" fill="url(#mb-ruled)" />
    </svg>
  );
}

/** The board's pattern: dots, a grid, ruled lines, crosses, or nothing. */
function BoardBackdrop({ pattern }: { pattern: BoardBackground }) {
  switch (pattern) {
    case "plain":
      return null;
    case "lines":
      return <RuledLines />;
    case "grid":
      return <Background variant={BackgroundVariant.Lines} gap={32} size={1} className="board-bg" />;
    case "cross":
      return <Background variant={BackgroundVariant.Cross} gap={32} size={7} className="board-bg" />;
    default:
      return <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} className="board-bg" />;
  }
}

export default memo(BoardBackdrop);
