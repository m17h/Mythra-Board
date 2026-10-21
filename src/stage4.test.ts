import { describe, expect, it } from "vitest";
import { slideOrder } from "./components/Presentation";

describe("presentation", () => {
  it("orders sections in reading order: rows top to bottom, left to right", () => {
    const f = (id: string, x: number, y: number) => ({ id, x, y, width: 400, height: 300 });
    // Two rows; the second section in the top row sits slightly lower than the first.
    expect(slideOrder([f("d", 0, 500), f("b", 500, 30), f("a", 0, 0), f("c", 1000, -20), f("e", 600, 520)])).toEqual(["a", "b", "c", "d", "e"]);
    expect(slideOrder([])).toEqual([]);
  });
});

describe("hand-drawn lines", async () => {
  const { roughPath, samplePath } = await import("./sketch");
  it("samples straight, curved and elbow paths evenly", () => {
    const line = samplePath("M 0 0 L 100 0", 10);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line.at(-1)).toEqual({ x: 100, y: 0 });
    expect(line.length).toBe(11);
    const curve = samplePath("M0,0 C50,0 50,100 100,100", 10);
    expect(curve.at(-1)!.x).toBeCloseTo(100);
    expect(curve.at(-1)!.y).toBeCloseTo(100);
    expect(samplePath("M 0 0 L 50 0 Q 60 0 60 10 L 60 60").at(-1)).toEqual({ x: 60, y: 60 });
  });

  it("wobbles a little, the same way every time, as two strokes", () => {
    const a = roughPath("M 0 0 L 200 0", "edge-1");
    expect(roughPath("M 0 0 L 200 0", "edge-1")).toBe(a);
    expect(roughPath("M 0 0 L 200 0", "edge-2")).not.toBe(a);
    expect(a.match(/M /g)).toHaveLength(2);
    const ys = [...a.matchAll(/(-?\d+\.\d) (-?\d+\.\d)/g)].map((m) => Math.abs(parseFloat(m[2])));
    expect(Math.max(...ys)).toBeLessThan(2);
    expect(Math.max(...ys)).toBeGreaterThan(0.1);
  });
});
