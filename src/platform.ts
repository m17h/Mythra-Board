/** True on a Mac (where shortcuts use ⌘ and the window has traffic-light buttons). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEYS: [RegExp, string][] = [
  [/⌫/g, "Delete"],
  [/↩/g, "Enter"],
  [/⇥/g, "Tab"],
];

/** Shortcut text for this computer: "⇧⌘E" on a Mac becomes "Ctrl+Shift+E" elsewhere. */
export function keyLabel(text: string, mac = isMac): string {
  if (mac) return text;
  // A run of Mac modifier symbols becomes the usual Ctrl, Alt, Shift order.
  const withMods = text.replace(/[⌃⌥⇧⌘]+/g, (run) => {
    const mods = [run.includes("⌘") || run.includes("⌃") ? "Ctrl" : "", run.includes("⌥") ? "Alt" : "", run.includes("⇧") ? "Shift" : ""];
    return mods.filter(Boolean).join("+") + "+";
  });
  return KEYS.reduce((s, [re, word]) => s.replace(re, word), withMods);
}
