import { describe, expect, it } from "vitest";

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
