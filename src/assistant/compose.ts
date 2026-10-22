/**
 * Turns a description of board content ("a blue section with these six notes in a grid",
 * "a mind map with these branches") into items with tidy positions. Claude describes what
 * goes where; this works out the exact sizes and coordinates, so nothing overlaps and
 * everything lines up.
 *
 * Laying out happens in two steps: `plan` turns the description into items (with widths
 * chosen), then, once the items' real heights are known, `arrange` positions everything.
 */
import { asPaint, isHex } from "../look";
import {
  ALIGNS,
  COLORS,
  EFFECTS,
  FONTS,
  LINK_DASHES,
  LINK_HEADS,
  LINK_MOTIONS,
  LINK_WIDTHS,
  type Effect,
  type FontKind,
  FILLS,
  OUTLINE_STYLES,
  OUTLINE_WIDTHS,
  SHAPES,
  SIZES,
  TEXT_STYLES,
  type Align,
  type Color,
  type Fill,
  type ItemData,
  type ItemType,
  type LinkData,
  type OutlineStyle,
  type OutlineWidth,
  type ShapeKind,
  type Size,
  type TextStyle,
} from "../types";

// ---------- What Claude can describe ----------

export type ItemKind = "note" | "text" | "shape" | "board" | "link";

export type Look = {
  /** A palette colour or any #rrggbb. */
  color?: string;
  fill?: Fill;
  outline?: OutlineWidth;
  outline_color?: string;
  outline_style?: OutlineStyle;
  text_color?: string;
  font?: FontKind;
  effect?: Effect;
};

export type ItemSpec = Look & {
  kind: ItemKind;
  ref?: string;
  text?: string;
  title?: string;
  shape?: ShapeKind;
  size?: Size;
  text_style?: TextStyle;
  align?: Align;
  width?: number;
  height?: number;
  url?: string;
  /** For board cards: the id of the board they open (filled in by the caller). */
  board_id?: string;
};

export type Arrangement = "grid" | "column" | "row";

export type SectionSpec = Look & {
  kind: "section";
  ref?: string;
  title: string;
  layout?: Arrangement;
  columns?: number;
  children: Spec[];
};

export type GroupSpec = {
  kind: "group";
  layout?: Arrangement;
  columns?: number;
  align?: "start" | "center";
  children: Spec[];
};

export type Branch = Omit<ItemSpec, "kind"> & { kind?: "note" | "shape" | "text"; children?: Branch[] };

export type MindMapSpec = {
  kind: "mindmap";
  root: Branch;
  /** "both" grows branches to the left and right of the centre; "right" only to the right. */
  direction?: "both" | "right";
  curve?: LinkData["curve"];
};

export type FlowSpec = {
  kind: "flow";
  direction?: "down" | "right";
  steps: ItemSpec[];
  links: LinkSpec[];
};

/** An item that's already on the board, to be moved into the arrangement. */
export type ExistingSpec = { kind: "existing"; id: string };

export type Spec = ItemSpec | SectionSpec | GroupSpec | MindMapSpec | FlowSpec | ExistingSpec;

export type LinkSpec = {
  from: string;
  to: string;
  label?: string;
  curve?: LinkData["curve"];
  arrow?: LinkData["arrow"];
  dash?: LinkData["dash"];
  color?: string;
  width?: number | "thin" | "normal" | "thick";
  head?: LinkData["head"];
  motion?: LinkData["motion"];
};

// ---------- The plan: items to create and how they're arranged ----------

/** An item to create. `key` identifies it until it gets a real id. */
export type PlannedItem = {
  key: string;
  ref?: string;
  type: ItemType;
  data: Partial<ItemData>;
  width: number;
  /** Fixed height (shapes, sections); items whose height follows their text leave it unset. */
  height?: number;
};

export type PlannedLink = { from: string; to: string; data: Partial<LinkData> };

type Leaf = { t: "leaf"; key: string; kind?: ItemType };
type Box = {
  t: "box";
  /** The section drawn around the contents, if any. */
  frame?: string;
  layout: Arrangement;
  columns: number;
  gapX: number;
  gapY: number;
  pad: number;
  align: "start" | "center";
  children: LNode[];
};
type TreeNode = { key: string; children: TreeNode[] };
type Tree = { t: "tree"; root: TreeNode; direction: "both" | "right" };
type Flow = { t: "flow"; keys: string[]; edges: [string, string][]; direction: "down" | "right" };
export type LNode = Leaf | Box | Tree | Flow;

