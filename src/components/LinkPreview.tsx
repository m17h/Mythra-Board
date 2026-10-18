import type { ConnectionLineComponentProps, InternalNode } from "@xyflow/react";
import { previewGeometry } from "../linkPath";
import { DEFAULT_NOTE_WIDTH, type BoardNode } from "../types";

const rectOfInternal = (n: InternalNode<BoardNode>) => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  width: n.measured.width ?? n.width ?? DEFAULT_NOTE_WIDTH,
  height: n.measured.height ?? 50,
});

/** The dashed line that follows the pointer while you drag out a new link. */
export default function LinkPreview({ fromNode, toNode, toX, toY, connectionStatus }: ConnectionLineComponentProps<BoardNode>) {
  const target = toNode && connectionStatus === "valid" ? rectOfInternal(toNode) : null;
  const path = previewGeometry(rectOfInternal(fromNode), { x: toX, y: toY }, target);
  return (
    <g className={`link-preview${connectionStatus === "invalid" ? " is-invalid" : ""}`}>
      <path d={path} />
      {!target && <circle cx={toX} cy={toY} r={4} />}
    </g>
  );
}
