import { createStore, useStore } from "zustand";
import { listBoards, loadBoard, newBoardId, writeBoard } from "./persistence";
import { boardStore, type BoardDoc } from "./store";
import { boardsOpenElsewhere, hearOtherWindows, tellOtherWindows } from "./windows";
import type { BoardBackground, BoardNode, BoardStyle, LinkEdge } from "./types";

/** Every saved board, kept for board cards, links, backlinks and the command palette. */
const indexStore = createStore<{ boards: BoardDoc[]; loaded: boolean }>()(() => ({ boards: [], loaded: false }));

export async function refreshBoardIndex(): Promise<BoardDoc[]> {
  const boards = await listBoards();
  indexStore.setState({ boards, loaded: true });
  return boards;
}

export const useBoardIndex = <T,>(select: (s: { boards: BoardDoc[]; loaded: boolean }) => T) => useStore(indexStore, select);
export const boardIndex = () => indexStore.getState().boards;

/** Keep the index's copy of a board current (e.g. after it's renamed or saved). */
export function updateIndexedBoard(doc: BoardDoc) {
  indexStore.setState((s) => ({
    boards: s.boards.some((b) => b.id === doc.id) ? s.boards.map((b) => (b.id === doc.id ? doc : b)) : [...s.boards, doc],
  }));
}

const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function findBoardByTitle(title: string): BoardDoc | undefined {
  return boardIndex().find((b) => sameTitle(b.title, title));
}

export function makeBoardDoc(
  title: string,
  content?: { nodes?: BoardNode[]; edges?: LinkEdge[]; background?: BoardBackground; style?: BoardStyle },
): BoardDoc {
  const now = Date.now();
  return {
    id: newBoardId(),
    title,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    background: content?.background ?? "dots",
    style: content?.style ?? "clean",
    viewport: null,
    nodes: content?.nodes ?? [],
    edges: content?.edges ?? [],
  };
}

export async function createBoard(doc: BoardDoc): Promise<BoardDoc> {
  await writeBoard(doc);
  updateIndexedBoard(doc);
  return doc;
}

/** Boards (other than `doc` itself) that link to it with a board card or a [[title]] link. */
export function backlinksTo(doc: { id: string; title: string }): BoardDoc[] {
  const needle = `[[${doc.title.trim().toLocaleLowerCase()}]]`;
  return boardIndex().filter(
    (b) =>
      b.id !== doc.id &&
      b.nodes.some(
        (n) =>
          (n.type === "board" && n.data.boardId === doc.id) ||
          (n.data.text + "\n" + (n.data.title ?? "")).toLocaleLowerCase().includes(needle),
      ),
  );
}

type Navigator = (id: string) => Promise<void>;
let navigate: Navigator = async () => {};

/** The app shell registers how to open a board. */
export const setNavigator = (fn: Navigator) => {
  navigate = fn;
};

export const openBoard = (id: string) => navigate(id);

/** Open the board with this title, creating it first if there isn't one (like a wiki link). */
export async function openBoardByTitle(title: string): Promise<void> {
  const name = title.trim();
  if (!name) return;
  if (!indexStore.getState().loaded) await refreshBoardIndex();
  const existing = findBoardByTitle(name);
  if (existing) return navigate(existing.id);
  const doc = await createBoard(makeBoardDoc(name));
  return navigate(doc.id);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text with every [[old]] link (any capitalisation) changed to [[new]]. */
export function retitleText(text: string, oldTitle: string, newTitle: string): string {
  return text.replace(new RegExp(`\\[\\[\\s*${escapeRe(oldTitle.trim())}\\s*\\]\\]`, "gi"), `[[${newTitle.trim()}]]`);
}

/**
 * After a board is renamed, point every [[Old name]] link on other boards at the new name,
 * so the links keep working. Skipped if another board still has the old name.
 * Returns how many boards were updated.
 */
/** Nodes with links to `oldTitle` pointed at `newTitle`, or null if none needed changing. */
function retitleNodes<T extends BoardDoc["nodes"][number]>(nodes: T[], oldTitle: string, newTitle: string): T[] | null {
  let touched = false;
  const out = nodes.map((n) => {
    const text = retitleText(n.data.text, oldTitle, newTitle);
    const title = n.data.title === undefined ? undefined : retitleText(n.data.title, oldTitle, newTitle);
    if (text === n.data.text && title === n.data.title) return n;
    touched = true;
    return { ...n, data: { ...n.data, text, ...(title === undefined ? {} : { title }) } };
  });
  return touched ? out : null;
}

/** Keep links on the board open in this window right when a board is renamed in another. */
export function followRenamesFromOtherWindows() {
  void hearOtherWindows<{ oldTitle: string; newTitle: string; boardId: string }>("links-renamed", ({ oldTitle, newTitle, boardId }) => {
    const s = boardStore.getState();
    if (!s.boardId || s.boardId === boardId) return;
    const nodes = retitleNodes(s.nodes, oldTitle, newTitle);
    if (nodes) boardStore.setState({ nodes });
    const listed = boardIndex().find((b) => b.id === boardId);
    if (listed) updateIndexedBoard({ ...listed, title: newTitle });
  });
}

export async function renameLinks(oldTitle: string, newTitle: string, boardId: string): Promise<number> {
  if (!oldTitle.trim() || oldTitle.trim().toLocaleLowerCase() === newTitle.trim().toLocaleLowerCase()) return 0;
  if (!indexStore.getState().loaded) await refreshBoardIndex();
  const boards = boardIndex();
  if (boards.some((b) => b.id !== boardId && sameTitle(b.title, oldTitle))) return 0;
  // Boards open in other windows are updated by those windows, so they aren't overwritten here.
  void tellOtherWindows("links-renamed", { oldTitle, newTitle, boardId });
  const elsewhere = await boardsOpenElsewhere();
  let changed = 0;
  for (const listed of boards) {
    if (listed.id === boardId || elsewhere.has(listed.id) || !retitleNodes(listed.nodes, oldTitle, newTitle)) continue;
    // Another window may have changed it since the list was read, so work from the saved copy.
    const b = (await loadBoard(listed.id).catch(() => null)) ?? listed;
    const nodes = retitleNodes(b.nodes, oldTitle, newTitle);
    if (!nodes) continue;
    const doc = { ...b, nodes, updatedAt: Date.now() };
    try {
      await writeBoard(doc, b.updatedAt);
      updateIndexedBoard(doc);
      changed++;
    } catch (err) {
      console.error(`Couldn't update links on “${b.title}”`, err);
    }
  }
  return changed;
}

// ---------- Tags and jumping to a note ----------

/** #tags in a piece of text (lower-case, without the #). */
export function tagsIn(text: string): string[] {
  return [...text.matchAll(/(?<![\w#/&])#([A-Za-z][\w-]{0,40})/g)].map((m) => m[1].toLowerCase());
}

let pendingFocus: string | null = null;
/** Ask the next board that opens to select and zoom to this item. */
export const focusOnOpen = (itemId: string | null) => {
  pendingFocus = itemId;
};
/** The item the board just opened should show, if any (asked once). */
export const takePendingFocus = () => {
  const id = pendingFocus;
  pendingFocus = null;
  return id;
};

/** Open a board and show one of its items. */
export async function openBoardAt(boardId: string, itemId: string) {
  focusOnOpen(itemId);
  await navigate(boardId);
}

/** Ask the open board to find something (e.g. when a #tag is clicked). */
export const findOnBoard = (query: string) => window.dispatchEvent(new CustomEvent("mythra:find", { detail: query }));
