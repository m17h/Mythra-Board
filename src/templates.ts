import { nanoid } from "nanoid";
import type { Point } from "./geometry";
import { newBoardId, saveTemplate } from "./persistence";
import { makeItem, makeLink } from "./store";
import type { BoardBackground, BoardNode, BoardStyle, ItemData, ItemType, LinkData, LinkEdge } from "./types";

export type Template = {
  id: string;
  name: string;
  description: string;
  background: BoardBackground;
  style?: BoardStyle;
  /** Set for templates you saved yourself. */
  customId?: string;
  build: () => { nodes: BoardNode[]; edges: LinkEdge[] };
};

/** One of your saved boards, offered as a starting point. */
export const customTemplate = (doc: { id: string; title: string; background: BoardBackground; style: BoardStyle; nodes: BoardNode[]; edges: LinkEdge[] }): Template => ({
  id: `custom:${doc.id}`,
  customId: doc.id,
  name: doc.title,
  description: "Your template",
  background: doc.background,
  style: doc.style,
  build: () => cloneContent(doc.nodes, doc.edges),
});

/** Small helper for laying out template content. */
function board() {
  const nodes: BoardNode[] = [];
  const edges: LinkEdge[] = [];
  const add = (type: ItemType, at: Point, data: Partial<ItemData>, size?: { width?: number; height?: number }) => {
    const n = makeItem(type, at, data, size);
    if (type === "frame") nodes.unshift(n);
    else nodes.push(n);
    return n.id;
  };
  const link = (a: string, b: string, data?: Partial<LinkData>) => edges.push(makeLink(a, b, data));
  return { nodes, edges, add, link };
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank board",
    description: "Start from nothing",
    background: "dots",
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "One big idea, branching out",
    background: "dots",
    build: () => {
      const b = board();
      const center = b.add("note", { x: 0, y: 0 }, { text: "Central idea", color: "purple", size: "l" }, { width: 240, height: 64 });
      const style = { arrow: "none" as const };
      const branches: [string, Point, ItemData["color"]][] = [
        ["Branch one", { x: 360, y: -110 }, "blue"],
        ["Branch two", { x: 360, y: 90 }, "green"],
        ["Branch three", { x: -340, y: -110 }, "orange"],
        ["Branch four", { x: -340, y: 90 }, "pink"],
      ];
      const ids = branches.map(([text, at, color]) => {
        const id = b.add("note", at, { text, color });
        b.link(center, id, style);
        return id;
      });
      for (const [i, text] of ["A detail", "Another detail"].entries()) {
        b.link(ids[0], b.add("note", { x: 680, y: -170 + i * 90 }, { text, color: "blue", size: "s" }, { width: 180 }), style);
      }
      return b;
    },
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "Dump ideas, then pick favourites",
    background: "dots",
    build: () => {
      const b = board();
      b.add("text", { x: 0, y: -110 }, { text: "What are we trying to solve?", textStyle: "heading" }, { width: 640 });
      b.add("frame", { x: 0, y: 0 }, { text: "Ideas", color: "yellow" }, { width: 760, height: 400 });
      b.add("frame", { x: 800, y: 0 }, { text: "Favourites", color: "green" }, { width: 400, height: 400 });
      const ideas = ["A wild idea", "A quick win", "What if…?", "Ask someone who knows", "Combine two ideas", "Flip it around"];
      ideas.forEach((text, i) =>
        b.add("note", { x: 40 + (i % 3) * 240, y: 60 + Math.floor(i / 3) * 150 }, { text, color: "yellow" }),
      );
      return b;
    },
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Steps, decisions and outcomes",
    background: "grid",
    build: () => {
      const b = board();
      const flow = { curve: "elbow" as const };
      const start = b.add("shape", { x: 10, y: 0 }, { text: "Start", shape: "ellipse", color: "green" }, { width: 160, height: 70 });
      const step = b.add("shape", { x: 0, y: 150 }, { text: "Do something", shape: "rect", color: "blue" }, { width: 180, height: 80 });
      const check = b.add("shape", { x: -5, y: 310 }, { text: "Did it work?", shape: "diamond", color: "yellow" }, { width: 190, height: 130 });
      const yes = b.add("shape", { x: 320, y: 335 }, { text: "Celebrate", shape: "rect", color: "green" }, { width: 180, height: 80 });
      const no = b.add("shape", { x: 0, y: 520 }, { text: "Try another way", shape: "rect", color: "pink" }, { width: 180, height: 80 });
      b.link(start, step, flow);
      b.link(step, check, flow);
      b.link(check, yes, { ...flow, label: "Yes" });
      b.link(check, no, { ...flow, label: "No" });
      return b;
    },
  },
  {
    id: "kanban",
    name: "Project plan",
    description: "To do, doing, done",
    background: "dots",
    build: () => {
      const b = board();
      b.add("text", { x: 0, y: -100 }, { text: "Project plan", textStyle: "title" }, { width: 400 });
      const columns: [string, ItemData["color"], [string, string][]][] = [
        ["To do", "blue", [["Research", "- [ ] Look at examples\n- [ ] Write down questions"], ["Plan the first version", "Who it's for and what it must do"]]],
        ["Doing", "yellow", [["Design", "- [x] Sketch ideas\n- [ ] Pick one"]]],
        ["Done", "green", [["Kick-off", "- [x] Agree on goals"]]],
      ];
      columns.forEach(([name, color, notes], c) => {
        b.add("frame", { x: c * 340, y: 0 }, { text: name, color }, { width: 300, height: 520 });
        notes.forEach(([title, text], i) => b.add("note", { x: c * 340 + 40, y: 60 + i * 190 }, { title, text, color }));
      });
      return b;
    },
  },
  {
    id: "proscons",
    name: "Pros & cons",
    description: "Weigh up a decision",
    background: "plain",
    build: () => {
      const b = board();
      b.add("text", { x: 0, y: -110 }, { text: "Should we…?", textStyle: "title" }, { width: 500 });
      b.add("text", { x: 0, y: -50 }, { text: "Write the decision you're weighing up, then list both sides.", textStyle: "caption" }, { width: 600 });
      b.add("frame", { x: 0, y: 0 }, { text: "Pros", color: "green" }, { width: 420, height: 420 });
      b.add("frame", { x: 460, y: 0 }, { text: "Cons", color: "pink" }, { width: 420, height: 420 });
      ["It would be great because…", "Another upside"].forEach((text, i) =>
        b.add("note", { x: 40, y: 60 + i * 120 }, { text, color: "green" }, { width: 340 }),
      );
      ["The risk is…", "Another downside"].forEach((text, i) =>
        b.add("note", { x: 500, y: 60 + i * 120 }, { text, color: "pink" }, { width: 340 }),
      );
      return b;
    },
  },
];

