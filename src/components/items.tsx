import { useReactFlow, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { strokePath } from "../ink";
import { formatBytes, hostOf } from "../images";
import { notify } from "../notify";
import { assetUrl, openAsset, openExternal } from "../persistence";
import { boardStore, useBoard } from "../store";
import { arrowHead, offset, unit } from "../geometry";
import { openBoard, useBoardIndex } from "../navigation";
import { DEFAULT_NOTE_WIDTH, DEFAULT_OUTLINE, textStyleOf, type BoardNode, type ItemData, type ItemType, type Size } from "../types";
import { itemAt } from "./CanvasGestures";
import Thumbnail from "./Thumbnail";
import { LABEL_INSETS, SHAPE_DETAILS, SHAPE_PATHS } from "../shapes";
import { roughPath } from "../sketch";
import { GlobeIcon, OpenIcon } from "./icons";
import { BoxResizer, LinkHandles, TextEditor, WidthResizers } from "./itemParts";
import RichText, { taskStats } from "./RichText";
import { colorLook, paintCss } from "../look";

const useEditing = (id: string) => useBoard((s) => s.editingId === id);

const startEditing = (id: string) => (e: React.MouseEvent) => {
  e.stopPropagation();
  boardStore.getState().startEditing(id);
};

const toggle = (id: string) => (line: number) => boardStore.getState().toggleTask(id, line);

const TYPE_NAMES: Record<ItemType, string> = {
  note: "Note",
  text: "Text",
  shape: "Shape",
  image: "Picture",
  frame: "Section",
  ink: "Drawing",
  link: "Web link",
  board: "Board link",
  arrow: "Arrow",
  file: "File",
};

/** What a screen reader says for an item. */
export function describe(type: ItemType, data: ItemData): string {
  const words = [data.title, data.text || data.url].filter(Boolean).join(": ").replace(/\s+/g, " ").trim().slice(0, 160);
  const kind = type === "shape" && data.shape ? `${TYPE_NAMES.shape} (${data.shape})` : TYPE_NAMES[type];
  return [kind, words, data.locked ? "locked" : "", data.collapsed ? "folded" : ""].filter(Boolean).join(", ");
}

const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/**
 * Classes and CSS variables for an item's outline and text alignment. Outlines are drawn by
 * CSS from `--ow` (width), `--os` (solid/dashed) and `--oc` (colour).
 */
function look(type: ItemType, data: ItemData): { className: string; style: CSSProperties } {
  const width = data.outline ?? DEFAULT_OUTLINE[type];
  const color = colorLook(data);
  const style = {
    ...color.style,
    "--ow": `${width}px`,
    "--os": data.outlineStyle ?? "solid",
    ...(data.outlineColor ? { "--oc": paintCss(data.outlineColor) } : {}),
    ...(data.textColor ? { "--tc": paintCss(data.textColor) } : {}),
  } as CSSProperties;
  return {
    className: cls(
      color.className,
      width > 0 && "has-outline",
      data.outline !== undefined && "outline-set",
      data.outlineStyle === "dashed" && "is-dashed-outline",
      data.align && `align--${data.align}`,
      data.locked && "is-locked",
      data.fill && data.fill !== "solid" && `fill--${data.fill}`,
      data.font && `font--${data.font}`,
      data.textColor && "has-text-color",
      data.effect && data.effect !== "none" && `effect--${data.effect}`,
    ),
    style,
  };
}

/** Sticky-style notes (optionally with a card title), and free text (the same thing without the card). */
export const NoteItem = memo(function NoteItem({ id, type, data, selected, dragging }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  const tasks = useMemo(() => taskStats(data.text), [data.text]);
  const isText = type === "text";
  const hasTitle = !isText && data.title !== undefined;
  const { className, style } = look(type, data);
  return (
    <div
      className={cls(
        isText ? "textitem" : "note",
        isText && `ts--${textStyleOf(data)}`,
        `size--${data.size}`,
        hasTitle && "has-title",
        hasTitle && (data.text || editing) && "has-body",
        className,
        selected && "is-selected",
        editing && "is-editing",
        dragging && "is-dragging",
      )}
      style={style}
      role="group"
      aria-label={describe(type, data)}
      onDoubleClick={startEditing(id)}
    >
      <span className="item-sketch" aria-hidden />
      {hasTitle &&
        (editing ? (
          <TextEditor id={id} field="title" text={data.title ?? ""} className="note__title" placeholder="Title" singleLine />
        ) : (
          <div
            className={cls("note__title", !data.title && "is-empty")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              boardStore.getState().startEditing(id, "title");
            }}
          >
            {data.title || "Untitled"}
          </div>
        ))}
      {editing ? (
        <TextEditor
          id={id}
          text={data.text}
          className="item-text"
          placeholder={isText ? "Type something…" : hasTitle ? "Add details…" : "Type an idea…"}
          canBranch
        />
      ) : data.text ? (
        <div className="item-text">
          <RichText text={data.text} onToggle={toggle(id)} />
        </div>
      ) : (
        !hasTitle && <div className="item-text is-empty">{isText ? "Text" : "Empty note"}</div>
      )}
      {!isText && tasks.total > 1 && !editing && (
        <div className="task-progress" title={`${tasks.done} of ${tasks.total} done`}>
          <div className="task-progress__track">
            <div className="task-progress__bar" style={{ width: `${(tasks.done / tasks.total) * 100}%` }} />
          </div>
          <span>
            {tasks.done}/{tasks.total}
          </span>
        </div>
      )}
      <LinkHandles id={id} collapsed={data.collapsed} />
      {selected && !editing && <WidthResizers />}
    </div>
  );
});

