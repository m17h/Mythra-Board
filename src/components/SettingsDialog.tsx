import { useEffect, useState } from "react";
import { aiSupported, claudeStatus, clearKey, hasKey, saveKey, type ClaudeStatus } from "../ai";
import { getEnginePreference, getModel, MODELS, setEnginePreference, setModel, type Engine, type Model } from "../assistant/run";
import { checkAccess } from "../assistant/ask";
import { formatBytes } from "../images";
import { cleanupFiles, isTauri, openExternal } from "../persistence";
import { autoCheckEnabled, checkForUpdate, installUpdate, setAutoCheck, useUpdateState } from "../updates";
import { useEscape, useLeave } from "../useDismiss";
import { ThemeSwitch } from "./ThemeSwitch";

type Location = { path: string; kind: "default" | "icloud" | "custom"; icloudAvailable: boolean };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const LOCATION_NAMES = { default: "On this Mac", icloud: "iCloud Drive", custom: "A folder you chose" };

/** App-wide settings: appearance, where boards are kept, and AI. */
export function SettingsDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [leaving, close] = useLeave(onClose);
  const desktop = isTauri();
  const [location, setLocation] = useState<Location | null>(null);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModelState] = useState<Model>(getModel());
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [engine, setEngine] = useState<Engine | null>(getEnginePreference());
  const recheck = () => {
    setClaude(null);
    void claudeStatus().then(setClaude);
    void checkAccess(true);
  };
  const [version, setVersion] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(autoCheckEnabled);
  const update = useUpdateState();
  useEscape(close);

  useEffect(() => {
    if (!desktop) return;
    void invoke<Location>("storage_location").then(setLocation);
    void hasKey().then(setKeySaved);
    void claudeStatus().then(setClaude);
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion));
  }, [desktop]);

  const move = async (kind: "default" | "icloud" | "folder") => {
    setMoving(true);
    setMessage(null);
    try {
      const next = await invoke<Location | null>("choose_storage_location", { kind });
      if (next) {
        setLocation(next);
        setMessage("Your boards now live here. The old copies were left where they were.");
        onChanged?.();
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setMoving(false);
    }
  };

  const storeKey = async () => {
    try {
      await saveKey(keyDraft);
      setKeyDraft("");
      setKeySaved(true);
      setMessage("API key saved in your Keychain.");
      void checkAccess(true);
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <>
      <div className={`palette-scrim${leaving ? " is-leaving" : ""}`} onPointerDown={close} />
      <div
        className={`dialog settings${leaving ? " is-leaving" : ""}`}
        role="dialog"
        aria-label="Settings"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="dialog__title">Settings</div>

        <div className="dialog__section">
          <div className="popover__label">Appearance</div>
          <ThemeSwitch labels />
        </div>

        <div className="dialog__section">
          <div className="popover__label">Where your boards are kept</div>
          {!desktop ? (
            <div className="settings__note">This browser preview keeps boards in the browser.</div>
          ) : location ? (
            <>
              <div className="settings__location">
                <strong>{LOCATION_NAMES[location.kind]}</strong>
                <span title={location.path}>{location.path}</span>
              </div>
              <div className="settings__row">
                {location.kind !== "icloud" && (
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={moving || !location.icloudAvailable}
                    title={location.icloudAvailable ? "Sync your boards to your other Macs" : "Turn on iCloud Drive in System Settings first"}
                    onClick={() => void move("icloud")}
                  >
                    Use iCloud Drive
                  </button>
                )}
                <button type="button" className="secondary-btn" disabled={moving} onClick={() => void move("folder")}>
                  Choose a folder…
                </button>
                {location.kind !== "default" && (
                  <button type="button" className="secondary-btn" disabled={moving} onClick={() => void move("default")}>
                    Back to this Mac
                  </button>
                )}
              </div>
              <div className="settings__row">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={moving}
                  onClick={() =>
                    void cleanupFiles().then(
                      (r) =>
                        setMessage(
                          r.files
                            ? `Removed ${r.files} unused picture${r.files === 1 ? "" : "s"} and file${r.files === 1 ? "" : "s"}, freeing ${formatBytes(r.bytes)}.`
                            : "Nothing to clean up. Every picture and file is still in use.",
                        ),
                      (err) => setMessage(`Couldn't clean up: ${err}`),
                    )
                  }
                >
                  Free up space
                </button>
                <span className="settings__note">Removes pictures and files no board, deleted board or version uses any more.</span>
              </div>
              <div className="settings__note">
                Keep boards in iCloud Drive (or any synced folder) to use them on all your Macs. If a board is changed on two Macs at
                once, the other version is kept in its Version history.
              </div>
            </>
          ) : (
            // Room for the details while they load, so the window doesn't jump.
            <div className="settings__loading" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <div className="dialog__section">
          <div className="popover__label">Claude</div>
          {!aiSupported() ? (
            <div className="settings__note">Claude works in the desktop app.</div>
          ) : (
            <>
              <div className="settings__note">Claude can build, organise and restyle your boards. On a board, press {"⌘J"} or click ✨.</div>
              <div className="settings__claude">
                <div className="settings__claude-head">
                  <strong>Your Claude account</strong>
                  <span className="settings__note">through Claude Code</span>
                </div>
                {claude === null ? (
                  <span className="settings__note">Checking…</span>
                ) : !claude.installed ? (
                  <span className="settings__note">
                    Claude Code isn't installed on this Mac.{" "}
                    <button type="button" className="link-btn" onClick={() => void openExternal("https://code.claude.com/docs/en/setup")}>
                      How to install it
                    </button>
                    , then open Terminal, type <code>claude</code> and sign in.
                  </span>
                ) : !claude.signedIn ? (
                  <span className="settings__note">
                    Claude Code is installed but not signed in. Open Terminal, type <code>claude</code> and follow the steps to sign in.
                  </span>
                ) : (
                  <span className="settings__ok">Connected{planName(claude.plan) ? ` · ${planName(claude.plan)}` : ""}</span>
                )}
                <button type="button" className="secondary-btn" onClick={recheck}>
                  Check again
                </button>
              </div>
              <div className="settings__claude-head">
                <strong>Or an Anthropic API key</strong>
              </div>
              {keySaved ? (
                <div className="settings__row">
                  <span className="settings__ok">API key saved in your Keychain</span>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() =>
                      void clearKey().then(() => {
                        setKeySaved(false);
                        setMessage("API key removed.");
                        void checkAccess(true);
                      })
                    }
                  >
                    Remove key
                  </button>
                </div>
              ) : (
                <div className="settings__row">
                  <input
                    className="settings__input"
                    type="password"
                    value={keyDraft}
                    placeholder="Paste your Anthropic API key"
                    aria-label="Anthropic API key"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && keyDraft.trim()) void storeKey();
                    }}
                  />
                  <button type="button" className="primary-btn" disabled={!keyDraft.trim()} onClick={() => void storeKey()}>
                    Save
                  </button>
                </div>
              )}
              {keySaved && claude?.signedIn && (
                <div className="segmented segmented--compact" role="radiogroup" aria-label="Use">
                  {(
                    [
                      ["claude-code", "Use my Claude account"],
                      ["api-key", "Use the API key"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={(engine ?? "claude-code") === id}
                      className={`segmented__item${(engine ?? "claude-code") === id ? " is-active" : ""}`}
                      onClick={() => {
                        setEnginePreference(id);
                        setEngine(id);
                        void checkAccess(true);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="popover__label">Model</div>
              <div className="segmented segmented--compact" role="radiogroup" aria-label="Model">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={model === m.id}
                    className={`segmented__item${model === m.id ? " is-active" : ""}`}
                    title={m.note}
                    onClick={() => {
                      setModel(m.id);
                      setModelState(m.id);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <div className="settings__note">
                When you ask Claude something, the board's text (and a picture of it) is sent to Anthropic to work on. Nothing is sent
                otherwise.
              </div>
            </>
          )}
        </div>

        {desktop && (
          <div className="dialog__section">
            <div className="popover__label">Updates</div>
            <div className="settings__row">
              {update.stage === "available" ? (
                <button type="button" className="primary-btn" onClick={() => void installUpdate()}>
                  Update to {update.version}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={update.stage === "checking" || update.stage === "downloading"}
                  onClick={() => void checkForUpdate()}
                >
                  {update.stage === "checking" ? "Checking…" : "Check for updates"}
                </button>
              )}
              <span className="settings__note">
                {update.stage === "current"
                  ? "You have the latest version."
                  : update.stage === "downloading"
                    ? `Downloading ${update.version}${update.percent === null ? "…" : ` (${update.percent}%)`}`
                    : update.stage === "error"
                      ? update.message
                      : ""}
              </span>
            </div>
            <label className="settings__check">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => {
                  setAutoCheck(e.target.checked);
                  setAutoUpdate(e.target.checked);
                }}
              />
              Check for new versions automatically
            </label>
          </div>
        )}

        {message && <div className="settings__message">{message}</div>}

        <div className="dialog__actions">
          <span className="settings__version">{version && `Mythra Board ${version}`}</span>
          <span className="dialog__spacer" />
          <button type="button" className="primary-btn" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}

/** A friendly name for a Claude plan. */
function planName(plan: string | null): string {
  switch ((plan ?? "").toLowerCase()) {
    case "max":
      return "Max plan";
    case "pro":
      return "Pro plan";
    case "team":
      return "Team plan";
    case "enterprise":
      return "Enterprise plan";
    case "":
      return "";
    default:
      return "Claude account";
  }
}
