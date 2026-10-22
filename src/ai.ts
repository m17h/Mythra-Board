import { isTauri } from "./persistence";

/** Claude works in the desktop app only. */
export const aiSupported = isTauri;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** An Anthropic API key kept in the system keychain (the page never sees it). */
export const hasKey = () => (aiSupported() ? invoke<boolean>("ai_key_status") : Promise.resolve(false));
export const saveKey = (key: string) => invoke<void>("set_ai_key", { key });
export const clearKey = () => invoke<void>("clear_ai_key");

export type ClaudeStatus = { installed: boolean; signedIn: boolean; version: string | null; plan: string | null; email: string | null };

/** Whether the person's own Claude Code is installed and signed in. */
export const claudeStatus = (): Promise<ClaudeStatus> =>
  aiSupported()
    ? invoke<ClaudeStatus>("claude_status")
    : Promise.resolve({ installed: false, signedIn: false, version: null, plan: null, email: null });