export type Plan = { items: PlannedItem[]; links: PlannedLink[]; root: LNode; problems: string[] };

export type Rect = { x: number; y: number; width: number; height: number };

// Spacing, in board pixels.
const SECTION_PAD = 28;
/** Section titles sit above the section, so stacked sections need room for them. */
const TITLE_ROOM = 34;
const ITEM_GAP = 20;
const SECTION_GAP_X = 48;
const SECTION_GAP_Y = 48 + TITLE_ROOM;
const BLOCK_GAP = 64;
const TREE_GAP_X = 72;
const TREE_GAP_Y = 18;
const FLOW_GAP_ALONG = 70;
const FLOW_GAP_ACROSS = 56;
const MIN_SECTION_WIDTH = 260;

const BRANCH_COLORS: Color[] = ["blue", "green", "orange", "pink", "purple", "yellow"];

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;
const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Colour, fill, outline, text colour, typeface and effect settings, checked. */
export function lookData(spec: Look): Partial<ItemData> {
  const d: Partial<ItemData> = {};
  const color = oneOf(COLORS, spec.color);
  if (color) d.color = color;
  else if (isHex(spec.color)) {
    d.color = "plain";
    d.hex = spec.color.toLowerCase();
  }
  const fill = oneOf(FILLS, spec.fill);
  if (fill) d.fill = fill;
  const outline = OUTLINE_WIDTHS.find((w) => w === spec.outline);
  if (outline !== undefined) d.outline = outline;
  const oc = asPaint(spec.outline_color);
  if (oc) d.outlineColor = oc;
  const os = oneOf(OUTLINE_STYLES, spec.outline_style);
  if (os) d.outlineStyle = os;
  const tc = asPaint(spec.text_color);
  if (tc) d.textColor = tc;
  const font = oneOf(FONTS, spec.font);
  if (font) d.font = font;
  const effect = oneOf(EFFECTS, spec.effect);
  if (effect && effect !== "none") d.effect = effect;
  return d;
}

/** Roughly how many characters fit on a line at a font size, for choosing widths. */
const charWidth = (fontSize: number) => fontSize * 0.55;

const TEXT_FONT: Record<TextStyle, number> = { title: 38, heading: 27, subheading: 19, body: 16, caption: 13 };

/** A comfortable width for an item, judged from how much it says. */
function naturalWidth(type: ItemType, data: Partial<ItemData>): number {
  const text = data.text ?? "";
  const longest = Math.max(0, ...text.split("\n").map((l) => l.length));
  switch (type) {
    case "text": {
      const style = data.textStyle ?? "body";
      const font = TEXT_FONT[style];
      // Room to spare, so a wider typeface (chosen now or later) doesn't wrap a title.
      const wanted = longest * charWidth(font) * 1.3 + 32;
      const max = style === "title" || style === "heading" ? 960 : 720;
      return Math.round(Math.min(max, Math.max(160, wanted)));
    }
    case "shape":
      return 0;
    case "board":
      return 260;
    case "link":
      return 280;
    default: {
      const total = text.length + (data.title?.length ?? 0);
      let w = total > 260 ? 320 : total > 110 ? 270 : total > 40 ? 230 : 200;
      if (data.size === "l") w = Math.max(w, Math.min(360, longest * charWidth(21) + 40));
      if (data.size === "s") w = Math.min(w, 220);
      return w;
    }
  }
}

/** A shape big enough for its label. */
function shapeSize(shape: ShapeKind, text: string, size: Size | undefined): { width: number; height: number } {
  const font = size === "l" ? 21 : size === "s" ? 13 : 15;
  const words = text.trim().length;
  // Diamonds, triangles and the like only have room in their middle.
  const roomy = shape === "rect" || shape === "cylinder" || shape === "arrow";
  const factor = roomy ? 1 : shape === "ellipse" ? 1.25 : 1.6;
  const width = Math.round(Math.min(320, Math.max(150, Math.sqrt(words) * font * 1.9 * factor)));
  const lines = Math.max(1, Math.ceil((words * charWidth(font) * factor) / (width - 40)));
  const height = Math.round(Math.max(shape === "rect" ? 80 : 100, lines * font * 1.5 * factor + 44));
  return { width, height: Math.min(260, height) };
}

