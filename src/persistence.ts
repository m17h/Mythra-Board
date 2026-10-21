import type { Viewport } from "@xyflow/react";
import { nanoid } from "nanoid";
import { decorate } from "./layout";
import { boardStore, cleanEdge, cleanNode, defaultLinkData, type BoardDoc } from "./store";
import {
  ALIGNS,
  AUTO_HEIGHT,
  DEFAULT_OUTLINE,
  OUTLINE_STYLES,
  OUTLINE_WIDTHS,
  TEXT_STYLES,
  BACKGROUNDS,
  COLORS,
  DEFAULT_NOTE_WIDTH,
  ITEM_TYPES,
  SHAPES,
  SIZES,
  type BoardNode,
  type LinkEdge,
} from "./types";

const FORMAT = "mythra-board";
const VERSION = 2;
const SAVE_DELAY_MS = 400;
const LOCAL_PREFIX = "mythra-board:board:";

type SavedItem = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  text: string;
  color: string;
  size: string;
  shape?: string;
  asset?: string;
  points?: number[];
  url?: string;
  title?: string;
  textStyle?: string;
  align?: string;
  outline?: number;
  outlineColor?: string;
  outlineStyle?: string;
  boardId?: string;
  collapsed?: boolean;
  ends?: number[];
  arrowHead?: string;
  locked?: boolean;
  group?: string;
};
type SavedLink = { id: string; from: string; to: string; label: string; curve: string; arrow: string; dash: string };
type SavedBoard = {
  format: typeof FORMAT;
  version: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  background: string;
  viewport: Viewport | null;
  items: SavedItem[];
  links: SavedLink[];
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args, options);
}

export const newBoardId = () => nanoid(12).replace(/[^A-Za-z0-9_-]/g, "_");

export function toSaved(doc: BoardDoc): SavedBoard {
  return {
    format: FORMAT,
    version: VERSION,
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pinned: doc.pinned,
    background: doc.background,
    viewport: doc.viewport,
    items: doc.nodes.map((raw) => {
      const n = cleanNode(raw);
      const item: SavedItem = {
        id: n.id,
        type: n.type,
        x: n.position.x,
        y: n.position.y,
        w: n.width ?? DEFAULT_NOTE_WIDTH,
        text: n.data.text,
        color: n.data.color,
        size: n.data.size,
      };
      // Auto-height items keep their last measured height so they open without a jump.
      const h = AUTO_HEIGHT.has(n.type) ? raw.measured?.height ?? raw.initialHeight : n.height;
      if (h) item.h = Math.round(h);
      if (n.data.shape) item.shape = n.data.shape;
      if (n.data.asset) item.asset = n.data.asset;
      if (n.data.points) item.points = n.data.points;
      if (n.data.url) item.url = n.data.url;
      if (n.data.title !== undefined) item.title = n.data.title;
      if (n.data.textStyle) item.textStyle = n.data.textStyle;
      if (n.data.align) item.align = n.data.align;
      if (n.data.outline !== undefined) item.outline = n.data.outline;
      if (n.data.outlineColor) item.outlineColor = n.data.outlineColor;
      if (n.data.outlineStyle) item.outlineStyle = n.data.outlineStyle;
      if (n.data.boardId) item.boardId = n.data.boardId;
      if (n.data.collapsed) item.collapsed = true;
      if (n.data.ends) item.ends = n.data.ends;
      if (n.data.arrowHead) item.arrowHead = n.data.arrowHead;
      if (n.data.locked) item.locked = true;
      if (n.data.group) item.group = n.data.group;
      return item;
    }),
    links: doc.edges.map(cleanEdge).map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      label: e.data!.label,
      curve: e.data!.curve,
      arrow: e.data!.arrow,
      dash: e.data!.dash,
    })),
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const clampSize = (v: unknown, fallback: number) => Math.min(20000, Math.max(8, num(v, fallback)));

