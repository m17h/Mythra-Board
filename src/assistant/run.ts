/**
 * Conversations with Claude about the board. Claude runs either through the person's own
 * Claude Code (which they've installed and signed in to) or with an Anthropic API key. Both
 * report progress the same way, so the panel shows them identically.
 */
import { createStore, useStore } from "zustand";
import { isTauri } from "../persistence";
import { boardStore } from "../store";
import { SYSTEM_PROMPT, userTurn } from "./prompt";
import { boardSwitch, describeCall, runTool, TOOLS, type ToolResult } from "./tools";

export type Engine = "claude-code" | "api-key";

export const MODELS = [
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "Fast and very good" },
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "Most thoughtful" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "Quickest" },
] as const;
export type Model = (typeof MODELS)[number]["id"];

export type Part =
  | { type: "text"; text: string }
  | { type: "step"; id: string; label: string; state: "running" | "done" | "failed" };

export type Turn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      parts: Part[];
      status: "running" | "done" | "stopped" | "error";
      error?: string;
      /** Undo history length right after this run, to know whether Undo still applies. */
      undoMark?: { boardId: string; past: number };
    };

type ChatState = {
  open: boolean;
  turns: Turn[];
  running: boolean;
  /** Claude Code's conversation id, so follow-ups continue the same conversation. */
  sessionId: string | null;
};

export const chat = createStore<ChatState>(() => ({ open: false, turns: [], running: false, sessionId: null }));
export const useChat = <T,>(select: (s: ChatState) => T) => useStore(chat, select);

const MODEL_KEY = "mythra-board:assistant-model";
const ENGINE_KEY = "mythra-board:assistant-engine";

export function getModel(): Model {
  const saved = localStorage.getItem(MODEL_KEY);
  return MODELS.some((m) => m.id === saved) ? (saved as Model) : "claude-sonnet-5-5";
}
export const setModel = (m: Model) => localStorage.setItem(MODEL_KEY, m);
export const getEnginePreference = (): Engine | null => {
  const v = localStorage.getItem(ENGINE_KEY);
  return v === "claude-code" || v === "api-key" ? v : null;
};
export const setEnginePreference = (e: Engine) => localStorage.setItem(ENGINE_KEY, e);

// ---------- Talking to the host (the desktop app, or a test harness) ----------

type McpTool = { name: string; description: string; inputSchema: Record<string, unknown> };
/** Claude Code names tools after the server that provides them. */
const TOOL_NAMES_NOTE = `Your board tools are named with the prefix mcp__board__ (for example mcp__board__get_board, mcp__board__add_content, mcp__board__view_board). Always call them by those full names.`;

export const MCP_TOOLS: McpTool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

export type StartOptions = { runId: string; prompt: string; system: string; tools: McpTool[]; model: string; resume: string | null };

/** Something that can run Claude Code and pass tool calls back to the page. */
export type Host = {
  start: (opts: StartOptions) => Promise<void>;
  stop: (runId: string) => Promise<void>;
};

/** Messages from the host about a run. */
export type HostEvent =
  | { runId: string; kind: "line"; line: string }
  | { runId: string; kind: "exit"; code: number | null; stderr: string };

type TestWindow = Window & { __mythraTestHost?: Host };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const tauriHost: Host = {
  start: (opts) => invoke("agent_start", { opts }),
  stop: (runId) => invoke("agent_stop", { runId }),
};

/** A test harness standing in for the desktop app, if there is one. */
export const testHost = () => (window as TestWindow).__mythraTestHost ?? null;

const host = (): Host | null => (window as TestWindow).__mythraTestHost ?? (isTauri() ? tauriHost : null);

/** Turn a tool's result into the form MCP (and the Claude API) expects. */
export function toolContent(r: ToolResult): ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] {
  const out: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: r.text || "Done." }];
  if (r.image) out.push({ type: "image", data: r.image.data, mimeType: r.image.mediaType });
  return out;
}

/** Run a tool the host was asked for, and give back MCP content. */
export async function answerToolCall(name: string, args: unknown) {
  return toolContent(await runTool(name.replace(/^mcp__board__/, ""), args));
}

let listening = false;
const runs = new Map<string, { onLine: (line: string) => void; onExit: (code: number | null, stderr: string) => void }>();

/** Deliver a host message to the run it belongs to. */
export function hostEvent(e: HostEvent) {
  const run = runs.get(e.runId);
  if (!run) return;
  if (e.kind === "line") run.onLine(e.line);
  else run.onExit(e.code, e.stderr);
}

