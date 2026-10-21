/** Show a short message at the bottom of the screen (the board view decides how). */
let show: (message: string | null) => void = () => {};
export const setNotifier = (fn: (message: string | null) => void) => {
  show = fn;
};
export const notify = (message: string | null) => show(message);

/** Run an AI action with a "Thinking…" message, then report what happened. */
export async function runAi(action: () => Promise<string>): Promise<void> {
  notify("Thinking…");
  try {
    notify(await action());
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err));
  }
}
