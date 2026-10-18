import { NodeToolbar, Position, useStore as useFlowStore } from "@xyflow/react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { boardStore, defaultLinkData, useBoard } from "../store";
import { COLORS, LINKABLE, SHAPES, SIZES, type Color, type ItemType, type LinkEdge, type ShapeKind, type Size } from "../types";
import { useLinkGeometry } from "./LinkLine";
import {
  ArrowBothIcon,
  ArrowEndIcon,
  ArrowNoneIcon,
  ChecklistIcon,
  CurveIcon,
  DashIcon,
  DiamondIcon,
  DuplicateIcon,
  ElbowIcon,
  EllipseIcon,
  LabelIcon,
  LinkedNoteIcon,
  RectIcon,
  SectionIcon,
  StraightIcon,
  SwapIcon,
  TrashIcon,
} from "./icons";

export const COLOR_NAMES: Record<Color, string> = {
  plain: "Default",
  yellow: "Yellow",
  orange: "Orange",
  pink: "Pink",
  purple: "Purple",
  blue: "Blue",
  green: "Green",
};
const SIZE_NAMES: Record<Size, string> = { s: "Small", m: "Medium", l: "Large" };
export const SHAPE_NAMES: Record<ShapeKind, string> = { rect: "Box", ellipse: "Circle", diamond: "Diamond" };
export const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  rect: <RectIcon />,
  ellipse: <EllipseIcon />,
  diamond: <DiamondIcon />,
};
const SIZED: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "ink", "link"]);

