import { NodeToolbar, Position, useStore as useFlowStore } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { boardStore, defaultLinkData, useBoard } from "../store";
import {
  ALIGNABLE,
  ALIGNS,
  COLORS,
  DEFAULT_OUTLINE,
  LINKABLE,
  OUTLINABLE,
  OUTLINE_STYLES,
  OUTLINE_WIDTHS,
  SHAPES,
  SIZES,
  TEXT_STYLES,
  textStyleOf,
  type Align,
  type Color,
  type ItemData,
  type ItemType,
  type LinkEdge,
  type OutlineWidth,
  type ShapeKind,
  type Size,
  type TextStyle,
} from "../types";
import { useLinkGeometry } from "./LinkLine";
import { ShapeGlyph, SHAPE_NAMES } from "../shapes";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowBothIcon,
  CardTitleIcon,
  ChevronIcon,
  MoreIcon,
  OutlineIcon,
  ArrowEndIcon,
  ArrowNoneIcon,
  CurveIcon,
  DashIcon,
  ElbowIcon,
  LabelIcon,
  LinkedNoteIcon,
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
const SIZED: ReadonlySet<ItemType> = new Set(["note", "shape", "ink", "link"]);

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

type Panel = "color" | "outline" | "text" | "shape";

/** A grid of every shape kind; picking one changes the selected shapes. */
export function ShapePicker({ value, onPick }: { value: ShapeKind | null; onPick: (k: ShapeKind) => void }) {
  return (
    <div className="shape-grid" role="group" aria-label="Shape">
      {SHAPES.map((k) => (
        <ToolButton key={k} label={SHAPE_NAMES[k]} active={value === k} onClick={() => onPick(k)}>
          <ShapeGlyph kind={k} />
        </ToolButton>
      ))}
    </div>
  );
}

const TEXT_STYLE_NAMES: Record<TextStyle, string> = {
  title: "Title",
  heading: "Heading",
  subheading: "Subheading",
  body: "Body",
  caption: "Caption",
};
const OUTLINE_NAMES: Record<OutlineWidth, string> = { 0: "None", 1: "Thin", 2: "Medium", 4: "Thick" };
const ALIGN_ICONS: Record<Align, ReactNode> = { left: <AlignLeftIcon />, center: <AlignCenterIcon />, right: <AlignRightIcon /> };
const TEXTUAL: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "link"]);
/** Items whose colour is a line or text colour rather than a fill. */
const STROKED: ReadonlySet<ItemType> = new Set(["ink", "text", "arrow"]);

type Selected = { id: string; type: ItemType; data: ItemData };

/** A toolbar button that opens a small panel of options underneath. */
function PanelButton({
  label,
  open,
  onToggle,
  children,
  panel,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div className="panel-anchor">
      <button
        type="button"
        className={`tool-btn tool-btn--panel${open ? " is-active" : ""}`}
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
      >
        {children}
        <ChevronIcon />
      </button>
      {open && <Popover label={label}>{panel}</Popover>}
    </div>
  );
}

/**
 * The toolbar sits just above the selected items, so panels open upwards (keeping the items
 * in view while you change them) unless there isn't room above.
 */
function Popover({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    setBelow(anchor.getBoundingClientRect().top - el.offsetHeight - 12 < 8);
  }, [children]);
  return (
    <div
      ref={ref}
      className={`popover${below ? " popover--below" : " popover--above"}`}
      role="dialog"
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="popover__row">
      <div className="popover__label">{label}</div>
      <div className="popover__controls">{children}</div>
    </div>
  );
}

