import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { borderPoint, pickSides, rectsOverlap, sidePoint } from "./geometry";
import { freeSpot, itemsInFrame } from "./layout";
import { computeLinkEnds, linkGeometry } from "./linkPath";
import { fromSaved, toSaved } from "./persistence";
import { createBoardStore, makeItem, makeLink, type BoardDoc } from "./store";
import { TEMPLATES } from "./templates";
import type { BoardNode } from "./types";

const rect = (x: number, y: number, width = 200, height = 60) => ({ x, y, width, height });

const note = (x: number, y: number, extra: Partial<BoardNode> = {}): BoardNode => ({
  ...makeItem("note", { x, y }, { text: "n" }, { width: 200, height: 60 }),
  measured: { width: 200, height: 60 },
  ...extra,
});

describe("geometry", () => {
  it("links side-by-side items on facing sides", () => {
    expect(pickSides(rect(0, 0), rect(400, 20))).toEqual([Position.Right, Position.Left]);
    expect(pickSides(rect(400, 20), rect(0, 0))).toEqual([Position.Left, Position.Right]);
  });

  it("links stacked items top/bottom", () => {
    expect(pickSides(rect(0, 0), rect(30, 300))).toEqual([Position.Bottom, Position.Top]);
    expect(pickSides(rect(0, 300), rect(30, 0))).toEqual([Position.Top, Position.Bottom]);
  });

  it("puts straight-link endpoints exactly on the outline", () => {
    const r = rect(0, 0, 200, 100);
    expect(borderPoint(r, { x: 1000, y: 50 })).toMatchObject({ x: 200, y: 50 });
    expect(borderPoint(r, { x: 100, y: -500 }).y).toBe(0);
    // A diagonal ray hits a diamond's edge halfway along, inside the bounding box corner.
    const d = borderPoint(rect(0, 0, 100, 100), { x: 1000, y: 1000 }, "diamond");
    expect(d.x).toBeCloseTo(75);
    expect(d.y).toBeCloseTo(75);
    const e = borderPoint(rect(0, 0, 100, 100), { x: 1000, y: 1000 }, "ellipse");
    expect(Math.hypot(e.x - 50, e.y - 50)).toBeCloseTo(50);
  });

  it("keeps offset anchors on curved outlines", () => {
    const r = rect(0, 0, 100, 100);
    expect(sidePoint(r, Position.Right, 20).x).toBe(100);
    expect(sidePoint(r, Position.Right, 25, "diamond").x).toBeCloseTo(75);
    expect(sidePoint(r, Position.Right, 30, "ellipse").x).toBeCloseTo(90);
  });

  it("produces arrowheads only where asked", () => {
    const ends = computeLinkEnds([note(0, 0, { id: "a" }), note(400, 0, { id: "b" })], [{ ...makeLink("a", "b"), id: "l" }]).get("l")!;
    expect(linkGeometry(ends, "curved", "none").heads).toHaveLength(0);
    expect(linkGeometry(ends, "curved", "end").heads).toHaveLength(1);
    expect(linkGeometry(ends, "elbow", "both").heads).toHaveLength(2);
  });

  it("handles overlapping items without NaN", () => {
    const nodes = [note(0, 0, { id: "a" }), note(0, 0, { id: "b" })];
    const ends = computeLinkEnds(nodes, [{ ...makeLink("a", "b", { curve: "straight" }), id: "l" }]).get("l")!;
    expect(linkGeometry(ends, "straight", "both").path).not.toContain("NaN");
  });
});