/** Turn an item description into a planned item. */
function planItem(spec: Omit<ItemSpec, "kind"> & { kind?: ItemKind }, key: string, fallbackKind: ItemKind = "note"): PlannedItem {
  const kind = oneOf(["note", "text", "shape", "board", "link"] as const, spec.kind) ?? fallbackKind;
  const data: Partial<ItemData> = { text: str(spec.text), ...lookData(spec) };
  const size = oneOf(SIZES, spec.size);
  if (size) data.size = size;
  const align = oneOf(ALIGNS, spec.align);
  if (align) data.align = align;
  let type: ItemType = kind;
  if (kind === "note" && typeof spec.title === "string" && spec.title.trim()) data.title = str(spec.title, 200);
  if (kind === "text") data.textStyle = oneOf(TEXT_STYLES, spec.text_style) ?? "body";
  if (kind === "shape") data.shape = oneOf(SHAPES, spec.shape) ?? "rect";
  if (kind === "link") {
    data.url = /^https?:\/\//i.test(str(spec.url)) ? str(spec.url, 2000) : "";
    if (!data.text) data.text = data.url ?? "";
  }
  if (kind === "board") {
    if (spec.board_id) data.boardId = spec.board_id;
    else type = "note";
  }
  const width = num(spec.width, 80, 1600);
  const height = num(spec.height, 40, 1600);
  if (type === "shape") {
    const auto = shapeSize(data.shape!, data.text ?? "", data.size);
    return { key, ref: spec.ref, type, data, width: width ?? auto.width, height: height ?? auto.height };
  }
  return { key, ref: spec.ref, type, data, width: width ?? naturalWidth(type, data) };
}

/**
 * Turn descriptions into a plan. Top-level blocks are arranged by `layout` (a row by default).
 * Refs name items so links can point at them; links may also use ids of existing items.
 */
