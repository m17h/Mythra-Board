/**
 * The tools Claude uses to work on boards, and what each one does. Every change goes
 * through the open board's store, so it shows up live and saves like any other edit.
 */
import { center, containsPoint, rectsBounds, rectsOverlap } from "../geometry";
import { itemsInFrame, rectOf } from "../layout";
import { tidyTree } from "../mindmap";
import { boardIndex, createBoard, findBoardByTitle, makeBoardDoc, openBoard, refreshBoardIndex } from "../navigation";
import { boardStore, makeItem, makeLink } from "../store";
import {
  ALIGNS,
  AUTO_HEIGHT,
  BACKGROUNDS,
  BOARD_STYLES,
  COLORS,
  EFFECTS,
  FONTS,
  LINK_DASHES,
  LINK_HEADS,
  LINK_MOTIONS,
  FILLS,
  OUTLINE_STYLES,
  SHAPES,
  SIZES,
  TEXT_STYLES,
  textStyleOf,
  type BoardBackground,
  type BoardNode,
  type BoardStyle,
  type FontKind,
  type ItemData,
  type LinkEdge,
} from "../types";
import { asBoardColor, BOARD_TINTS, boardLook, THEMES } from "../look";
import {
  arrange,
  estimateHeight,
  linkData,
  lookData,
  plan,
  type Arrangement,
  type LinkSpec,
  type Plan,
  type Rect,
  type Spec,
} from "./compose";

export type ToolResult = { text: string; image?: { data: string; mediaType: "image/jpeg" | "image/png" } };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

// ---------- Schemas ----------