describe("link ends", () => {
  it("spreads links that share a side so they don't overlap", () => {
    const nodes = [note(0, 200, { id: "hub" }), note(400, 0, { id: "a" }), note(400, 200, { id: "b" }), note(400, 400, { id: "c" })];
    const edges = ["a", "b", "c"].map((t) => ({ ...makeLink("hub", t), id: t }));
    const ends = computeLinkEnds(nodes, edges);
    const ys = ["a", "b", "c"].map((id) => ends.get(id)![0].y);
    // All on the hub's right side, distinct, and ordered top-to-bottom like their targets.
    expect(ends.get("a")![0].side).toBe(Position.Right);
    expect(new Set(ys).size).toBe(3);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    // The middle one stays centred and nothing leaves the side.
    expect(ys[1]).toBe(230);
    for (const y of ys) expect(y).toBeGreaterThan(200);
    for (const y of ys) expect(y).toBeLessThan(260);
  });

  it("leaves a lone link at the side's midpoint", () => {
    const ends = computeLinkEnds([note(0, 0, { id: "a" }), note(400, 0, { id: "b" })], [{ ...makeLink("a", "b"), id: "l" }]).get("l")!;
    expect(ends[0]).toMatchObject({ x: 200, y: 30 });
    expect(ends[1]).toMatchObject({ x: 400, y: 30 });
  });

  it("spreads incoming ends on the target too", () => {
    const nodes = [note(0, 0, { id: "a" }), note(0, 300, { id: "b" }), note(400, 150, { id: "t" })];
    const edges = [
      { ...makeLink("a", "t"), id: "1" },
      { ...makeLink("b", "t"), id: "2" },
    ];
    const ends = computeLinkEnds(nodes, edges);
    expect(ends.get("1")![1].side).toBe(Position.Left);
    expect(ends.get("1")![1].y).toBeLessThan(ends.get("2")![1].y);
  });
});

describe("placing items", () => {
  it("puts a new note beside its parent when there's room", () => {
    const p = freeSpot(rect(0, 0, 220, 50), Position.Right, [rect(0, 0, 220, 50)]);
    expect(p.x).toBeGreaterThan(220);
    expect(p.y).toBe(0);
  });

  it("slides down past items that are in the way", () => {
    const parent = rect(0, 0, 220, 50);
    const first = freeSpot(parent, Position.Right, [parent]);
    const blocker = { ...first, width: 220, height: 50 };
    const second = freeSpot(parent, Position.Right, [parent, blocker]);
    expect(second.y).toBeGreaterThan(first.y);
    expect(rectsOverlap({ ...second, width: 220, height: 50 }, blocker)).toBe(false);
  });

  it("finds the items inside a section", () => {
    const frame = makeItem("frame", { x: 0, y: 0 }, {}, { width: 500, height: 400 });
    const inside = note(100, 100);
    const outside = note(600, 100);
    expect(itemsInFrame(frame, [frame, inside, outside])).toEqual([inside.id]);
  });
});

