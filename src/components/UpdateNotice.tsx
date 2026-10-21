import { dismissUpdate, installUpdate, useUpdateState } from "../updates";

/** A small card in the corner when a new version of the app is ready. */
export function UpdateNotice() {
  const update = useUpdateState();
  if (update.stage !== "available" && update.stage !== "downloading" && update.stage !== "error") return null;
  return (
    <div className="update-notice" role="status">
      {update.stage === "available" && (
        <>
          <div className="update-notice__text">
            <strong>Mythra Board {update.version} is ready</strong>
            <span>Your boards are saved first, then the app restarts.</span>
          </div>
          <button type="button" className="primary-btn" onClick={() => void installUpdate()}>
            Update
          </button>
        </>
      )}
      {update.stage === "downloading" && (
        <div className="update-notice__text">
          <strong>Updating to {update.version}…</strong>
          <span>{update.percent === null ? "Downloading" : `Downloading ${update.percent}%`}</span>
        </div>
      )}
      {update.stage === "error" && (
        <div className="update-notice__text">
          <span>{update.message}</span>
        </div>
      )}
      {update.stage !== "downloading" && (
        <button type="button" className="help-panel__close" title="Not now" aria-label="Not now" onClick={dismissUpdate}>
          ×
        </button>
      )}
    </div>
  );
}
