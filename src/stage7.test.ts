import { describe, expect, it } from "vitest";
import { arrowEnds } from "./arrowBinding";
import { createBoardStore } from "./store";
import type { BoardNode } from "./types";

const setup = () => {
  const s = createBoardStore();
  const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" }, width: 200 });
  const b = s.getState().addNote({ x: 500, y: 0 }, { data: { text: "b" }, width: 200 });
  const arrow = s.getState().addArrow({ x: 100, y: 25 }, { x: 600, y: 25 }, { startId: a, endId: b });
  const get = (id: string) => s.getState().nodes.find((n) => n.id === id) as BoardNode;
  return { s, a, b, arrow, get };
};

describe("sticky arrows", () => {
  it("snap their ends to the edges of the items they were drawn on", () => {
    const { arrow, get } = setup();
    const [p, q] = arrowEnds(get(arrow));
    // Just outside a's right edge and b's left edge.
    expect(p.x).toBeGreaterThan(200);
    expect(p.x).toBeLessThan(215);
    expect(q.x).toBeLessThan(500);
    expect(q.x).toBeGreaterThan(485);
  });

  it("follow an item when it's dragged or nudged", () => {
    const { s, b, arrow, get } = setup();
    s.getState().onNodesChange([{ type: "position", id: b, position: { x: 500, y: 300 }, dragging: true }]);
    const [, q] = arrowEnds(get(arrow));
    expect(q.y).toBeGreaterThan(250);
    s.getState().selectOnly([b]);
    s.getState().nudgeSelection(0, 100);
    expect(arrowEnds(get(arrow))[1].y).toBeGreaterThan(350);
  });

  it("come unstuck when the arrow alone is moved", () => {
    const { s, arrow, get } = setup();
    s.getState().selectOnly([arrow]);
    s.getState().nudgeSelection(0, 40);
    expect(get(arrow).data.startId).toBeUndefined();
    expect(get(arrow).data.endId).toBeUndefined();
  });

  it("stay stuck when moved together with their items, and copies stick to the copies", () => {
    const { s, a, b, arrow, get } = setup();
    s.getState().selectOnly([a, b, arrow]);
    s.getState().nudgeSelection(10, 10);
    expect(get(arrow).data.startId).toBe(a);
    s.getState().duplicateSelection();
    const copy = s.getState().nodes.find((n) => n.type === "arrow" && n.id !== arrow)!;
    expect(copy.data.startId).toBeDefined();
    expect([a, b]).not.toContain(copy.data.startId);
    expect(s.getState().nodes.some((n) => n.id === copy.data.startId)).toBe(true);
  });
});

describe("tags and renaming", async () => {
  const { tagsIn, retitleText } = await import("./navigation");
  it("finds #tags but not headings, URLs or colours", () => {
    expect(tagsIn("Plan #Trip and #budget-2026. # Heading, https://x.com/#anchor, a#b")).toEqual(["trip", "budget-2026"]);
  });
  it("rewrites [[links]] when a board is renamed", () => {
    expect(retitleText("See [[old name]] and [[ Old Name ]] but not [[Older name]]", "Old name", "New name")).toBe(
      "See [[New name]] and [[New name]] but not [[Older name]]",
    );
    expect(retitleText("[[a.b]] [[aXb]]", "a.b", "c")).toBe("[[c]] [[aXb]]");
  });
});

describe("keyboard navigation and templates", async () => {
  const { nearestInDirection } = await import("./layout");
  const { cloneContent } = await import("./templates");
  const { makeItem, makeLink } = await import("./store");
  it("moves to the nearest item in a direction, preferring ones in line", () => {
    const r = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 50 });
    const others = [r("right-far", 600, 0), r("right-near-off", 200, 300), r("right-inline", 300, 10), r("left", -300, 0)];
    expect(nearestInDirection(r("me", 0, 0), others, "right")).toBe("right-inline");
    expect(nearestInDirection(r("me", 0, 0), others, "left")).toBe("left");
    expect(nearestInDirection(r("me", 0, 0), others, "up")).toBeNull();
  });
  it("clones template content with fresh, consistent ids", () => {
    const a = makeItem("note", { x: 0, y: 0 }, { text: "a", group: "g1" });
    const b = makeItem("note", { x: 300, y: 0 }, { text: "b", group: "g1" });
    const arrow = makeItem("arrow", { x: 0, y: 0 }, { ends: [0, 0, 1, 1], startId: a.id });
    const { nodes, edges } = cloneContent([a, b, arrow], [makeLink(a.id, b.id)]);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has(a.id)).toBe(false);
    expect(ids.has(edges[0].source) && ids.has(edges[0].target)).toBe(true);
    expect(ids.has(nodes[2].data.startId!)).toBe(true);
    expect(nodes[0].data.group).toBe(nodes[1].data.group);
    expect(nodes[0].data.group).not.toBe("g1");
  });
});