const colorProp = {
  type: "string",
  description: `A palette colour (${COLORS.join(", ")}; plain is white or grey) or any colour as #rrggbb.`,
};
const lookProps = {
  color: colorProp,
  fill: {
    type: "string",
    enum: FILLS,
    description: "How the colour is painted: solid (default, a soft tint), light (paler), bold (the full colour, with contrasting text), hatch, or none.",
  },
  outline: { type: "number", enum: [0, 1, 2, 4], description: "Outline thickness. Notes default to 0, shapes to 2, sections to 1." },
  outline_color: colorProp,
  outline_style: { type: "string", enum: OUTLINE_STYLES },
  text_color: { ...colorProp, description: "Text colour, if it shouldn't follow the item's colour: a palette colour or #rrggbb." },
  font: { type: "string", enum: FONTS, description: "Typeface for this item, if it shouldn't follow the board's." },
  effect: { type: "string", enum: EFFECTS, description: "glow or pulse makes one item stand out. Use for at most one or two key items." },
};
const itemProps = {
  kind: { type: "string", enum: ["note", "text", "shape", "board", "link"] },
  ref: { type: "string", description: "Your own name for this item, so links can point at it." },
  text: { type: "string", description: "Body text. Supports **bold**, *italic*, # headings, - bullets, 1. lists, - [ ] to-dos, [[Board title]] links and #tags." },
  title: { type: "string", description: "Notes only: a bold card title above the body." },
  shape: { type: "string", enum: SHAPES },
  size: { type: "string", enum: SIZES, description: "Text size for notes and shapes: s, m (default) or l." },
  text_style: { type: "string", enum: TEXT_STYLES, description: "For kind text: title, heading, subheading, body (default) or caption." },
  align: { type: "string", enum: ALIGNS },
  width: { type: "number", description: "Rarely needed: widths are chosen for you." },
  height: { type: "number", description: "Shapes only; rarely needed." },
  url: { type: "string", description: "For kind link: the web address." },
  board: { type: "string", description: "For kind board: the id or exact title of the board the card opens." },
  ...lookProps,
};
const blockSchema = {
  type: "object",
  description:
    "One block. kind note/text/shape/board/link is a single item. kind section is a coloured, titled area holding children. kind group arranges children without drawing anything. kind mindmap is a tree grown from a root. kind flow is a flowchart of steps and links.",
  properties: {
    ...itemProps,
    kind: { type: "string", enum: ["note", "text", "shape", "board", "link", "section", "group", "mindmap", "flow", "existing"] },
    title: { type: "string", description: "Section title, or a note's card title." },
    layout: { type: "string", enum: ["grid", "column", "row"], description: "How a section or group arranges its children." },
    columns: { type: "number", description: "Columns for a grid layout." },
    align: { type: "string", description: "For groups: start (default) or center. For items: text alignment." },
    children: { type: "array", items: { type: "object" }, description: "Blocks inside a section or group (any kind, including sections)." },
    root: {
      type: "object",
      description: "Mindmap root: {text, color?, size?, kind?, shape?, children: [{text, children: [...]}, ...]}. Branch colours are chosen for you unless given.",
    },
    direction: { type: "string", description: "mindmap: both (default) or right. flow: down (default) or right." },
    curve: { type: "string", enum: ["curved", "straight", "elbow"], description: "mindmap link curve." },
    steps: { type: "array", items: { type: "object" }, description: "flow steps: items (default kind shape) each with a ref." },
    links: { type: "array", items: { type: "object" }, description: "flow links between step refs: {from, to, label?}." },
    id: { type: "string", description: "kind existing: the id of an item already on the board, to move it into this arrangement." },
  },
  required: ["kind"],
};
const linkSchema = {
  type: "object",
  properties: {
    from: { type: "string", description: "A ref or item id." },
    to: { type: "string", description: "A ref or item id." },
    label: { type: "string" },
    curve: { type: "string", enum: ["curved", "straight", "elbow"] },
    arrow: { type: "string", enum: ["none", "end", "both"] },
    dash: { type: "string", enum: LINK_DASHES },
    color: { ...colorProp, description: "Line colour: a palette colour or #rrggbb. Leave out for the board's usual grey." },
    width: { type: "string", enum: ["thin", "normal", "thick"] },
    head: { type: "string", enum: LINK_HEADS, description: "Shape at the arrow end(s): arrow (default), open, dot or diamond." },
    motion: {
      type: "string",
      enum: LINK_MOTIONS,
      description: "flow: dashes travel along the line (shows direction or an active path). pulse: a soft glow. Only for the one or two most important lines.",
    },
  },
  required: ["from", "to"],
};
const placeSchema = {
  type: "object",
  description:
    "Where the content goes. Leave out to put it in free space beside what's already there. {near: id, side: right|left|below|above} puts it beside an item. {into: sectionId} adds it inside an existing section, which grows to fit.",
  properties: {
    near: { type: "string" },
    side: { type: "string", enum: ["right", "left", "below", "above"] },
    into: { type: "string" },
  },
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_board",
    description:
      "Read the open board: its title, settings, every item (id, kind, text, colour, size, position, which section it's in) and every link. Call this before changing a board that already has things on it.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "view_board",
    description:
      "Look at a picture of the board (or of some items and everything inside them) to check how it looks. Use it after building to spot anything cramped, overlapping, unbalanced or hard to read, then fix it.",
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Only show these items (sections include their contents). Leave out for the whole board." } } },
  },
  {
    name: "add_content",
    description:
      "Add content to the open board. Describe the structure and the app lays it out neatly: you never give coordinates. Blocks are arranged by `layout` (row by default). Blocks can also include items already on the board as {kind: existing, id}: they move into the new layout. That's the best way to organise a board: one call with sections whose children are the existing items (plus anything new). Returns the ids of what was made.",
    input_schema: {
      type: "object",
      properties: {
        blocks: { type: "array", items: blockSchema },
        layout: { type: "string", enum: ["row", "column", "grid"], description: "How the top-level blocks sit relative to each other." },
        columns: { type: "number" },
        links: { type: "array", items: linkSchema, description: "Links between items, by ref or id. Mind maps and flows link their own items." },
        place: placeSchema,
      },
      required: ["blocks"],
    },
  },
  {
    name: "update_items",
    description:
      "Change existing items: text, title, colours, fill, outline, size, shape, text style, alignment, width or lock. Only the fields you give change. Set title to null to remove a note's title.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              ...itemProps,
              title: { type: ["string", "null"] },
              text_color: { type: ["string", "null"], description: "A palette colour or #rrggbb; null to go back to automatic." },
              font: { type: ["string", "null"], enum: [...FONTS, null], description: "null to use the board's typeface." },
              locked: { type: "boolean" },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "arrange_items",
    description:
      "Rearrange items that are already on the board. Give ids and a layout (grid, row, column) to line them up neatly where they are, optionally wrapping them in a new section. Or give `section` to re-flow everything inside a section and resize it to fit. Or layout mindmap with `root` to tidy a mind map. Items inside a section move with it.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        layout: { type: "string", enum: ["grid", "row", "column", "mindmap"] },
        columns: { type: "number" },
        section: { type: "string", description: "Re-flow everything inside this section." },
        root: { type: "string", description: "For layout mindmap: the centre item." },
        new_section: { type: "object", description: "Wrap the items in a new section: {title, color?, fill?}.", properties: { title: { type: "string" }, ...lookProps } },
        place: placeSchema,
      },
    },
  },
  {
    name: "delete_items",
    description: "Delete items (and their links). Deleting a section also deletes what's inside it, unless keep_contents is true.",
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } }, keep_contents: { type: "boolean" } },
      required: ["ids"],
    },
  },
  {
    name: "edit_links",
    description: "Add, change or remove links (the lines between items).",
    input_schema: {
      type: "object",
      properties: {
        add: { type: "array", items: linkSchema },
        update: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              curve: { type: "string" },
              arrow: { type: "string" },
              dash: { type: "string" },
              color: { type: ["string", "null"], description: "#rrggbb or palette colour; null for the usual grey." },
              width: { type: "string", enum: ["thin", "normal", "thick"] },
              head: { type: "string", enum: LINK_HEADS },
              motion: { type: "string", enum: LINK_MOTIONS },
            },
            required: ["id"],
          },
        },
        remove: { type: "array", items: { type: "string" }, description: "Link ids." },
      },
    },
  },
  {
    name: "set_board",
    description:
      "Change the open board's title and look. A theme sets colour, pattern, typeface and style together; then any of those can be changed on their own.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        theme: { type: "string", enum: THEMES.map((t) => t.id), description: THEMES.map((t) => `${t.id}: ${t.description}`).join("; ") },
        board_color: {
          type: "string",
          description: `The board's colour: default (follows the app's light or dark mode), ${Object.keys(BOARD_TINTS).join(", ")}, or any #rrggbb. Dark colours (slate, midnight, blueprint, chalkboard, charcoal, or a dark #rrggbb) switch items to their dark look automatically.`,
        },
        background: { type: "string", enum: BACKGROUNDS, description: "The pattern: dots, grid, lines (ruled paper), cross, or plain." },
        font: { type: "string", enum: FONTS, description: "The board's typeface." },
        style: { type: "string", enum: BOARD_STYLES, description: "clean, or sketchy for a hand-drawn look." },
      },
    },
  },
  {
    name: "list_boards",
    description: "List all boards (id, title, number of items), so you can link to them or open one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_board",
    description:
      "Create a new, empty board and open it, so the next tools work on it. Use open_board to go back to an earlier board afterwards (e.g. to add board cards linking to the new ones).",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, background: { type: "string", enum: BACKGROUNDS }, style: { type: "string", enum: BOARD_STYLES } },
      required: ["title"],
    },
  },
  {
    name: "open_board",
    description: "Open another board (by id or exact title), so the next tools work on it.",
    input_schema: { type: "object", properties: { board: { type: "string" } }, required: ["board"] },
  },
];

// ---------- Helpers ----------

