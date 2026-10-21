import { createStore, useStore } from "zustand";
import { listBoards, newBoardId, writeBoard } from "./persistence";
import type { BoardDoc } from "./store";
import type { BoardBackground, BoardNode, LinkEdge } from "./types";

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
  content?: { nodes?: BoardNode[]; edges?: LinkEdge[]; background?: BoardBackground },
): BoardDoc {
  const now = Date.now();
  return {
    id: newBoardId(),
    title,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    background: content?.background ?? "dots",
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