async function listenToHost() {
  if (listening) return;
  listening = true;
  if ((window as TestWindow).__mythraTestHost || !isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.listen<HostEvent>("agent-event", (e) => hostEvent(e.payload));
  await win.listen<{ callId: string; name: string; args: unknown }>("agent-tool", async (e) => {
    const content = await answerToolCall(e.payload.name, e.payload.args);
    await invoke("agent_tool_result", { callId: e.payload.callId, content });
  });
}

// ---------- Updating the conversation ----------

const update = (fn: (t: Extract<Turn, { role: "assistant" }>) => Extract<Turn, { role: "assistant" }>) =>
  chat.setState((s) => {
    const turns = [...s.turns];
    const last = turns[turns.length - 1];
    if (last?.role === "assistant") turns[turns.length - 1] = fn(last);
    return { turns };
  });

const addText = (text: string) => {
  const t = text.trim();
  if (t) update((a) => ({ ...a, parts: [...a.parts, { type: "text", text: t }] }));
};
const addStep = (id: string, name: string, input: unknown) =>
  update((a) => ({ ...a, parts: [...a.parts, { type: "step", id, label: describeCall(name.replace(/^mcp__board__/, ""), input), state: "running" }] }));
const finishStep = (id: string, failed: boolean) =>
  update((a) => ({ ...a, parts: a.parts.map((p) => (p.type === "step" && p.id === id ? { ...p, state: failed ? "failed" : "done" } : p)) }));

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean };

/** Read one message of Claude's output (Claude Code's stream-json format). Returns true when finished. */
function readMessage(m: Record<string, unknown>, finish: (error?: string) => void) {
  const type = m.type;
  if (type === "system" && m.subtype === "init") {
    if (typeof m.session_id === "string") chat.setState({ sessionId: m.session_id });
    const servers = (Array.isArray(m.mcp_servers) ? m.mcp_servers : []) as { name: string; status: string }[];
    const board = servers.find((s) => s.name === "board");
    if (board && board.status !== "connected") finish("Claude couldn't connect to the board. Please try again.");
    return;
  }
  const content = ((m.message as { content?: unknown })?.content ?? []) as Block[];
  if (type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b.type === "text" && b.text) addText(b.text);
      if (b.type === "tool_use" && b.id && b.name) addStep(b.id, b.name, b.input);
    }
    return;
  }
  if (type === "user" && Array.isArray(content)) {
    for (const b of content) if (b.type === "tool_result" && b.tool_use_id) finishStep(b.tool_use_id, !!b.is_error);
    return;
  }
  if (type === "result") {
    if (typeof m.session_id === "string") chat.setState({ sessionId: m.session_id });
    if (m.is_error || (typeof m.subtype === "string" && m.subtype !== "success")) {
      const detail = typeof m.result === "string" && m.result ? m.result : String(m.subtype ?? "");
      finish(friendlyError(detail));
    } else finish();
  }
}

/** Plain-language versions of the errors people are most likely to hit. */
export function friendlyError(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("not logged in") || d.includes("login") || d.includes("authenticat") || d.includes("invalid api key") || d.includes("oauth"))
    return "Claude Code isn't signed in. Open Terminal, type claude, and sign in. Then try again.";
  if (d.includes("rate limit") || d.includes("usage limit") || d.includes("limit reached")) return "You've reached your Claude usage limit for now. Try again later.";
  if (d.includes("overloaded") || d.includes("529")) return "Claude is very busy right now. Try again in a moment.";
  if (d.includes("max_turns") || d.includes("max turns")) return "Claude stopped after a lot of steps. Ask it to continue if there's more to do.";
  return detail ? `Something went wrong: ${detail.slice(0, 300)}` : "Something went wrong. Please try again.";
}

// ---------- Running a conversation turn ----------

let currentRun: string | null = null;
let stopCurrent: (() => void) | null = null;

export async function send(message: string, engine: Engine) {
  const text = message.trim();
  if (!text || chat.getState().running) return;
  const s = boardStore.getState();
  const prompt = userTurn(text, {
    boardTitle: s.title,
    itemCount: s.nodes.length,
    selected: s.nodes.filter((n) => n.selected).map((n) => n.id),
  });
  chat.setState((c) => ({ turns: [...c.turns, { role: "user", text }, { role: "assistant", parts: [], status: "running" }], running: true }));

  // Everything Claude does is one undo step (per board, if it moves between boards).
  boardStore.getState().begin();
  boardSwitch.before = () => boardStore.getState().commit();
  boardSwitch.after = () => boardStore.getState().begin();

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentRun = runId;
  let finished = false;
  const finish = (error?: string, stopped = false) => {
    if (finished) return;
    finished = true;
    runs.delete(runId);
    if (currentRun === runId) {
      currentRun = null;
      stopCurrent = null;
    }
    boardStore.getState().commit();
    boardSwitch.before = boardSwitch.after = () => {};
    const b = boardStore.getState();
    update((a) => ({
      ...a,
      parts: a.parts.map((p) => (p.type === "step" && p.state === "running" ? { ...p, state: stopped || error ? "failed" : "done" } : p)),
      status: stopped ? "stopped" : error ? "error" : "done",
      error,
      undoMark: { boardId: b.boardId, past: b.past.length },
    }));
    chat.setState({ running: false });
  };

  stopCurrent = () => finish(undefined, true);
  try {
    if (engine === "api-key") await runWithApiKey(prompt, finish);
    else await runWithClaudeCode(prompt, runId, finish);
  } catch (err) {
    finish(err instanceof Error ? err.message : String(err));
  }
}

