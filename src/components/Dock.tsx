import type { ReactNode } from "react";
import { boardStore, useBoard, type Tool } from "../store";
import { SIZES, type LinkArrow } from "../types";
import {
  ArrowBothIcon,
  ArrowToolIcon,
  CursorIcon,
  EraserIcon,
  FrameIcon,
  HandIcon,
  ImageIcon,
  LassoIcon,
  LineToolIcon,
  NoteIcon,
  PenIcon,
  TextIcon,
} from "./icons";
import { ShapeGlyph } from "../shapes";
import { ShapePicker, Swatches, ToolButton } from "./Toolbars";

function ToolSwitch({ tool, label, children }: { tool: Tool; label: string; children: ReactNode }) {
  const active = useBoard((s) => s.tool === tool);
  return (
    <ToolButton label={label} active={active} onClick={() => boardStore.getState().setTool(active ? "select" : tool)}>
      {children}
    </ToolButton>
  );
}

const PEN_SIZE_NAMES = { s: "Thin", m: "Medium", l: "Thick" } as const;

/** Extra choices for the active tool, shown just above the dock. */
function ToolOptions() {
  const tool = useBoard((s) => s.tool);
  const shapeKind = useBoard((s) => s.shapeKind);
  const penColor = useBoard((s) => s.penColor);
  const penSize = useBoard((s) => s.penSize);
  const arrowHead = useBoard((s) => s.arrowHead);
  const store = boardStore.getState();

  if (tool === "shape") {
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Shape">
        <ShapePicker value={shapeKind} onPick={(k) => store.setShapeKind(k)} />
        <span className="dock-hint">Click to place, or drag to size</span>
      </div>
    );
  }
  if (tool === "arrow") {
    const heads: [LinkArrow, string, ReactNode][] = [
      ["end", "Arrow", <ArrowToolIcon key="a" />],
      ["none", "Line", <LineToolIcon key="l" />],
      ["both", "Two-way arrow", <ArrowBothIcon key="b" />],
    ];
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Arrow">
        {heads.map(([h, name, icon]) => (
          <ToolButton key={h} label={name} active={arrowHead === h} onClick={() => store.setArrowHead(h)}>
            {icon}
          </ToolButton>
        ))}
        <span className="bar-divider" />
        <Swatches value={penColor} strong onPick={(color) => store.setPen({ color })} />
        <span className="bar-divider" />
        {SIZES.map((s) => (
          <ToolButton key={s} label={PEN_SIZE_NAMES[s]} active={penSize === s} onClick={() => store.setPen({ size: s })}>
            <span className={`pen-dot pen-dot--${s}`} />
          </ToolButton>
        ))}
        <span className="dock-hint">Drag between two items to link them</span>
      </div>
    );
  }
  if (tool === "pen") {
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Pen">
        <Swatches value={penColor} strong onPick={(color) => store.setPen({ color })} />
        <span className="bar-divider" />
        {SIZES.map((s) => (
          <ToolButton key={s} label={PEN_SIZE_NAMES[s]} active={penSize === s} onClick={() => store.setPen({ size: s })}>
            <span className={`pen-dot pen-dot--${s}`} />
          </ToolButton>
        ))}
      </div>
    );
  }
  const hints: Partial<Record<Tool, string>> = {
    note: "Click anywhere to add a note",
    text: "Click anywhere to add text",
    frame: "Click to place a section, or drag to size it",
    eraser: "Drag over pen strokes to erase them",
    lasso: "Draw a loop around the items you want to select",
  };
  const hint = hints[tool];
  return hint ? (
    <div className="dock dock--options dock--hint" role="status">
      <span className="dock-hint">{hint}</span>
    </div>
  ) : null;
}

export function Dock({ onPickImage }: { onPickImage: () => void }) {
  const shapeKind = useBoard((s) => s.shapeKind);
  return (
    <div className="dock-stack">
      <ToolOptions />
      <div className="dock" role="toolbar" aria-label="Tools">
        <ToolSwitch tool="select" label="Select (V)">
          <CursorIcon />
        </ToolSwitch>
        <ToolSwitch tool="lasso" label="Lasso select (L)">
          <LassoIcon />
        </ToolSwitch>
        <ToolSwitch tool="hand" label="Pan (H, or hold Space)">
          <HandIcon />
        </ToolSwitch>
        <span className="bar-divider" />
        <ToolSwitch tool="note" label="Note (N)">
          <NoteIcon />
        </ToolSwitch>
        <ToolSwitch tool="text" label="Text (T)">
          <TextIcon />
        </ToolSwitch>
        <ToolSwitch tool="shape" label="Shape (S)">
          <ShapeGlyph kind={shapeKind} />
        </ToolSwitch>
        <ToolSwitch tool="frame" label="Section (F)">
          <FrameIcon />
        </ToolSwitch>
        <ToolSwitch tool="arrow" label="Arrow or line (A)">
          <ArrowToolIcon />
        </ToolSwitch>
        <span className="bar-divider" />
        <ToolSwitch tool="pen" label="Pen (P)">
          <PenIcon />
        </ToolSwitch>
        <ToolSwitch tool="eraser" label="Eraser (E)">
          <EraserIcon />
        </ToolSwitch>
        <span className="bar-divider" />
        <ToolButton label="Image (I)" onClick={onPickImage}>
          <ImageIcon />
        </ToolButton>
      </div>
    </div>
  );
}