describe("board store", () => {
  it("connects items once, never to themselves, and never to sections or drawings", () => {
    const s = createBoardStore();
    const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    const b = s.getState().addNote({ x: 400, y: 0 }, { data: { text: "b" } });
    const f = s.getState().addItem("frame", { x: 0, y: 300 });
    expect(s.getState().connect(a, a)).toBeNull();
    expect(s.getState().connect(a, b)).not.toBeNull();
    expect(s.getState().connect(a, b)).toBeNull();
    expect(s.getState().connect(b, a)).toBeNull();
    expect(s.getState().connect(a, f)).toBeNull();
    expect(s.getState().edges).toHaveLength(1);
  });

  it("keeps sections underneath everything else", () => {
    const s = createBoardStore();
    s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    s.getState().addItem("frame", { x: 0, y: 0 });
    expect(s.getState().nodes[0].type).toBe("frame");
    expect(s.getState().nodes[0].zIndex).toBe(-1);
  });

  it("removes links along with their items, and undo brings both back", () => {
    const s = createBoardStore();
    const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    const b = s.getState().addNote({ x: 400, y: 0 }, { data: { text: "b" } });
    s.getState().connect(a, b);
    s.getState().deleteNodes([a]);
    expect(s.getState().nodes.map((n) => n.id)).toEqual([b]);
    expect(s.getState().edges).toHaveLength(0);
    s.getState().undo();
    expect(s.getState().nodes).toHaveLength(2);
    expect(s.getState().edges).toHaveLength(1);
    s.getState().redo();
    expect(s.getState().edges).toHaveLength(0);
  });

  it("drops an abandoned empty note without leaving an undo step, but keeps empty shapes", () => {
    const s = createBoardStore();
    s.getState().addNote({ x: 0, y: 0 }, { data: { text: "keep" } });
    const before = s.getState().past.length;
    s.getState().addNote({ x: 300, y: 0 }, { edit: true });
    s.getState().stopEditing();
    expect(s.getState().nodes).toHaveLength(1);
    expect(s.getState().past.length).toBe(before);
    s.getState().addItem("shape", { x: 0, y: 300 }, { edit: true, data: { shape: "ellipse" } });
    s.getState().stopEditing();
    expect(s.getState().nodes).toHaveLength(2);
  });

  it("records a whole typing session as one undo step", () => {
    const s = createBoardStore();
    const id = s.getState().addNote({ x: 0, y: 0 }, { edit: true });
    for (const t of ["h", "he", "hel", "hello"]) s.getState().setText(id, t);
    s.getState().stopEditing();
    const steps = s.getState().past.length;
    s.getState().startEditing(id);
    s.getState().setText(id, "hello world");
    s.getState().stopEditing();
    expect(s.getState().past.length).toBe(steps + 1);
    s.getState().undo();
    expect(s.getState().nodes[0].data.text).toBe("hello");
  });

  it("ticks to-dos inside a note", () => {
    const s = createBoardStore();
    const id = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "# Plan\n- [ ] one\n- [x] two" } });
    s.getState().toggleTask(id, 1);
    s.getState().toggleTask(id, 2);
    expect(s.getState().nodes[0].data.text).toBe("# Plan\n- [x] one\n- [ ] two");
    s.getState().toggleTask(id, 0);
    expect(s.getState().nodes[0].data.text).toBe("# Plan\n- [x] one\n- [ ] two");
  });

  it("drags a section's contents along with it", () => {
    const s = createBoardStore();
    const f = s.getState().addItem("frame", { x: 0, y: 0 }, { width: 500, height: 400 });
    const inside = s.getState().addNote({ x: 100, y: 100 }, { data: { text: "in" } });
    const outside = s.getState().addNote({ x: 900, y: 100 }, { data: { text: "out" } });
    s.getState().beginDrag([f]);
    s.getState().onNodesChange([{ type: "position", id: f, position: { x: 50, y: 20 }, dragging: true }]);
    s.getState().endDrag();
    const pos = (id: string) => s.getState().nodes.find((n) => n.id === id)!.position;
    expect(pos(inside)).toEqual({ x: 150, y: 120 });
    expect(pos(outside)).toEqual({ x: 900, y: 100 });
    s.getState().undo();
    expect(pos(inside)).toEqual({ x: 100, y: 100 });
  });

  it("wraps the selection in a section", () => {
    const s = createBoardStore();
    s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    s.getState().addNote({ x: 300, y: 200 }, { data: { text: "b" } });
    s.getState().selectAll();
    const id = s.getState().frameSelection()!;
    const frame = s.getState().nodes.find((n) => n.id === id)!;
    expect(frame.type).toBe("frame");
    expect(frame.position.x).toBeLessThan(0);
    expect(itemsInFrame(frame, s.getState().nodes)).toHaveLength(2);
  });

  it("stores pen strokes relative to their own corner", () => {
    const s = createBoardStore();
    const id = s.getState().addInk([100, 100, 0.5, 150, 120, 0.5, 200, 180, 0.5], "blue", "m")!;
    const ink = s.getState().nodes.find((n) => n.id === id)!;
    expect(ink.position).toEqual({ x: 88, y: 88 });
    expect(ink.data.points!.slice(0, 2)).toEqual([12, 12]);
    expect(ink.width).toBe(124);
    s.getState().begin();
    s.getState().eraseNodes([id]);
    s.getState().commit();
    expect(s.getState().nodes).toHaveLength(0);
    s.getState().undo();
    expect(s.getState().nodes).toHaveLength(1);
  });

  it("Tab-style linked notes get a link and stay editable", () => {
    const s = createBoardStore();
    const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "root" } });
    const b = s.getState().addLinkedNote(a, Position.Right)!;
    expect(s.getState().editingId).toBe(b);
    expect(s.getState().edges[0]).toMatchObject({ source: a, target: b });
  });

  it("new links copy the last link style you chose", () => {
    const s = createBoardStore();
    const [a, b, c] = ["a", "b", "c"].map((t, i) => s.getState().addNote({ x: i * 300, y: 0 }, { data: { text: t } }));
    const first = s.getState().connect(a, b)!;
    s.getState().updateLink(first, { curve: "elbow", dash: "dashed" });
    s.getState().connect(b, c);
    expect(s.getState().edges[1].data).toMatchObject({ curve: "elbow", dash: "dashed", label: "" });
  });

  it("pastes copies with fresh ids and their internal links", () => {
    const s = createBoardStore();
    const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    const b = s.getState().addItem("shape", { x: 300, y: 0 }, { data: { shape: "diamond" } });
    s.getState().connect(a, b);
    s.getState().selectAll();
    s.getState().duplicateSelection();
    const { nodes, edges } = s.getState();
    expect(nodes).toHaveLength(4);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(4);
    expect(edges).toHaveLength(2);
    expect(nodes.filter((n) => n.selected)).toHaveLength(2);
    expect(nodes.filter((n) => n.data.shape === "diamond")).toHaveLength(2);
  });
});