const state = () => boardStore.getState();
const kindOfId = (id: string) => state().nodes.find((n) => n.id === id)?.type;
const nodeById = () => new Map(state().nodes.map((n) => [n.id, n]));
const r1 = (v: number) => Math.round(v);
const clip = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const quote = (s: string) => JSON.stringify(clip(s.replace(/\s+/g, " ").trim()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KIND_NAMES: Record<string, string> = { frame: "section", board: "board card", link: "web link card", ink: "drawing", arrow: "arrow", file: "file" };
const kindOf = (n: BoardNode) => (n.type === "shape" ? `${n.data.shape ?? "rect"} shape` : KIND_NAMES[n.type] ?? n.type);

/** Ask the board view to bring these items into sight. */
const showItems = (ids: string[]) => window.dispatchEvent(new CustomEvent("mythra:show-items", { detail: ids }));

/**
 * Wait until the board has measured these items' heights (they follow their text) and the
 * heights have stopped changing.
 */
async function waitForSizes(ids: string[], timeout = 3000): Promise<void> {
  const wanted = new Set(ids);
  const start = performance.now();
  let last = "";
  let steady = 0;
  while (performance.now() - start < timeout) {
    const heights = state()
      .nodes.filter((n) => wanted.has(n.id) && AUTO_HEIGHT.has(n.type))
      .map((n) => n.measured?.height ?? -1);
    const key = heights.join(",");
    if (!heights.includes(-1) && key === last) {
      if (++steady >= 3) return;
    } else steady = 0;
    last = key;
    await sleep(40);
  }
}

const sizeOfNode = (n: BoardNode) => {
  const r = rectOf(n);
  return { width: r.width, height: r.height };
};

/** Section ids containing each item (the innermost one). */
function sectionOf(nodes: BoardNode[]): Map<string, string> {
  const frames = nodes.filter((n) => n.type === "frame").sort((a, b) => rectOf(b).width * rectOf(b).height - rectOf(a).width * rectOf(a).height);
  const out = new Map<string, string>();
  for (const f of frames) for (const id of itemsInFrame(f, nodes)) out.set(id, f.id);
  return out;
}

/** Everything inside a section, including inside sections within it. */
function contentsOf(frameId: string, nodes: BoardNode[]): string[] {
  const f = nodes.find((n) => n.id === frameId);
  return f ? itemsInFrame(f, nodes) : [];
}

/** Larger sections first, so smaller ones inside them are drawn on top. */
function orderFrames(nodes: BoardNode[]): BoardNode[] {
  const frames = nodes.filter((n) => n.type === "frame");
  if (!frames.length) return nodes;
  const area = (n: BoardNode) => rectOf(n).width * rectOf(n).height;
  frames.sort((a, b) => area(b) - area(a));
  return [...frames, ...nodes.filter((n) => n.type !== "frame")];
}

/** Content items (not sections, drawings or arrows) that overlap each other. */
export function layoutProblems(nodes: BoardNode[], only?: Set<string>): string[] {
  const solid = nodes.filter((n) => n.type !== "frame" && n.type !== "ink" && n.type !== "arrow" && !n.hidden);
  const problems: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (only && !only.has(a.id) && !only.has(b.id)) continue;
      if (rectsOverlap(rectOf(a), rectOf(b), -4)) problems.push(`${a.id} and ${b.id} overlap`);
      if (problems.length >= 8) return problems;
    }
  }
  // Items poking out of the section they mostly sit in.
  const frames = nodes.filter((n) => n.type === "frame");
  for (const n of solid) {
    if (only && !only.has(n.id)) continue;
    const r = rectOf(n);
    for (const f of frames) {
      const fr = rectOf(f);
      if (!containsPoint(fr, center(r))) continue;
      const inside = r.x >= fr.x - 1 && r.y >= fr.y - 1 && r.x + r.width <= fr.x + fr.width + 1 && r.y + r.height <= fr.y + fr.height + 1;
      if (!inside) problems.push(`${n.id} sticks out of section ${f.id}`);
    }
  }
  return problems.slice(0, 10);
}

/** Free space for a block of this size: beside the existing content, or near an item. */
function placeBlock(size: { width: number; height: number }, place: PlaceSpec | undefined, exclude: Set<string>): { x: number; y: number } {
  const nodes = state().nodes.filter((n) => !exclude.has(n.id) && !n.hidden);
  const rects = nodes.map(rectOf);
  const GAP = 120;
  const fits = (p: { x: number; y: number }) =>
    !rects.some((r) => rectsOverlap({ x: p.x, y: p.y, width: size.width, height: size.height }, r, 40));
  const anchor = place?.near ? nodes.find((n) => n.id === place.near) : undefined;
  if (anchor) {
    // Beside an item means close to it, like its neighbours.
    const GAP = anchor.type === "frame" ? 48 : 90;
    const a = rectOf(anchor);
    const side = place?.side ?? "right";
    const step = { right: [1, 0], left: [-1, 0], below: [0, 1], above: [0, -1] }[side];
    // Next to a section, line up with its top (like columns); next to an item, centre on it
    // (like ideas branching from it).
    const centred = anchor.type !== "frame";
    const across = (along: number, length: number, own: number) => (centred ? along + length / 2 - own / 2 : along);
    let p =
      side === "right"
        ? { x: a.x + a.width + GAP, y: across(a.y, a.height, size.height) }
        : side === "left"
          ? { x: a.x - GAP - size.width, y: across(a.y, a.height, size.height) }
          : side === "below"
            ? { x: across(a.x, a.width, size.width), y: a.y + a.height + GAP }
            : { x: across(a.x, a.width, size.width), y: a.y - GAP - size.height };
    for (let i = 0; i < 60 && !fits(p); i++) p = { x: p.x + step[0] * 80, y: p.y + step[1] * 80 };
    return p;
  }
  const bounds = rectsBounds(rects);
  if (!bounds) return { x: 0, y: 0 };
  // Beside everything, unless the board is already very wide; then underneath.
  if (bounds.width > bounds.height * 2.2 && bounds.width > 1600) return { x: bounds.x, y: bounds.y + bounds.height + GAP + 40 };
  return { x: bounds.x + bounds.width + GAP + 40, y: bounds.y };
}

type PlaceSpec = { near?: string; side?: "right" | "left" | "below" | "above"; into?: string };

/**
 * Push items out of the way of a section that grew: anything that sat below or to the right
 * of its old edges (and now overlaps it) moves by how much it grew.
 */
function makeRoom(frameId: string, before: Rect, moved: Set<string>) {
  const nodes = state().nodes;
  const frame = nodes.find((n) => n.id === frameId);
  if (!frame) return;
  const after = rectOf(frame);
  const dy = after.y + after.height - (before.y + before.height);
  const dx = after.x + after.width - (before.x + before.width);
  if (dy <= 0 && dx <= 0) return;
  const inside = new Set(contentsOf(frameId, nodes));
  const shifts = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    if (n.id === frameId || inside.has(n.id) || moved.has(n.id)) continue;
    const r = rectOf(n);
    const below = r.y >= before.y + before.height - 1 && r.x < after.x + after.width && r.x + r.width > after.x;
    const right = r.x >= before.x + before.width - 1 && r.y < after.y + after.height && r.y + r.height > after.y;
    if (below && dy > 0) shifts.set(n.id, { x: 0, y: dy });
    else if (right && dx > 0) shifts.set(n.id, { x: dx, y: 0 });
  }
  if (!shifts.size) return;
  boardStore.setState((s) => ({
    nodes: s.nodes.map((n) => {
      const d = shifts.get(n.id);
      return d ? { ...n, position: { x: n.position.x + d.x, y: n.position.y + d.y } } : n;
    }),
  }));
}

