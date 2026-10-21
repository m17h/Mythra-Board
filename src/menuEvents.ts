import { isTauri } from "./persistence";

/** A screen's menu handler; returns true if it dealt with the item. */
type Handler = (id: string) => boolean;

const handlers: Handler[] = [];
let lastKeyAt = -Infinity;

/**
 * Note that the page just handled a keyboard shortcut itself. The same keypress can also
 * reach the menu bar, and this stops the action happening twice.
 */
export const markKeyHandled = () => {
  lastKeyAt = performance.now();
};

/** Handle menu-bar choices while this screen is showing. The newest handler goes first. */
export function onMenu(handler: Handler): () => void {
  handlers.unshift(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function dispatchMenu(id: string) {
  if (performance.now() - lastKeyAt < 400) return;
  for (const h of handlers) if (h(id)) return;
}

let listening = false;
export async function listenToMenu() {
  if (listening || !isTauri()) return;
  listening = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<string>("menu", (e) => dispatchMenu(e.payload));
}

/** Whether keyboard focus is in a text field (so board actions should stay out of the way). */
export const typingNow = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
};
