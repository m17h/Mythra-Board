import { domToCanvas } from "modern-screenshot";
import { rectsBounds } from "./geometry";
import { rectOf } from "./layout";
import { copyImageToClipboard, fileNameFor, saveFile, type FileKind } from "./persistence";
import type { BoardNode, LinkEdge } from "./types";

/** Room around the content, including space for section titles that sit above sections. */
const PAD = 64;
const MAX_SIDE = 8000;

/** Parts of the board that are controls, not content. */
const SKIP = ["react-flow__handle", "react-flow__resize-control", "react-flow__minimap", "react-flow__panel", "fold-badge"];

/**
 * Each link is drawn in a small SVG whose lines spill outside it. Screens show the spill,
 * but image capture clips it, so temporarily make every link SVG cover the whole board.
 */
function stretchLinkCanvases(viewport: HTMLElement, area: { x: number; y: number; width: number; height: number }) {
  const svgs = [...viewport.querySelectorAll<SVGSVGElement>(".react-flow__edges svg")];
  const saved = svgs.map((svg) => [svg.getAttribute("style"), svg.getAttribute("viewBox")] as const);
  for (const svg of svgs) {
    Object.assign(svg.style, {
      left: `${area.x}px`,
      top: `${area.y}px`,
      width: `${area.width}px`,
      height: `${area.height}px`,
    });
    svg.setAttribute("viewBox", `${area.x} ${area.y} ${area.width} ${area.height}`);
  }
  return () =>
    svgs.forEach((svg, i) => {
      const [style, viewBox] = saved[i];
      if (style === null) svg.removeAttribute("style");
      else svg.setAttribute("style", style);
      if (viewBox === null) svg.removeAttribute("viewBox");
      else svg.setAttribute("viewBox", viewBox);
    });
}

/**
 * Draw the given items (and the links between them) to a canvas, at up to 2× for crisp
 * results. Everything else on the board is left out.
 */
export async function renderCanvas(nodes: BoardNode[], edges: LinkEdge[], opts: { background: boolean }) {
  const bounds = rectsBounds(nodes.map(rectOf));
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!bounds || !viewport) throw new Error("Nothing to export");
  const keep = new Set(nodes.map((n) => n.id));
  const keepEdges = new Set(edges.filter((e) => keep.has(e.source) && keep.has(e.target)).map((e) => e.id));
  const width = Math.ceil(bounds.width + PAD * 2);
  const height = Math.ceil(bounds.height + PAD * 2);
  const scale = Math.max(0.5, Math.min(2, MAX_SIDE / Math.max(width, height)));
  const background = getComputedStyle(document.body).backgroundColor;
  const render = () =>
    domToCanvas(viewport, {
      width,
      height,
      scale,
      backgroundColor: null,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px) scale(1)`,
      },
      filter: (el: Node) => {
        if (!(el instanceof Element)) return true;
        if (SKIP.some((c) => el.classList.contains(c))) return false;
        if (el.classList.contains("react-flow__node")) return keep.has(el.getAttribute("data-id") ?? "");
        if (el.classList.contains("react-flow__edge")) return keepEdges.has(el.getAttribute("data-id") ?? "");
        const edge = el.getAttribute("data-edge");
        return edge === null || keepEdges.has(edge);
      },
    });
  // Shadows and animations don't copy cleanly into an image, so flatten the board while exporting.
  const root = viewport.closest(".react-flow");
  root?.classList.add("is-exporting");
  const restoreLinks = stretchLinkCanvases(viewport, { x: bounds.x - PAD, y: bounds.y - PAD, width, height });
  try {
    // WebKit sometimes leaves images out of the first render, so render twice.
    await render();
    const content = await render();
    if (!opts.background) return { canvas: content, scale };
    // Paint the board colour across the whole picture, then the content on top.
    const canvas = document.createElement("canvas");
    canvas.width = content.width;
    canvas.height = content.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(content, 0, 0);
    return { canvas, scale };
  } finally {
    restoreLinks();
    root?.classList.remove("is-exporting");
  }
}

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** A one-page PDF showing a JPEG, sized so the picture appears at its natural size. */
export function pdfWithImage(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number, pixelsPerPoint: number): Uint8Array {
  const w = Math.round((pixelWidth / pixelsPerPoint) * 100) / 100;
  const h = Math.round((pixelHeight / pixelsPerPoint) * 100) / 100;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");
  const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export type ExportFormat = Extract<FileKind, "png" | "svg" | "pdf">;

/** Export items as a picture file. Returns false if the save was cancelled. */
export async function exportItems(
  format: ExportFormat,
  nodes: BoardNode[],
  edges: LinkEdge[],
  title: string,
  opts: { background: boolean },
): Promise<boolean> {
  const name = fileNameFor(title, format);
  if (format === "svg") {
    const { boardSvg } = await import("./exportSvg");
    const root = document.querySelector(".react-flow") ?? document.body;
    const svg = await boardSvg(nodes, edges, root, opts);
    return saveFile(new TextEncoder().encode(svg), name, "svg");
  }
  const { canvas, scale } = await renderCanvas(nodes, edges, { background: format === "pdf" || opts.background });
  if (format === "png") return saveFile(dataUrlBytes(canvas.toDataURL("image/png")), name, "png");
  // 1 CSS pixel = 0.75 points, so the page matches the board's on-screen size.
  const jpeg = dataUrlBytes(canvas.toDataURL("image/jpeg", 0.92));
  return saveFile(pdfWithImage(jpeg, canvas.width, canvas.height, scale / 0.75), name, "pdf");
}

export async function copyItemsAsImage(nodes: BoardNode[], edges: LinkEdge[], opts: { background: boolean }): Promise<void> {
  const { canvas } = await renderCanvas(nodes, edges, opts);
  await copyImageToClipboard(canvas);
}