async function runWithClaudeCode(prompt: string, runId: string, finish: (error?: string, stopped?: boolean) => void) {
  const h = host();
  if (!h) throw new Error("Claude works in the desktop app.");
  await listenToHost();
  let stderr = "";
  runs.set(runId, {
    onLine: (line) => {
      try {
        readMessage(JSON.parse(line) as Record<string, unknown>, finish);
      } catch {
        stderr += `${line}\n`;
      }
    },
    onExit: (code, err) => {
      stderr += err;
      if (code === 0) finish();
      else finish(friendlyError(stderr.trim() || `Claude Code stopped unexpectedly (code ${code}).`));
    },
  });
  await h.start({ runId, prompt, system: `${SYSTEM_PROMPT}\n\n${TOOL_NAMES_NOTE}`, tools: MCP_TOOLS, model: getModel(), resume: chat.getState().sessionId });
}

/** Stop the run in progress; whatever Claude already did stays (and is undoable). */
export async function stop() {
  const runId = currentRun;
  if (!runId) return;
  const done = stopCurrent;
  stopApiRun = true;
  done?.();
  await host()?.stop(runId).catch(() => {});
}

/** Start a fresh conversation. */
export function resetChat() {
  if (chat.getState().running) return;
  apiHistory = [];
  chat.setState({ turns: [], sessionId: null });
}

// ---------- The API-key engine: the same tools, run in a loop here ----------

type ApiBlock = Record<string, unknown> & { type: string };
type ApiMessage = { role: "user" | "assistant"; content: string | ApiBlock[] };
let apiHistory: ApiMessage[] = [];
let stopApiRun = false;
const MAX_STEPS = 40;

async function runWithApiKey(prompt: string, finish: (error?: string, stopped?: boolean) => void) {
  if (!isTauri()) throw new Error("Claude works in the desktop app.");
  stopApiRun = false;
  // Pictures from earlier turns aren't needed again; replace them to keep requests small.
  apiHistory = apiHistory.map((m) =>
    typeof m.content === "string"
      ? m
      : {
          ...m,
          content: m.content.map((b) =>
            b.type === "tool_result" && Array.isArray(b.content)
              ? { ...b, content: (b.content as ApiBlock[]).map((c) => (c.type === "image" ? { type: "text", text: "[picture of the board]" } : c)) }
              : b,
          ),
        },
  );
  apiHistory.push({ role: "user", content: prompt });
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  for (let step = 0; step < MAX_STEPS; step++) {
    if (stopApiRun) return;
    const reply = await invoke<{ content: ApiBlock[]; stop_reason: string }>("ai_messages", {
      body: { model: getModel(), max_tokens: 16000, system: SYSTEM_PROMPT, tools, messages: apiHistory },
    });
    if (stopApiRun) return;
    apiHistory.push({ role: "assistant", content: reply.content });
    readMessage({ type: "assistant", message: { content: reply.content } }, finish);
    if (reply.stop_reason !== "tool_use") return finish();
    const results: ApiBlock[] = [];
    for (const b of reply.content) {
      if (b.type !== "tool_use") continue;
      const r = await runTool(String(b.name), b.input);
      const content: ApiBlock[] = [{ type: "text", text: r.text || "Done." }];
      if (r.image) content.push({ type: "image", source: { type: "base64", media_type: r.image.mediaType, data: r.image.data } });
      results.push({ type: "tool_result", tool_use_id: String(b.id), content });
    }
    apiHistory.push({ role: "user", content: results });
    readMessage({ type: "user", message: { content: results } }, finish);
  }
  finish("Claude stopped after a lot of steps. Ask it to continue if there's more to do.");
}

// For the test harness: lets it run tools on the page directly.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__mythraAssistant = { answerToolCall, hostEvent, MCP_TOOLS, SYSTEM_PROMPT, send, chat, boardStore };
}
