/**
 * How boards and items can look: custom colours, board colours (some dark, some light),
 * typefaces and ready-made themes. Shared by the board, its toolbars, exports and Claude.
 */
import type { CSSProperties } from "react";
import {
  BOARD_COLORS,
  COLORS,
  type BoardBackground,
  type BoardColor,
  type BoardStyle,
  type Color,
  type FontKind,
  type ItemData,
  type Paint,
} from "./types";

export const isHex = (v: unknown): v is `#${string}` => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** A palette colour or #rrggbb, checked; anything else is dropped. */
export function asPaint(v: unknown): Paint | undefined {
  if (isHex(v)) return v.toLowerCase() as Paint;
  return (COLORS as readonly unknown[]).includes(v) ? (v as Color) : undefined;
}

/** A board colour (named, or #rrggbb), checked. */
export function asBoardColor(v: unknown): string | undefined {
  if (isHex(v)) return v.toLowerCase();
  return (BOARD_COLORS as readonly unknown[]).includes(v) ? (v as string) : undefined;
}

/** The CSS colour for a paint: a palette colour's strong ink, or the colour itself. */
export const paintCss = (p: Paint): string => (isHex(p) ? p : `var(--ink-${p})`);

/** How light a colour is, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text that reads well on top of a colour. */
export const readableOn = (hex: string) => (luminance(hex) > 0.38 ? "#1d1d22" : "#ffffff");

/** The colour class (and, for custom colours, the CSS variables) for an item. */
export function colorLook(d: Pick<ItemData, "color" | "hex">): { className: string; style: CSSProperties } {
  if (d.hex && isHex(d.hex)) {
    return { className: "color--custom", style: { "--c": d.hex, "--on-c": readableOn(d.hex) } as CSSProperties };
  }
  return { className: `color--${d.color}`, style: {} };
}

// ---------- Typefaces ----------

export const FONT_NAMES: Record<FontKind, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
  rounded: "Rounded",
  hand: "Handwritten",
};

// ---------- Board colours ----------

type Tint = { name: string; bg: string; pattern: string; dark: boolean };

export const BOARD_TINTS: Record<Exclude<BoardColor, "default">, Tint> = {
  paper: { name: "Paper", bg: "#f7f1e3", pattern: "#ddd2b8", dark: false },
  sky: { name: "Sky", bg: "#eaf2fb", pattern: "#c9d9ec", dark: false },
  mint: { name: "Mint", bg: "#e8f5ee", pattern: "#c4e2d1", dark: false },
  blush: { name: "Blush", bg: "#fbeef1", pattern: "#efcfd8", dark: false },
  sand: { name: "Sand", bg: "#f1e9dc", pattern: "#d9cab2", dark: false },
  slate: { name: "Slate", bg: "#2b313b", pattern: "#3f4754", dark: true },
  midnight: { name: "Midnight", bg: "#161b2e", pattern: "#2a3150", dark: true },
  blueprint: { name: "Blueprint", bg: "#1d4e89", pattern: "#3b6ba3", dark: true },
  chalkboard: { name: "Chalkboard", bg: "#24352d", pattern: "#36493f", dark: true },
  charcoal: { name: "Charcoal", bg: "#1b1b1e", pattern: "#2e2e33", dark: true },
};

/** Mix two #rrggbb colours (amount 0–1 of `b`). */
function mix(a: string, b: string, amount: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - amount) + ((pb >> shift) & 255) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

export type BoardLook = {
  /** Whether items and text use the dark or light colour set. */
  scheme: "light" | "dark";
  /** The board's own colour and pattern colour, if it isn't following the app. */
  bg?: string;
  pattern?: string;
};

/** How a board's colour shows, given the app's own light or dark appearance. */
export function boardLook(color: string | undefined, appTheme: "light" | "dark"): BoardLook {
  if (!color || color === "default") return { scheme: appTheme };
  if (isHex(color)) {
    const dark = luminance(color) < 0.22;
    return { scheme: dark ? "dark" : "light", bg: color, pattern: mix(color, dark ? "#ffffff" : "#000000", dark ? 0.13 : 0.12) };
  }
  const tint = BOARD_TINTS[color as keyof typeof BOARD_TINTS];
  return tint ? { scheme: tint.dark ? "dark" : "light", bg: tint.bg, pattern: tint.pattern } : { scheme: appTheme };
}

// ---------- Themes ----------

export type Theme = {
  id: string;
  name: string;
  description: string;
  boardColor: string;
  background: BoardBackground;
  font: FontKind;
  style: BoardStyle;
};

/** Ready-made looks: a board colour, pattern, typeface and drawing style that go together. */
export const THEMES: Theme[] = [
  { id: "classic", name: "Classic", description: "Clean and simple", boardColor: "default", background: "dots", font: "sans", style: "clean" },
  { id: "paper", name: "Paper", description: "Warm paper, serif type", boardColor: "paper", background: "dots", font: "serif", style: "clean" },
  { id: "notebook", name: "Notebook", description: "Lined paper, handwriting", boardColor: "paper", background: "lines", font: "hand", style: "sketchy" },
  { id: "blueprint", name: "Blueprint", description: "Technical drawings", boardColor: "blueprint", background: "grid", font: "mono", style: "clean" },
  { id: "chalkboard", name: "Chalkboard", description: "Chalk on a board", boardColor: "chalkboard", background: "plain", font: "hand", style: "sketchy" },
  { id: "midnight", name: "Midnight", description: "Calm and dark", boardColor: "midnight", background: "dots", font: "sans", style: "clean" },
  { id: "pastel", name: "Pastel", description: "Soft and friendly", boardColor: "blush", background: "dots", font: "rounded", style: "clean" },
  { id: "terminal", name: "Terminal", description: "Monospace on black", boardColor: "charcoal", background: "cross", font: "mono", style: "clean" },
];
