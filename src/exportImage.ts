import { domToCanvas } from "modern-screenshot";
import { rectsBounds } from "./geometry";
import { rectOf } from "./layout";
import { isTauri } from "./persistence";
import type { BoardNode } from "./types";

/** Room around the content, including space for section titles that sit above sections. */
const PAD = 64;
const MAX_SIDE = 8000;

/** Parts of the board that are controls, not content. */
const SKIP = ["react-flow__handle", "react-flow__resize-control", "react-flow__minimap", "react-flow__panel"];

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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

/** Turn a board title into a safe file name. */
export const fileNameFor = (title: string) =>
  `${title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 80) || "Board"}.png`;

/**
 * Draw the whole board (not just what's on screen) to a PNG and save it.
 * Returns false if there was nothing to export or the save was cancelled.
 */
export async function exportBoardPng(nodes: BoardNode[], title: string): Promise<boolean> {
  const bounds = rectsBounds(nodes.map(rectOf));
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!bounds || !viewport) return false;
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
      filter: (el: Node) => !(el instanceof Element && SKIP.some((c) => el.classList.contains(c))),
    });
  // Shadows and animations don't copy cleanly into an image, so flatten the board while exporting.
  const root = viewport.closest(".react-flow");
  root?.classList.add("is-exporting");
  const restoreLinks = stretchLinkCanvases(viewport, { x: bounds.x - PAD, y: bounds.y - PAD, width, height });
  let url: string;
  try {
    // WebKit sometimes leaves images out of the first render, so render twice.
    await render();
    const content = await render();
    // Paint the board colour across the whole picture, then the content on top.
    const canvas = document.createElement("canvas");
    canvas.width = content.width;
    canvas.height = content.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(content, 0, 0);
    url = canvas.toDataURL("image/png");
  } finally {
    restoreLinks();
    root?.classList.remove("is-exporting");
  }
  const name = fileNameFor(title);

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("export_png", dataUrlBytes(url), { headers: { "file-name": name } });
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  return true;
}
