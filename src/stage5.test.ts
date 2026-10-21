import { describe, expect, it } from "vitest";
import { addChildren, addTree, parseJsonReply } from "./ai";
import { rectsOverlap } from "./geometry";
import { rectOf } from "./layout";
import { boardStore } from "./store";

const reset = () =>
  boardStore.getState().load({ id: "t", title: "T", createdAt: 0, updatedAt: 0, pinned: false, background: "dots", style: "clean", viewport: null, nodes: [], edges: [] });

describe("AI helpers", () => {
  it("finds the JSON in a reply, fenced or not", () => {
    expect(parseJsonReply<{ ideas: string[] }>('```json\n{"ideas":["a","b"]}\n```').ideas).toEqual(["a", "b"]);
    expect(parseJsonReply<{ x: number }>('Sure! {"x": 1}').x).toBe(1);
    expect(() => parseJsonReply("no json here")).toThrow();
  });

  it("adds brainstormed ideas beside the note without overlaps, in one undo step", () => {
    reset();
    const s = boardStore.getState();
    const root = s.addNote({ x: 0, y: 0 }, { data: { text: "Holiday" } });
    const steps = boardStore.getState().past.length;
    addChildren(root, ["Beach", "Mountains", "City break"], "blue");
    const { nodes, edges, past } = boardStore.getState();
    expect(nodes).toHaveLength(4);
    expect(edges.every((e) => e.source === root)).toBe(true);
    expect(past.length).toBe(steps + 1);
    const kids = nodes.filter((n) => n.id !== root).map(rectOf);
    for (const a of kids) for (const b of kids) if (a !== b) expect(rectsOverlap(a, b)).toBe(false);
    boardStore.getState().undo();
    expect(boardStore.getState().nodes).toHaveLength(1);
  });

  it("builds a mind map tree from a reply, skipping junk", () => {
    reset();
    const root = boardStore.getState().addNote({ x: 0, y: 0 }, { data: { text: "Plan" } });
    const count = addTree(root, [
      { text: "Goals", children: [{ text: "Short term" }, { text: "Long term", children: [{ text: "Five years" }] }] },
      { text: "", children: [{ text: "orphan" }] },
      { text: 42 },
      { text: "Budget" },
    ]);
    expect(count).toBe(5);
    const { nodes, edges } = boardStore.getState();
    const byText = (t: string) => nodes.find((n) => n.data.text === t)!;
    expect(edges.some((e) => e.source === byText("Long term").id && e.target === byText("Five years").id)).toBe(true);
    expect(byText("Goals").position.x).toBeGreaterThan(200);
  });
});

describe("shortcut labels", async () => {
  const { keyLabel } = await import("./platform");
  it("uses Mac symbols on a Mac and words elsewhere", () => {
    expect(keyLabel("Undo (⌘Z)", true)).toBe("Undo (⌘Z)");
    expect(keyLabel("Undo (⌘Z)", false)).toBe("Undo (Ctrl+Z)");
    expect(keyLabel("⇧⌘E", false)).toBe("Ctrl+Shift+E");
    expect(keyLabel("⌃⌥H", false)).toBe("Ctrl+Alt+H");
    expect(keyLabel("⌥A", false)).toBe("Alt+A");
    expect(keyLabel("Delete (⌫)", false)).toBe("Delete (Delete)");
  });
});