function ColorPanel({ items }: { items: Selected[] }) {
  const colored = items.filter((i) => i.type !== "image");
  const strong = colored.every((i) => STROKED.has(i.type));
  const inks = items.filter((i) => i.type === "ink" || i.type === "arrow");
  const arrows = items.filter((i) => i.type === "arrow");
  const store = boardStore.getState();
  return (
    <>
      <Row label={strong ? "Colour" : "Fill"}>
        <Swatches
          value={only(colored.map((i) => i.data.color))}
          strong={strong}
          onPick={(c) => boardStore.getState().setColor(colored.map((i) => i.id), c)}
        />
      </Row>
      {inks.length > 0 && (
        <Row label="Thickness">
          {SIZES.map((sz) => (
            <ToolButton
              key={sz}
              label={{ s: "Thin", m: "Medium", l: "Thick" }[sz]}
              active={only(inks.map((i) => i.data.size)) === sz}
              onClick={() => store.setSize(inks.map((i) => i.id), sz)}
            >
              <span className={`pen-dot pen-dot--${sz}`} />
            </ToolButton>
          ))}
        </Row>
      )}
      {arrows.length > 0 && (
        <>
          <Row label="Ends">
            {(
              [
                ["none", "No arrowheads", <ArrowNoneIcon key="n" />],
                ["end", "Arrowhead", <ArrowEndIcon key="e" />],
                ["both", "Arrowheads both ends", <ArrowBothIcon key="b" />],
              ] as const
            ).map(([h, name, icon]) => (
              <ToolButton
                key={h}
                label={name}
                active={only(arrows.map((i) => i.data.arrowHead ?? "end")) === h}
                onClick={() => store.styleItems(arrows.map((i) => i.id), { arrowHead: h })}
              >
                {icon}
              </ToolButton>
            ))}
          </Row>
          <Row label="Line">
            <ToolButton
              label="Dashed"
              active={only(arrows.map((i) => i.data.outlineStyle ?? "solid")) === "dashed"}
              onClick={() =>
                store.styleItems(arrows.map((i) => i.id), {
                  outlineStyle: only(arrows.map((i) => i.data.outlineStyle)) === "dashed" ? "solid" : "dashed",
                })
              }
            >
              <DashIcon />
            </ToolButton>
          </Row>
        </>
      )}
    </>
  );
}