export const ShapeItem = memo(function ShapeItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  const shape = data.shape ?? "rect";
  const { className, style } = look("shape", data);
  return (
    <div
      className={cls(
        "shape",
        `shape--${shape}`,
        `size--${data.size}`,
        className,
        selected && "is-selected",
        editing && "is-editing",
        dragging && "is-dragging",
      )}
      style={style}
      role="group"
      aria-label={describe("shape", data)}
      onDoubleClick={startEditing(id)}
    >
      {!SHAPE_PATHS[shape] && <span className="item-sketch" aria-hidden />}
      {SHAPE_PATHS[shape] && (
        <svg className="shape__outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <path d={SHAPE_PATHS[shape]} vectorEffect="non-scaling-stroke" />
          {SHAPE_DETAILS[shape] && <path className="shape__detail" d={SHAPE_DETAILS[shape]} vectorEffect="non-scaling-stroke" />}
        </svg>
      )}
      <div className="shape__label" style={LABEL_INSETS[shape]}>
        {editing ? (
          <TextEditor id={id} text={data.text} className="item-text" placeholder="Label" canBranch />
        ) : (
          data.text && (
            <div className="item-text">
              <RichText text={data.text} onToggle={toggle(id)} />
            </div>
          )
        )}
      </div>
      <LinkHandles id={id} collapsed={data.collapsed} />
      <BoxResizer visible={!!selected && !editing} />
    </div>
  );
});

export const ImageItem = memo(function ImageItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const editing = useEditing(id);
  const cropping = useBoard((s) => s.croppingId === id);
  useEffect(() => {
    let live = true;
    if (data.asset)
      assetUrl(data.asset).then(
        (url) => live && setSrc(url),
        () => live && setFailed(true),
      );
    return () => {
      live = false;
    };
  }, [data.asset]);
  const { className, style } = look("image", data);
  const [fx, fy] = data.crop ?? [0.5, 0.5];

  // While cropping, dragging the picture slides it around inside its frame.
  const pan = (e: React.PointerEvent) => {
    if (!cropping) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, fx, fy };
    const box = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      boardStore.getState().patchItem(id, {
        crop: [clamp(start.fx - (ev.clientX - start.x) / box.width), clamp(start.fy - (ev.clientY - start.y) / box.height)],
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div
      className={cls("image", className, selected && "is-selected", dragging && "is-dragging", cropping && "is-cropping")}
      style={style}
      role="img"
      aria-label={describe("image", data)}
      onDoubleClick={startEditing(id)}
    >
      <span className="item-sketch" aria-hidden />
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className={cropping ? "nodrag" : undefined}
          style={{ objectPosition: `${fx * 100}% ${fy * 100}%` }}
          onPointerDown={pan}
        />
      ) : (
        <div className={cls("image__placeholder", failed && "is-failed")}>{failed ? "Image missing" : ""}</div>
      )}
      {(editing || data.text) && (
        <div className="image__caption">
          {editing ? <TextEditor id={id} text={data.text} className="image__caption-input" placeholder="Add a caption" singleLine /> : data.text}
        </div>
      )}
      <LinkHandles id={id} collapsed={data.collapsed} />
      <BoxResizer visible={!!selected && !editing} keepAspectRatio={!cropping} minWidth={40} minHeight={40} />
    </div>
  );
});

