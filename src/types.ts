import type { Edge, Node } from "@xyflow/react";

export const COLORS = ["plain", "yellow", "orange", "red", "pink", "purple", "blue", "teal", "green", "gray"] as const;
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

/** Patterns drawn on the board. */
export const BACKGROUNDS = ["dots", "grid", "lines", "cross", "plain"] as const;

/** Board colours. "default" follows the app's light or dark appearance; the rest keep their own look. */
export const BOARD_COLORS = ["default", "paper", "sky", "mint", "blush", "sand", "slate", "midnight", "blueprint", "chalkboard", "charcoal"] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

/** Typefaces for a board or a single item. */
export const FONTS = ["sans", "serif", "mono", "rounded", "hand"] as const;
export type FontKind = (typeof FONTS)[number];

/** Ways to make an item stand out. */
export const EFFECTS = ["none", "glow", "pulse"] as const;
export type Effect = (typeof EFFECTS)[number];

/** A palette colour, or any colour as #rrggbb. */
export type Paint = Color | `#${string}`;

/** How a board is drawn: crisp, or hand-drawn with wobbly lines and handwriting. */
export const BOARD_STYLES = ["clean", "sketchy"] as const;
export type BoardStyle = (typeof BOARD_STYLES)[number];

export const FILLS = ["solid", "light", "bold", "hatch", "none"] as const;
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
  outlineColor?: Paint;
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
  /** Any fill colour (#rrggbb), used instead of the palette colour. */
  hex?: string;
  /** Text colour, when it shouldn't follow the item's colour. */
  textColor?: Paint;
  /** Typeface, when it shouldn't follow the board's. */
  font?: FontKind;
  /** A glow, or a gentle pulse, to make the item stand out. */
  effect?: Effect;
};

export type BoardNode = Node<ItemData, ItemType>;

export type LinkCurve = "curved" | "straight" | "elbow";
export type LinkArrow = "none" | "end" | "both";
export const LINK_DASHES = ["solid", "dashed", "dotted"] as const;
export type LinkDash = (typeof LINK_DASHES)[number];
/** Line thickness: thin, normal or thick. */
export const LINK_WIDTHS = [1, 2, 3] as const;
export type LinkWidth = (typeof LINK_WIDTHS)[number];
/** The shape at a line's arrow end(s). */
export const LINK_HEADS = ["arrow", "open", "dot", "diamond"] as const;
export type LinkHead = (typeof LINK_HEADS)[number];
/** Movement along a line, to draw the eye: dashes flowing along it, or a soft pulse. */
export const LINK_MOTIONS = ["none", "flow", "pulse"] as const;
export type LinkMotion = (typeof LINK_MOTIONS)[number];

export type LinkData = {
  label: string;
  curve: LinkCurve;
  arrow: LinkArrow;
  dash: LinkDash;
  color?: Paint;
  width?: LinkWidth;
  head?: LinkHead;
  motion?: LinkMotion;
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
