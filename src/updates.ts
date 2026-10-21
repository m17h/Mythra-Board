import { useSyncExternalStore } from "react";
import { flushSave, isTauri } from "./persistence";
import { hearOtherWindows, tellOtherWindows } from "./windows";
import type { Update } from "@tauri-apps/plugin-updater";

const AUTO_KEY = "mythra-board:auto-update";
const LAST_CHECK_KEY = "mythra-board:last-update-check";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export type UpdateState =
  | { stage: "idle" }
  | { stage: "checking" }
  | { stage: "current" }
  | { stage: "available"; version: string; notes: string }
  | { stage: "downloading"; version: string; percent: number | null }
  | { stage: "error"; message: string };

let state: UpdateState = { stage: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Where updating is up to: checking, a new version ready, downloading… */
export const useUpdateState = () => useSyncExternalStore(subscribe, () => state);

export const updatesSupported = isTauri;

export function autoCheckEnabled(): boolean {
  return localStorage.getItem(AUTO_KEY) !== "off";
}

export function setAutoCheck(on: boolean) {
  localStorage.setItem(AUTO_KEY, on ? "on" : "off");
}

/** Look for a newer version. `quiet` checks don't report problems (e.g. being offline). */
export async function checkForUpdate(quiet = false): Promise<void> {
  if (!isTauri() || state.stage === "checking" || state.stage === "downloading") return;
  set({ stage: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    pending = update;
    if (update) {
      set({ stage: "available", version: update.version, notes: update.body ?? "" });
    } else {
      set({ stage: "current" });
    }
  } catch (err) {
    console.warn("Couldn't check for updates", err);
    set(quiet ? { stage: "idle" } : { stage: "error", message: "Couldn't check for updates. Check your internet connection and try again." });
  }
}

/** Check by itself once a day, if that's turned on. */
export function checkNowAndThen() {
  if (!isTauri() || !autoCheckEnabled()) return;
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
  if (Date.now() - last > CHECK_EVERY_MS) void checkForUpdate(true);
}

/** Download the new version, save every window's work, and restart into it. */
export async function installUpdate(): Promise<void> {
  if (!pending || state.stage !== "available") return;
  const version = pending.version;
  let total = 0;
  let got = 0;
  set({ stage: "downloading", version, percent: null });
  try {
    await pending.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") {
        got += e.data.chunkLength;
        set({ stage: "downloading", version, percent: total ? Math.min(100, Math.round((got / total) * 100)) : null });
      }
    });
    await tellOtherWindows("save-now", null);
    await flushSave();
    // Give other windows a moment to finish saving.
    await new Promise((r) => setTimeout(r, 800));
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.error("Update failed", err);
    set({ stage: "error", message: "The update couldn't be installed. Please try again later." });
  }
}

/** Every window saves straight away when another is about to restart the app. */
export function saveWhenAsked() {
  void hearOtherWindows("save-now", () => void flushSave());
}

/** Put the "new version" notice away until the next check. */
export function dismissUpdate() {
  if (state.stage === "available" || state.stage === "error") set({ stage: "idle" });
}