export function plan(
  blocks: Spec[],
  givenLinks: LinkSpec[] = [],
  layout: Arrangement = "row",
  columns?: number,
  /** What kind of thing an existing item is (sections need room for their titles). */
  kindOf: (id: string) => ItemType | undefined = () => undefined,
): Plan {
  // Flows hand on links that leave them, so work on a copy.
  const links = Array.isArray(givenLinks) ? [...givenLinks] : [];
  const items: PlannedItem[] = [];
  const planned: PlannedLink[] = [];
  const problems: string[] = [];
  let next = 0;
  const newKey = () => `k${next++}`;
  /** Leaves without a width of their own, per container, so they can be made the same width. */
  const add = (item: PlannedItem) => {
    items.push(item);
    return item;
  };

  const leafOf = (spec: Spec, uniform: PlannedItem[] | null): LNode | null => {
    if (!spec || typeof spec !== "object") return null;
    switch (spec.kind) {
      case "existing":
        return typeof spec.id === "string" ? { t: "leaf", key: `id:${spec.id}`, kind: kindOf(spec.id) } : null;
      case "section":
      case "group":
        return box(spec);
      case "mindmap":
        return mindmap(spec);
      case "flow":
        return flow(spec);
      case "note":
      case "text":
      case "shape":
      case "board":
      case "link": {
        const item = add(planItem(spec, newKey()));
        if (uniform && spec.width === undefined && (item.type === "note" || item.type === "board" || item.type === "link")) uniform.push(item);
        return { t: "leaf", key: item.key, kind: item.type };
      }
      default:
        problems.push(`Skipped something of unknown kind "${String((spec as { kind?: unknown }).kind)}".`);
        return null;
    }
  };

  const uniformOf = new Map<Box, PlannedItem[]>();
  const box = (spec: SectionSpec | GroupSpec): Box => {
    const children = Array.isArray(spec.children) ? spec.children : [];
    const isSection = spec.kind === "section";
    const kids = children.length;
    const lay = oneOf(["grid", "column", "row"] as const, spec.layout) ?? (isSection ? (kids > 3 ? "grid" : "column") : "column");
    const allBlocks = children.every(
      (c) => c && (c.kind === "section" || c.kind === "group" || c.kind === "mindmap" || c.kind === "flow" || (c.kind === "existing" && kindOf(c.id) === "frame")),
    );
    const uniform: PlannedItem[] = [];
    const nodes = children.map((c) => leafOf(c, lay === "row" ? null : uniform)).filter((n): n is LNode => !!n);
    // Notes side by side in a grid or column look tidiest at one width…
    if (uniform.length > 1) {
      const w = Math.min(340, Math.max(...uniform.map((i) => i.width)));
      for (const i of uniform) i.width = w;
    }
    // …and so do notes in sections that sit next to each other.
    const sections = nodes.filter((n): n is Box => n.t === "box" && !!n.frame);
    if (lay !== "column" && sections.length > 1) {
      const lists = sections.map((b) => uniformOf.get(b) ?? []).filter((l) => l.length);
      const w = Math.min(340, Math.max(0, ...lists.flat().map((i) => i.width)));
      if (lists.length > 1) for (const i of lists.flat()) i.width = w;
    }
    const cols = lay === "grid" ? (num(spec.columns, 1, 8) ?? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length))))) : 1;
    const out: Box = {
      t: "box",
      layout: lay,
      columns: cols,
      gapX: allBlocks ? SECTION_GAP_X : ITEM_GAP,
      gapY: allBlocks ? SECTION_GAP_Y : ITEM_GAP,
      pad: isSection ? SECTION_PAD : 0,
      align: spec.kind === "group" && spec.align === "center" ? "center" : "start",
      children: nodes,
    };
    // A group of things that each have a section title above them needs room for those too.
    if (!isSection && lay !== "row" && nodes.some(titledTop)) out.gapY = Math.max(out.gapY, SECTION_GAP_Y);
    uniformOf.set(out, uniform);
    if (isSection) {
      const frame = add({ key: newKey(), ref: spec.ref, type: "frame", data: { text: str(spec.title, 120) || "Section", ...lookData(spec) }, width: MIN_SECTION_WIDTH, height: 200 });
      out.frame = frame.key;
    }
    return out;
  };

  const mindmap = (spec: MindMapSpec): LNode | null => {
    if (!spec.root || typeof spec.root !== "object") return null;
    const curve = spec.curve ?? "curved";
    const walk = (b: Branch, depth: number, inherited: string | undefined, index: number): TreeNode => {
      const color: string | undefined = b.color ?? (depth === 0 ? "purple" : depth === 1 ? BRANCH_COLORS[index % BRANCH_COLORS.length] : inherited);
      const size: Size = b.size ?? (depth === 0 ? "l" : depth >= 2 ? "s" : "m");
      const item = add(planItem({ ...b, color, size }, newKey(), "note"));
      const children = (Array.isArray(b.children) ? b.children : []).filter((c) => c && typeof c === "object").slice(0, 12);
      const node: TreeNode = { key: item.key, children: children.map((c, i) => walk(c, depth + 1, color, i)) };
      for (const c of node.children) planned.push({ from: item.key, to: c.key, data: { arrow: "none", curve } });
      return node;
    };
    return { t: "tree", root: walk(spec.root, 0, undefined, 0), direction: spec.direction === "right" ? "right" : "both" };
  };

  const flow = (spec: FlowSpec): LNode | null => {
    const steps = (Array.isArray(spec.steps) ? spec.steps : []).filter((s) => s && typeof s === "object");
    if (!steps.length) return null;
    const keys = steps.map((s) => add(planItem(s, newKey(), "shape")).key);
    const byRef = new Map(steps.map((s, i) => [s.ref, keys[i]] as const).filter(([r]) => typeof r === "string"));
    const edges: [string, string][] = [];
    for (const l of Array.isArray(spec.links) ? spec.links : []) {
      const a = byRef.get(l?.from);
      const b = byRef.get(l?.to);
      if (!a || !b) {
        links.push(l);
        continue;
      }
      edges.push([a, b]);
      planned.push({ from: a, to: b, data: linkData(l, { curve: "elbow", arrow: "end" }) });
    }
    return { t: "flow", keys, edges, direction: spec.direction === "right" ? "right" : "down" };
  };

  const top: Box = box({ kind: "group", layout, columns, children: Array.isArray(blocks) ? blocks : [] });
  if (top.children.every((c) => c.t !== "leaf")) {
    top.gapX = BLOCK_GAP + 16;
    top.gapY = BLOCK_GAP + TITLE_ROOM;
  } else {
    top.gapX = top.gapY = BLOCK_GAP / 2;
  }
  if (layout === "grid") top.columns = num(columns, 1, 8) ?? Math.min(3, Math.max(2, Math.ceil(Math.sqrt(top.children.length))));
  const root: LNode = top.children.length === 1 ? top.children[0] : top;

  // Links between refs (or existing ids) anywhere in the plan.
  const byRef = new Map(items.filter((i) => i.ref).map((i) => [i.ref!, i.key]));
  const resolve = (r: string) => byRef.get(r) ?? (typeof r === "string" && r ? `id:${r}` : null);
  for (const l of links) {
    if (!l || typeof l !== "object") continue;
    const a = resolve(l.from);
    const b = resolve(l.to);
    if (!a || !b || a === b) {
      problems.push(`Couldn't link "${String(l.from)}" to "${String(l.to)}".`);
      continue;
    }
    planned.push({ from: a, to: b, data: linkData(l) });
  }
  return { items, links: planned, root, problems };
}

