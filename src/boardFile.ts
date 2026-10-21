import { createBoard, findBoardByTitle, refreshBoardIndex } from "./navigation";
import { fileNameFor, fromSaved, loadAssetBytes, newBoardId, saveAsset, saveFile, toSaved } from "./persistence";
import type { BoardDoc } from "./store";

const FORMAT = "mythra-board-file";
const ASSET_NAME = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|gif|webp)$/;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A whole board, with its pictures, as one portable file. */
export async function boardFileText(doc: BoardDoc): Promise<string> {
  const assets: Record<string, string> = {};
  for (const n of doc.nodes) {
    const name = n.data.asset;
    if (n.type !== "image" || !name || assets[name]) continue;
    try {
      assets[name] = bytesToBase64(await loadAssetBytes(name));
    } catch {
      // A missing picture shouldn't stop the rest of the board being saved.
    }
  }
  return JSON.stringify({ format: FORMAT, version: 1, board: toSaved(doc), assets });
}

export async function exportBoardFile(doc: BoardDoc): Promise<boolean> {
  const text = await boardFileText(doc);
  return saveFile(new TextEncoder().encode(text), fileNameFor(doc.title, "mythra"), "mythra");
}

/** Add a board from a .mythra file to the library (as a new board) and return it. */
export async function importBoardFile(text: string): Promise<BoardDoc> {
  let file: { format?: unknown; board?: unknown; assets?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Mythra board");
  }
  if (file.format !== FORMAT || typeof file.board !== "object" || !file.board) throw new Error("That file isn't a Mythra board");
  const assets = file.assets && typeof file.assets === "object" ? (file.assets as Record<string, unknown>) : {};
  for (const [name, data] of Object.entries(assets)) {
    if (!ASSET_NAME.test(name) || typeof data !== "string") continue;
    try {
      await saveAsset(name, base64ToBytes(data));
    } catch (err) {
      console.error(`Couldn't import picture ${name}`, err);
    }
  }
  await refreshBoardIndex();
  const board = fromSaved(file.board);
  const now = Date.now();
  // Always a new board, so importing never overwrites anything already here.
  const title = findBoardByTitle(board.title) ? `${board.title} (imported)` : board.title;
  return createBoard({ ...board, id: newBoardId(), title, createdAt: now, updatedAt: now, pinned: false });
}