/** Board cards name their board by title or id; find the id. */
function resolveBoards(blocks: unknown): string[] {
  const missing: string[] = [];
  const walk = (b: unknown) => {
    if (!b || typeof b !== "object") return;
    const o = b as Record<string, unknown>;
    if (o.kind === "board" && typeof o.board === "string") {
      const found = boardIndex().find((d) => d.id === o.board) ?? findBoardByTitle(o.board);
      if (found) {
        o.board_id = found.id;
        if (!o.text) o.text = found.title;
      } else missing.push(o.board);
    }
    for (const k of ["children", "steps"]) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(walk);
    if (o.root) walk(o.root);
  };
  if (Array.isArray(blocks)) blocks.forEach(walk);
  return missing;
}

/**
 * Put a plan on the board: create the items out of sight, let the board measure them,
 * then lay everything out and reveal it. Returns the new ids by ref and by key.
 */
async function realise(p: Plan, place: PlaceSpec | undefined): Promise<{ ids: Map<string, string>; created: string[]; rect: Rect }> {
  const byKey = new Map<string, BoardNode>();
  const ids = new Map<string, string>();
  for (const item of p.items) {
    const node = makeItem(item.type, { x: 0, y: 0 }, item.data, { width: item.width, height: item.height ?? estimateHeight(item) });
    node.style = { ...node.style, opacity: 0 };
    byKey.set(item.key, node);
    ids.set(item.key, node.id);
  }
  const existing = nodeById();
  const keyId = (k: string) => (k.startsWith("id:") ? k.slice(3) : ids.get(k));
  // First pass with estimated heights, so items are measured roughly where they'll end up.
  const estimate = (k: string) => {
    if (k.startsWith("id:")) {
      const n = existing.get(k.slice(3));
      return n ? sizeOfNode(n) : { width: 0, height: 0 };
    }
    const item = p.items.find((i) => i.key === k)!;
    return { width: item.width, height: item.height ?? estimateHeight(item) };
  };
  let layout = arrange(p.root, estimate);
  const moving = new Set(leafKeys(p.root).filter((k) => k.startsWith("id:")).map((k) => k.slice(3)));
  // Existing sections moved into the arrangement bring along what's inside them. Smaller
  // sections come last, so items go with the innermost section they're in.
  const passengers = new Map<string, string[]>();
  const movingFrames = [...moving].map((id) => existing.get(id)).filter((n): n is BoardNode => n?.type === "frame");
  movingFrames.sort((a, b) => rectOf(b).width * rectOf(b).height - rectOf(a).width * rectOf(a).height);
  for (const f of movingFrames) passengers.set(f.id, contentsOf(f.id, state().nodes).filter((x) => !moving.has(x)));
  const exclude = new Set([...moving, ...[...passengers.values()].flat()]);
  for (const k of layout.keys()) if (k.startsWith("id:")) exclude.add(k.slice(3));
  boardStore.setState((s) => ({ nodes: orderFrames([...s.nodes, ...byKey.values()]) }));
  const newIds = new Set([...byKey.values()].map((n) => n.id));
  await waitForSizes([...newIds]);

  /** Sizes as the board has measured them. */
  const sizeNow = () => {
    const measured = nodeById();
    return (k: string) => {
      const id = keyId(k);
      const n = id ? measured.get(id) : undefined;
      if (!n) return estimate(k);
      const item = p.items.find((i) => i.key === k);
      // Shapes and sections keep the size chosen for them; text items use their measured height.
      if (item && item.height) return { width: item.width, height: item.height };
      return sizeOfNode(n);
    };
  };

  let origin: { x: number; y: number } | null = null;
  let rects = new Map<string, Rect>();
  const apply = (sizeOf: (k: string) => { width: number; height: number }) => {
    layout = arrange(p.root, sizeOf);
    if (!origin) {
      const bounds = rectsBounds([...layout.values()]) ?? { x: 0, y: 0, width: 0, height: 0 };
      if (place?.into) origin = { x: 0, y: 0 };
      else if (moving.size && !place?.near) {
        // Rearranging existing items keeps them about where they were, unless that would
        // land them on top of other things.
        const old = rectsBounds([...moving].map((id) => existing.get(id)).filter((n): n is BoardNode => !!n).map(rectOf));
        const others = state().nodes.filter((n) => !exclude.has(n.id) && !newIds.has(n.id) && !n.hidden).map(rectOf);
        const clear = old && !others.some((r) => rectsOverlap({ x: old.x, y: old.y, width: bounds.width, height: bounds.height }, r, 24));
        origin = old && clear ? { x: old.x, y: old.y } : placeBlock(bounds, place, new Set([...exclude, ...newIds]));
      } else origin = placeBlock(bounds, place, new Set([...exclude, ...newIds]));
    }
    const o = origin;
    rects = new Map();
    for (const [k, r] of layout) {
      const id = keyId(k);
      if (id) rects.set(id, { x: Math.round(o.x + r.x), y: Math.round(o.y + r.y), width: Math.round(r.width), height: Math.round(r.height) });
    }
    // Things inside a moved section keep their place within it.
    const targets = new Map<string, { x: number; y: number }>();
    for (const [frame, inside] of passengers) {
      const to = rects.get(frame);
      const from = existing.get(frame);
      if (!to || !from) continue;
      for (const id of inside) {
        const n = existing.get(id);
        if (n) targets.set(id, { x: n.position.x + to.x - from.position.x, y: n.position.y + to.y - from.position.y });
      }
    }
    boardStore.setState((s) => ({
      nodes: orderFrames(
        s.nodes.map((n) => {
          const r = rects.get(n.id);
          const target = targets.get(n.id);
          if (!r && !target) return n;
          let out: BoardNode = { ...n };
          if (r) {
            out.position = { x: r.x, y: r.y };
            if (n.type === "frame" || n.type === "shape") {
              out.width = r.width;
              out.height = r.height;
            }
          } else if (target) out.position = target;
          if (newIds.has(n.id) && n.style?.opacity === 0) {
            const { opacity: _o, ...style } = n.style;
            out = { ...out, style };
          }
          return out;
        }),
      ),
    }));
  };
  apply(sizeNow());
  // Items can still change height for a moment after they appear (lists and fonts finishing
  // drawing). If they did, lay everything out again.
  for (let round = 0; round < 2; round++) {
    await sleep(220);
    const sizeOf = sizeNow();
    const changed = p.items.some((i) => !i.height && layout.has(i.key) && Math.abs(sizeOf(i.key).height - layout.get(i.key)!.height) > 1);
    if (!changed) break;
    apply(sizeOf);
  }

  // Links, now that every end exists.
  const links: LinkEdge[] = [];
  const all = nodeById();
  for (const l of p.links) {
    const a = keyId(l.from);
    const b = keyId(l.to);
    if (!a || !b || !all.has(a) || !all.has(b)) {
      p.problems.push(`A link to "${l.from.startsWith("id:") ? l.from.slice(3) : l.to.replace(/^id:/, "")}" was skipped: no such item.`);
      continue;
    }
    links.push(makeLink(a, b, l.data));
  }
  if (links.length) boardStore.setState((s) => ({ edges: [...s.edges, ...links] }));
  const created = [...newIds];
  const rect = rectsBounds([...rects.values()]) ?? { x: 0, y: 0, width: 0, height: 0 };
  return { ids, created, rect };
}