export function linkData(l: Partial<LinkSpec>, defaults: Partial<LinkData> = {}): Partial<LinkData> {
  const d: Partial<LinkData> = { ...defaults };
  if (typeof l.label === "string") d.label = l.label.slice(0, 200);
  const curve = oneOf(["curved", "straight", "elbow"] as const, l.curve);
  if (curve) d.curve = curve;
  const arrow = oneOf(["none", "end", "both"] as const, l.arrow);
  if (arrow) d.arrow = arrow;
  const dash = oneOf(LINK_DASHES, l.dash);
  if (dash) d.dash = dash;
  const color = asPaint(l.color);
  if (color) d.color = color;
  const width = typeof l.width === "string" ? ({ thin: 1, normal: 2, thick: 3 } as const)[l.width as "thin"] : LINK_WIDTHS.find((w) => w === l.width);
  if (width) d.width = width;
  const head = oneOf(LINK_HEADS, l.head);
  if (head) d.head = head;
  const motion = oneOf(LINK_MOTIONS, l.motion);
  if (motion) d.motion = motion === "none" ? undefined : motion;
  return d;
}

// ---------- Arranging, once sizes are known ----------

type Size2 = { width: number; height: number };

/**
 * Where everything goes, relative to the arrangement's top-left corner (0, 0). `sizeOf`
 * gives each item's size (real heights where known); sections are sized to fit.
 */
export function arrange(root: LNode, sizeOf: (key: string) => Size2): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const sizes = new Map<LNode, Size2>();

  const measure = (n: LNode): Size2 => {
    const known = sizes.get(n);
    if (known) return known;
    let s: Size2;
    if (n.t === "leaf") s = sizeOf(n.key);
    else if (n.t === "box") s = measureBox(n);
    else if (n.t === "tree") s = treeLayout(n, sizeOf, new Map()).size;
    else s = flowLayout(n, sizeOf, new Map()).size;
    sizes.set(n, s);
    return s;
  };

  /** Rows (or columns) of children, for grid, row and column arrangements. */
  const lines = (b: Box): LNode[][] => {
    if (b.layout === "row") return [b.children];
    if (b.layout === "column") return b.children.map((c) => [c]);
    const rows: LNode[][] = [];
    for (let i = 0; i < b.children.length; i += b.columns) rows.push(b.children.slice(i, i + b.columns));
    return rows;
  };

  const columnWidths = (b: Box): number[] => {
    if (b.layout !== "grid") return [];
    const widths: number[] = [];
    b.children.forEach((c, i) => {
      const col = i % b.columns;
      widths[col] = Math.max(widths[col] ?? 0, measure(c).width);
    });
    return widths;
  };

  function measureBox(b: Box): Size2 {
    const rows = lines(b);
    const cols = columnWidths(b);
    let width = 0;
    let height = 0;
    rows.forEach((row, r) => {
      const rowWidth = row.reduce((sum, c, i) => sum + (b.layout === "grid" ? cols[i] : measure(c).width), 0) + b.gapX * (row.length - 1);
      const rowHeight = Math.max(0, ...row.map((c) => measure(c).height));
      width = Math.max(width, rowWidth);
      height += rowHeight + (r > 0 ? rowGap(b, rows[r - 1], row) : 0);
    });
    if (b.frame) {
      width = Math.max(width + b.pad * 2, MIN_SECTION_WIDTH);
      height = Math.max(height + b.pad * 2, 140);
    }
    return { width, height };
  }

  const place = (n: LNode, x: number, y: number, forced?: Size2) => {
    if (n.t === "leaf") {
      const s = sizeOf(n.key);
      out.set(n.key, { x, y, width: s.width, height: s.height });
      return;
    }
    if (n.t === "tree") {
      const pos = new Map<string, Rect>();
      treeLayout(n, sizeOf, pos);
      for (const [k, r] of pos) out.set(k, { ...r, x: r.x + x, y: r.y + y });
      return;
    }
    if (n.t === "flow") {
      const pos = new Map<string, Rect>();
      flowLayout(n, sizeOf, pos);
      for (const [k, r] of pos) out.set(k, { ...r, x: r.x + x, y: r.y + y });
      return;
    }
    const size = measure(n);
    const width = forced?.width ?? size.width;
    const height = forced?.height ?? size.height;
    if (n.frame) out.set(n.frame, { x, y, width, height });
    const inner = n.frame ? n.pad : 0;
    const innerWidth = width - inner * 2;
    // A section stretched wider than its contents keeps them centred.
    const centre = n.frame && width > size.width + 1 ? (width - size.width) / 2 : 0;
    const rows = lines(n);
    const cols = columnWidths(n);
    // Sections side by side in a row are stretched to the same height, like columns on a board.
    const stretchRow = n.layout === "row" && n.children.length > 1 && n.children.every((c) => c.t === "box" && c.frame);
    // Sections stacked in a column share one width.
    const stretchColumn = n.layout === "column" && n.children.length > 1 && n.children.every((c) => c.t === "box" && c.frame);
    let cy = y + inner;
    for (const row of rows) {
      const rowHeight = Math.max(0, ...row.map((c) => measure(c).height));
      const rowWidth = row.reduce((sum, c, i) => sum + (n.layout === "grid" ? cols[i] : measure(c).width), 0) + n.gapX * (row.length - 1);
      let cx = x + inner + centre + (n.align === "center" ? Math.max(0, (innerWidth - centre * 2 - rowWidth) / 2) : 0);
      row.forEach((c, i) => {
        const s = measure(c);
        const cellWidth = n.layout === "grid" ? cols[i] : s.width;
        let force: Size2 | undefined;
        if (stretchRow) force = { width: s.width, height: rowHeight };
        else if (stretchColumn) force = { width: innerWidth, height: s.height };
        else if (n.layout === "grid" && c.t === "box" && c.frame) force = { width: cellWidth, height: rowHeight };
        const ox = n.align === "center" && n.layout === "column" ? Math.max(0, (innerWidth - s.width) / 2) : 0;
        place(c, cx + ox, cy, force);
        cx += cellWidth + n.gapX;
      });
      const next = rows[rows.indexOf(row) + 1];
      if (next) cy += rowHeight + rowGap(n, row, next);
    }
  };

  place(root, 0, 0);
  return out;
}

