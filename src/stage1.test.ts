import { describe, expect, it } from "vitest";
import { pointInPolygon } from "./components/CanvasGestures";
import { fuzzyScore } from "./components/CommandPalette";
import { rectsOverlap } from "./geometry";
import { rectOf } from "./layout";
import { childrenOf, descendants, hiddenItems, tidyTree, treeRoots } from "./mindmap";
import { fromSaved, toSaved } from "./persistence";
import { arrowBox, createBoardStore, makeItem, makeLink } from "./store";
import type { BoardNode } from "./types";

const note = (id: string, x: number, y: number): BoardNode => ({
  ...makeItem("note", { x, y }, { text: id }, { width: 200, height: 50 }),
  id,
  measured: { width: 200, height: 50 },
});

describe("mind maps", () => {
  // root → a → (a1, a2); root → b; c ← root on the left
  const nodes = [note("root", 0, 0), note("a", 300, -200), note("a1", 600, 300), note("a2", 600, -400), note("b", 300, 500), note("c", -400, 40)];
  const edges = [
    ["root", "a"],
    ["a", "a1"],
    ["a", "a2"],
    ["root", "b"],
    ["root", "c"],
  ].map(([s, t]) => ({ ...makeLink(s, t), id: `${s}-${t}` }));

  it("finds children, descendants and roots", () => {
    const ch = childrenOf(nodes, edges);
    expect(ch.get("a")).toEqual(["a1", "a2"]);
    expect([...descendants("root", ch)].sort()).toEqual(["a", "a1", "a2", "b", "c"]);
    expect(treeRoots(nodes, edges)).toEqual(["root"]);
  });

  it("tidies a tree without overlaps, keeping the root still and sides intact", () => {
    const moves = tidyTree("root", nodes, edges);
    expect(moves.has("root")).toBe(false);
    const placed = nodes.map((n) => ({ ...rectOf(n), ...(moves.get(n.id) ?? n.position), id: n.id }));
    for (const p of placed) for (const q of placed) if (p.id < q.id) expect(rectsOverlap(p, q)).toBe(false);
    const at = (id: string) => placed.find((p) => p.id === id)!;
    expect(at("c").x).toBeLessThan(0);
    expect(at("a").x).toBeGreaterThan(200);
    // Children line up in a column, keeping their top-to-bottom order.
    expect(at("a1").x).toBe(at("a2").x);
    expect(at("a2").y).toBeLessThan(at("a1").y);
    // A parent sits in the middle of its children.
    expect(at("a").y + 25).toBeCloseTo((at("a1").y + at("a2").y) / 2 + 25);
  });

  it("folding hides the whole branch, and tidying carries it along", () => {
    const folded = nodes.map((n) => (n.id === "a" ? { ...n, data: { ...n.data, collapsed: true } } : n));
    expect([...hiddenItems(folded, edges)].sort()).toEqual(["a1", "a2"]);
    const moves = tidyTree("root", folded, edges);
    const a = moves.get("a")!;
    const a1 = moves.get("a1")!;
    // a1 keeps its offset from a.
    expect(a1.x - a.x).toBeCloseTo(600 - 300);
    expect(a1.y - a.y).toBeCloseTo(300 + 200);
  });

  it("store: fold, tidy and undo", () => {
    const s = createBoardStore();
    s.getState().load({ id: "b", title: "t", createdAt: 0, updatedAt: 0, pinned: false, background: "dots", viewport: null, nodes, edges });
    s.getState().selectAll();
    expect(s.getState().nodes.filter((n) => n.selected)).toHaveLength(6);
    s.getState().toggleCollapse("a");
    s.getState().selectAll();
    expect(s.getState().nodes.filter((n) => n.selected)).toHaveLength(4);
    expect(s.getState().tidyUp()).toBeGreaterThan(0);
    s.getState().undo();
    expect(s.getState().nodes.find((n) => n.id === "b")!.position).toEqual({ x: 300, y: 500 });
  });
});

describe("free arrows", () => {
  it("boxes an arrow with padding and relative ends", () => {
    const b = arrowBox({ x: 100, y: 200 }, { x: 40, y: 260 });
    expect(b.position).toEqual({ x: 24, y: 184 });
    expect([b.width, b.height]).toEqual([92, 92]);
    expect(b.ends).toEqual([76, 16, 16, 76]);
  });

  it("round-trips arrows and board cards; drops broken ones", () => {
    const s = createBoardStore();
    s.getState().addArrow({ x: 0, y: 0 }, { x: 100, y: 50 }, { arrowHead: "both", color: "blue", size: "l" });
    s.getState().addBoardCard("other", "Other board", { x: 0, y: 200 });
    s.getState().addItem("shape", { x: 0, y: 400 }, { data: { shape: "star" } });
    const doc = { id: "x", title: "t", createdAt: 0, updatedAt: 0, pinned: false, background: "dots" as const, viewport: null, nodes: s.getState().nodes, edges: [] };
    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(doc))));
    expect(back.nodes.map((n) => n.data)).toEqual(s.getState().nodes.map((n) => n.data));
    const bad = fromSaved({ items: [{ id: "a", type: "arrow", ends: [1, 2] }, { id: "b", type: "board" }, { id: "c", type: "shape", shape: "blob" }] });
    expect(bad.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(bad.nodes[0].data.shape).toBe("rect");
  });
});

describe("palette and lasso", () => {
  it("fuzzy-matches in order and prefers word starts", () => {
    expect(fuzzyScore("tdy", "Tidy up all mind maps")).not.toBeNull();
    expect(fuzzyScore("xyz", "Tidy up")).toBeNull();
    expect(fuzzyScore("ex", "Export as PNG")!).toBeGreaterThan(fuzzyScore("ex", "Next item")!);
  });

  it("tests points inside a loop", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});
