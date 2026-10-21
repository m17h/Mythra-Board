import { isTauri } from "./persistence";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Whether this copy of the app can open more windows (only the desktop app can). */
export const canOpenWindows = isTauri;

/** Open a new window on the home screen, or on a board (just brings it forward if it's open). */
export async function openWindow(boardId: string | null = null): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_window", { board: boardId });
}

/**
 * Tell the app this window is about to show a board (or the home screen, for null).
 * Returns false if another window already has that board open; that window comes forward.
 */
export async function claimBoard(boardId: string | null): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke<boolean>("claim_board", { board: boardId });
  } catch (err) {
    console.error(err);
    return true;
  }
}

/** The board this window was opened for, if any. */
export async function startBoard(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("start_board").catch(() => null);
}

/** Boards that are open in other windows right now. */
export async function boardsOpenElsewhere(): Promise<Set<string>> {
  if (!isTauri()) return new Set();
  return new Set(await invoke<string[]>("boards_open_elsewhere").catch(() => []));
}

/** This window's name, used to tell which window a message is meant for. */
export async function windowLabel(): Promise<string> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

/** Tell every other window something changed (e.g. links renamed, theme switched). */
export async function tellOtherWindows<T>(event: string, payload: T): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, { from: await windowLabel(), payload });
}

/** Hear what other windows announce with `tellOtherWindows`. */
export async function hearOtherWindows<T>(event: string, fn: (payload: T) => void): Promise<void> {
  if (!isTauri()) return;
  const { listen } = await import("@tauri-apps/api/event");
  const me = await windowLabel();
  await listen<{ from: string; payload: T }>(event, (e) => {
    if (e.payload.from !== me) fn(e.payload.payload);
  });
}

/** Run `fn` whenever this window comes to the front. Returns a function that stops it. */
export function onWindowFocus(fn: () => void): () => void {
  if (!isTauri()) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) fn();
      })
      .then((unlisten) => (stopped ? unlisten() : (stop = unlisten))),
  );
  return () => {
    stopped = true;
    stop?.();
  };
}
