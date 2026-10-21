import { useEffect, useState } from "react";
import { AI_MODELS, aiSupported, clearKey, getModel, hasKey, saveKey, setModel, type AiModel } from "../ai";
import { formatBytes } from "../images";
import { cleanupFiles, isTauri } from "../persistence";
import { autoCheckEnabled, checkForUpdate, installUpdate, setAutoCheck, useUpdateState } from "../updates";
import { useEscape } from "../useDismiss";
import { ThemeSwitch } from "./ThemeSwitch";

type Location = { path: string; kind: "default" | "icloud" | "custom"; icloudAvailable: boolean };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const LOCATION_NAMES = { default: "On this Mac", icloud: "iCloud Drive", custom: "A folder you chose" };

/** App-wide settings: appearance, where boards are kept, and AI. */
export function SettingsDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const desktop = isTauri();
  const [location, setLocation] = useState<Location | null>(null);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModelState] = useState<AiModel>(getModel());
  const [version, setVersion] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(autoCheckEnabled);
  const update = useUpdateState();
  useEscape(onClose);

  useEffect(() => {
    if (!desktop) return;
    void invoke<Location>("storage_location").then(setLocation);
    void hasKey().then(setKeySaved);
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
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <>
      <div className="palette-scrim" onPointerDown={onClose} />
      <div
        className="dialog settings"
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
          ) : null}
        </div>

        <div className="dialog__section">
          <div className="popover__label">AI (Claude)</div>
          {!aiSupported() ? (
            <div className="settings__note">AI features work in the desktop app.</div>
          ) : (
            <>
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
              <div className="segmented segmented--compact">
                {AI_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
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
                Get a key at console.anthropic.com. When you use an AI action, the text of the notes involved is sent to Anthropic's
                Claude; nothing is sent otherwise.
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
          <button type="button" className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
