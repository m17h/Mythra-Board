import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchMenu, markKeyHandled, onMenu } from "./menuEvents";

describe("menu bar", () => {
  afterEach(() => vi.useRealTimers());

  it("asks the newest screen first and stops at the first that handles it", () => {
    const seen: string[] = [];
    const offApp = onMenu((id) => (seen.push(`app:${id}`), id === "theme-dark"));
    const offBoard = onMenu((id) => (seen.push(`board:${id}`), id === "group"));
    dispatchMenu("group");
    dispatchMenu("theme-dark");
    expect(seen).toEqual(["board:group", "board:theme-dark", "app:theme-dark"]);
    offBoard();
    offApp();
  });

  it("ignores the menu echo of a shortcut the page already handled", () => {
    const handler = vi.fn(() => true);
    const off = onMenu(handler);
    markKeyHandled();
    dispatchMenu("duplicate");
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
