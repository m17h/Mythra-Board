import { Position } from "@xyflow/react";
import { rectsBounds } from "./geometry";
import { freeSpot, rectOf } from "./layout";
import { isTauri } from "./persistence";
import { boardStore, makeItem, makeLink } from "./store";
import { DEFAULT_NOTE_WIDTH, type BoardNode, type Color, type LinkEdge } from "./types";
import { tidyTree } from "./mindmap";

export const AI_MODELS = [
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "Fastest" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "Balanced" },
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "Most thoughtful" },
] as const;
export type AiModel = (typeof AI_MODELS)[number]["id"];

const MODEL_KEY = "mythra-board:ai-model";
const MAX_BOARD_TEXT = 14_000;

export const aiSupported = isTauri;

export function getModel(): AiModel {
  const saved = localStorage.getItem(MODEL_KEY);
  return AI_MODELS.some((m) => m.id === saved) ? (saved as AiModel) : "claude-sonnet-5-5";
}
export const setModel = (m: AiModel) => localStorage.setItem(MODEL_KEY, m);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const hasKey = () => (aiSupported() ? invoke<boolean>("ai_key_status") : Promise.resolve(false));
export const saveKey = (key: string) => invoke<void>("set_ai_key", { key });
export const clearKey = () => invoke<void>("clear_ai_key");

const SYSTEM =
  "You help someone think on a visual whiteboard of notes and links. Reply with a single JSON object and nothing else: no commentary, no Markdown fences. Keep wording short, concrete and in the same language as the person's notes.";

/** Pull the JSON object out of a reply, even if it came wrapped in a code fence. */
export function parseJsonReply<T>(reply: string): T {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Claude's reply wasn't in the expected format.");
  return JSON.parse(reply.slice(start, end + 1)) as T;
}

async function ask<T>(prompt: string): Promise<T> {
  if (!aiSupported()) throw new Error("AI features work in the desktop app.");
  const reply = await invoke<string>("ask_ai", { model: getModel(), system: SYSTEM, prompt });
  return parseJsonReply<T>(reply);
}

const clean = (s: unknown, max = 160) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const itemText = (n: BoardNode) => [n.data.title, n.data.text].filter(Boolean).join(": ").trim();

