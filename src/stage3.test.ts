import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./boardFile";
import { pdfWithImage } from "./exportImage";
import { placePath, plainLines } from "./exportSvg";

describe("PDF export", () => {
  it("writes a valid single-page PDF whose cross-reference points at each object", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = pdfWithImage(jpeg, 800, 400, 2 / 0.75);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // 800 px at 2x = 400 CSS px = 300 pt.
    expect(text).toContain("/MediaBox [0 0 300 150]");
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
});

describe("SVG export", () => {
  it("scales shape outlines into place, arcs included", () => {
    expect(placePath("M50 0 L100 50 L50 100 L0 50 Z", { x: 10, y: 20, width: 200, height: 100 })).toBe(
      "M 110 20 L 210 70 L 110 120 L 10 70 Z",
    );
    expect(placePath("M0 12 A50 12 0 0 1 100 12", { x: 0, y: 0, width: 200, height: 50 })).toBe("M 0 6 A 100 6 0 0 1 200 6");
  });

  it("turns note Markdown into plain lines", () => {
    const lines = plainLines("# Plan\n- [ ] **Buy** milk\n- [x] Call [[Mum]]\n- bullet", 15, 400);
    expect(lines.map((l) => l.text)).toEqual(["Plan", "☐ Buy milk", "☑ Call Mum", "•  bullet"]);
    expect(lines[0].weight).toBe(700);
    expect(lines[0].size).toBeCloseTo(19.5);
  });
});

describe("board files", () => {
  it("round-trips binary through base64, including large data", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 37) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