/** Turn saved JSON back into a board, skipping anything damaged rather than failing. */
export function fromSaved(raw: unknown, fallbackId = "board"): BoardDoc {
  const doc = (raw ?? {}) as Partial<SavedBoard> & { notes?: unknown[] };
  // Version 1 files only had notes.
  const rawItems = Array.isArray(doc.items)
    ? doc.items
    : Array.isArray(doc.notes)
      ? (doc.notes as Record<string, unknown>[]).map((n) => ({ ...n, type: "note", w: n?.width }))
      : [];
  const nodes: BoardNode[] = [];
  const seen = new Set<string>();
  for (const it of rawItems as Partial<SavedItem>[]) {
    const id = str(it?.id);
    const type = oneOf(it?.type, ITEM_TYPES, "note");
    if (!id || seen.has(id)) continue;
    if (type === "image" && !str(it.asset)) continue;
    if (type === "ink" && !(Array.isArray(it.points) && it.points.every((p) => typeof p === "number"))) continue;
    if (type === "arrow" && !(Array.isArray(it.ends) && it.ends.length === 4 && it.ends.every((p) => Number.isFinite(p)))) continue;
    if (type === "board" && !str(it.boardId)) continue;
    seen.add(id);
    const node: BoardNode = {
      id,
      type,
      position: { x: num(it.x, 0), y: num(it.y, 0) },
      width: clampSize(it.w, DEFAULT_NOTE_WIDTH),
      data: { text: str(it.text), color: oneOf(it.color, COLORS, "plain"), size: oneOf(it.size, SIZES, "m") },
    };
    if (AUTO_HEIGHT.has(type)) node.initialHeight = it.h ? clampSize(it.h, 50) : undefined;
    else node.height = clampSize(it.h, 100);
    if (type === "shape") node.data.shape = oneOf(it.shape, SHAPES, "rect");
    if (type === "image") node.data.asset = str(it.asset);
    if (type === "ink") node.data.points = it.points;
    if (type === "link") node.data.url = str(it.url);
    if (type === "note" && typeof it.title === "string") node.data.title = it.title;
    if (type === "text" && it.textStyle) node.data.textStyle = oneOf(it.textStyle, TEXT_STYLES, "body");
    if (it.align) node.data.align = oneOf(it.align, ALIGNS, "left");
    if (it.outline !== undefined) node.data.outline = oneOf(it.outline, OUTLINE_WIDTHS, DEFAULT_OUTLINE[type]);
    if (it.outlineColor) node.data.outlineColor = oneOf(it.outlineColor, COLORS, "plain");
    if (it.outlineStyle) node.data.outlineStyle = oneOf(it.outlineStyle, OUTLINE_STYLES, "solid");
    if (type === "board") node.data.boardId = str(it.boardId);
    if (it.collapsed === true) node.data.collapsed = true;
    if (it.locked === true) node.data.locked = true;
    if (str(it.group)) node.data.group = str(it.group);
    if (type === "arrow") {
      node.data.ends = it.ends as [number, number, number, number];
      node.data.arrowHead = oneOf(it.arrowHead, ["none", "end", "both"] as const, "end");
    }
    nodes.push(node);
  }
  const edges: LinkEdge[] = [];
  const pairs = new Set<string>();
  for (const l of Array.isArray(doc.links) ? doc.links : []) {
    const id = str(l?.id);
    const from = str(l?.from);
    const to = str(l?.to);
    const pair = [from, to].sort().join("|");
    if (!id || from === to || !seen.has(from) || !seen.has(to) || pairs.has(pair)) continue;
    pairs.add(pair);
    const d = defaultLinkData();
    edges.push({
      id,
      type: "link",
      source: from,
      target: to,
      data: {
        label: str(l.label),
        curve: oneOf(l.curve, ["curved", "straight", "elbow"] as const, d.curve),
        arrow: oneOf(l.arrow, ["none", "end", "both"] as const, d.arrow),
        dash: oneOf(l.dash, ["solid", "dashed"] as const, d.dash),
      },
    });
  }
  const v = doc.viewport;
  const viewport =
    v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0
      ? { x: v.x, y: v.y, zoom: v.zoom }
      : null;
  const updatedAt = num(doc.updatedAt, 0);
  return {
    id: str(doc.id) || fallbackId,
    title: str(doc.title, "Untitled board") || "Untitled board",
    createdAt: num(doc.createdAt, updatedAt),
    updatedAt,
    pinned: doc.pinned === true,
    background: oneOf(doc.background, BACKGROUNDS, "dots"),
    viewport,
    nodes,
    edges,
  };
}

// ---------- Board files ----------

export async function listBoards(): Promise<BoardDoc[]> {
  let files: { id: string; json: string }[];
  if (isTauri()) files = await invoke("list_boards");
  else {
    files = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith(LOCAL_PREFIX)) files.push({ id: key.slice(LOCAL_PREFIX.length), json: localStorage.getItem(key)! });
    }
  }
  const docs: BoardDoc[] = [];
  for (const f of files) {
    try {
      // The file name is the source of truth for the id.
      docs.push({ ...fromSaved(JSON.parse(f.json), f.id), id: f.id });
    } catch (err) {
      console.error(`Skipping unreadable board ${f.id}`, err);
    }
  }
  return docs;
}

