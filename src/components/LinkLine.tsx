import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { paintCss } from "../look";
import { linkEnds, linkGeometry, type LinkGeometry } from "../linkPath";
import { roughPath } from "../sketch";
import { boardStore, defaultLinkData, useBoard } from "../store";
import type { LinkEdge } from "../types";

/** The drawn shape of a link, shared by the line itself and its toolbar. */
export function useLinkGeometry(link: Pick<LinkEdge, "id" | "data">): LinkGeometry | null {
  const ends = useBoard((s) => linkEnds(s.nodes, s.edges).get(link.id));
  const d = link.data ?? defaultLinkData();
  return useMemo(
    () => (ends ? linkGeometry(ends, d.curve, d.arrow, d.head, d.width) : null),
    [ends, d.curve, d.arrow, d.head, d.width],
  );
}

function LinkLine({ id, data, selected }: EdgeProps<LinkEdge>) {
  const editingLabel = useBoard((s) => s.editingLabelId === id);
  const sketchy = useBoard((s) => s.style === "sketchy");
  const geo = useLinkGeometry({ id, data });
  // Hand-drawn boards draw lines with a gentle double-stroke wobble.
  const drawn = useMemo(() => (geo && sketchy ? roughPath(geo.path, id) : geo?.path), [geo, sketchy, id]);
  if (!geo || !drawn) return null;

  const d = data ?? defaultLinkData();
  const colored = !!d.color;
  const className = [
    "link",
    selected && "is-selected",
    d.dash === "dashed" && "is-dashed",
    d.dash === "dotted" && "is-dotted",
    colored && "has-color",
    d.width && d.width !== 2 && `w-${d.width}`,
    d.motion === "flow" && "motion--flow",
  ]
    .filter(Boolean)
    .join(" ");
  const style = colored ? ({ "--lc": paintCss(d.color!) } as CSSProperties) : undefined;
  const headClass = ["link-head", d.head === "open" && "link-head--open", colored && "has-color", selected && "is-selected"].filter(Boolean).join(" ");

  return (
    <>
      {d.motion === "pulse" && <path d={drawn} className="link-glow" style={style} />}
      <BaseEdge path={drawn} className={className} style={style} interactionWidth={22} />
      {geo.heads.map((head, i) => (
        <path key={i} d={head} className={headClass} style={style} />
      ))}
      {(d.label || editingLabel) && (
        <EdgeLabelRenderer>
          <div
            data-edge={id}
            className={`link-label nodrag nopan${selected ? " is-selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${geo.labelX}px, ${geo.labelY}px)` }}
            onClick={() => boardStore.getState().selectOnly([], [id])}
            onDoubleClick={(e) => {
              e.stopPropagation();
              boardStore.getState().startEditingLabel(id);
            }}
          >
            {editingLabel ? <LabelEditor id={id} initial={d.label} /> : d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function LabelEditor({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const { updateLink, startEditingLabel } = boardStore.getState();
    if (save && value.trim() !== initial) updateLink(id, { label: value.trim() });
    startEditingLabel(null);
  };

  return (
    <input
      ref={ref}
      className="link-label__input"
      value={value}
      placeholder="Label"
      size={Math.max(value.length, 5)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

export const edgeTypes = { link: memo(LinkLine) };