/** Keys of the single items in an arrangement (not the sections drawn around groups). */
function leafKeys(n: Plan["root"]): string[] {
  if (n.t === "leaf") return [n.key];
  if (n.t === "box") return n.children.flatMap(leafKeys);
  if (n.t === "tree") {
    const walk = (t: { key: string; children: { key: string; children: unknown[] }[] }): string[] => [t.key, ...t.children.flatMap((c) => walk(c as never))];
    return walk(n.root);
  }
  return n.keys;
}

/** "ref → id" lines for the reply, so Claude can refer to what it made. */
function idList(p: Plan, ids: Map<string, string>): string {
  const named = p.items.filter((i) => i.ref).map((i) => `${i.ref}=${ids.get(i.key)}`);
  const sections = p.items.filter((i) => i.type === "frame" && !i.ref).map((i) => `"${clip(i.data.text ?? "", 40)}"=${ids.get(i.key)}`);
  return [named.length ? `Ids by ref: ${named.join(", ")}.` : "", sections.length ? `Section ids: ${sections.join(", ")}.` : ""].filter(Boolean).join(" ");
}

const countWords = (p: Plan) => {
  const counts = new Map<string, number>();
  for (const i of p.items) {
    const k = i.type === "frame" ? "section" : i.type === "shape" ? "shape" : i.type;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
};

function report(parts: (string | number | false | undefined | null)[]): ToolResult {
  return { text: parts.filter((p): p is string => typeof p === "string" && !!p).join("\n") };
}

// ---------- The tools ----------

type Args = Record<string, unknown>;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

async function addContent(args: Args): Promise<ToolResult> {
  const blocks = Array.isArray(args.blocks) ? (args.blocks as Spec[]) : [];
  if (!blocks.length) return { text: "Nothing to add: blocks was empty." };
  const missingBoards = resolveBoards(blocks);
  const place = (args.place && typeof args.place === "object" ? args.place : undefined) as PlaceSpec | undefined;
  const layout = (["row", "column", "grid"].includes(String(args.layout)) ? args.layout : "row") as Arrangement;
  const links = (Array.isArray(args.links) ? args.links : []) as LinkSpec[];

  if (place?.into) return addIntoSection(place.into, blocks, links, args);
  const p = plan(blocks, links, layout, typeof args.columns === "number" ? args.columns : undefined, kindOfId);
  if (!p.items.length) return { text: `Nothing was added. ${p.problems.join(" ")}` };
  const { ids: made, created, rect } = await realise(p, place);
  // A new board takes its name from the title Claude gives it (or the centre of its mind map).
  const heading =
    p.items.find((i) => i.type === "text" && i.data.textStyle === "title" && i.data.text?.trim()) ??
    (blocks[0]?.kind === "mindmap" ? p.items.find((i) => i.data.text?.trim()) : undefined);
  if (heading && /^untitled board$/i.test(state().title.trim())) boardStore.setState({ title: heading.data.text!.replace(/\s+/g, " ").trim().slice(0, 120) });
  showItems(created);
  const problems = layoutProblems(state().nodes, new Set(created));
  return report([
    `Added ${countWords(p)} at x=${r1(rect.x)}, y=${r1(rect.y)} (${r1(rect.width)}×${r1(rect.height)}).`,
    idList(p, made),
    missingBoards.length && `No board called ${missingBoards.map((b) => `"${b}"`).join(", ")}; those became plain notes. Use list_boards or create_board.`,
    p.problems.length && `Notes: ${p.problems.join(" ")}`,
    problems.length && `Layout check: ${problems.join("; ")}.`,
  ]);
}

/** Add blocks inside an existing section, re-flowing it and making room around it. */
async function addIntoSection(frameId: string, blocks: Spec[], links: LinkSpec[], args: Args): Promise<ToolResult> {
  const frame = nodeById().get(frameId);
  if (!frame || frame.type !== "frame") return { text: `${frameId} isn't a section. Use get_board to find section ids.` };
  const before = rectOf(frame);
  const nodes = state().nodes;
  const inside = contentsOf(frameId, nodes);
  // Only items directly in this section (not inside a smaller section within it) are re-flowed.
  const owner = sectionOf(nodes);
  const direct = inside.filter((id) => owner.get(id) === frameId).map((id) => nodes.find((n) => n.id === id)!);
  direct.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const children: Spec[] = [...direct.map((n) => ({ kind: "existing" as const, id: n.id })), ...blocks];
  const total = children.length;
  const lay = (["grid", "column", "row"].includes(String(args.layout)) ? args.layout : total > 3 ? "grid" : "column") as Arrangement;
  const p = plan([{ kind: "section", title: frame.data.text, children, layout: lay, columns: typeof args.columns === "number" ? args.columns : undefined }], links, "row", undefined, kindOfId);
  // The plan made a fresh section; use the existing one instead.
  const fresh = p.items.find((i) => i.type === "frame")!;
  p.items = p.items.filter((i) => i !== fresh);
  const swap = (n: typeof p.root): typeof p.root => {
    if (n.t === "box") return { ...n, frame: n.frame === fresh.key ? `id:${frameId}` : n.frame, children: n.children.map(swap) };
    return n;
  };
  p.root = swap(p.root);
  const { ids: made, created } = await realise(p, { into: frameId });
  // realise placed the arrangement at 0,0; move it to the section's corner.
  const placed = nodeById();
  const f = placed.get(frameId)!;
  const dx = before.x - f.position.x;
  const dy = before.y - f.position.y;
  const group = new Set([frameId, ...inside, ...created]);
  boardStore.setState((s) => ({
    nodes: s.nodes.map((n) => (group.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
  }));
  makeRoom(frameId, before, group);
  showItems([frameId]);
  const problems = layoutProblems(state().nodes, new Set(created));
  return report([`Added ${countWords(p) || "nothing"} inside section ${frameId}, which now fits them.`, idList(p, made), p.problems.length && `Notes: ${p.problems.join(" ")}`, problems.length && `Layout check: ${problems.join("; ")}.`]);
}

function getBoard(): ToolResult {
  const s = state();
  const nodes = s.nodes;
  const owner = sectionOf(nodes);
  const lines: string[] = [];
  const counts = `${nodes.length} item${nodes.length === 1 ? "" : "s"}, ${s.edges.length} link${s.edges.length === 1 ? "" : "s"}`;
  const scheme = boardLook(s.boardColor, "light").scheme;
  lines.push(
    `Board "${s.title}" (id ${s.boardId}) · colour ${s.boardColor}${s.boardColor !== "default" ? ` (${scheme})` : ""} · pattern ${s.background} · font ${s.font} · style ${s.style} · ${counts}`,
  );
  const selected = nodes.filter((n) => n.selected).map((n) => n.id);
  if (selected.length) lines.push(`Selected by the user: ${selected.join(", ")}`);
  if (!nodes.length) {
    lines.push("The board is empty.");
    return { text: lines.join("\n") };
  }
  const bounds = rectsBounds(nodes.map(rectOf))!;
  lines.push(`Content spans x ${r1(bounds.x)}…${r1(bounds.x + bounds.width)}, y ${r1(bounds.y)}…${r1(bounds.y + bounds.height)}.`);
  const big = nodes.length > 250;
  lines.push("Items (id · kind · look · text · box x,y w×h · section):");
  for (const n of nodes) {
    const r = rectOf(n);
    const d = n.data;
    const look = [
      d.hex ? d.hex : d.color !== "plain" || n.type === "note" ? d.color : "",
      d.textColor ? `text ${d.textColor}` : "",
      d.font ? `font ${d.font}` : "",
      d.effect ? d.effect : "",
      d.fill && d.fill !== "solid" ? `fill ${d.fill}` : "",
      d.outline !== undefined ? `outline ${d.outline}${d.outlineColor ? ` ${d.outlineColor}` : ""}${d.outlineStyle === "dashed" ? " dashed" : ""}` : "",
      (n.type === "note" || n.type === "shape") && d.size !== "m" ? `size ${d.size}` : "",
      n.type === "text" ? textStyleOf(d) : "",
      d.align ? `align ${d.align}` : "",
      d.locked ? "locked" : "",
      d.collapsed ? "folded" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const text =
      n.type === "ink" ? "" : n.type === "image" ? (d.text ? `caption ${quote(d.text)}` : "") : [d.title !== undefined ? `title ${quote(d.title)}` : "", d.text ? quote(d.text) : ""].filter(Boolean).join(" ");
    const extra = n.type === "board" ? ` → board ${d.boardId}` : n.type === "link" && d.url ? ` → ${d.url}` : "";
    const where = owner.get(n.id) ? ` · in ${owner.get(n.id)}` : "";
    lines.push(`- ${n.id} · ${kindOf(n)}${look ? ` · ${look}` : ""}${text ? ` · ${big ? clip(text, 70) : text}` : ""}${extra} · ${r1(r.x)},${r1(r.y)} ${r1(r.width)}×${r1(r.height)}${where}`);
  }
  if (s.edges.length) {
    lines.push("Links (id: from → to):");
    for (const e of s.edges) {
      const d = e.data;
      const style = d
        ? [
            d.curve !== "curved" ? d.curve : "",
            d.arrow !== "end" ? `arrow ${d.arrow}` : "",
            d.dash !== "solid" ? d.dash : "",
            d.color ? `colour ${d.color}` : "",
            d.width && d.width !== 2 ? (d.width === 1 ? "thin" : "thick") : "",
            d.head && d.head !== "arrow" ? `${d.head} ends` : "",
            d.motion ? d.motion : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "";
      lines.push(`- ${e.id}: ${e.source} → ${e.target}${d?.label ? ` ${quote(d.label)}` : ""}${style ? ` (${style})` : ""}`);
    }
  }
  const problems = layoutProblems(nodes);
  if (problems.length) lines.push(`Layout check: ${problems.join("; ")}.`);
  return { text: lines.join("\n") };
}

async function viewBoard(args: Args): Promise<ToolResult> {
  const s = state();
  let nodes = s.nodes.filter((n) => !n.hidden);
  const wanted = ids(args.ids);
  if (wanted.length) {
    const keep = new Set(wanted);
    for (const id of wanted) for (const inside of contentsOf(id, s.nodes)) keep.add(inside);
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  if (!nodes.length) return { text: "There's nothing to show." };
  const { renderCanvas } = await import("../exportImage");
  const { canvas } = await renderCanvas(nodes, s.edges, { background: true, maxSide: 1500 });
  const data = canvas.toDataURL("image/jpeg", 0.82);
  const bounds = rectsBounds(nodes.map(rectOf))!;
  return {
    text: `A picture of ${wanted.length ? "those items" : "the whole board"} (${nodes.length} items, ${r1(bounds.width)}×${r1(bounds.height)} board pixels).`,
    image: { data: data.slice(data.indexOf(",") + 1), mediaType: "image/jpeg" },
  };
}

function updateItems(args: Args): ToolResult {
  const updates = Array.isArray(args.updates) ? (args.updates as Args[]) : [];
  const byId = nodeById();
  const missing: string[] = [];
  const changes = new Map<string, { data: Partial<ItemData>; width?: number; height?: number; clearTitle?: boolean }>();
  for (const u of updates) {
    const id = typeof u.id === "string" ? u.id : "";
    const n = byId.get(id);
    if (!n) {
      missing.push(id || "(no id)");
      continue;
    }
    const data: Partial<ItemData> = { ...lookData(u) };
    // Clearing: a palette colour replaces a custom one; null (or "none") removes a setting.
    if (COLORS.includes(u.color as never)) data.hex = undefined;
    if (u.text_color === null) data.textColor = undefined;
    if (u.font === null) data.font = undefined;
    if (u.effect === null || u.effect === "none") data.effect = undefined;
    if (typeof u.text === "string") data.text = u.text.slice(0, 4000);
    if (typeof u.title === "string") data.title = u.title.slice(0, 200);
    if (SIZES.includes(u.size as never)) data.size = u.size as ItemData["size"];
    if (SHAPES.includes(u.shape as never)) data.shape = u.shape as ItemData["shape"];
    if (TEXT_STYLES.includes(u.text_style as never)) data.textStyle = u.text_style as ItemData["textStyle"];
    if (ALIGNS.includes(u.align as never)) data.align = u.align as ItemData["align"];
    if (typeof u.locked === "boolean") data.locked = u.locked;
    if (typeof u.url === "string" && /^https?:\/\//i.test(u.url)) data.url = u.url;
    const width = typeof u.width === "number" ? Math.max(60, Math.min(1600, Math.round(u.width))) : undefined;
    const height = typeof u.height === "number" && !AUTO_HEIGHT.has(n.type) ? Math.max(40, Math.min(1600, Math.round(u.height))) : undefined;
    changes.set(id, { data, width, height, clearTitle: u.title === null });
  }
  boardStore.setState((s) => ({
    nodes: s.nodes.map((n) => {
      const c = changes.get(n.id);
      if (!c) return n;
      const data = { ...n.data, ...c.data };
      if (c.clearTitle) delete data.title;
      return { ...n, data, ...(c.width ? { width: c.width } : {}), ...(c.height ? { height: c.height } : {}) };
    }),
  }));
  return report([
    `Updated ${changes.size} item${changes.size === 1 ? "" : "s"}.`,
    missing.length && `Not found: ${missing.join(", ")}.`,
    [...changes.values()].some((c) => c.width || c.data.text !== undefined || c.data.size) &&
      "Text or size changes can make items taller; call arrange_items with section to re-flow a section if things now overlap.",
  ]);
}

async function arrangeItems(args: Args): Promise<ToolResult> {
  const byId = nodeById();
  const nodes = state().nodes;
  if (args.layout === "mindmap") {
    const root = typeof args.root === "string" ? args.root : "";
    if (!byId.has(root)) return { text: "Give root: the id of the mind map's centre item." };
    const moves = tidyTree(root, nodes, state().edges);
    boardStore.setState((s) => ({ nodes: s.nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)) }));
    showItems([root, ...moves.keys()]);
    return { text: `Tidied the mind map around ${root} (${moves.size} items moved).` };
  }
  const lay = (["grid", "row", "column"].includes(String(args.layout)) ? args.layout : undefined) as Arrangement | undefined;
  const columns = typeof args.columns === "number" ? args.columns : undefined;
  if (typeof args.section === "string") {
    const frame = byId.get(args.section);
    if (!frame || frame.type !== "frame") return { text: `${args.section} isn't a section.` };
    return addIntoSection(frame.id, [], [], { layout: lay, columns });
  }
  const list = ids(args.ids).filter((id) => byId.has(id));
  if (!list.length) return { text: "None of those ids are on the board." };
  // Keep their current reading order (top to bottom, left to right).
  list.sort((a, b) => {
    const ra = rectOf(byId.get(a)!);
    const rb = rectOf(byId.get(b)!);
    return Math.abs(ra.y - rb.y) > 40 ? ra.y - rb.y : ra.x - rb.x;
  });
  const children: Spec[] = list.map((id) => ({ kind: "existing", id }));
  const wrap = args.new_section && typeof args.new_section === "object" ? (args.new_section as Args) : null;
  const block: Spec = wrap
    ? { kind: "section", title: typeof wrap.title === "string" ? wrap.title : "Section", ...lookData(wrap), layout: lay, columns, children }
    : { kind: "group", layout: lay ?? "grid", columns, children };
  const p = plan([block], [], "row", undefined, kindOfId);
  const place = (args.place && typeof args.place === "object" ? args.place : undefined) as PlaceSpec | undefined;
  const { ids: made, created } = await realise(p, place);
  showItems([...list, ...created]);
  const problems = layoutProblems(state().nodes, new Set([...list, ...created]));
  const section = p.items.find((i) => i.type === "frame");
  return report([
    `Arranged ${list.length} item${list.length === 1 ? "" : "s"}${section ? ` in new section ${made.get(section.key)}` : ""}.`,
    problems.length && `Layout check: ${problems.join("; ")}.`,
  ]);
}

function deleteItems(args: Args): ToolResult {
  const nodes = state().nodes;
  const wanted = new Set(ids(args.ids));
  if (!args.keep_contents) for (const id of [...wanted]) for (const inside of contentsOf(id, nodes)) wanted.add(inside);
  const locked = nodes.filter((n) => wanted.has(n.id) && n.data.locked).map((n) => n.id);
  for (const id of locked) wanted.delete(id);
  const count = nodes.filter((n) => wanted.has(n.id)).length;
  boardStore.setState((s) => ({
    nodes: s.nodes.filter((n) => !wanted.has(n.id)),
    edges: s.edges.filter((e) => !wanted.has(e.source) && !wanted.has(e.target)),
  }));
  return report([`Deleted ${count} item${count === 1 ? "" : "s"}.`, locked.length && `Left ${locked.join(", ")} alone: locked.`]);
}

function editLinks(args: Args): ToolResult {
  const byId = nodeById();
  const adds = (Array.isArray(args.add) ? args.add : []) as LinkSpec[];
  const made: string[] = [];
  const problems: string[] = [];
  const edges = [...state().edges];
  for (const l of adds) {
    if (!byId.has(l?.from) || !byId.has(l?.to) || l.from === l.to) {
      problems.push(`Can't link ${l?.from} → ${l?.to}`);
      continue;
    }
    const link = makeLink(l.from, l.to, linkData(l));
    edges.push(link);
    made.push(link.id);
  }
  const updates = Array.isArray(args.update) ? (args.update as Args[]) : [];
  let changed = 0;
  for (const u of updates) {
    const i = edges.findIndex((e) => e.id === u.id);
    if (i < 0) {
      problems.push(`No link ${String(u.id)}`);
      continue;
    }
    const data = { ...edges[i].data!, ...linkData(u as Partial<LinkSpec>) };
    if (u.color === null) delete data.color;
    edges[i] = { ...edges[i], data };
    changed++;
  }
  const remove = new Set(ids(args.remove));
  const kept = edges.filter((e) => !remove.has(e.id));
  boardStore.setState({ edges: kept });
  return report([
    made.length && `Added links ${made.join(", ")}.`,
    changed && `Changed ${changed} link${changed === 1 ? "" : "s"}.`,
    remove.size && `Removed ${edges.length - kept.length} link${edges.length - kept.length === 1 ? "" : "s"}.`,
    problems.length && problems.join("; "),
  ]) as ToolResult;
}

function setBoard(args: Args): ToolResult {
  const changes: string[] = [];
  if (typeof args.title === "string" && args.title.trim()) {
    boardStore.setState({ title: args.title.trim().slice(0, 120) });
    changes.push(`title "${args.title.trim().slice(0, 120)}"`);
  }
  const look: { background?: BoardBackground; boardColor?: string; font?: FontKind; style?: BoardStyle } = {};
  const theme = THEMES.find((t) => t.id === args.theme);
  if (theme) {
    Object.assign(look, { boardColor: theme.boardColor, background: theme.background, font: theme.font, style: theme.style });
    changes.push(`theme ${theme.name}`);
  }
  const color = asBoardColor(args.board_color);
  if (color) look.boardColor = color;
  if (BACKGROUNDS.includes(args.background as never)) look.background = args.background as BoardBackground;
  if (FONTS.includes(args.font as never)) look.font = args.font as FontKind;
  if (BOARD_STYLES.includes(args.style as never)) look.style = args.style as BoardStyle;
  if (Object.keys(look).length) {
    boardStore.setState(look);
    for (const [k, v] of Object.entries(look)) if (!theme) changes.push(`${k} ${v}`);
  }
  if (args.board_color !== undefined && !color) changes.push(`(unknown board colour "${String(args.board_color)}" ignored)`);
  const scheme = boardLook(state().boardColor, "light").scheme;
  return {
    text: changes.length
      ? `Board updated: ${changes.join(", ")}.${state().boardColor !== "default" ? ` The board is ${scheme === "dark" ? "dark: items use their dark look and text is light" : "light"}.` : ""}`
      : "Nothing to change.",
  };
}

async function listBoards(): Promise<ToolResult> {
  const boards = await refreshBoardIndex();
  const open = state().boardId;
  return {
    text: boards.length
      ? boards.map((b) => `- ${b.id} · "${b.title}" · ${b.nodes.length} items${b.id === open ? " · (open now)" : ""}`).join("\n")
      : "There are no boards yet.",
  };
}

/** Wait until the board that just opened is ready to work on. */
async function waitForBoard(id: string): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < 5000) {
    if (state().boardId === id && document.querySelector(".react-flow__viewport")) {
      await sleep(150);
      return true;
    }
    await sleep(40);
  }
  return false;
}

/** Hooks the assistant uses to keep one undo step per board while switching boards. */
export const boardSwitch = { before: () => {}, after: () => {} };

async function createBoardTool(args: Args): Promise<ToolResult> {
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 120) : "Untitled board";
  if (findBoardByTitle(title)) return { text: `A board called "${title}" already exists. Use open_board, or pick another title.` };
  const doc = makeBoardDoc(title, {
    background: BACKGROUNDS.includes(args.background as never) ? (args.background as BoardBackground) : undefined,
    style: BOARD_STYLES.includes(args.style as never) ? (args.style as BoardStyle) : undefined,
  });
  await createBoard(doc);
  boardSwitch.before();
  await openBoard(doc.id);
  const ok = await waitForBoard(doc.id);
  boardSwitch.after();
  return { text: ok ? `Created and opened board "${title}" (id ${doc.id}). It's empty.` : `Created board "${title}" (id ${doc.id}) but couldn't open it.` };
}

async function openBoardTool(args: Args): Promise<ToolResult> {
  const want = typeof args.board === "string" ? args.board : "";
  if (!boardIndex().length) await refreshBoardIndex();
  const doc = boardIndex().find((b) => b.id === want) ?? findBoardByTitle(want);
  if (!doc) return { text: `No board "${want}". Use list_boards.` };
  if (state().boardId === doc.id) return { text: `"${doc.title}" is already open.` };
  boardSwitch.before();
  await openBoard(doc.id);
  const ok = await waitForBoard(doc.id);
  boardSwitch.after();
  return { text: ok ? `Opened "${doc.title}" (id ${doc.id}).` : `Couldn't open "${doc.title}". It may be open in another window.` };
}

/** Run one tool. Problems come back as text for Claude to read, never as thrown errors. */
export async function runTool(name: string, args: unknown): Promise<ToolResult> {
  const a = (args && typeof args === "object" ? args : {}) as Args;
  try {
    switch (name) {
      case "get_board":
        return getBoard();
      case "view_board":
        return await viewBoard(a);
      case "add_content":
        return await addContent(a);
      case "update_items":
        return updateItems(a);
      case "arrange_items":
        return await arrangeItems(a);
      case "delete_items":
        return deleteItems(a);
      case "edit_links":
        return editLinks(a);
      case "set_board":
        return setBoard(a);
      case "list_boards":
        return await listBoards();
      case "create_board":
        return await createBoardTool(a);
      case "open_board":
        return await openBoardTool(a);
      default:
        return { text: `There's no tool called ${name}.` };
    }
  } catch (err) {
    console.error(`Tool ${name} failed`, err);
    return { text: `That didn't work: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** A few words about what a tool call is doing, for the progress list. */
export function describeCall(name: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Args;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (name) {
    case "get_board":
      return "Reading the board";
    case "view_board":
      return "Looking at the board";
    case "add_content": {
      const blocks = (Array.isArray(a.blocks) ? a.blocks : []) as Args[];
      const titled = blocks.map((b) => (typeof b.title === "string" ? b.title : b.kind === "mindmap" ? "a mind map" : b.kind === "flow" ? "a flowchart" : "")).filter(Boolean);
      return titled.length ? `Adding ${titled.slice(0, 3).join(", ")}${titled.length > 3 ? "…" : ""}` : `Adding ${count(a.blocks)} block${count(a.blocks) === 1 ? "" : "s"}`;
    }
    case "update_items":
      return `Restyling ${count(a.updates)} item${count(a.updates) === 1 ? "" : "s"}`;
    case "arrange_items":
      return "Rearranging";
    case "delete_items":
      return `Removing ${count(a.ids)} item${count(a.ids) === 1 ? "" : "s"}`;
    case "edit_links":
      return "Updating links";
    case "set_board":
      return "Changing board settings";
    case "list_boards":
      return "Looking at your boards";
    case "create_board":
      return `Creating board “${typeof a.title === "string" ? a.title : ""}”`;
    case "open_board":
      return "Opening a board";
    default:
      return name;
  }
}
