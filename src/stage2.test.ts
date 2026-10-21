import { describe, expect, it } from "vitest";
import { arrangePositions, createBoardStore } from "./store";

const setup = () => {
  const s = createBoardStore();
  const a = s.getState().addNote({ x: 0, y: 0 }, { data: { text: "a" }, width: 200 });
  const b = s.getState().addNote({ x: 300, y: 40 }, { data: { text: "b" }, width: 100 });
  const c = s.getState().addNote({ x: 700, y: 90 }, { data: { text: "c" }, width: 200 });
  return { s, a, b, c };
};
const pos = (s: ReturnType<typeof createBoardStore>, id: string) => s.getState().nodes.find((n) => n.id === id)!.position;

describe("arranging", () => {
  it("aligns edges and centres", () => {
    const rects = [
      { id: "a", x: 0, y: 0, width: 200, height: 50 },
      { id: "b", x: 300, y: 40, width: 100, height: 50 },
    ];
    const bounds = { x: 0, y: 0, width: 400, height: 90 };
    expect(arrangePositions(rects, bounds, "left").get("b")).toEqual({ x: 0, y: 40 });
    expect(arrangePositions(rects, bounds, "right").get("a")).toEqual({ x: 200, y: 0 });
    expect(arrangePositions(rects, bounds, "hcenter").get("b")).toEqual({ x: 150, y: 40 });
    expect(arrangePositions(rects, bounds, "bottom").get("a")).toEqual({ x: 0, y: 40 });
  });

  it("spaces items evenly", () => {
    const { s, a, b, c } = setup();
    s.getState().arrange([a, b, c], "distributeX");
    // Total span 900, widths 500, so two gaps of 200.
    expect(pos(s, a).x).toBe(0);
    expect(pos(s, b).x).toBe(400);
    expect(pos(s, c).x).toBe(700);
    s.getState().undo();
    expect(pos(s, b).x).toBe(300);
  });
});

describe("locking", () => {
  it("locked items can't be moved, deleted or edited, and unlock again", () => {
    const { s, a, b } = setup();
    s.getState().setLocked([a], true);
    expect(s.getState().nodes.find((n) => n.id === a)!.draggable).toBe(false);
    s.getState().selectOnly([a, b]);
    s.getState().nudgeSelection(10, 0);
    expect(pos(s, a).x).toBe(0);
    expect(pos(s, b).x).toBe(310);
    s.getState().deleteSelection();
    expect(s.getState().nodes.map((n) => n.id)).toContain(a);
    expect(s.getState().nodes.map((n) => n.id)).not.toContain(b);
    s.getState().startEditing(a);
    expect(s.getState().editingId).toBeNull();
    s.getState().setLocked([a], false);
    s.getState().deleteNodes([a]);
    expect(s.getState().nodes.map((n) => n.id)).not.toContain(a);
  });
});

describe("grouping", () => {
  it("selecting one member selects the whole group; copies form their own group", () => {
    const { s, a, b, c } = setup();
    s.getState().group([a, b]);
    s.getState().clearSelection();
    s.getState().onNodesChange([{ type: "select", id: a, selected: true }]);
    const selected = s.getState().nodes.filter((n) => n.selected).map((n) => n.id);
    expect(selected.sort()).toEqual([a, b].sort());
    s.getState().duplicateSelection();
    const groups = new Set(s.getState().nodes.map((n) => n.data.group).filter(Boolean));
    expect(groups.size).toBe(2);
    s.getState().ungroup([c, a]);
    expect(s.getState().nodes.find((n) => n.id === b)!.data.group).toBeUndefined();
  });
});