/** Whether a section title sits at the top of this part of the arrangement. */
function titledTop(n: LNode): boolean {
  if (n.t === "leaf") return n.kind === "frame";
  if (n.t !== "box") return false;
  if (n.frame) return true;
  const first = n.layout === "column" ? n.children.slice(0, 1) : n.children.slice(0, n.layout === "grid" ? n.columns : undefined);
  return first.some(titledTop);
}

const isText = (n: LNode) => n.t === "leaf" && n.kind === "text";

/**
 * Space between two rows: a caption hugs the title above it, and a section's title (which
 * sits above the section) gets room so it doesn't crowd what's above.
 */
function rowGap(b: Box, above: LNode[], below: LNode[]): number {
  if (b.layout === "column" && isText(above[0]) && isText(below[0])) return 8;
  const base = b.layout === "column" && above.some(isText) ? Math.min(b.gapY, 28) : b.gapY;
  return below.some(titledTop) && base < TITLE_ROOM + 20 ? base + TITLE_ROOM : base;
}

/** A mind map: the root in the middle, branches in columns to either side. */
function treeLayout(tree: Tree, sizeOf: (key: string) => Size2, out: Map<string, Rect>): { size: Size2 } {
  const block = new Map<TreeNode, number>();
  const heightOf = (n: TreeNode): number => {
    const own = sizeOf(n.key).height;
    const kids = n.children.reduce((s, c) => s + heightOf(c), 0) + TREE_GAP_Y * Math.max(0, n.children.length - 1);
    const h = Math.max(own, kids);
    block.set(n, h);
    return h;
  };
  const rootKids = tree.root.children;
  const sides: Record<"left" | "right", TreeNode[]> = { left: [], right: [] };
  if (tree.direction === "right" || rootKids.length < 3) sides.right = rootKids;
  else {
    // Share branches between the sides so both are about as tall.
    const sorted = rootKids.map((c) => ({ c, h: heightOf(c) }));
    let r = 0;
    let l = 0;
    for (const { c, h } of sorted) {
      if (r <= l) {
        sides.right.push(c);
        r += h + TREE_GAP_Y;
      } else {
        sides.left.push(c);
        l += h + TREE_GAP_Y;
      }
    }
  }
  const colWidth = { left: [] as number[], right: [] as number[] };
  const measureCols = (n: TreeNode, depth: number, side: "left" | "right") => {
    colWidth[side][depth] = Math.max(colWidth[side][depth] ?? 0, sizeOf(n.key).width);
    for (const c of n.children) measureCols(c, depth + 1, side);
  };
  for (const side of ["left", "right"] as const) for (const c of sides[side]) measureCols(c, 0, side);

  const root = sizeOf(tree.root.key);
  const rects = new Map<string, Rect>();
  const rootRect = { x: 0, y: 0, width: root.width, height: root.height };
  rects.set(tree.root.key, rootRect);
  const colX = (side: "left" | "right", depth: number, width: number) => {
    let x = side === "right" ? root.width + TREE_GAP_X : -TREE_GAP_X;
    for (let d = 0; d < depth; d++) x += side === "right" ? colWidth.right[d] + TREE_GAP_X : -(colWidth.left[d] + TREE_GAP_X);
    return side === "right" ? x : x - width;
  };
  const placeNode = (n: TreeNode, top: number, depth: number, side: "left" | "right") => {
    const s = sizeOf(n.key);
    const h = block.get(n) ?? heightOf(n);
    rects.set(n.key, { x: colX(side, depth, s.width), y: top + (h - s.height) / 2, width: s.width, height: s.height });
    const kidsHeight = n.children.reduce((sum, c) => sum + block.get(c)!, 0) + TREE_GAP_Y * Math.max(0, n.children.length - 1);
    let y = top + (h - kidsHeight) / 2;
    for (const c of n.children) {
      placeNode(c, y, depth + 1, side);
      y += block.get(c)! + TREE_GAP_Y;
    }
  };
  for (const side of ["left", "right"] as const) {
    const kids = sides[side];
    if (!kids.length) continue;
    const total = kids.reduce((s, c) => s + heightOf(c), 0) + TREE_GAP_Y * (kids.length - 1);
    let y = root.height / 2 - total / 2;
    for (const c of kids) {
      placeNode(c, y, 0, side);
      y += block.get(c)! + TREE_GAP_Y;
    }
  }
  return { size: normalise(rects, out) };
}

