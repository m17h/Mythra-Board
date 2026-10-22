import { describe, expect, it } from "vitest";
import { arrange, plan, type Rect, type Spec } from "./compose";

/** Lay a plan out with each item's planned width and a fixed text height. */
function layOut(blocks: Spec[], links = [], layout: "row" | "column" | "grid" = "row") {
  const p = plan(blocks, links, layout);
  const rects = arrange(p.root, (k) => {
    const item = p.items.find((i) => i.key === k)!;
    return { width: item.width, height: item.height ?? 60 };
  });
  return { p, rects };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r: Rect, outer: Rect) => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;

function noOverlaps(p: ReturnType<typeof plan>, rects: Map<string, Rect>) {
  const items = p.items.filter((i) => i.type !== "frame").map((i) => rects.get(i.key)!);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i], items[j])).toBe(false);
}

const notes = (n: number, color = "blue") => Array.from({ length: n }, (_, i) => ({ kind: "note" as const, text: `Idea ${i + 1}`, color: color as "blue" }));

describe("laying out board content", () => {
  it("puts a section's notes inside it, in a grid, without overlaps", () => {
    const { p, rects } = layOut([{ kind: "section", title: "Ideas", layout: "grid", columns: 3, children: notes(7) }]);
    const frame = p.items.find((i) => i.type === "frame")!;
    noOverlaps(p, rects);
    for (const i of p.items) if (i !== frame) expect(inside(rects.get(i.key)!, rects.get(frame.key)!)).toBe(true);
    // Three columns: the first three notes share a row.
    const ys = p.items.filter((i) => i.type === "note").slice(0, 3).map((i) => rects.get(i.key)!.y);
    expect(new Set(ys).size).toBe(1);
  });

  it("gives notes side by side the same width, even across sections", () => {
    const { p } = layOut([
      { kind: "section", title: "A", children: [{ kind: "note", text: "short" }, { kind: "note", text: "a much longer note that needs more room to breathe than the other" }] },
      { kind: "section", title: "B", children: [{ kind: "note", text: "tiny" }] },
    ]);
    const widths = new Set(p.items.filter((i) => i.type === "note").map((i) => i.width));
    expect(widths.size).toBe(1);
  });

  it("stretches sections in a row to the same height, with room for their titles", () => {
    const { p, rects } = layOut([
      { kind: "section", title: "To do", layout: "column", children: notes(4) },
      { kind: "section", title: "Done", layout: "column", children: notes(1) },
    ]);
    const [a, b] = p.items.filter((i) => i.type === "frame").map((i) => rects.get(i.key)!);
    expect(a.height).toBe(b.height);
    expect(Math.abs(b.x - (a.x + a.width))).toBeGreaterThanOrEqual(40);
  });

  it("keeps a caption close under its title, and sections clear of both", () => {
    const { p, rects } = layOut(
      [
        { kind: "text", text: "Big title", text_style: "title" },
        { kind: "text", text: "a caption", text_style: "caption" },
        { kind: "group", layout: "row", children: [{ kind: "section", title: "S", children: notes(2) }] },
      ],
      [],
      "column",
    );
    const [title, caption] = p.items.filter((i) => i.type === "text").map((i) => rects.get(i.key)!);
    const frame = rects.get(p.items.find((i) => i.type === "frame")!.key)!;
    expect(caption.y - (title.y + title.height)).toBeLessThanOrEqual(10);
    // Section titles sit above sections, so there's extra room.
    expect(frame.y - (caption.y + caption.height)).toBeGreaterThanOrEqual(50);
  });

  it("builds a mind map with linked, colour-coded branches and no overlaps", () => {
    const { p, rects } = layOut([
      {
        kind: "mindmap",
        root: {
          text: "Garden",
          children: ["Soil", "Sun", "Water", "Plants"].map((t) => ({ text: t, children: [{ text: `${t} detail 1` }, { text: `${t} detail 2` }] })),
        },
      },
    ]);
    noOverlaps(p, rects);
    expect(p.links).toHaveLength(12);
    const branchColors = new Set(p.items.filter((i) => ["Soil", "Sun", "Water", "Plants"].includes(i.data.text!)).map((i) => i.data.color));
    expect(branchColors.size).toBe(4);
    // Branches grow on both sides of the centre.
    const root = rects.get(p.items[0].key)!;
    const xs = p.items.slice(1).map((i) => rects.get(i.key)!.x);
    expect(xs.some((x) => x < root.x) && xs.some((x) => x > root.x)).toBe(true);
  });

  it("lays out a flowchart in order, with branches side by side", () => {
    const steps = [
      { kind: "shape" as const, ref: "start", text: "Start", shape: "ellipse" as const },
      { kind: "shape" as const, ref: "check", text: "OK?", shape: "diamond" as const },
      { kind: "shape" as const, ref: "yes", text: "Ship it" },
      { kind: "shape" as const, ref: "no", text: "Fix it" },
      { kind: "shape" as const, ref: "end", text: "Done", shape: "ellipse" as const },
    ];
    const links = [
      { from: "start", to: "check" },
      { from: "check", to: "yes", label: "Yes" },
      { from: "check", to: "no", label: "No" },
      { from: "yes", to: "end" },
      { from: "no", to: "check" },
    ];
    const p = plan([{ kind: "flow", steps, links }]);
    const rects = arrange(p.root, (k) => {
      const i = p.items.find((x) => x.key === k)!;
      return { width: i.width, height: i.height! };
    });
    noOverlaps(p, rects);
    const at = (ref: string) => rects.get(p.items.find((i) => i.ref === ref)!.key)!;
    expect(at("start").y).toBeLessThan(at("check").y);
    expect(at("check").y).toBeLessThan(at("yes").y);
    expect(at("yes").y).toBe(at("no").y);
    expect(at("yes").y).toBeLessThan(at("end").y);
    expect(p.links).toHaveLength(5);
  });

  it("links refs anywhere in the plan, and reports links it can't make", () => {
    const p = plan([{ kind: "note", ref: "a", text: "A" }, { kind: "note", ref: "b", text: "B" }], [
      { from: "a", to: "b", label: "leads to" },
      { from: "a", to: "a" },
    ]);
    expect(p.links).toHaveLength(1);
    expect(p.links[0].data.label).toBe("leads to");
    expect(p.problems.length).toBe(1);
  });

  it("ignores junk instead of failing", () => {
    const p = plan([{ kind: "nonsense" } as never, null as never, { kind: "note", text: "ok", color: "rainbow" as never, size: "xl" as never }]);
    expect(p.items).toHaveLength(1);
    expect(p.items[0].data.color).toBeUndefined();
    expect(p.problems.length).toBe(1);
  });
});
