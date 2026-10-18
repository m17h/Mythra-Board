import type { NodeProps } from "@xyflow/react";
import { memo, useEffect, useMemo, useState } from "react";
import { hostOf } from "../images";
import { strokePath } from "../ink";
import { assetUrl, openExternal } from "../persistence";
import { boardStore, useBoard } from "../store";
import type { BoardNode } from "../types";
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

/** Sticky-style notes, and free text (the same thing without the card). */
export const NoteItem = memo(function NoteItem({ id, type, data, selected, dragging }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  const tasks = useMemo(() => taskStats(data.text), [data.text]);
  const isText = type === "text";
  return (
    <div
      className={cls(
        isText ? "textitem" : "note",
        `color--${data.color}`,
        `size--${data.size}`,
        selected && "is-selected",
        editing && "is-editing",
        dragging && "is-dragging",
      )}
      onDoubleClick={startEditing(id)}
    >
      {editing ? (
        <TextEditor id={id} text={data.text} className="item-text" placeholder={isText ? "Type something…" : "Type an idea…"} canBranch />
      ) : (
        <div className={cls("item-text", !data.text && "is-empty")}>
          {data.text ? <RichText text={data.text} onToggle={toggle(id)} /> : isText ? "Text" : "Empty note"}
        </div>
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
  return (
    <div
      className={cls("shape", `shape--${shape}`, `color--${data.color}`, `size--${data.size}`, selected && "is-selected", editing && "is-editing", dragging && "is-dragging")}
      onDoubleClick={startEditing(id)}
    >
      {shape === "diamond" && (
        <svg className="shape__outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polygon points="50,1.5 98.5,50 50,98.5 1.5,50" vectorEffect="non-scaling-stroke" />
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
  return (
    <div className={cls("image", selected && "is-selected", dragging && "is-dragging")}>
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

/** A titled area for grouping things. Dragging it by its title moves everything inside. */
export const FrameItem = memo(function FrameItem({ id, data, selected }: NodeProps<BoardNode>) {
  const editing = useEditing(id);
  return (
    <div className={cls("frame", `color--${data.color}`, selected && "is-selected", editing && "is-editing")}>
      <div className="frame__title" onDoubleClick={startEditing(id)} title="Drag to move this section and everything in it">
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
  return (
    <div
      className={cls("note", "linkcard", `color--${data.color}`, selected && "is-selected", editing && "is-editing", dragging && "is-dragging")}
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
