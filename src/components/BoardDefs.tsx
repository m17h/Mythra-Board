import { ViewportPortal } from "@xyflow/react";
import { memo } from "react";
import { COLORS } from "../types";

/**
 * Shared SVG effects for the board: the "roughen" filters behind the hand-drawn style and
 * the cross-hatch patterns for hatched fills. They live inside the board's viewport so
 * exported pictures include them too.
 */
function BoardDefs() {
  return (
    <ViewportPortal>
      <svg className="board-defs" width="0" height="0" aria-hidden>
        <defs>
          {/* For boxes: wobble each edge a little, sized to the item. */}
          <filter id="mb-rough" x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {COLORS.map((c) => (
            <pattern key={c} id={`mb-hatch-${c}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" style={{ fill: `color-mix(in srgb, var(--note-${c}) 55%, transparent)` }} />
              <line x1="0" y1="0" x2="0" y2="8" style={{ stroke: c === "plain" ? "color-mix(in srgb, var(--text) 30%, transparent)" : `var(--ink-${c})`, strokeWidth: 1.6, strokeOpacity: 0.55 }} />
            </pattern>
          ))}
        </defs>
      </svg>
    </ViewportPortal>
  );
}

export default memo(BoardDefs);
