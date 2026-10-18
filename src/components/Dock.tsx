import type { ReactNode } from "react";
import { boardStore, useBoard, type Tool } from "../store";
import { SHAPES, SIZES } from "../types";
import { CursorIcon, EraserIcon, FrameIcon, HandIcon, ImageIcon, NoteIcon, PenIcon, TextIcon } from "./icons";
import { SHAPE_ICONS, SHAPE_NAMES, Swatches, ToolButton } from "./Toolbars";

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
  const store = boardStore.getState();

  if (tool === "shape") {
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Shape">
        {SHAPES.map((k) => (
          <ToolButton key={k} label={SHAPE_NAMES[k]} active={shapeKind === k} onClick={() => store.setShapeKind(k)}>
            {SHAPE_ICONS[k]}
          </ToolButton>
        ))}
        <span className="dock-hint">Click to place, or drag to size</span>
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
          {SHAPE_ICONS[shapeKind]}
        </ToolSwitch>
        <ToolSwitch tool="frame" label="Section (F)">
          <FrameIcon />
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
