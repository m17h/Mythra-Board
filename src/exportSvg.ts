import { bytesToBase64 } from "./boardFile";
import { arrowHead, offset, rectsBounds, unit, type Rect } from "./geometry";
import { strokePath } from "./ink";
import { rectOf } from "./layout";
import { computeLinkEnds, linkGeometry } from "./linkPath";
import { boardIndex } from "./navigation";
import { formatBytes } from "./images";
import { loadAssetBytes } from "./persistence";
import { SHAPE_DETAILS, SHAPE_PATHS } from "./shapes";
import {
  DEFAULT_OUTLINE,
  textStyleOf,
  type BoardNode,
  type Color,
  type LinkEdge,
  type Size,
  type TextStyle,
} from "./types";

const PAD = 64;

/** The nearest SVG alignment for a picture's crop focus. */
const cropAlign = (crop?: [number, number]) => {
  const pick = (v: number, axis: "x" | "y") => `${axis}${v < 0.34 ? "Min" : v > 0.66 ? "Max" : "Mid"}`;
  const [fx, fy] = crop ?? [0.5, 0.5];
  return `${pick(fx, "x")}${pick(fy, "y").replace("y", "Y")}`;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => Math.round(v * 100) / 100;

/** Colours resolved from the current theme. */
type Palette = {
  bg: string;
  text: string;
  muted: string;
  link: string;
  noteBorder: string;
  accent: string;
  soft: (c: Color) => string;
  strong: (c: Color) => string;
  font: string;
};

function readPalette(root: Element): Palette {
  const probe = document.createElement("div");
  probe.style.display = "none";
  root.appendChild(probe);
  const cache = new Map<string, string>();
  const read = (cls: string, prop: string) => {
    const key = `${cls}|${prop}`;
    if (!cache.has(key)) {
      probe.className = cls;
      cache.set(key, getComputedStyle(probe).getPropertyValue(prop).trim());
    }
    return cache.get(key)!;
  };
  const p: Palette = {
    bg: read("", "--bg"),
    text: read("", "--text"),
    muted: read("", "--muted"),
    link: read("", "--link"),
    noteBorder: read("", "--note-border"),
    accent: read("", "--accent"),
    soft: (c) => read(`color--${c}`, "--soft"),
    strong: (c) => read(`color--${c}`, "--strong"),
    font: getComputedStyle(document.body).fontFamily.replace(/"/g, "'"),
  };
  // Read everything now, while the probe is attached.
  for (const c of ["plain", "yellow", "orange", "pink", "purple", "blue", "green"] as Color[]) (p.soft(c), p.strong(c));
  probe.remove();
  return p;
}

/** Scale one of the 100×100 shape outlines to a real size and position. */
export function placePath(d: string, r: Rect): string {
  const sx = r.width / 100;
  const sy = r.height / 100;
  const tokens = d.match(/[MLAZ]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let cmd = "";
  let args: number[] = [];
  const flush = () => {
    if (!cmd) return;
    if (cmd === "A") {
      // rx ry rotation large-arc sweep x y
      const [rx, ry, rot, large, sweep, x, y] = args;
      out.push(`A ${n2(rx * sx)} ${n2(ry * sy)} ${rot} ${large} ${sweep} ${n2(r.x + x * sx)} ${n2(r.y + y * sy)}`);
    } else if (cmd === "Z") {
      out.push("Z");
    } else {
      const pts: string[] = [];
      for (let i = 0; i + 1 < args.length; i += 2) pts.push(`${n2(r.x + args[i] * sx)} ${n2(r.y + args[i + 1] * sy)}`);
      out.push(`${cmd} ${pts.join(" ")}`);
    }
    args = [];
  };
  for (const t of tokens) {
    if (/[MLAZ]/.test(t)) {
      flush();
      cmd = t;
      if (t === "Z") {
        flush();
        cmd = "";
      }
    } else {
      args.push(parseFloat(t));
    }
  }
  flush();
  return out.join(" ");
}

type Line = { text: string; size: number; weight: number; color?: string };

const NOTE_SIZE: Record<Size, number> = { s: 13, m: 15, l: 21 };
const TEXT_STYLE: Record<TextStyle, { size: number; weight: number; lineHeight: number }> = {
  title: { size: 38, weight: 760, lineHeight: 1.12 },
  heading: { size: 27, weight: 700, lineHeight: 1.2 },
  subheading: { size: 19, weight: 600, lineHeight: 1.35 },
  body: { size: 16, weight: 400, lineHeight: 1.55 },
  caption: { size: 13, weight: 500, lineHeight: 1.45 },
};

/** Note text without its Markdown, line by line, with sizes for headings. */
export function plainLines(text: string, size: number, weight: number): Line[] {
  const clean = (s: string) =>
    s
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1$2");
  return text.split("\n").map((raw) => {
    let m: RegExpExecArray | null;
    if ((m = /^\s*[-*] \[( |x|X)\] ?(.*)$/.exec(raw))) return { text: `${m[1] === " " ? "☐" : "☑"} ${clean(m[2])}`, size, weight };
    if ((m = /^(#{1,3}) (.*)$/.exec(raw))) return { text: clean(m[2]), size: m[1].length === 1 ? size * 1.3 : size * 1.1, weight: 700 };
    if ((m = /^\s*[-*•] (.*)$/.exec(raw))) return { text: `•  ${clean(m[1])}`, size, weight };
    if ((m = /^> ?(.*)$/.exec(raw))) return { text: `“${clean(m[1])}”`, size, weight };
    return { text: clean(raw), size, weight };
  });
}

/** Text drawn with the same font as the app, wrapped to a width. */
class TextLayout {
  private ctx = document.createElement("canvas").getContext("2d")!;
  constructor(private family: string) {}

  wrap(line: Line, width: number): string[] {
    this.ctx.font = `${line.weight} ${line.size}px ${this.family}`;
    if (!line.text) return [""];
    const out: string[] = [];
    let current = "";
    for (const word of line.text.split(/(\s+)/)) {
      const next = current + word;
      if (this.ctx.measureText(next).width <= width || !current.trim()) {
        current = next;
        // A single word wider than the box gets broken up.
        while (this.ctx.measureText(current).width > width && current.length > 1) {
          let cut = current.length - 1;
          while (cut > 1 && this.ctx.measureText(current.slice(0, cut)).width > width) cut--;
          out.push(current.slice(0, cut));
          current = current.slice(cut);
        }
      } else {
        out.push(current.trimEnd());
        current = word.trimStart();
      }
    }
    out.push(current.trimEnd());
    return out;
  }

  /** `<text>` elements for lines of text inside a box, top-aligned (or centred). */
  block(lines: Line[], box: Rect, opts: { align?: "left" | "center" | "right"; lineHeight?: number; color: string; middle?: boolean }) {
    const lh = opts.lineHeight ?? 1.45;
    const rows: { text: string; line: Line }[] = [];
    for (const line of lines) for (const text of this.wrap(line, box.width)) rows.push({ text, line });
    const total = rows.reduce((sum, r) => sum + r.line.size * lh, 0);
    let y = opts.middle ? box.y + (box.height - total) / 2 : box.y;
    const anchor = opts.align === "center" ? "middle" : opts.align === "right" ? "end" : "start";
    const x = opts.align === "center" ? box.x + box.width / 2 : opts.align === "right" ? box.x + box.width : box.x;
    const out: string[] = [];
    for (const r of rows) {
      const h = r.line.size * lh;
      y += h;
      if (!r.text) continue;
      out.push(
        `<text x="${n2(x)}" y="${n2(y - h * 0.28)}" font-size="${n2(r.line.size)}" font-weight="${r.line.weight}" fill="${r.line.color ?? opts.color}" text-anchor="${anchor}">${esc(r.text)}</text>`,
      );
    }
    return { svg: out.join(""), height: total };
  }
}

function outlineAttrs(n: BoardNode, p: Palette, fallback: string): string {
  const width = n.data.outline ?? DEFAULT_OUTLINE[n.type];
  if (!width) return `stroke="${fallback}" stroke-width="1"`;
  const color = n.data.outlineColor ? p.strong(n.data.outlineColor) : n.data.color === "plain" ? p.muted : p.strong(n.data.color);
  return `stroke="${color}" stroke-width="${width}"${n.data.outlineStyle === "dashed" ? ` stroke-dasharray="${width * 4} ${width * 3}"` : ""}`;
}

async function imageData(name: string): Promise<string | null> {
  try {
    const bytes = await loadAssetBytes(name);
    const ext = name.split(".").pop();
    return `data:${ext === "jpg" ? "image/jpeg" : `image/${ext}`};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

/** A real vector drawing of the given items and the links between them. */
export async function boardSvg(nodes: BoardNode[], edges: LinkEdge[], root: Element, opts: { background: boolean }): Promise<string> {
  const p = readPalette(root);
  const layout = new TextLayout(p.font);
  const ids = new Set(nodes.map((n) => n.id));
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const bounds = rectsBounds(nodes.map(rectOf)) ?? { x: 0, y: 0, width: 100, height: 100 };
  const vb = { x: bounds.x - PAD, y: bounds.y - PAD, width: bounds.width + PAD * 2, height: bounds.height + PAD * 2 };
  const parts: string[] = [];
  const defs: string[] = [];

  if (opts.background) parts.push(`<rect x="${vb.x}" y="${vb.y}" width="${vb.width}" height="${vb.height}" fill="${p.bg}"/>`);

  const drawItem = async (n: BoardNode) => {
    const r = rectOf(n);
    const d = n.data;
    switch (n.type) {
      case "frame": {
        parts.push(
          `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="18" fill="${d.color === "plain" ? p.text : p.soft(d.color)}" fill-opacity="${d.color === "plain" ? 0.035 : 0.55}" ${
            d.outline !== undefined ? outlineAttrs(n, p, p.noteBorder) : `stroke="${d.color === "plain" ? p.muted : p.strong(d.color)}" stroke-opacity="0.3" stroke-width="1.5"`
          }/>`,
        );
        if (d.text)
          parts.push(
            `<text x="${r.x + 13}" y="${r.y - 12}" font-size="14" font-weight="650" fill="${d.color === "plain" ? p.muted : p.strong(d.color)}">${esc(d.text)}</text>`,
          );
        return;
      }
      case "ink":
        parts.push(`<path d="${strokePath(d.points ?? [], d.size)}" transform="translate(${r.x} ${r.y})" fill="${p.strong(d.color)}"/>`);
        return;
      case "arrow": {
        const [x1, y1, x2, y2] = d.ends ?? [0, 0, 0, 0];
        const a = { x: r.x + x1, y: r.y + y1 };
        const b = { x: r.x + x2, y: r.y + y2 };
        const stroke = { s: 1.5, m: 2.5, l: 4 }[d.size];
        const color = d.color === "plain" ? p.text : p.strong(d.color);
        const dir = unit(a, b);
        const len = 8 + stroke * 2.2;
        const head = d.arrowHead ?? "end";
        const end = head !== "none" ? offset(b, dir, -(len - 2)) : b;
        const start = head === "both" ? offset(a, dir, len - 2) : a;
        parts.push(
          `<line x1="${n2(start.x)}" y1="${n2(start.y)}" x2="${n2(end.x)}" y2="${n2(end.y)}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"${d.outlineStyle === "dashed" ? ' stroke-dasharray="8 7"' : ""}/>`,
        );
        if (head !== "none") parts.push(`<path d="${arrowHead(b, dir, len, len * 0.85)}" fill="${color}"/>`);
        if (head === "both") parts.push(`<path d="${arrowHead(a, { x: -dir.x, y: -dir.y }, len, len * 0.85)}" fill="${color}"/>`);
        return;
      }
      case "image": {
        const href = d.asset ? await imageData(d.asset) : null;
        const clip = `clip-${n.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
        defs.push(`<clipPath id="${clip}"><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10"/></clipPath>`);
        if (href)
          parts.push(
            `<image href="${href}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" preserveAspectRatio="${cropAlign(d.crop)} slice" clip-path="url(#${clip})"/>`,
          );
        if ((d.outline ?? 0) > 0)
          parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10" fill="none" ${outlineAttrs(n, p, "none")}/>`);
        if (d.text)
          parts.push(layout.block([{ text: d.text, size: 13, weight: 400 }], { x: r.x, y: r.y + r.height + 8, width: r.width, height: 40 }, { align: "center", color: p.muted }).svg);
        return;
      }
      case "shape": {
        const shape = d.shape ?? "rect";
        const fill = p.soft(d.color);
        const stroke = outlineAttrs(n, p, "none");
        if (shape === "rect") parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="14" fill="${fill}" ${stroke}/>`);
        else if (shape === "ellipse")
          parts.push(`<ellipse cx="${r.x + r.width / 2}" cy="${r.y + r.height / 2}" rx="${r.width / 2}" ry="${r.height / 2}" fill="${fill}" ${stroke}/>`);
        else {
          parts.push(`<path d="${placePath(SHAPE_PATHS[shape]!, r)}" fill="${fill}" stroke-linejoin="round" ${stroke}/>`);
          if (SHAPE_DETAILS[shape]) parts.push(`<path d="${placePath(SHAPE_DETAILS[shape]!, r)}" fill="none" ${stroke}/>`);
        }
        if (d.text) {
          const size = NOTE_SIZE[d.size];
          const inset = { x: r.x + r.width * 0.12, y: r.y + r.height * 0.12, width: r.width * 0.76, height: r.height * 0.76 };
          parts.push(layout.block(plainLines(d.text, size, d.size === "l" ? 650 : 400), inset, { align: d.align ?? "center", color: p.text, middle: true }).svg);
        }
        return;
      }
      case "text": {
        const style = TEXT_STYLE[textStyleOf(d)];
        const color = d.color === "plain" ? (textStyleOf(d) === "caption" ? p.muted : p.text) : p.strong(d.color);
        const padX = (d.outline ?? 0) > 0 ? 12 : 6;
        const padY = (d.outline ?? 0) > 0 ? 8 : 4;
        if ((d.outline ?? 0) > 0) parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10" fill="none" ${outlineAttrs(n, p, "none")}/>`);
        parts.push(
          layout.block(plainLines(d.text, style.size, style.weight), { x: r.x + padX, y: r.y + padY, width: r.width - padX * 2, height: r.height }, {
            align: d.align,
            lineHeight: style.lineHeight,
            color,
          }).svg,
        );
        return;
      }
      default: {
        // Notes, link cards and board cards share the card look.
        parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="12" fill="${p.soft(d.color)}" ${outlineAttrs(n, p, p.noteBorder)}/>`);
        const inner = { x: r.x + 15, y: r.y + 12, width: r.width - 30, height: r.height - 24 };
        if (n.type === "file") {
          const size = d.fileSize ? formatBytes(d.fileSize) : "File";
          parts.push(layout.block([{ text: d.text || "File", size: 14.5, weight: 650 }, { text: size, size: 12, weight: 400, color: p.muted }], inner, { color: p.text, middle: true }).svg);
          return;
        }
        if (n.type === "link" || n.type === "board") {
          const target = n.type === "board" ? boardIndex().find((b) => b.id === d.boardId) : undefined;
          const title = n.type === "board" ? (target?.title ?? d.text) : d.text || d.url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "";
          const sub = n.type === "board" ? `${target?.nodes.length ?? 0} items` : (d.url ?? "").replace(/^https?:\/\/(www\.)?/, "");
          parts.push(
            layout.block([{ text: title, size: 14.5, weight: 650 }, { text: sub, size: 12, weight: 400, color: p.muted }], inner, { color: p.text, middle: true }).svg,
          );
          return;
        }
        let top = inner.y;
        if (d.title !== undefined) {
          const t = layout.block([{ text: d.title || "Untitled", size: d.size === "l" ? 22 : d.size === "s" ? 14 : 16.5, weight: 700 }], { ...inner, y: top }, {
            align: d.align,
            lineHeight: 1.3,
            color: p.text,
          });
          parts.push(t.svg);
          top += t.height + 8;
          if (d.text) {
            parts.push(`<line x1="${inner.x}" y1="${top}" x2="${inner.x + inner.width}" y2="${top}" stroke="${p.text}" stroke-opacity="0.13"/>`);
            top += 9;
          }
        }
        const size = d.title !== undefined && d.size === "l" ? 15 : NOTE_SIZE[d.size];
        parts.push(layout.block(plainLines(d.text, size, d.size === "l" && d.title === undefined ? 650 : 400), { ...inner, y: top }, { align: d.align, color: p.text }).svg);
        // The to-do progress bar along the bottom, as on screen.
        const tasks = [...d.text.matchAll(/^\s*[-*] \[( |x|X)\]/gm)];
        if (tasks.length) {
          const done = tasks.filter((m) => m[1] !== " ").length;
          const y = r.y + r.height - 16;
          const track = inner.width - 34;
          parts.push(
            `<rect x="${inner.x}" y="${y - 2}" width="${n2(track)}" height="4" rx="2" fill="${p.text}" fill-opacity="0.08"/>`,
            `<rect x="${inner.x}" y="${y - 2}" width="${n2((track * done) / tasks.length)}" height="4" rx="2" fill="${p.accent}"/>`,
            `<text x="${inner.x + inner.width}" y="${y + 4}" font-size="11" font-weight="600" fill="${p.muted}" text-anchor="end">${done}/${tasks.length}</text>`,
          );
        }
      }
    }
  };

  // Sections first, then links, then everything else on top (as on screen).
  for (const n of nodes) if (n.type === "frame") await drawItem(n);
  const ends = computeLinkEnds(nodes, links);
  for (const e of links) {
    const end = ends.get(e.id);
    if (!end || !e.data) continue;
    const g = linkGeometry(end, e.data.curve, e.data.arrow);
    parts.push(`<path d="${g.path}" fill="none" stroke="${p.link}" stroke-width="2"${e.data.dash === "dashed" ? ' stroke-dasharray="7 6"' : ""}/>`);
    for (const h of g.heads) parts.push(`<path d="${h}" fill="${p.link}"/>`);
    if (e.data.label) {
      const w = e.data.label.length * 7 + 20;
      parts.push(
        `<rect x="${n2(g.labelX - w / 2)}" y="${n2(g.labelY - 12)}" width="${n2(w)}" height="24" rx="8" fill="${p.soft("plain")}" stroke="${p.noteBorder}"/>`,
        `<text x="${n2(g.labelX)}" y="${n2(g.labelY + 4.5)}" font-size="12.5" font-weight="500" fill="${p.text}" text-anchor="middle">${esc(e.data.label)}</text>`,
      );
    }
  }
  for (const n of nodes) if (n.type !== "frame") await drawItem(n);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}" width="${Math.round(vb.width)}" height="${Math.round(vb.height)}" font-family="${esc(p.font)}">`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    ...parts,
    "</svg>",
  ].join("");
}