const docOf = (s: ReturnType<typeof createBoardStore>): BoardDoc => ({
  id: "b1",
  title: "T",
  createdAt: 1,
  updatedAt: 2,
  pinned: true,
  background: "grid",
  viewport: { x: 1, y: 2, zoom: 0.5 },
  nodes: s.getState().nodes,
  edges: s.getState().edges,
});

describe("saving", () => {
  it("round-trips every kind of item", () => {
    const s = createBoardStore();
    const a = s.getState().addNote({ x: 10, y: 20 }, { data: { text: "a", color: "blue", size: "l" } });
    const b = s.getState().addItem("shape", { x: 300, y: 0 }, { data: { text: "b", shape: "ellipse" }, width: 150, height: 90 });
    s.getState().addItem("frame", { x: -50, y: -50 }, { data: { text: "Section", color: "green" } });
    s.getState().addItem("image", { x: 0, y: 300 }, { data: { asset: "abc.png" }, width: 300, height: 200 });
    s.getState().addItem("link", { x: 0, y: 600 }, { data: { url: "https://example.com" } });
    s.getState().addItem("text", { x: 0, y: 700 }, { data: { text: "Title", size: "l" } });
    s.getState().addInk([0, 0, 0.5, 10, 10, 0.5], "pink", "s");
    const l = s.getState().connect(a, b)!;
    s.getState().updateLink(l, { label: "because", arrow: "both" });

    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(docOf(s)))));
    const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((p, q) => (p.id < q.id ? -1 : 1));
    expect(sortById(back.nodes).map((n) => [n.type, n.data])).toEqual(sortById(s.getState().nodes).map((n) => [n.type, n.data]));
    const shape = back.nodes.find((n) => n.id === b)!;
    expect([shape.width, shape.height]).toEqual([150, 90]);
    expect(back.edges[0]).toMatchObject({ source: a, target: b, data: { label: "because", arrow: "both" } });
    expect(back).toMatchObject({ id: "b1", title: "T", pinned: true, background: "grid", viewport: { x: 1, y: 2, zoom: 0.5 } });
  });

  it("opens version 1 boards (notes only)", () => {
    const back = fromSaved({
      format: "mythra-board",
      version: 1,
      title: "Old",
      notes: [{ id: "a", x: 1, y: 2, width: 300, text: "hi", color: "pink", size: "s" }],
      links: [],
    });
    expect(back.nodes[0]).toMatchObject({ type: "note", position: { x: 1, y: 2 }, width: 300, data: { text: "hi", color: "pink" } });
    expect(back.background).toBe("dots");
  });

  it("skips damaged entries instead of failing", () => {
    const back = fromSaved({
      items: [
        { id: "a", type: "note", x: 0, y: 0, text: "ok" },
        { id: "a", x: 5 },
        null,
        { x: 1 },
        { id: "b", x: "bad", color: "neon", type: "mystery" },
        { id: "c", type: "image" },
        { id: "d", type: "ink", points: ["x"] },
      ],
      links: [
        { id: "l1", from: "a", to: "b" },
        { id: "l2", from: "b", to: "a" },
        { id: "l3", from: "a", to: "missing" },
        { id: "l4", from: "a", to: "a" },
      ],
      viewport: { x: 0, y: 0, zoom: 0 },
    });
    expect(back.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(back.nodes[1]).toMatchObject({ type: "note", position: { x: 0 }, data: { color: "plain" } });
    expect(back.edges.map((e) => e.id)).toEqual(["l1"]);
    expect(back.viewport).toBeNull();
  });
});

describe("templates", () => {
  it("all build valid boards", () => {
    for (const t of TEMPLATES) {
      const { nodes, edges } = t.build();
      const ids = new Set(nodes.map((n) => n.id));
      expect(ids.size).toBe(nodes.length);
      for (const e of edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
      // Sections come first so they draw underneath.
      const firstOther = nodes.findIndex((n) => n.type !== "frame");
      expect(nodes.slice(firstOther).some((n) => n.type === "frame")).toBe(false);
    }
  });
});