function OutlinePanel({ items }: { items: Selected[] }) {
  const targets = items.filter((i) => OUTLINABLE.has(i.type));
  const ids = targets.map((i) => i.id);
  const width = only(targets.map((i) => i.data.outline ?? DEFAULT_OUTLINE[i.type]));
  const style = only(targets.map((i) => i.data.outlineStyle ?? "solid"));
  const color = only(targets.map((i) => i.data.outlineColor ?? null));
  const store = boardStore.getState();
  const set = (patch: Partial<ItemData>) => store.styleItems(ids, patch, OUTLINABLE);
  // Picking a colour or style on something without an outline gives it one, so the choice shows.
  const ensureVisible = (patch: Partial<ItemData>) => set(width === 0 ? { ...patch, outline: 2 } : patch);
  return (
    <>
      <Row label="Thickness">
        <div className="segmented segmented--compact">
          {OUTLINE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`segmented__item${width === w ? " is-active" : ""}`}
              title={OUTLINE_NAMES[w]}
              aria-label={`${OUTLINE_NAMES[w]} outline`}
              onClick={() => set({ outline: w })}
            >
              {w === 0 ? <span className="outline-none-glyph" /> : <span className="outline-sample" style={{ borderWidth: w }} />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Style">
        <div className="segmented segmented--compact">
          {OUTLINE_STYLES.map((st) => (
            <button
              key={st}
              type="button"
              className={`segmented__item${style === st && width !== 0 ? " is-active" : ""}`}
              aria-label={`${st === "solid" ? "Solid" : "Dashed"} outline`}
              onClick={() => ensureVisible({ outlineStyle: st })}
            >
              <span className={`line-sample line-sample--${st}`} />
              {st === "solid" ? "Solid" : "Dashed"}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Colour">
        <button
          type="button"
          className={`swatch swatch--auto${color === null && width !== 0 ? " is-active" : ""}`}
          title="Match the fill"
          aria-label="Match the fill"
          onClick={() => {
            const patch: Partial<ItemData> = { outlineColor: undefined };
            ensureVisible(patch);
          }}
        />
        <Swatches value={width === 0 ? null : color} strong onPick={(c) => ensureVisible({ outlineColor: c })} />
      </Row>
    </>
  );
}

function TextPanel({ items }: { items: Selected[] }) {
  const store = boardStore.getState();
  const texts = items.filter((i) => i.type === "text");
  const sized = items.filter((i) => i.type !== "text" && SIZED.has(i.type));
  const alignable = items.filter((i) => ALIGNABLE.has(i.type));
  const single = items.length === 1 ? items[0] : null;
  const align = only(alignable.map((i) => i.data.align ?? (i.type === "shape" ? "center" : "left")));
  return (
    <>
      {texts.length > 0 && (
        <Row label="Style">
          <div className="style-list">
            {TEXT_STYLES.map((t) => (
              <button
                key={t}
                type="button"
                className={`style-option ts-sample--${t}${only(texts.map((i) => textStyleOf(i.data))) === t ? " is-active" : ""}`}
                onClick={() => store.styleItems(texts.map((i) => i.id), { textStyle: t })}
              >
                {TEXT_STYLE_NAMES[t]}
              </button>
            ))}
          </div>
        </Row>
      )}
      {sized.length > 0 && (
        <Row label="Size">
          <SizeButtons value={only(sized.map((i) => i.data.size))} onPick={(s) => store.setSize(sized.map((i) => i.id), s)} />
        </Row>
      )}
      {alignable.length > 0 && (
        <Row label="Align">
          {ALIGNS.map((a) => (
            <ToolButton
              key={a}
              label={`Align ${a}`}
              active={align === a}
              onClick={() => store.styleItems(alignable.map((i) => i.id), { align: a }, ALIGNABLE)}
            >
              {ALIGN_ICONS[a]}
            </ToolButton>
          ))}
        </Row>
      )}
      {single?.type === "note" && (
        <Row label="Card">
          <label className="menu__item menu__toggle popover__toggle">
            <span>Title</span>
            <input type="checkbox" checked={single.data.title !== undefined} onChange={() => store.toggleTitle(single.id)} />
            <span className="switch" aria-hidden />
          </label>
        </Row>
      )}
    </>
  );
}

/** Colour, outline, text and arrange controls above the selected items. */
export function SelectionToolbar({ onMore }: { onMore: (x: number, y: number) => void }) {
  const selectedIds = useBoard(useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => `${n.id}:${n.type}`)));
  const selectedData = useBoard(useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => n.data)));
  const hidden = useBoard(
    (s) =>
      s.connecting ||
      s.tool === "pen" ||
      s.tool === "eraser" ||
      s.nodes.some((n) => n.dragging) ||
      s.edges.some((e) => e.selected),
  );
  const [open, setOpen] = useState<Panel | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const key = selectedIds.join(",");

  // Panels close when the selection changes or you click elsewhere.
  useEffect(() => setOpen(null), [key]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(null);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!selectedIds.length || selectedIds.length !== selectedData.length) return null;

  const items: Selected[] = selectedIds.map((k, i) => {
    const [id, type] = k.split(":");
    return { id, type: type as ItemType, data: selectedData[i] };
  });
  const ids = items.map((i) => i.id);
  const colored = items.filter((i) => i.type !== "image");
  const shapes = items.every((i) => i.type === "shape");
  const outlinable = items.some((i) => OUTLINABLE.has(i.type));
  const textual = items.some((i) => TEXTUAL.has(i.type));
  const single = items.length === 1 ? items[0] : null;
  const store = boardStore.getState();
  const toggle = (p: Panel) => setOpen((o) => (o === p ? null : p));
  const fill = only(colored.map((i) => i.data.color));
  const strongFill = colored.every((i) => STROKED.has(i.type));

  return (
    <NodeToolbar nodeId={ids} isVisible={!hidden} position={Position.Top} offset={items.some((i) => i.type === "frame") ? 48 : 14}>
      <div ref={bar} className="floating-bar" onDoubleClick={(e) => e.stopPropagation()}>
        {colored.length > 0 && (
          <PanelButton label="Colour" open={open === "color"} onToggle={() => toggle("color")} panel={<ColorPanel items={items} />}>
            <span className={`color-dot color--${fill ?? "plain"}${strongFill ? " color-dot--strong" : ""}${fill ? "" : " is-mixed"}`} />
          </PanelButton>
        )}
        {outlinable && (
          <PanelButton label="Outline" open={open === "outline"} onToggle={() => toggle("outline")} panel={<OutlinePanel items={items} />}>
            <OutlineIcon />
          </PanelButton>
        )}
        {textual && (
          <PanelButton label="Text" open={open === "text"} onToggle={() => toggle("text")} panel={<TextPanel items={items} />}>
            <span className="text-glyph">Aa</span>
          </PanelButton>
        )}
        <span className="bar-divider" />
        {shapes && (
          <>
            <PanelButton
              label="Shape"
              open={open === "shape"}
              onToggle={() => toggle("shape")}
              panel={<ShapePicker value={only(items.map((i) => i.data.shape ?? "rect"))} onPick={(k) => store.setShape(ids, k)} />}
            >
              <ShapeGlyph kind={only(items.map((i) => i.data.shape ?? "rect")) ?? "rect"} />
            </PanelButton>
            <span className="bar-divider" />
          </>
        )}
        {single?.type === "note" && (
          <ToolButton
            label={single.data.title === undefined ? "Add a card title" : "Remove the card title"}
            active={single.data.title !== undefined}
            onClick={() => store.toggleTitle(single.id)}
          >
            <CardTitleIcon />
          </ToolButton>
        )}
        {single && LINKABLE.has(single.type) && (
          <ToolButton label="Add linked note (Tab)" onClick={() => store.addLinkedNote(single.id, Position.Right)}>
            <LinkedNoteIcon />
          </ToolButton>
        )}
        <button
          type="button"
          className="tool-btn"
          title="More actions"
          aria-label="More actions"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMore(r.left, r.bottom + 8);
          }}
        >
          <MoreIcon />
        </button>
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