export async function loadBoard(id: string): Promise<BoardDoc | null> {
  const json = isTauri() ? await invoke<string | null>("load_board", { id }) : localStorage.getItem(LOCAL_PREFIX + id);
  return json ? { ...fromSaved(JSON.parse(json), id), id } : null;
}

export async function writeBoard(doc: BoardDoc): Promise<void> {
  const json = JSON.stringify(toSaved(doc));
  if (isTauri()) await invoke("save_board", { id: doc.id, json });
  else localStorage.setItem(LOCAL_PREFIX + doc.id, json);
}

const localTrash = new Map<string, string>();

export async function trashBoard(id: string): Promise<void> {
  if (isTauri()) return invoke("trash_board", { id });
  const json = localStorage.getItem(LOCAL_PREFIX + id);
  if (json) localTrash.set(id, json);
  localStorage.removeItem(LOCAL_PREFIX + id);
}

export async function restoreBoard(id: string): Promise<void> {
  if (isTauri()) return invoke("restore_board", { id });
  const json = localTrash.get(id);
  if (json) localStorage.setItem(LOCAL_PREFIX + id, json);
}

// ---------- Images ----------

const IDB_NAME = "mythra-board-assets";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("assets");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction("assets", mode).objectStore("assets"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAsset(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) return invoke("save_asset", bytes, { headers: { "asset-name": name } });
  await idbRun("readwrite", (s) => s.put(bytes, name));
}

const assetUrls = new Map<string, Promise<string>>();

/** A displayable URL for a stored image, loaded once and then cached. */
export function assetUrl(name: string): Promise<string> {
  let url = assetUrls.get(name);
  if (!url) {
    url = (async () => {
      const bytes = isTauri()
        ? new Uint8Array(await invoke<ArrayBuffer>("load_asset", { name }))
        : await idbRun<Uint8Array | undefined>("readonly", (s) => s.get(name));
      if (!bytes) throw new Error(`Missing image ${name}`);
      const ext = name.split(".").pop();
      const type = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    })();
    url.catch(() => assetUrls.delete(name));
    assetUrls.set(name, url);
  }
  return url;
}

// ---------- Autosave for the open board ----------

let lastSaved = "";
let lastContent = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let updatedAt = 0;
let statusListener: (s: SaveStatus) => void = () => {};
let unsubscribe: (() => void) | null = null;

export const onSaveStatus = (fn: (s: SaveStatus) => void) => {
  statusListener = fn;
};

/** The open board as a saveable document. */
export function currentDoc(): BoardDoc {
  const s = boardStore.getState();
  return {
    id: s.boardId,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt,
    pinned: s.pinned,
    background: s.background,
    viewport: s.viewport,
    nodes: s.nodes,
    edges: s.edges,
  };
}

/** What counts as an edit: content changes, not panning around or selecting things. */
const contentKey = (doc: BoardDoc) => {
  const { viewport: _v, updatedAt: _u, ...rest } = toSaved(doc);
  return JSON.stringify(rest);
};

export async function flushSave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!boardStore.getState().boardId) return;
  let doc = currentDoc();
  const content = contentKey(doc);
  if (content !== lastContent) {
    updatedAt = Date.now();
    lastContent = content;
    doc = { ...doc, updatedAt };
  }
  const json = JSON.stringify(toSaved(doc));
  if (json === lastSaved) return;
  statusListener("saving");
  try {
    await writeBoard(doc);
    lastSaved = json;
    statusListener("saved");
  } catch (err) {
    console.error("Save failed", err);
    statusListener("error");
  }
}

/** Load a board into the editor and keep saving it as it changes. */
export function openInEditor(doc: BoardDoc) {
  unsubscribe?.();
  boardStore.getState().load({ ...doc, nodes: doc.nodes.map(decorate) });
  updatedAt = doc.updatedAt;
  lastContent = contentKey(currentDoc());
  lastSaved = JSON.stringify(toSaved({ ...currentDoc(), updatedAt }));
  statusListener("idle");
  unsubscribe = boardStore.subscribe((s, prev) => {
    if (
      s.nodes === prev.nodes &&
      s.edges === prev.edges &&
      s.title === prev.title &&
      s.viewport === prev.viewport &&
      s.background === prev.background
    )
      return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
  });
}

/** Save and stop watching the open board. */
export async function closeEditor(): Promise<void> {
  await flushSave();
  unsubscribe?.();
  unsubscribe = null;
}

let closeHooked = false;
export async function saveOnQuit(): Promise<void> {
  if (closeHooked) return;
  closeHooked = true;
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().onCloseRequested(async () => {
      await flushSave();
    });
  } else {
    window.addEventListener("beforeunload", () => void flushSave());
  }
}

/** Open a link in the user's browser. Only web and email links are allowed. */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
