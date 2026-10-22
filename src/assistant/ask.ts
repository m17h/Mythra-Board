import { claudeStatus, hasKey, type ClaudeStatus } from "../ai";
import { boardStore } from "../store";
import { chat, getEnginePreference, send, testHost, type Engine } from "./run";

/** How Claude can be reached right now, if at all. */
export type Access = { engine: Engine | null; status: ClaudeStatus; hasKey: boolean };

let cached: Promise<Access> | null = null;

/** Check (again) whether Claude Code is signed in or an API key is saved. */
export function checkAccess(fresh = false): Promise<Access> {
  if (testHost()) return Promise.resolve({ engine: "claude-code", status: { installed: true, signedIn: true, version: null, plan: "max", email: null }, hasKey: false });
  if (!cached || fresh) {
    cached = Promise.all([claudeStatus(), hasKey().catch(() => false)]).then(([status, key]) => {
      const code = status.installed && status.signedIn;
      const preferred = getEnginePreference();
      const engine: Engine | null =
        preferred === "api-key" && key ? "api-key" : code ? "claude-code" : key ? "api-key" : null;
      return { engine, status, hasKey: key };
    });
  }
  return cached;
}

/** Open the Claude panel, optionally sending a message straight away. */
export async function askClaude(message?: string, focusIds?: string[]) {
  chat.setState({ open: true });
  if (!message) return;
  if (focusIds?.length) boardStore.getState().selectOnly(focusIds);
  const { engine } = await checkAccess();
  if (engine) void send(message, engine);
}

/** Ready-made requests behind the ✨ buttons. */
export const QUICK = {
  brainstorm: "Brainstorm about five new, specific ideas that branch from the selected item. Add them as short linked notes beside it, in its colour.",
  mindMap: "Turn the selected item's text into a tidy mind map that grows out of it. Keep the original item as the centre.",
  summarise: "Summarise this board in one note beside the content, with a title and three to seven short points: the main themes, decisions and open questions.",
  organise: "Organise this board: group related items into clearly titled sections, make the colours consistent, and line everything up neatly. Keep all the content.",
  polish: "Make this board look more polished and easier to read, without changing what it says.",
};
