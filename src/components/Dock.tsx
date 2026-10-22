import type { ReactNode } from "react";
import { boardStore, useBoard, type Tool } from "../store";
import { SIZES, type Color, type LinkArrow } from "../types";
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

/**
 * A dock button for a tool, or a family of tools (Select/Lasso, Pen/Eraser). Clicking an
 * active family cycles through it; clicking any other active tool goes back to Select.
 */
function ToolSwitch({ tool, family, label, children }: { tool: Tool; family?: Tool[]; label: string; children: ReactNode }) {
  const current = useBoard((s) => s.tool);
  const tools = family ?? [tool];
  const active = tools.includes(current);
  const next = () => {
    if (!active) return tool;
    if (tools.length > 1) return tools[(tools.indexOf(current) + 1) % tools.length];
    return "select";
  };
  return (
    <ToolButton label={label} active={active} onClick={() => boardStore.getState().setTool(next())}>
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
        <Swatches value={penColor} strong onPick={(color) => store.setPen({ color: color as Color })} />
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
  if (tool === "pen" || tool === "eraser") {
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Pen">
        <ToolButton label="Pen (P)" active={tool === "pen"} onClick={() => store.setTool("pen")}>
          <PenIcon />
        </ToolButton>
        <ToolButton label="Eraser (E)" active={tool === "eraser"} onClick={() => store.setTool("eraser")}>
          <EraserIcon />
        </ToolButton>
        <span className="bar-divider" />
        {tool === "pen" ? (
          <>
            <Swatches value={penColor} strong onPick={(color) => store.setPen({ color: color as Color })} />
            <span className="bar-divider" />
            {SIZES.map((s) => (
              <ToolButton key={s} label={PEN_SIZE_NAMES[s]} active={penSize === s} onClick={() => store.setPen({ size: s })}>
                <span className={`pen-dot pen-dot--${s}`} />
              </ToolButton>
            ))}
          </>
        ) : (
          <span className="dock-hint">Drag over pen strokes to erase them</span>
        )}
      </div>
    );
  }
  if (tool === "lasso") {
    return (
      <div className="dock dock--options" role="toolbar" aria-label="Selecting">
        <ToolButton label="Box select (V)" onClick={() => store.setTool("select")}>
          <CursorIcon />
        </ToolButton>
        <ToolButton label="Lasso select (L)" active onClick={() => store.setTool("lasso")}>
          <LassoIcon />
        </ToolButton>
        <span className="dock-hint">Draw a loop around the items you want to select</span>
      </div>
    );
  }
  const hints: Partial<Record<Tool, string>> = {
    note: "Click anywhere to add a note",
    text: "Click anywhere to add text",
    frame: "Click to place a section, or drag to size it",
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
  const tool = useBoard((s) => s.tool);
  return (
    <div className="dock-stack">
      <ToolOptions />
      <div className="dock" role="toolbar" aria-label="Tools">
        <ToolSwitch tool="select" family={["select", "lasso"]} label="Select (V) · click again for lasso (L)">
          {tool === "lasso" ? <LassoIcon /> : <CursorIcon />}
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
        <ToolSwitch tool="pen" family={["pen", "eraser"]} label="Pen (P) · eraser (E)">
          {tool === "eraser" ? <EraserIcon /> : <PenIcon />}
        </ToolSwitch>
        <span className="bar-divider" />
        <ToolButton label="Picture or file (I)" onClick={onPickImage}>
          <ImageIcon />
        </ToolButton>
      </div>
    </div>
  );
}
