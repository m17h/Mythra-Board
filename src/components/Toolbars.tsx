import { NodeToolbar, Position, useStore as useFlowStore } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { boardStore, defaultLinkData, useBoard } from "../store";
import {
  ALIGNABLE,
  ALIGNS,
  COLORS,
  DEFAULT_OUTLINE,
  FILLABLE,
  LINKABLE,
  OUTLINABLE,
  OUTLINE_STYLES,
  OUTLINE_WIDTHS,
  SHAPES,
  SIZES,
  TEXT_STYLES,
  FONTS,
  LINK_DASHES,
  LINK_HEADS,
  LINK_MOTIONS,
  textStyleOf,
  type LinkHead,
  type LinkMotion,
  type Align,
  type Effect,
  type Paint,
  type ArrangeMode,
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
import { colorLook, FONT_NAMES, isHex, paintCss } from "../look";
import { headPath } from "../geometry";
import { ShapeGlyph, SHAPE_NAMES } from "../shapes";
import { aiSupported } from "../ai";
import { askClaude, QUICK } from "../assistant/ask";
import { keyLabel } from "../platform";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowBothIcon,
  CardTitleIcon,
  AlignItemsIcon,
  CaptionIcon,
  CropIcon,
  CropResetIcon,
  ArrangeGlyph,
  ChevronIcon,
  GroupIcon,
  LockIcon,
  MoreIcon,
  SparkleIcon,
  TidyIcon,
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
  red: "Red",
  pink: "Pink",
  purple: "Purple",
  blue: "Blue",
  teal: "Teal",
  green: "Green",
  gray: "Gray",
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
      title={keyLabel(label)}
      aria-label={keyLabel(label)}
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
  custom,
  auto,
}: {
  value: Paint | null;
  onPick: (c: Paint) => void;
  strong?: boolean;
  /** Also offer any colour, from the system colour picker. */
  custom?: boolean;
  /** An "automatic" choice first (e.g. text that follows the item's colour). */
  auto?: { active: boolean; label: string; onPick: () => void };
}) {
  return (
    <div className="swatches" role="group" aria-label="Colour">
      {auto && (
        <button
          type="button"
          className={`swatch swatch--auto${auto.active ? " is-active" : ""}`}
          title={auto.label}
          aria-label={auto.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={auto.onPick}
        />
      )}
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
      {custom && <CustomSwatch value={value && isHex(value) ? value : null} onPick={onPick} />}
    </div>
  );
}

/** Any colour at all, from the system colour picker (one undo step when it's chosen). */
function CustomSwatch({ value, onPick }: { value: string | null; onPick: (c: Paint) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onChange = () => pick.current(el.value.toLowerCase() as Paint);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <label className={`swatch swatch--custom${value ? " is-active" : ""}`} title="Any colour" style={value ? { background: value } : undefined}>
      <input ref={input} type="color" aria-label="Any colour" defaultValue={value ?? "#7c5cff"} key={value ?? "none"} />
    </label>
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

type Panel = "color" | "outline" | "text" | "shape" | "arrange" | "ai";

function AiPanel({ id, close }: { id: string; close: () => void }) {
  const go = (message: string, focus?: string[]) => {
    close();
    void askClaude(message, focus);
  };
  return (
    <div className="ai-actions">
      <button type="button" className="popover__action" onClick={() => go(QUICK.brainstorm, [id])}>
        <SparkleIcon /> Brainstorm ideas from this
      </button>
      <button type="button" className="popover__action" onClick={() => go(QUICK.mindMap, [id])}>
        <TidyIcon /> Turn this into a mind map
      </button>
      <button type="button" className="popover__action" onClick={() => go(QUICK.summarise)}>
        <CardTitleIcon /> Summarise this board
      </button>
      <button type="button" className="popover__action" onClick={() => go("")}>
        <SparkleIcon /> Ask Claude something else…
      </button>
    </div>
  );
}

const ARRANGE_NAMES: Record<ArrangeMode, string> = {
  left: "Align left edges (⌥A)",
  hcenter: "Align centres (⌥H)",
  right: "Align right edges (⌥D)",
  top: "Align top edges (⌥W)",
  vmiddle: "Align middles (⌥V)",
  bottom: "Align bottom edges (⌥S)",
  distributeX: "Space evenly across (⌃⌥H)",
  distributeY: "Space evenly down (⌃⌥V)",
};

function ArrangePanel({ ids, grouped }: { ids: string[]; grouped: boolean }) {
  const store = boardStore.getState();
  return (
    <>
      <Row label="Align">
        {(["left", "hcenter", "right", "top", "vmiddle", "bottom"] as const).map((m) => (
          <ToolButton key={m} label={ARRANGE_NAMES[m]} onClick={() => store.arrange(ids, m)}>
            <ArrangeGlyph mode={m} />
          </ToolButton>
        ))}
      </Row>
      <Row label="Space evenly">
        {(["distributeX", "distributeY"] as const).map((m) => (
          <ToolButton key={m} label={ARRANGE_NAMES[m]} onClick={() => store.arrange(ids, m)}>
            <ArrangeGlyph mode={m} />
          </ToolButton>
        ))}
      </Row>
      <Row label="Group">
        <button type="button" className="popover__action" onClick={() => (grouped ? store.ungroup(ids) : store.group(ids))}>
          <GroupIcon /> {grouped ? "Ungroup (⇧⌘G)" : "Group (⌘G)"}
        </button>
      </Row>
    </>
  );
}

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
  const fillable = items.filter((i) => FILLABLE.has(i.type));
  const arrows = items.filter((i) => i.type === "arrow");
  // Items with words on a coloured background, whose text colour can be set on its own.
  const lettered = items.filter((i) => ["note", "shape", "frame", "link", "board", "file"].includes(i.type));
  const glowing = items.filter((i) => i.type !== "ink" && i.type !== "arrow");
  const sampleLook = colorLook({ color: only(fillable.map((i) => i.data.color)) ?? "blue", hex: only(fillable.map((i) => i.data.hex ?? null)) ?? undefined });
  const store = boardStore.getState();
  return (
    <>
      <Row label={strong ? "Colour" : "Fill"}>
        <Swatches
          value={only(colored.map((i) => (i.data.hex as Paint | undefined) ?? i.data.color))}
          strong={strong}
          custom
          onPick={(c) =>
            isHex(c)
              ? store.styleItems(colored.map((i) => i.id), { hex: c })
              : store.setColor(colored.map((i) => i.id), c)
          }
        />
      </Row>
      {fillable.length > 0 && (
        <Row label="Fill style">
          <div className="segmented segmented--compact">
            {(
              [
                ["solid", "Solid"],
                ["light", "Light"],
                ["bold", "Bold"],
                ["hatch", "Hatched"],
                ["none", "None"],
              ] as const
            ).map(([f, name]) => (
              <button
                key={f}
                type="button"
                title={name}
                aria-label={`${name} fill`}
                className={`segmented__item${only(fillable.map((i) => i.data.fill ?? "solid")) === f ? " is-active" : ""}`}
                onClick={() => store.styleItems(fillable.map((i) => i.id), { fill: f }, FILLABLE)}
              >
                <span
                  className={`fill-sample fill-sample--${f} ${sampleLook.className}`}
                  style={sampleLook.style}
                />
              </button>
            ))}
          </div>
        </Row>
      )}
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
      {lettered.length > 0 && (
        <Row label="Text colour">
          <Swatches
            value={only(lettered.map((i) => i.data.textColor ?? null))}
            strong
            custom
            auto={{
              active: only(lettered.map((i) => i.data.textColor ?? null)) === null,
              label: "Automatic text colour",
              onPick: () => store.styleItems(lettered.map((i) => i.id), { textColor: undefined }),
            }}
            onPick={(c) => store.styleItems(lettered.map((i) => i.id), { textColor: c })}
          />
        </Row>
      )}
      {glowing.length > 0 && (
        <Row label="Stand out">
          <div className="segmented segmented--compact">
            {(
              [
                ["none", "None"],
                ["glow", "Glow"],
                ["pulse", "Pulse"],
              ] as [Effect, string][]
            ).map(([e, name]) => (
              <button
                key={e}
                type="button"
                className={`segmented__item${only(glowing.map((i) => i.data.effect ?? "none")) === e ? " is-active" : ""}`}
                onClick={() => store.styleItems(glowing.map((i) => i.id), { effect: e === "none" ? undefined : e })}
              >
                {name}
              </button>
            ))}
          </div>
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
        <Swatches
          value={width === 0 ? null : color}
          strong
          custom
          auto={{ active: color === null && width !== 0, label: "Match the fill", onPick: () => ensureVisible({ outlineColor: undefined }) }}
          onPick={(c) => ensureVisible({ outlineColor: c })}
        />
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
      <Row label="Typeface">
        <div className="segmented segmented--compact font-picker">
          <button
            type="button"
            className={`segmented__item${only(items.map((i) => i.data.font ?? null)) === null ? " is-active" : ""}`}
            title="The board's typeface"
            onClick={() => store.styleItems(items.map((i) => i.id), { font: undefined })}
          >
            Board
          </button>
          {FONTS.map((f) => (
            <button
              key={f}
              type="button"
              className={`segmented__item${only(items.map((i) => i.data.font ?? null)) === f ? " is-active" : ""}`}
              title={FONT_NAMES[f]}
              aria-label={FONT_NAMES[f]}
              onClick={() => store.styleItems(items.map((i) => i.id), { font: f })}
            >
              <span className={`font-sample font-sample--${f}`}>Aa</span>
            </button>
          ))}
        </div>
      </Row>
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

/** Crop a picture to any shape (drag the picture to choose what shows), or undo the crop. */
function CropButtons({ id, cropped }: { id: string; cropped: boolean }) {
  const cropping = useBoard((s) => s.croppingId === id);
  const store = boardStore.getState();
  const reset = () => {
    const img = document.querySelector<HTMLImageElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] img`);
    const node = store.nodes.find((n) => n.id === id);
    if (!img?.naturalWidth || !node) return;
    store.setCropping(null);
    store.begin();
    const width = node.width ?? img.naturalWidth;
    store.patchItem(id, { crop: undefined }, { width, height: Math.round((width * img.naturalHeight) / img.naturalWidth) });
    store.commit();
  };
  return (
    <>
      <ToolButton label={cropping ? "Done cropping (Esc)" : "Crop"} active={cropping} onClick={() => store.setCropping(cropping ? null : id)}>
        <CropIcon />
      </ToolButton>
      {cropped && !cropping && (
        <ToolButton label="Undo crop" onClick={reset}>
          <CropResetIcon />
        </ToolButton>
      )}
      <ToolButton label="Caption" onClick={() => store.startEditing(id)}>
        <CaptionIcon />
      </ToolButton>
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
      // While typing, the formatting bar takes this spot.
      (s.editingId !== null && s.editingField === "body" && s.nodes.some((n) => n.id === s.editingId && n.type !== "frame" && n.type !== "link")) ||
      s.tool === "pen" ||
      s.tool === "eraser" ||
      s.nodes.some((n) => n.dragging) ||
      s.edges.some((e) => e.selected),
  );
  const [open, setOpen] = useState<Panel | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const key = selectedIds.join(",");

  // Panels close (and cropping ends) when the selection changes or you click elsewhere.
  useEffect(() => {
    setOpen(null);
    const s = boardStore.getState();
    if (s.croppingId && !s.nodes.some((n) => n.id === s.croppingId && n.selected)) s.setCropping(null);
  }, [key]);
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
  const hexFill = only(colored.map((i) => i.data.hex ?? null));
  const strongFill = colored.every((i) => STROKED.has(i.type));
  const locked = items.every((i) => i.data.locked);

  return (
    <NodeToolbar nodeId={ids} isVisible={!hidden} position={Position.Top} offset={items.some((i) => i.type === "frame") ? 48 : 14}>
      <div ref={bar} className="floating-bar" onDoubleClick={(e) => e.stopPropagation()}>
        {colored.length > 0 && (
          <PanelButton label="Colour" open={open === "color"} onToggle={() => toggle("color")} panel={<ColorPanel items={items} />}>
            <span
              className={`color-dot color--${fill ?? "plain"}${strongFill ? " color-dot--strong" : ""}${fill ? "" : " is-mixed"}`}
              style={hexFill ? { background: hexFill } : undefined}
            />
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
        {items.length > 1 && (
          <PanelButton
            label="Arrange"
            open={open === "arrange"}
            onToggle={() => toggle("arrange")}
            panel={<ArrangePanel ids={ids} grouped={items.every((i) => i.data.group && i.data.group === items[0].data.group)} />}
          >
            <AlignItemsIcon />
          </PanelButton>
        )}
        {single?.type === "image" && <CropButtons id={single.id} cropped={!!single.data.crop} />}
        {single?.type === "note" && (
          <ToolButton
            label={single.data.title === undefined ? "Add a card title" : "Remove the card title"}
            active={single.data.title !== undefined}
            onClick={() => store.toggleTitle(single.id)}
          >
            <CardTitleIcon />
          </ToolButton>
        )}
        {single && TEXTUAL.has(single.type) && aiSupported() && (
          <PanelButton label="AI" open={open === "ai"} onToggle={() => toggle("ai")} panel={<AiPanel id={single.id} close={() => setOpen(null)} />}>
            <SparkleIcon />
          </PanelButton>
        )}
        {single && LINKABLE.has(single.type) && (
          <ToolButton label="Add linked note (Tab)" onClick={() => store.addLinkedNote(single.id, Position.Right)}>
            <LinkedNoteIcon />
          </ToolButton>
        )}
        <ToolButton
          label={locked ? "Unlock (⇧⌘L)" : "Lock (⇧⌘L)"}
          active={locked}
          onClick={() => store.setLocked(ids, !locked)}
        >
          <LockIcon open={!locked} />
        </ToolButton>
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
        {!locked && (
          <ToolButton label="Delete (⌫)" danger onClick={() => store.deleteNodes(ids)}>
            <TrashIcon />
          </ToolButton>
        )}
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

/** Colour, thickness, pattern, ends and movement for a line. */
function LineStylePanel({ link }: { link: LinkEdge }) {
  const d = link.data ?? defaultLinkData();
  const store = boardStore.getState();
  const set = (patch: Parameters<typeof store.updateLink>[1]) => store.updateLink(link.id, patch);
  return (
    <>
      <Row label="Colour">
        <Swatches
          value={d.color ?? null}
          strong
          custom
          auto={{ active: !d.color, label: "Automatic line colour", onPick: () => set({ color: undefined }) }}
          onPick={(c) => set({ color: c })}
        />
      </Row>
      <Row label="Thickness">
        <div className="segmented segmented--compact">
          {(
            [
              [1, "Thin"],
              [2, "Normal"],
              [3, "Thick"],
            ] as const
          ).map(([w, name]) => (
            <button key={w} type="button" className={`segmented__item${(d.width ?? 2) === w ? " is-active" : ""}`} onClick={() => set({ width: w })}>
              <span className="line-width-sample" style={{ height: w === 1 ? 1.5 : w === 2 ? 2.5 : 4 }} />
              {name}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Pattern">
        <div className="segmented segmented--compact">
          {LINK_DASHES.map((p) => (
            <button key={p} type="button" className={`segmented__item${d.dash === p ? " is-active" : ""}`} onClick={() => set({ dash: p })}>
              <span className={`line-sample line-sample--${p}`} />
              {p === "solid" ? "Solid" : p === "dashed" ? "Dashed" : "Dotted"}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Ends">
        <div className="segmented segmented--compact">
          {LINK_HEADS.map((h) => (
            <button
              key={h}
              type="button"
              className={`segmented__item${(d.head ?? "arrow") === h ? " is-active" : ""}`}
              title={HEAD_NAMES[h]}
              aria-label={HEAD_NAMES[h]}
              onClick={() => set({ head: h, ...(d.arrow === "none" ? { arrow: "end" as const } : {}) })}
            >
              <HeadGlyph kind={h} />
            </button>
          ))}
        </div>
      </Row>
      <Row label="Movement">
        <div className="segmented segmented--compact">
          {LINK_MOTIONS.map((m) => (
            <button
              key={m}
              type="button"
              className={`segmented__item${(d.motion ?? "none") === m ? " is-active" : ""}`}
              title={MOTION_HINTS[m]}
              onClick={() => set({ motion: m === "none" ? undefined : m })}
            >
              {m === "none" ? "None" : m === "flow" ? "Flow" : "Pulse"}
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

const HEAD_NAMES: Record<LinkHead, string> = { arrow: "Arrow", open: "Open arrow", dot: "Dot", diamond: "Diamond" };
const MOTION_HINTS: Record<LinkMotion, string> = {
  none: "Still",
  flow: "Dashes flow along the line, showing its direction",
  pulse: "A soft glow pulses along the line",
};

function HeadGlyph({ kind }: { kind: LinkHead }) {
  const tip = { x: 21, y: 12 };
  return (
    <svg width="26" height="24" viewBox="0 0 26 24" aria-hidden className="head-glyph">
      <line x1="3" y1="12" x2={kind === "open" ? 20 : 13} y2="12" />
      <path d={headPath(kind, tip, { x: 1, y: 0 }, 10)} className={kind === "open" ? "is-open" : ""} />
    </svg>
  );
}

function LinkToolbarFor({ link }: { link: LinkEdge }) {
  const [styleOpen, setStyleOpen] = useState(false);
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
      <div className="panel-anchor">
        <button
          type="button"
          className={`tool-btn tool-btn--panel${styleOpen ? " is-active" : ""}`}
          title="Line style"
          aria-label="Line style"
          aria-expanded={styleOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setStyleOpen((o) => !o)}
        >
          <span className="line-swatch" style={d.color ? ({ "--lc": paintCss(d.color) } as CSSProperties) : undefined} />
          <ChevronIcon />
        </button>
        {styleOpen && (
          <Popover label="Line style">
            <LineStylePanel link={link} />
          </Popover>
        )}
      </div>
      <ToolButton label="Label (Enter)" onClick={() => store.startEditingLabel(link.id)}>
        <LabelIcon />
      </ToolButton>
      <ToolButton label="Delete link (⌫)" danger onClick={() => store.deleteSelection()}>
        <TrashIcon />
      </ToolButton>
    </div>
  );
}
