import type { Edge, Node } from "@xyflow/react";

export const COLORS = ["plain", "yellow", "orange", "pink", "purple", "blue", "green"] as const;
export type Color = (typeof COLORS)[number];

export const SIZES = ["s", "m", "l"] as const;
export type Size = (typeof SIZES)[number];

export const SHAPES = ["rect", "ellipse", "diamond"] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const TEXT_STYLES = ["title", "heading", "subheading", "body", "caption"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const ALIGNS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNS)[number];

/** Outline thickness in board pixels; 0 means no outline. */
export const OUTLINE_WIDTHS = [0, 1, 2, 4] as const;
export type OutlineWidth = (typeof OUTLINE_WIDTHS)[number];

export const OUTLINE_STYLES = ["solid", "dashed"] as const;
export type OutlineStyle = (typeof OUTLINE_STYLES)[number];

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
  /** A card title shown above a note's body. Present (even empty) means the title is shown. */
  title?: string;
  /** Typography preset for text items. */
  textStyle?: TextStyle;
  align?: Align;
  /** Outline thickness; when unset, each type uses its own default. */
  outline?: OutlineWidth;
  outlineColor?: Color;
  outlineStyle?: OutlineStyle;
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

/** Types that can have an outline. */
export const OUTLINABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "image", "frame", "link"]);
/** Types whose text can be aligned. */
export const ALIGNABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape"]);
/** Outline each type has before the user picks one. */
export const DEFAULT_OUTLINE: Record<ItemType, OutlineWidth> = {
  note: 0,
  text: 0,
  shape: 2,
  image: 0,
  frame: 1,
  ink: 0,
  link: 0,
};

/** Text items made before text styles existed used the S/M/L size instead. */
export const textStyleOf = (d: ItemData): TextStyle =>
  d.textStyle ?? (d.size === "l" ? "title" : d.size === "s" ? "body" : "subheading");
