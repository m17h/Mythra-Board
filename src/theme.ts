import { useSyncExternalStore } from "react";
import { isTauri } from "./persistence";
import { hearOtherWindows, tellOtherWindows } from "./windows";

export type ThemeSetting = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "mythra-board:theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set<() => void>();

function readSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let setting: ThemeSetting = typeof window !== "undefined" ? readSetting() : "system";

const resolve = (): Theme => (setting === "system" ? (media?.matches ? "dark" : "light") : setting);

let current: { setting: ThemeSetting; theme: Theme } = { setting, theme: resolve() };

/** Put the theme on the page (CSS reads `data-theme`) and on the window's title bar. */
function apply() {
  current = { setting, theme: resolve() };
  document.documentElement.dataset.theme = current.theme;
  if (isTauri()) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .setTheme(setting === "system" ? null : setting)
        .catch(() => {}),
    );
  }
  listeners.forEach((l) => l());
}

export function initTheme() {
  apply();
  media?.addEventListener("change", () => {
    if (setting === "system") apply();
  });
  // Switching the theme in one window switches it in all of them.
  void hearOtherWindows<ThemeSetting>("theme", (next) => {
    setting = next;
    apply();
  });
}

export function setThemeSetting(next: ThemeSetting) {
  setting = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not being able to remember the choice is harmless.
  }
  apply();
  void tellOtherWindows("theme", next);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The chosen setting and the theme actually showing. */
export function useTheme() {
  return useSyncExternalStore(subscribe, () => current);
}