/** A document, audio or video file. Double-click (or the button) opens it in its own app. */
export const FileItem = memo(function FileItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const { className, style } = look("file", data);
  const name = data.text || "File";
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE";
  const open = () => data.asset && void openAsset(data.asset, name).catch(() => notify("Couldn't open that file"));
  return (
    <div
      className={cls("note", "linkcard", "filecard", className, selected && "is-selected", dragging && "is-dragging")}
      style={style}
      role="group"
      aria-label={describe("file", data)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        open();
      }}
    >
      <span className="item-sketch" aria-hidden />
      <div className={`filecard__badge filecard__badge--${ext.toLowerCase()}`}>{ext}</div>
      <div className="linkcard__body">
        <div className="linkcard__title" title={name}>
          {name}
        </div>
        <div className="linkcard__url">{data.fileSize ? formatBytes(data.fileSize) : "File"}</div>
      </div>
      <button
        type="button"
        className="linkcard__open nodrag"
        title="Open"
        aria-label="Open"
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      >
        <OpenIcon />
      </button>
      <LinkHandles id={id} collapsed={data.collapsed} />
      {selected && <WidthResizers />}
    </div>
  );
});

/** A titled area for grouping things. Dragging it moves everything inside. */
export const FrameItem = memo(function FrameItem({ id, data, selected }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  const dropTarget = useBoard((s) => s.dropFrameId === id);
  const rf = useReactFlow();
  const { className, style } = look("frame", data);
  return (
    <div
      className={cls("frame", className, selected && "is-selected", editing && "is-editing", dropTarget && "is-drop-target")}
      style={style}
      role="group"
      aria-label={describe("frame", data)}
      onDoubleClick={(e) => {
        // Double-clicking inside a section adds a note there, just like on the open board.
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        boardStore.getState().addNote({ x: p.x - DEFAULT_NOTE_WIDTH / 2, y: p.y - 22 }, { edit: true });
      }}
    >
      <span className="item-sketch" aria-hidden />
      <div className="frame__title" onDoubleClick={startEditing(id)} title="Double-click to rename">
        {editing ? (
          <TextEditor id={id} text={data.text} className="frame__input" placeholder="Section name" singleLine />
        ) : (
          data.text || "Untitled section"
        )}
      </div>
      <BoxResizer visible={!!selected && !editing} minWidth={160} minHeight={100} />
    </div>
  );
});

export const InkItem = memo(function InkItem({ data, selected, width, height }: NodeProps<BoardNode>) {
  const path = useMemo(() => strokePath(data.points ?? [], data.size), [data.points, data.size]);
  const erasing = useBoard((s) => s.tool === "eraser");
  return (
    <svg style={colorLook(data).style} className={cls("ink", colorLook(data).className, selected && "is-selected", erasing && "is-erasable", data.locked && "is-locked")} width={width} height={height} role="img" aria-label="Drawing">
      <path d={path} />
    </svg>
  );
});

export const LinkCardItem = memo(function LinkCardItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  const url = data.url ?? "";
  const host = hostOf(url);
  const { className, style } = look("link", data);
  return (
    <div
      className={cls("note", "linkcard", className, selected && "is-selected", editing && "is-editing", dragging && "is-dragging")}
      style={style}
      role="group"
      aria-label={describe("link", data)}
      onDoubleClick={startEditing(id)}
    >
      <span className="item-sketch" aria-hidden />
      <div className="linkcard__icon">
        <GlobeIcon />
      </div>
      <div className="linkcard__body">
        {editing ? (
          <TextEditor id={id} text={data.text} className="linkcard__title" placeholder={host} singleLine />
        ) : (
          <div className="linkcard__title">{data.text || host}</div>
        )}
        <div className="linkcard__url" title={url}>
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </div>
      </div>
      <button
        type="button"
        className="linkcard__open nodrag"
        title="Open in browser"
        aria-label="Open in browser"
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void openExternal(url);
        }}
      >
        <OpenIcon />
      </button>
      <LinkHandles id={id} collapsed={data.collapsed} />
      {selected && !editing && <WidthResizers />}
    </div>
  );
});

