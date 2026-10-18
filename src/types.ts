import type { Edge, Node } from "@xyflow/react";

export const COLORS = ["plain", "yellow", "orange", "pink", "purple", "blue", "green"] as const;
export type Color = (typeof COLORS)[number];

export const SIZES = ["s", "m", "l"] as const;
export type Size = (typeof SIZES)[number];

export const SHAPES = ["rect", "ellipse", "diamond"] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const ITEM_TYPES = ["note", "text", "shape", "image", "frame", "ink", "link"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const BACKGROUNDS = ["dots", "grid", "plain"] as const;
export type BoardBackground = (typeof BACKGROUNDS)[number];

/**
 * Everything on a board shares one data shape; each type only uses the fields it needs.
 * `text` is a note's body, a shape's label, a frame's title or a link card's title.
 */
export type ItemData = {
  text: string;
  color: Color;
  size: Size;
  shape?: ShapeKind;
  /** Image file name in the asset store. */
  asset?: string;
  /** Pen stroke as flat [x, y, pressure, …] triples relative to the item's corner. */
  points?: number[];
  url?: string;
};

export type BoardNode = Node<ItemData, ItemType>;

export type LinkCurve = "curved" | "straight" | "elbow";
export type LinkArrow = "none" | "end" | "both";
export type LinkDash = "solid" | "dashed";

export type LinkData = {
  label: string;
  curve: LinkCurve;
  arrow: LinkArrow;
  dash: LinkDash;
};

export type LinkEdge = Edge<LinkData, "link">;

export type LinkStyle = Omit<LinkData, "label">;

export const DEFAULT_NOTE_WIDTH = 220;
export const MIN_NOTE_WIDTH = 120;
export const MAX_NOTE_WIDTH = 720;

/** Types whose height follows their text instead of being set by resizing. */
export const AUTO_HEIGHT: ReadonlySet<ItemType> = new Set(["note", "text", "link"]);
/** Types that links can attach to. */
export const LINKABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "image", "link"]);
/** Types you can type into. */
export const EDITABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "frame", "link"]);