/**
 * A flowchart: steps in layers following the links (top to bottom, or left to right). Links
 * that skip layers get a lane of their own, steps sit under the steps that lead to them, and
 * each layer is ordered to keep links from crossing where possible.
 */
function flowLayout(flow: Flow, sizeOf: (key: string) => Size2, out: Map<string, Rect>): { size: Size2 } {
  const { keys, edges } = flow;
  const down = flow.direction === "down";
  const index = new Map(keys.map((k, i) => [k, i]));
  const outs = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const [a, b] of edges) outs.get(a)?.push(b);
  // Ignore links that loop back (found by a depth-first walk in the order steps were given).
  const forward: [string, string][] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (k: string) => {
    state.set(k, 1);
    for (const b of outs.get(k) ?? []) {
      if (state.get(b) === 1) continue;
      forward.push([k, b]);
      if (!state.has(b)) visit(b);
    }
    state.set(k, 2);
  };
  for (const k of keys) if (!state.has(k)) visit(k);
  // Each step's layer: one after the furthest step leading into it.
  const layer = new Map<string, number>(keys.map((k) => [k, 0]));
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;
    for (const [a, b] of forward) {
      if (layer.get(b)! < layer.get(a)! + 1) {
        layer.set(b, layer.get(a)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Links that skip layers pass through placeholder points, one per layer they cross.
  const across = (k: string) => (k.startsWith("~") ? 24 : down ? sizeOf(k).width : sizeOf(k).height);
  const depthOf = (k: string) => (k.startsWith("~") ? 0 : down ? sizeOf(k).height : sizeOf(k).width);
  const preds = new Map<string, string[]>(keys.map((k) => [k, []]));
  const succs = new Map<string, string[]>(keys.map((k) => [k, []]));
  const all = [...keys];
  let dummies = 0;
  for (const [a, b] of forward) {
    let prev = a;
    for (let l = layer.get(a)! + 1; l < layer.get(b)!; l++) {
      const d = `~${dummies++}`;
      layer.set(d, l);
      all.push(d);
      preds.set(d, [prev]);
      succs.set(d, []);
      succs.get(prev)!.push(d);
      prev = d;
    }
    succs.get(prev)!.push(b);
    preds.get(b)!.push(prev);
  }
  const layers: string[][] = [];
  for (const k of all) (layers[layer.get(k)!] ??= []).push(k);

  // Order each layer by where its neighbours sit, sweeping down and up a few times.
  const order = new Map<string, number>();
  layers.forEach((l) => l.forEach((k, i) => order.set(k, i)));
  const tie = (k: string) => index.get(k) ?? keys.length;
  for (let sweep = 0; sweep < 6; sweep++) {
    const downward = sweep % 2 === 0;
    const range = downward ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const li of range) {
      const l = layers[li];
      const near = downward ? preds : succs;
      const score = (k: string) => {
        const p = near.get(k) ?? [];
        return p.length ? p.reduce((s, x) => s + order.get(x)!, 0) / p.length : order.get(k)!;
      };
      const scores = new Map(l.map((k) => [k, score(k)]));
      l.sort((a, b) => scores.get(a)! - scores.get(b)! || tie(a) - tie(b));
      l.forEach((k, i) => order.set(k, i));
    }
  }

  // Positions across the flow: start packed and centred, then pull each step towards the
  // steps it's linked to, keeping order and spacing.
  const gapBetween = (a: string, b: string) => (a.startsWith("~") || b.startsWith("~") ? 36 : FLOW_GAP_ACROSS);
  const mid = new Map<string, number>();
  for (const l of layers) {
    let x = 0;
    l.forEach((k, i) => {
      if (i > 0) x += gapBetween(l[i - 1], k);
      mid.set(k, x + across(k) / 2);
      x += across(k);
    });
    for (const k of l) mid.set(k, mid.get(k)! - x / 2);
  }
  const settle = (l: string[], want: Map<string, number>) => {
    // Place in order at the wanted spot, pushing right to make room…
    const pos: number[] = [];
    l.forEach((k, i) => {
      const w = want.get(k)!;
      pos[i] = i === 0 ? w : Math.max(w, pos[i - 1] + across(l[i - 1]) / 2 + gapBetween(l[i - 1], k) + across(k) / 2);
    });
    // …then shift the whole layer back so it's as close to where it wanted to be as possible.
    const drift = l.reduce((s, k, i) => s + (pos[i] - want.get(k)!), 0) / l.length;
    l.forEach((k, i) => mid.set(k, pos[i] - drift));
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    const downward = sweep % 2 === 0;
    const range = downward ? layers.map((_, i) => i) : layers.map((_, i) => i).reverse();
    for (const li of range) {
      const l = layers[li];
      const want = new Map<string, number>();
      for (const k of l) {
        // Steps line up with the steps they're linked to; the lanes of long links follow the
        // steps rather than pulling them sideways.
        let near = [...(downward ? preds.get(k)! : succs.get(k)!)];
        if (!k.startsWith("~")) near = near.filter((x) => !x.startsWith("~"));
        want.set(k, near.length ? near.reduce((s, x) => s + mid.get(x)!, 0) / near.length : mid.get(k)!);
      }
      settle(l, want);
    }
  }

  const rects = new Map<string, Rect>();
  let along = 0;
  for (const l of layers) {
    const depth = Math.max(0, ...l.map(depthOf));
    for (const k of l) {
      if (k.startsWith("~")) continue;
      const s = sizeOf(k);
      const a = mid.get(k)! - across(k) / 2;
      const offset = (depth - depthOf(k)) / 2;
      rects.set(k, down ? { x: a, y: along + offset, width: s.width, height: s.height } : { x: along + offset, y: a, width: s.width, height: s.height });
    }
    along += depth + (down ? FLOW_GAP_ALONG : FLOW_GAP_ALONG + 40);
  }
  return { size: normalise(rects, out) };
}

/** Shift rects so their bounds start at (0, 0); copy them into `out` and return their size. */
function normalise(rects: Map<string, Rect>, out: Map<string, Rect>): Size2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!rects.size) return { width: 0, height: 0 };
  for (const [k, r] of rects) out.set(k, { ...r, x: r.x - minX, y: r.y - minY });
  return { width: maxX - minX, height: maxY - minY };
}

/** A rough height for an item before it has been drawn, so it can be placed out of sight first. */
export function estimateHeight(item: PlannedItem): number {
  if (item.height) return item.height;
  const font = item.type === "text" ? TEXT_FONT[item.data.textStyle ?? "body"] : item.data.size === "l" ? 21 : item.data.size === "s" ? 13 : 15;
  const perLine = Math.max(8, (item.width - 30) / charWidth(font));
  const lines = (item.data.text ?? "").split("\n").reduce((s, l) => s + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.round(lines * font * 1.45 + (item.type === "text" ? 10 : 26) + (item.data.title ? 30 : 0));
}