/** A few new ideas branching from a note, added as linked notes beside it. */
export async function brainstorm(id: string): Promise<number> {
  const s = boardStore.getState();
  const node = s.nodes.find((n) => n.id === id);
  if (!node) return 0;
  const topic = itemText(node);
  if (!topic) throw new Error("Write something in the note first.");
  const near = s.edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => s.nodes.find((n) => n.id === (e.source === id ? e.target : e.source)))
    .filter((n): n is BoardNode => !!n)
    .map(itemText)
    .filter(Boolean);
  const { ideas } = await ask<{ ideas?: unknown[] }>(
    [
      `Board: ${s.title}`,
      `Idea to build on: ${topic}`,
      near.length ? `Already connected (don't repeat these): ${near.join(" | ")}` : "",
      'Suggest 5 new, distinct ideas that branch from it. Each at most 12 words. Return {"ideas": ["..."]}.',
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const texts = (Array.isArray(ideas) ? ideas : []).map((t) => clean(t)).filter(Boolean).slice(0, 8);
  if (!texts.length) throw new Error("Claude didn't suggest anything this time.");
  addChildren(id, texts, node.data.color);
  return texts.length;
}

type Branch = { text?: unknown; children?: unknown };

/** Turn a note's text into a branching mind map growing out of that note. */
export async function mindMapFromNote(id: string): Promise<number> {
  const node = boardStore.getState().nodes.find((n) => n.id === id);
  if (!node) return 0;
  const text = itemText(node);
  if (text.length < 3) throw new Error("Write something in the note first.");
  const { branches } = await ask<{ branches?: unknown[] }>(
    [
      `Text:\n${text.slice(0, MAX_BOARD_TEXT)}`,
      'Organise this into a mind map. Give 3 to 6 main branches, each with up to 4 children, at most 3 levels deep. Each entry at most 8 words. Return {"branches": [{"text": "...", "children": [{"text": "...", "children": []}]}]}.',
    ].join("\n\n"),
  );
  const count = addTree(id, Array.isArray(branches) ? (branches as Branch[]) : []);
  if (!count) throw new Error("Claude didn't return a mind map this time.");
  return count;
}

/** A summary card of everything written on the board, placed to the right of it. */
export async function summariseBoard(): Promise<string> {
  const s = boardStore.getState();
  const text = s.nodes.map(itemText).filter(Boolean).join("\n- ").slice(0, MAX_BOARD_TEXT);
  if (!text) throw new Error("There's nothing written on this board yet.");
  const { title, points } = await ask<{ title?: unknown; points?: unknown[] }>(
    [
      `Board: ${s.title}`,
      `Notes:\n- ${text}`,
      'Summarise the board: the main themes, decisions and open questions. Return {"title": "a short title", "points": ["3 to 7 short points"]}.',
    ].join("\n\n"),
  );
  const bullets = (Array.isArray(points) ? points : []).map((p) => clean(p, 240)).filter(Boolean);
  if (!bullets.length) throw new Error("Claude didn't return a summary this time.");
  const bounds = rectsBounds(s.nodes.map(rectOf));
  const at = bounds ? { x: bounds.x + bounds.width + 120, y: bounds.y } : { x: 0, y: 0 };
  return s.addItem("note", at, {
    width: 340,
    data: { title: clean(title) || "Summary", text: bullets.map((b) => `- ${b}`).join("\n"), color: "purple" },
  });
}

/** Add notes linked from `parentId`, each placed in the next free spot beside it, as one step. */
export function addChildren(parentId: string, texts: string[], color: Color) {
  const s = boardStore.getState();
  const parent = s.nodes.find((n) => n.id === parentId);
  if (!parent) return;
  const others = s.nodes.filter((n) => n.type !== "frame").map(rectOf);
  const nodes: BoardNode[] = [];
  const edges: LinkEdge[] = [];
  for (const text of texts) {
    const at = freeSpot(rectOf(parent), Position.Right, others);
    const n = makeItem("note", at, { text, color }, { width: DEFAULT_NOTE_WIDTH });
    others.push({ ...at, width: DEFAULT_NOTE_WIDTH, height: 50 });
    nodes.push(n);
    edges.push(makeLink(parentId, n.id, { ...s.linkStyle, label: "" }));
  }
  s.replaceContent([...s.nodes, ...nodes], [...s.edges, ...edges]);
}

/** Add a whole tree of notes under `parentId` and arrange it neatly, as one step. */
export function addTree(parentId: string, branches: Branch[]): number {
  const s = boardStore.getState();
  const parent = s.nodes.find((n) => n.id === parentId);
  if (!parent) return 0;
  const nodes: BoardNode[] = [];
  const edges: LinkEdge[] = [];
  const palette: Color[] = ["blue", "green", "orange", "pink", "purple", "yellow"];
  const walk = (list: Branch[], from: string, depth: number, color: Color | null) => {
    list.slice(0, 8).forEach((b, i) => {
      const text = clean(b?.text);
      if (!text || depth > 3) return;
      const c = color ?? palette[i % palette.length];
      const n = makeItem("note", { x: parent.position.x + 300 * depth, y: parent.position.y + nodes.length * 60 }, { text, color: c, size: depth > 1 ? "s" : "m" });
      nodes.push(n);
      edges.push(makeLink(from, n.id, { arrow: "none" }));
      if (Array.isArray(b.children)) walk(b.children as Branch[], n.id, depth + 1, c);
    });
  };
  walk(branches, parentId, 1, null);
  if (!nodes.length) return 0;
  const allNodes = [...s.nodes, ...nodes];
  const allEdges = [...s.edges, ...edges];
  const moves = tidyTree(parentId, allNodes, allEdges);
  s.replaceContent(
    allNodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)),
    allEdges,
  );
  return nodes.length;
}

/** The AI actions, each reporting what it did in a sentence. */
export const aiActions = {
  brainstorm: async (id: string) => {
    const n = await brainstorm(id);
    return `Added ${n} ideas`;
  },
  mindMap: async (id: string) => {
    const n = await mindMapFromNote(id);
    return `Built a mind map with ${n} notes`;
  },
  summarise: async () => {
    await summariseBoard();
    return "Added a summary to the right of the board";
  },
};
