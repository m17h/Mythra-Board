import { nanoid } from "nanoid";
import type { Point } from "./geometry";
import { saveAsset } from "./persistence";
import { boardStore } from "./store";

const MAX_SIDE = 2400;
const MAX_KEEP_BYTES = 1_500_000;
const DISPLAY_WIDTH = 360;
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const isImageFile = (f: File) => f.type in TYPES;

/** Store an image file (shrinking very large photos) and return its asset name and size. */
async function storeImage(file: File): Promise<{ name: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  let blob: Blob = file;
  let ext = TYPES[file.type];
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  // Animated GIFs are kept as-is so they keep moving.
  if (ext !== "gif" && (scale < 1 || file.size > MAX_KEEP_BYTES)) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = ext === "png" ? "image/png" : "image/jpeg";
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, 0.88),
    );
    ext = type === "image/png" ? "png" : "jpg";
  }
  bitmap.close();
  const name = `${nanoid(14).replace(/[^A-Za-z0-9_-]/g, "_")}.${ext}`;
  await saveAsset(name, new Uint8Array(await blob.arrayBuffer()));
  return { name, width, height };
}

/** Add image files to the board, centred on `at` and fanned out if there are several. */
/** Adds pictures fanned out from `at`; returns the lowest edge they reach. */
export async function addImages(files: File[], at: Point): Promise<number> {
  const images = files.filter(isImageFile);
  let i = 0;
  let bottom = at.y;
  for (const file of images) {
    try {
      const { name, width, height } = await storeImage(file);
      const w = Math.min(DISPLAY_WIDTH, width);
      const h = Math.round((height / width) * w);
      boardStore.getState().addItem(
        "image",
        { x: at.x - w / 2 + i * 30, y: at.y - h / 2 + i * 30 },
        { width: w, height: h, data: { asset: name } },
      );
      bottom = Math.max(bottom, at.y - h / 2 + i * 30 + h);
      i++;
    } catch (err) {
      console.error("Could not add image", err);
    }
  }
  return bottom;
}

const URL_RE = /^(https?:\/\/)[^\s]+$/i;

/** If the text is just a web address, return it. */
export const asUrl = (text: string) => (URL_RE.test(text.trim()) ? text.trim() : null);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** File types that can be dropped on a board as file cards (images become pictures). */
export const FILE_EXTENSIONS = [
  "pdf", "txt", "md", "csv", "json", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "key", "pages", "numbers", "zip", "mp3", "m4a", "wav", "mp4", "mov",
];
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const isAttachable = (f: File) => isImageFile(f) || FILE_EXTENSIONS.includes(extOf(f.name));

/**
 * Add dropped or picked files: pictures become images, documents become file cards.
 * Returns a message about anything that couldn't be added.
 */
export async function addFiles(files: File[], at: Point): Promise<string | null> {
  const images = files.filter(isImageFile);
  const others = files.filter((f) => !isImageFile(f));
  const problems: string[] = [];
  // Files go in a column underneath any pictures, so nothing lands on top of anything else.
  const top = images.length ? (await addImages(images, at)) + 30 : at.y - 35;
  let i = 0;
  for (const file of others) {
    const ext = extOf(file.name);
    if (!FILE_EXTENSIONS.includes(ext)) {
      problems.push(`${file.name} (this kind of file isn't supported)`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`${file.name} (larger than 200 MB)`);
      continue;
    }
    try {
      const name = `${nanoid(14).replace(/[^A-Za-z0-9_-]/g, "_")}.${ext}`;
      await saveAsset(name, new Uint8Array(await file.arrayBuffer()));
      boardStore.getState().addItem(
        "file",
        { x: at.x - 130, y: top + i * 90 },
        { data: { asset: name, text: file.name, fileSize: file.size } },
      );
      i++;
    } catch (err) {
      console.error("Couldn't add file", err);
      problems.push(file.name);
    }
  }
  return problems.length ? `Couldn't add ${problems.join(", ")}` : null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