/** A card that opens another board, with a small preview of what's on it. */
export const BoardCardItem = memo(function BoardCardItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const target = useBoardIndex((s) => s.boards.find((b) => b.id === data.boardId));
  const loaded = useBoardIndex((s) => s.loaded);
  const { className, style } = look("board", data);
  const open = () => data.boardId && void openBoard(data.boardId);
  const missing = loaded && !target;
  return (
    <div
      className={cls("note", "boardcard", className, missing && "is-missing", selected && "is-selected", dragging && "is-dragging")}
      style={style}
      role="group"
      aria-label={describe("board", data)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        open();
      }}
    >
      <span className="item-sketch" aria-hidden />
      <div className={`boardcard__preview bg--${target?.background ?? "dots"}`}>
        {target && <Thumbnail nodes={target.nodes} edges={target.edges} />}
      </div>
      <div className="boardcard__meta">
        <div className="boardcard__title">{target?.title ?? data.text ?? "Board"}</div>
        <div className="boardcard__sub">
          {missing ? "This board was deleted" : target ? `${target.nodes.length} item${target.nodes.length === 1 ? "" : "s"}` : "Board"}
        </div>
      </div>
      {!missing && (
        <button
          type="button"
          className="linkcard__open nodrag"
          title="Open this board"
          aria-label="Open this board"
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          <OpenIcon />
        </button>
      )}
      <LinkHandles id={id} collapsed={data.collapsed} />
      {selected && <WidthResizers />}
    </div>
  );
});

const ARROW_WIDTH: Record<Size, number> = { s: 1.5, m: 2.5, l: 4 };

/** A free-standing arrow or line. When selected, drag either end to move it. */
export const ArrowItem = memo(function ArrowItem({ id, data, selected, width, height, positionAbsoluteX, positionAbsoluteY }: NodeProps<BoardNode>) {
  const rf = useReactFlow();
  const [x1, y1, x2, y2] = data.ends ?? [0, 0, 0, 0];
  const stroke = ARROW_WIDTH[data.size];
  const head = data.arrowHead ?? "end";
  const dir = unit({ x: x1, y: y1 }, { x: x2, y: y2 });
  const back = { x: -dir.x, y: -dir.y };
  const length = 8 + stroke * 2.2;
  const end = head !== "none" ? offset({ x: x2, y: y2 }, dir, -(length - 2)) : { x: x2, y: y2 };
  const start = head === "both" ? offset({ x: x1, y: y1 }, back, -(length - 2)) : { x: x1, y: y1 };
  const sketchy = useBoard((s) => s.style === "sketchy");
  const straight = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const line = sketchy ? roughPath(straight, id) : straight;

  const dragEnd = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const store = boardStore.getState();
    store.begin();
    const fixed = which === 0 ? { x: positionAbsoluteX + x2, y: positionAbsoluteY + y2 } : { x: positionAbsoluteX + x1, y: positionAbsoluteY + y1 };
    const move = (ev: PointerEvent) => {
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      if (which === 0) store.setArrowEnds(id, p, fixed);
      else store.setArrowEnds(id, fixed, p);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up as EventListener);
      // Dropping an end on an item sticks it there; anywhere else unsticks it.
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      store.stickArrowEnd(id, which === 0 ? "start" : "end", itemAt(p));
      store.commit();
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up as EventListener);
  };

  return (
    <svg
      style={colorLook(data).style}
      className={cls("free-arrow", colorLook(data).className, data.outlineStyle === "dashed" && "is-dashed", selected && "is-selected", data.locked && "is-locked")}
      role="img"
      aria-label={data.arrowHead === "none" ? "Line" : "Arrow"}
      width={width}
      height={height}
    >
      <path className="free-arrow__hit" d={`M ${x1} ${y1} L ${x2} ${y2}`} />
      <path className="free-arrow__line" d={line} style={{ strokeWidth: stroke }} />
      {head !== "none" && <path className="free-arrow__head" d={arrowHead({ x: x2, y: y2 }, dir, length, length * 0.85)} />}
      {head === "both" && <path className="free-arrow__head" d={arrowHead({ x: x1, y: y1 }, back, length, length * 0.85)} />}
      {selected && !data.locked && (
        <>
          <circle className="free-arrow__handle nodrag" cx={x1} cy={y1} r={6} onPointerDown={dragEnd(0)} />
          <circle className="free-arrow__handle nodrag" cx={x2} cy={y2} r={6} onPointerDown={dragEnd(1)} />
        </>
      )}
    </svg>
  );
});

export const nodeTypes = {
  note: NoteItem,
  text: NoteItem,
  shape: ShapeItem,
  image: ImageItem,
  frame: FrameItem,
  ink: InkItem,
  link: LinkCardItem,
  board: BoardCardItem,
  arrow: ArrowItem,
  file: FileItem,
};