export function ToolButton({
  label,
  active,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tool-btn${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep focus (and any text being typed) where it is.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Swatches({
  value,
  onPick,
  strong,
}: {
  value: Color | null;
  onPick: (c: Color) => void;
  strong?: boolean;
}) {
  return (
    <div className="swatches" role="group" aria-label="Colour">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch ${strong ? "swatch--strong" : ""} color--${c}${value === c ? " is-active" : ""}`}
          title={COLOR_NAMES[c]}
          aria-label={COLOR_NAMES[c]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

export function SizeButtons({ value, onPick }: { value: Size | null; onPick: (s: Size) => void }) {
  return (
    <>
      {SIZES.map((s) => (
        <ToolButton key={s} label={SIZE_NAMES[s]} active={value === s} onClick={() => onPick(s)}>
          <span className={`size-glyph size-glyph--${s}`}>A</span>
        </ToolButton>
      ))}
    </>
  );
}

const only = <T,>(values: T[]): T | null => (values.length && values.every((v) => v === values[0]) ? values[0] : null);

/** Colour, size, shape and arrange controls above the selected items. */
export function SelectionToolbar() {
  const selected = useBoard(
    useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => `${n.id}:${n.type}:${n.data.color}:${n.data.size}:${n.data.shape ?? ""}`)),
  );
  const hidden = useBoard(
    (s) =>
      s.connecting ||
      s.tool === "pen" ||
      s.tool === "eraser" ||
      s.nodes.some((n) => n.dragging) ||
      s.edges.some((e) => e.selected),
  );
  if (!selected.length) return null;

  const items = selected.map((key) => {
    const [id, type, color, size, shape] = key.split(":");
    return { id, type: type as ItemType, color: color as Color, size: size as Size, shape: shape as ShapeKind };
  });
  const ids = items.map((i) => i.id);
  const colored = items.filter((i) => i.type !== "image");
  const sized = items.filter((i) => SIZED.has(i.type));
  const shapes = items.every((i) => i.type === "shape");
  const single = items.length === 1 ? items[0] : null;
  const store = boardStore.getState();
  const strong = colored.every((i) => i.type === "ink" || i.type === "text");

  return (
    <NodeToolbar nodeId={ids} isVisible={!hidden} position={Position.Top} offset={14}>
      <div className="floating-bar" onDoubleClick={(e) => e.stopPropagation()}>
        {colored.length > 0 && (
          <>
            <Swatches value={only(colored.map((i) => i.color))} strong={strong} onPick={(c) => store.setColor(colored.map((i) => i.id), c)} />
            <span className="bar-divider" />
          </>
        )}
        {shapes &&
          SHAPES.map((k) => (
            <ToolButton key={k} label={SHAPE_NAMES[k]} active={only(items.map((i) => i.shape)) === k} onClick={() => store.setShape(ids, k)}>
              {SHAPE_ICONS[k]}
            </ToolButton>
          ))}
        {shapes && <span className="bar-divider" />}
        {sized.length > 0 && (
          <>
            <SizeButtons value={only(sized.map((i) => i.size))} onPick={(s) => store.setSize(sized.map((i) => i.id), s)} />
            <span className="bar-divider" />
          </>
        )}
        {single?.type === "note" && (
          <ToolButton
            label="Add a to-do"
            onClick={() => {
              const note = boardStore.getState().nodes.find((n) => n.id === single.id);
              if (!note) return;
              const text = note.data.text;
              store.startEditing(single.id);
              store.setText(single.id, `${text}${text && !text.endsWith("\n") ? "\n" : ""}- [ ] `);
            }}
          >
            <ChecklistIcon />
          </ToolButton>
        )}
        {single && LINKABLE.has(single.type) && (
          <ToolButton label="Add linked note (Tab)" onClick={() => store.addLinkedNote(single.id, Position.Right)}>
            <LinkedNoteIcon />
          </ToolButton>
        )}
        {!(single?.type === "frame") && (
          <ToolButton label="Put in a section (⌥⌘G)" onClick={() => store.frameSelection()}>
            <SectionIcon />
          </ToolButton>
        )}
        <ToolButton label="Duplicate (⌘D)" onClick={() => store.duplicateSelection()}>
          <DuplicateIcon />
        </ToolButton>
        <ToolButton label="Delete (⌫)" danger onClick={() => store.deleteNodes(ids)}>
          <TrashIcon />
        </ToolButton>
      </div>
    </NodeToolbar>
  );
}

/** Line style controls for the selected link, shown just above it. */
export function LinkToolbar() {
  const link = useBoard((s) => {
    const edges = s.edges.filter((e) => e.selected);
    if (edges.length !== 1 || s.connecting || s.editingLabelId || s.nodes.some((n) => n.selected)) return null;
    return edges[0];
  });
  return link ? <LinkToolbarFor link={link} /> : null;
}

function LinkToolbarFor({ link }: { link: LinkEdge }) {
  const geo = useLinkGeometry(link);
  const [tx, ty, zoom] = useFlowStore((s) => s.transform);
  if (!geo) return null;

  const d = link.data ?? defaultLinkData();
  const x = geo.labelX * zoom + tx;
  const y = geo.labelY * zoom + ty;
  const store = boardStore.getState();
  const set = (patch: Parameters<typeof store.updateLink>[1]) => store.updateLink(link.id, patch);

  return (
    <div
      className="floating-bar link-bar"
      style={{ transform: `translate(${x}px, ${y}px) translate(-50%, calc(-100% - ${d.label ? 26 : 16}px))` }}
    >
      <ToolButton label="Curved" active={d.curve === "curved"} onClick={() => set({ curve: "curved" })}>
        <CurveIcon />
      </ToolButton>
      <ToolButton label="Straight" active={d.curve === "straight"} onClick={() => set({ curve: "straight" })}>
        <StraightIcon />
      </ToolButton>
      <ToolButton label="Elbow" active={d.curve === "elbow"} onClick={() => set({ curve: "elbow" })}>
        <ElbowIcon />
      </ToolButton>
      <span className="bar-divider" />
      <ToolButton label="No arrow" active={d.arrow === "none"} onClick={() => set({ arrow: "none" })}>
        <ArrowNoneIcon />
      </ToolButton>
      <ToolButton label="Arrow" active={d.arrow === "end"} onClick={() => set({ arrow: "end" })}>
        <ArrowEndIcon />
      </ToolButton>
      <ToolButton label="Arrows both ways" active={d.arrow === "both"} onClick={() => set({ arrow: "both" })}>
        <ArrowBothIcon />
      </ToolButton>
      <ToolButton label="Flip direction" onClick={() => store.reverseLink(link.id)}>
        <SwapIcon />
      </ToolButton>
      <span className="bar-divider" />
      <ToolButton
        label="Dashed"
        active={d.dash === "dashed"}
        onClick={() => set({ dash: d.dash === "dashed" ? "solid" : "dashed" })}
      >
        <DashIcon />
      </ToolButton>
      <ToolButton label="Label (Enter)" onClick={() => store.startEditingLabel(link.id)}>
        <LabelIcon />
      </ToolButton>
      <ToolButton label="Delete link (⌫)" danger onClick={() => store.deleteSelection()}>
        <TrashIcon />
      </ToolButton>
    </div>
  );
}
