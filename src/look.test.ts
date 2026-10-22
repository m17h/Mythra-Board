import { describe, expect, it } from "vitest";
import { linkData, lookData, plan } from "./assistant/compose";
import { asBoardColor, asPaint, boardLook, colorLook, readableOn, THEMES } from "./look";
import { fromSaved, toSaved } from "./persistence";
import { makeItem, makeLink, type BoardDoc } from "./store";
import { BACKGROUNDS, BOARD_COLORS, FONTS } from "./types";

describe("board looks", () => {
  it("knows which board colours are dark", () => {
    expect(boardLook("default", "light").scheme).toBe("light");
    expect(boardLook("default", "dark").scheme).toBe("dark");
    expect(boardLook("blueprint", "light")).toMatchObject({ scheme: "dark", bg: "#1d4e89" });
    expect(boardLook("paper", "dark").scheme).toBe("light");
    expect(boardLook("#101820", "light").scheme).toBe("dark");
    expect(boardLook("#fdf6e3", "dark").scheme).toBe("light");
  });

  it("only accepts real colours", () => {
    expect(asPaint("teal")).toBe("teal");
    expect(asPaint("#FF6B35")).toBe("#ff6b35");
    expect(asPaint("rainbow")).toBeUndefined();
    expect(asPaint("#fff")).toBeUndefined();
    expect(asBoardColor("chalkboard")).toBe("chalkboard");
    expect(asBoardColor("url(evil)")).toBeUndefined();
  });

  it("picks readable text for any colour", () => {
    expect(readableOn("#ffffff")).toBe("#1d1d22");
    expect(readableOn("#1d4e89")).toBe("#ffffff");
    expect(colorLook({ color: "plain", hex: "#ff6b35" }).className).toBe("color--custom");
    expect(colorLook({ color: "blue" }).className).toBe("color--blue");
  });

  it("has themes made of real settings", () => {
    for (const t of THEMES) {
      expect(BOARD_COLORS).toContain(t.boardColor);
      expect(BACKGROUNDS).toContain(t.background);
      expect(FONTS).toContain(t.font);
    }
  });
});

describe("saving the new looks", () => {
  const doc = (): BoardDoc => {
    const a = makeItem("note", { x: 0, y: 0 }, { text: "A", color: "plain", hex: "#ff6b35", textColor: "#123456", font: "serif", effect: "pulse", fill: "bold" });
    const b = makeItem("shape", { x: 300, y: 0 }, { text: "B", color: "teal", outlineColor: "#00ff00" });
    const link = makeLink(a.id, b.id, { color: "#aa00aa", width: 3, head: "diamond", motion: "flow", dash: "dotted" });
    return {
      id: "b1",
      title: "Look",
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      background: "lines",
      style: "clean",
      boardColor: "midnight",
      font: "mono",
      viewport: null,
      nodes: [a, b],
      edges: [link],
    };
  };

  it("keeps every new setting through a save and load", () => {
    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(doc()))));
    expect(back.boardColor).toBe("midnight");
    expect(back.font).toBe("mono");
    expect(back.background).toBe("lines");
    const [a, b] = back.nodes;
    expect(a.data).toMatchObject({ hex: "#ff6b35", textColor: "#123456", font: "serif", effect: "pulse", fill: "bold" });
    expect(b.data).toMatchObject({ color: "teal", outlineColor: "#00ff00" });
    expect(back.edges[0].data).toMatchObject({ color: "#aa00aa", width: 3, head: "diamond", motion: "flow", dash: "dotted" });
  });

  it("drops damaged settings instead of failing", () => {
    const raw = toSaved(doc()) as unknown as Record<string, unknown>;
    raw.boardColor = "javascript:alert(1)";
    raw.font = "comic";
    const items = raw.items as Record<string, unknown>[];
    Object.assign(items[0], { hex: "red", textColor: "nope", font: 7, effect: "explode" });
    Object.assign((raw.links as Record<string, unknown>[])[0], { color: "#12", width: 9, head: "skull", motion: "spin" });
    const back = fromSaved(raw);
    expect(back.boardColor).toBe("default");
    expect(back.font).toBe("sans");
    expect(back.nodes[0].data.hex).toBeUndefined();
    expect(back.nodes[0].data.textColor).toBeUndefined();
    expect(back.nodes[0].data.effect).toBeUndefined();
    const l = back.edges[0].data!;
    expect([l.color, l.width, l.head, l.motion]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("Claude's styling options", () => {
  it("turns colours, text colours, fonts and effects into item settings", () => {
    expect(lookData({ color: "#3B2A20", fill: "bold", text_color: "teal", font: "hand", effect: "glow" })).toEqual({
      color: "plain",
      hex: "#3b2a20",
      fill: "bold",
      textColor: "teal",
      font: "hand",
      effect: "glow",
    });
    expect(lookData({ color: "not a colour", font: "wingdings" as never })).toEqual({});
  });

  it("turns line styles into link settings", () => {
    expect(linkData({ color: "green", width: "thick", head: "open", motion: "flow", dash: "dotted" })).toEqual({
      color: "green",
      width: 3,
      head: "open",
      motion: "flow",
      dash: "dotted",
    });
    expect(linkData({ motion: "none", width: 7 as never })).toEqual({ motion: undefined });
  });

  it("carries custom colours through a mind map's branches", () => {
    const p = plan([{ kind: "mindmap", root: { text: "Brand", children: [{ text: "Tone", color: "#e8c39e", children: [{ text: "Warm" }] }] } }]);
    expect(p.items.find((i) => i.data.text === "Warm")?.data.hex).toBe("#e8c39e");
  });
});
