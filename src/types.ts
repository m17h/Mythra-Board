import type { Edge, Node } from "@xyflow/react";

export const COLORS = ["plain", "yellow", "orange", "pink", "purple", "blue", "green"] as const;
export type Color = (typeof COLORS)[number];

export const SIZES = ["s", "m", "l"] as const;
export type Size = (typeof SIZES)[number];

export const SHAPES = ["rect", "ellipse", "diamond", "triangle", "hexagon", "star", "cylinder", "arrow"] as const;
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

export const ITEM_TYPES = ["note", "text", "shape", "image", "frame", "ink", "link", "board", "arrow", "file"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const BACKGROUNDS = ["dots", "grid", "plain"] as const;

/** How a board is drawn: crisp, or hand-drawn with wobbly lines and handwriting. */
export const BOARD_STYLES = ["clean", "sketchy"] as const;
export type BoardStyle = (typeof BOARD_STYLES)[number];

export const FILLS = ["solid", "light", "hatch", "none"] as const;
export type Fill = (typeof FILLS)[number];
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
  /** For board cards: the board they open. */
  boardId?: string;
  /** Hide everything this item links out to (a folded mind-map branch). */
  collapsed?: boolean;
  /** For free arrows and lines: [x1, y1, x2, y2] relative to the item's corner. */
  ends?: [number, number, number, number];
  /** For free arrows: which ends get arrowheads. */
  arrowHead?: LinkArrow;
  /** Locked items can't be moved, resized, edited or deleted until unlocked. */
  locked?: boolean;
  /** Items sharing a group id are selected and moved together. */
  group?: string;
  /** How the background colour is painted (cards, shapes and sections). */
  fill?: Fill;
  /** For free arrows: the items each end is stuck to, so the arrow follows them. */
  startId?: string;
  endId?: string;
  /** For file cards: the file's size in bytes. */
  fileSize?: number;
  /** For pictures: cropped to fill the frame, centred on this point (0–1 across and down). */
  crop?: [number, number];
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
export const AUTO_HEIGHT: ReadonlySet<ItemType> = new Set(["note", "text", "link", "board", "file"]);
/** Types that links can attach to. */
export const LINKABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "image", "link", "board", "file"]);
/** Types you can type into. */
export const EDITABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "frame", "link", "image"]);

/** Types that can have an outline. */
export const OUTLINABLE: ReadonlySet<ItemType> = new Set(["note", "text", "shape", "image", "frame", "link", "board", "file"]);
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
  board: 0,
  arrow: 0,
  file: 0,
};

/** Text items made before text styles existed used the S/M/L size instead. */
export const textStyleOf = (d: ItemData): TextStyle =>
  d.textStyle ?? (d.size === "l" ? "title" : d.size === "s" ? "body" : "subheading");

export const ARRANGE_MODES = ["left", "hcenter", "right", "top", "vmiddle", "bottom", "distributeX", "distributeY"] as const;
export type ArrangeMode = (typeof ARRANGE_MODES)[number];

/** Types whose background can be solid, light, hatched or see-through. */
export const FILLABLE: ReadonlySet<ItemType> = new Set(["note", "shape", "frame", "link", "board", "file"]);
