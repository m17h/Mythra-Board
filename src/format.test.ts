import { describe, expect, it } from "vitest";
import { activeLineStyle, toggleInline, toggleLines } from "./format";

const sel = (text: string) => {
  // "a [b] c" → selection around b
  const start = text.indexOf("[");
  const end = text.indexOf("]") - 1;
  return { text: text.replace("[", "").replace("]", ""), start, end };
};
const show = (e: { text: string; start: number; end: number }) => e.text.slice(0, e.start) + "[" + e.text.slice(e.start, e.end) + "]" + e.text.slice(e.end);

describe("inline formatting", () => {
  it("wraps, unwraps and inserts empty markers", () => {
    expect(show(toggleInline(sel("make [this] bold"), "bold"))).toBe("make **[this]** bold");
    expect(show(toggleInline(sel("make **[this]** bold"), "bold"))).toBe("make [this] bold");
    expect(show(toggleInline(sel("make [**this**] bold"), "bold"))).toBe("make [this] bold");
    expect(show(toggleInline(sel("x [] y"), "italic"))).toBe("x *[]* y");
    expect(show(toggleInline(sel("a [Recipes] b"), "link"))).toBe("a [[[Recipes]]] b");
  });
  it("doesn't mistake bold for italic", () => {
    expect(show(toggleInline(sel("**[word]**"), "italic"))).toBe("***[word]***");
  });
});

describe("line formatting", () => {
  it("adds and removes bullets on every selected line", () => {
    const e = { text: "one\ntwo\nthree", start: 0, end: 7 };
    const on = toggleLines(e, "bullet");
    expect(on.text).toBe("- one\n- two\nthree");
    expect(toggleLines(on, "bullet").text).toBe("one\ntwo\nthree");
  });
  it("switches style, numbers lines and keeps the cursor on its word", () => {
    const e = { text: "- one\n- two", start: 0, end: 11 };
    expect(toggleLines(e, "task").text).toBe("- [ ] one\n- [ ] two");
    expect(toggleLines(e, "number").text).toBe("1. one\n2. two");
    const cursor = toggleLines({ text: "hello", start: 3, end: 3 }, "heading");
    expect(cursor).toEqual({ text: "# hello", start: 5, end: 5 });
    expect(activeLineStyle("x\n- [ ] y", 7)).toBe("task");
  });
});

describe("formatting list lines", () => {
  it("bolds the words, not the checkbox", () => {
    const e = { text: "- [ ] Buy milk", start: 0, end: 14 };
    expect(toggleInline(e, "bold").text).toBe("- [ ] **Buy milk**");
  });
});
