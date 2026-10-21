import { useReactFlow, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import { hostOf } from "../images";
import { strokePath } from "../ink";
import { assetUrl, openExternal } from "../persistence";
import { boardStore, useBoard } from "../store";
import { DEFAULT_NOTE_WIDTH, DEFAULT_OUTLINE, textStyleOf, type BoardNode, type ItemData, type ItemType } from "../types";
import { GlobeIcon, OpenIcon } from "./icons";
import { BoxResizer, LinkHandles, TextEditor, WidthResizers } from "./itemParts";
import RichText, { taskStats } from "./RichText";

const useEditing = (id: string) => useBoard((s) => s.editingId === id);

const startEditing = (id: string) => (e: React.MouseEvent) => {
  e.stopPropagation();
  boardStore.getState().startEditing(id);
};

const toggle = (id: string) => (line: number) => boardStore.getState().toggleTask(id, line);

const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/**
 * Classes and CSS variables for an item's outline and text alignment. Outlines are drawn by
 * CSS from `--ow` (width), `--os` (solid/dashed) and `--oc` (colour).
 */
function look(type: ItemType, data: ItemData): { className: string; style: CSSProperties } {
  const width = data.outline ?? DEFAULT_OUTLINE[type];
  const style = {
    "--ow": `${width}px`,
    "--os": data.outlineStyle ?? "solid",
    ...(data.outlineColor ? { "--oc": `var(--ink-${data.outlineColor})` } : {}),
  } as CSSProperties;
  return {
    className: cls(
      width > 0 && "has-outline",
      data.outline !== undefined && "outline-set",
      data.outlineStyle === "dashed" && "is-dashed-outline",
      data.align && `align--${data.align}`,
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
        `color--${data.color}`,
        `size--${data.size}`,
        hasTitle && "has-title",
        hasTitle && (data.text || editing) && "has-body",
        className,
        selected && "is-selected",
        editing && "is-editing",
        dragging && "is-dragging",
      )}
      style={style}
      onDoubleClick={startEditing(id)}
    >
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
      {!isText && tasks.total > 0 && !editing && (
        <div className="task-progress" title={`${tasks.done} of ${tasks.total} done`}>
          <div className="task-progress__track">
            <div className="task-progress__bar" style={{ width: `${(tasks.done / tasks.total) * 100}%` }} />
          </div>
          <span>
            {tasks.done}/{tasks.total}
          </span>
        </div>
      )}
      <LinkHandles id={id} />
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
        `color--${data.color}`,
        `size--${data.size}`,
        className,
        selected && "is-selected",
        editing && "is-editing",
        dragging && "is-dragging",
      )}
      style={style}
      onDoubleClick={startEditing(id)}
    >
      {shape === "diamond" && (
        <svg className="shape__outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polygon points="50,0 100,50 50,100 0,50" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="shape__label">
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
      <LinkHandles id={id} />
      <BoxResizer visible={!!selected && !editing} />
    </div>
  );
});

export const ImageItem = memo(function ImageItem({ id, data, selected, dragging }: NodeProps<BoardNode>) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
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
  return (
    <div className={cls("image", `color--${data.color}`, className, selected && "is-selected", dragging && "is-dragging")} style={style}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className={cls("image__placeholder", failed && "is-failed")}>{failed ? "Image missing" : ""}</div>
      )}
      <LinkHandles id={id} />
      <BoxResizer visible={!!selected} keepAspectRatio minWidth={40} minHeight={40} />
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
      className={cls("frame", `color--${data.color}`, className, selected && "is-selected", editing && "is-editing", dropTarget && "is-drop-target")}
      style={style}
      onDoubleClick={(e) => {
        // Double-clicking inside a section adds a note there, just like on the open board.
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        boardStore.getState().addNote({ x: p.x - DEFAULT_NOTE_WIDTH / 2, y: p.y - 22 }, { edit: true });
      }}
    >
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
    <svg className={cls("ink", `color--${data.color}`, selected && "is-selected", erasing && "is-erasable")} width={width} height={height}>
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
      className={cls("note", "linkcard", `color--${data.color}`, className, selected && "is-selected", editing && "is-editing", dragging && "is-dragging")}
      style={style}
      onDoubleClick={startEditing(id)}
    >
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
      <LinkHandles id={id} />
      {selected && !editing && <WidthResizers />}
    </div>
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
};
