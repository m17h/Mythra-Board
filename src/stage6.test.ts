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

describe("menu undo", () => {
  it("undoes the board when not typing", async () => {
    const { boardStore } = await import("./store");
    const s = boardStore.getState();
    s.load({ id: "u", title: "T", createdAt: 0, updatedAt: 0, pinned: false, background: "dots", style: "clean", viewport: null, nodes: [], edges: [] });
    s.addNote({ x: 0, y: 0 }, { data: { text: "a" } });
    s.setTitle("Renamed");
    s.setBackground("grid");
    s.undo();
    expect(boardStore.getState().background).toBe("dots");
    s.undo();
    expect(boardStore.getState().title).toBe("T");
    s.undo();
    expect(boardStore.getState().nodes).toHaveLength(0);
    s.redo();
    s.redo();
    expect(boardStore.getState().title).toBe("Renamed");
  });
});