/** The board shown the very first time the app opens: a short, hands-on tour. */
export function welcomeBoard() {
  const b = board();
  b.add("text", { x: 0, y: -170 }, { text: "Welcome to Mythra Board", textStyle: "title" }, { width: 700 });
  b.add("text", { x: 0, y: -105 }, { text: "A calm place to think: write ideas down and link them together. Try things right here.", textStyle: "caption" }, { width: 760 });

  // Start here
  b.add("frame", { x: 0, y: 0 }, { text: "Start here", color: "blue" }, { width: 420, height: 560 });
  b.add("note", { x: 30, y: 50 }, { title: "Add an idea", text: "Double-click anywhere on the board, then type." , color: "blue" }, { width: 360 });
  const hub = b.add("note", { x: 30, y: 210 }, { text: "Your big idea", color: "blue", size: "l" }, { width: 200 });
  const a = b.add("note", { x: 260, y: 170 }, { text: "A thought", color: "blue", size: "s" }, { width: 140 });
  const c = b.add("note", { x: 260, y: 270 }, { text: "Another", color: "blue", size: "s" }, { width: 140 });
  b.link(hub, a, { arrow: "none" });
  b.link(hub, c, { arrow: "none" });
  b.add("note", { x: 30, y: 380 }, { text: "Hover a note to see its dots. **Drag a dot** to another note to link them, or press **Tab** while typing to grow a new linked note.", color: "blue" }, { width: 360 });

  // Make it yours
  b.add("frame", { x: 460, y: 0 }, { text: "Make it yours", color: "green" }, { width: 420, height: 560 });
  b.add("note", { x: 490, y: 50 }, { title: "Notes can have titles", text: "- [x] Tick off to-dos\n- [ ] Use # headings, - bullets and **bold**\n- [ ] Select a note to change its colour, outline and text", color: "green" }, { width: 360 });
  b.add("shape", { x: 490, y: 270 }, { text: "Shapes", shape: "diamond", color: "yellow" }, { width: 160, height: 110 });
  b.add("shape", { x: 680, y: 270 }, { text: "and more", shape: "star", color: "pink" }, { width: 150, height: 120 });
  b.add("note", { x: 490, y: 420 }, { text: "Draw with the pen (P), add arrows (A) and pictures (I) from the toolbar below.", color: "green" }, { width: 360 });

  // Go further
  b.add("frame", { x: 920, y: 0 }, { text: "Go further", color: "purple" }, { width: 420, height: 560 });
  b.add("note", { x: 950, y: 50 }, { text: "Press **⌘K** to find any action or board.", color: "purple" }, { width: 360 });
  b.add("note", { x: 950, y: 140 }, { text: "Link boards together: [[My first ideas]] is a link. Click it to create that board.", color: "purple" }, { width: 360 });
  b.add("note", { x: 950, y: 250 }, { text: "**Right-click** anything for more options, and press **?** for every shortcut.", color: "purple" }, { width: 360 });
  b.add("note", { x: 950, y: 360 }, { text: "Sections like these become slides: press **⇧⌘P** to present them.", color: "purple" }, { width: 360 });
  b.add("note", { x: 950, y: 460 }, { text: "Done exploring? Delete this board from the home screen any time.", color: "purple" }, { width: 360 });
  return b;
}

/**
 * A fresh copy of a board's content: new ids throughout, with links, groups and stuck
 * arrows pointing at the copies. Used for custom templates.
 */
export function cloneContent(nodes: BoardNode[], edges: LinkEdge[]) {
  const ids = new Map(nodes.map((n) => [n.id, nanoid(10)]));
  const groups = new Map<string, string>();
  const copy = nodes.map((n) => {
    const data = { ...n.data };
    if (data.group) data.group = groups.get(data.group) ?? groups.set(data.group, nanoid(8)).get(data.group)!;
    for (const k of ["startId", "endId"] as const) if (data[k]) data[k] = ids.get(data[k]!);
    delete data.collapsed;
    return { ...n, id: ids.get(n.id)!, selected: false, data };
  });
  const links = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ ...e, id: nanoid(10), source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false }));
  return { nodes: copy, edges: links };
}

/** Save a copy of a board as one of your templates. */
export async function saveAsTemplate(doc: { title: string; background: BoardBackground; style: BoardStyle; nodes: BoardNode[]; edges: LinkEdge[] }) {
  const now = Date.now();
  const content = cloneContent(doc.nodes, doc.edges);
  await saveTemplate({ id: newBoardId(), title: doc.title, createdAt: now, updatedAt: now, pinned: false, background: doc.background, style: doc.style, viewport: null, ...content });
}
