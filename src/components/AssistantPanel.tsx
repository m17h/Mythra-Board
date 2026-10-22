import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { checkAccess, QUICK, type Access } from "../assistant/ask";
import { chat, getModel, MODELS, resetChat, send, setModel, stop, useChat, type Model, type Part, type Turn } from "../assistant/run";
import { openExternal } from "../persistence";
import { boardStore, useBoard } from "../store";
import { SparkleIcon } from "./icons";

const INSTALL_URL = "https://code.claude.com/docs/en/setup";

/** Ideas for a first message: things to build on an empty board, things to do with a full one. */
const START: [string, string, boolean][] = [
  ["Plan a trip", "Plan a trip to ", false],
  ["Mind map an idea", "Make a mind map about ", false],
  ["Map out a process", "Draw a flowchart of how ", false],
  ["Plan a project", "Make a project plan for ", false],
];
const WORK: [string, string, boolean][] = [
  ["Organise this board", QUICK.organise, true],
  ["Make it look polished", QUICK.polish, true],
  ["Summarise it", QUICK.summarise, true],
  ["What's missing?", "What's missing from this board? Add notes for the most important gaps, and mark them so they're easy to spot.", true],
];

/** The Claude panel: a conversation down the right of the board. */
export function AssistantPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const open = useChat((s) => s.open);
  return open ? <Panel onOpenSettings={onOpenSettings} /> : null;
}

function Panel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const turns = useChat((s) => s.turns);
  const running = useChat((s) => s.running);
  const itemCount = useBoard((s) => s.nodes.length);
  const [access, setAccess] = useState<Access | null>(null);
  const [draft, setDraft] = useState("");
  const [model, setModelState] = useState<Model>(getModel());
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // Take the keyboard straight away (so typing, or Escape, goes to the panel).
    panel.current?.focus();
    void checkAccess().then((a) => {
      setAccess(a);
      requestAnimationFrame(() => input.current?.focus());
    });
  }, []);

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Grow the box with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [draft]);

  const close = () => chat.setState({ open: false });
  const submit = (text = draft) => {
    if (!text.trim() || running || !access?.engine) return;
    void send(text, access.engine);
    setDraft("");
  };
  const recheck = () => {
    setAccess(null);
    void checkAccess(true).then(setAccess);
  };

  const ideas = itemCount ? WORK : START;
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="assistant"
      aria-label="Claude"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !running) close();
      }}
    >
      <header className="assistant__head">
        <span className="assistant__mark" aria-hidden>
          <SparkleIcon />
        </span>
        <span className="assistant__title">Claude</span>
        <span className="assistant__spacer" />
        {turns.length > 0 && (
          <button type="button" className="assistant__head-btn" disabled={running} onClick={resetChat} title="Start a new conversation">
            New chat
          </button>
        )}
        <button type="button" className="help-panel__close" onClick={close} aria-label="Close" title="Close (Esc)">
          ×
        </button>
      </header>

      <div className="assistant__body" ref={list} aria-live="polite">
        {access === null ? (
          <div className="assistant__empty">Checking for Claude…</div>
        ) : !access.engine ? (
          <Setup access={access} onRecheck={recheck} onOpenSettings={onOpenSettings} />
        ) : turns.length === 0 ? (
          <div className="assistant__empty">
            <p className="assistant__intro">
              {itemCount
                ? "Ask Claude to organise, restyle, extend or explain this board."
                : "Describe what you'd like and Claude will build the board for you."}
            </p>
            <div className="assistant__ideas">
              {ideas.map(([label, text, now]) => (
                <button
                  key={label}
                  type="button"
                  className="assistant__idea"
                  onClick={() => {
                    if (now) submit(text);
                    else {
                      setDraft(text);
                      requestAnimationFrame(() => {
                        const el = input.current;
                        el?.focus();
                        el?.setSelectionRange(text.length, text.length);
                      });
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => <TurnView key={i} turn={t} last={i === turns.length - 1} />)
        )}
      </div>

      {access?.engine && (
        <footer className="assistant__foot">
          <div className="assistant__compose">
            <textarea
              ref={input}
              className="assistant__input"
              value={draft}
              rows={1}
              placeholder={running ? "Claude is working…" : turns.length ? "Ask for changes…" : "What should Claude make?"}
              aria-label="Message to Claude"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {running ? (
              <button type="button" className="assistant__send is-stop" onClick={() => void stop()} aria-label="Stop" title="Stop">
                <span className="assistant__stop-square" />
              </button>
            ) : (
              <button type="button" className="assistant__send" disabled={!draft.trim()} onClick={() => submit()} aria-label="Send" title="Send (Return)">
                ↑
              </button>
            )}
          </div>
          <div className="assistant__meta">
            <span>{access.engine === "api-key" ? "Using your API key" : `Your Claude account${planLabel(access.status.plan)}`}</span>
            <select
              className="assistant__model"
              value={model}
              aria-label="Model"
              disabled={running}
              onChange={(e) => {
                const m = e.target.value as Model;
                setModel(m);
                setModelState(m);
              }}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </footer>
      )}
    </aside>
  );
}

const planLabel = (plan: string | null) => {
  const p = (plan ?? "").toLowerCase();
  return p === "max" ? " · Max" : p === "pro" ? " · Pro" : p === "team" ? " · Team" : p === "enterprise" ? " · Enterprise" : "";
};

function Setup({ access, onRecheck, onOpenSettings }: { access: Access; onRecheck: () => void; onOpenSettings: () => void }) {
  const { status } = access;
  return (
    <div className="assistant__setup">
      <p>Claude can build boards for you, organise messy ones and tidy up the details. It uses your own Claude account, through Claude Code.</p>
      <ol>
        <li className={status.installed ? "is-done" : ""}>
          {status.installed ? (
            "Claude Code is installed."
          ) : (
            <>
              Install Claude Code.{" "}
              <button type="button" className="link-btn" onClick={() => void openExternal(INSTALL_URL)}>
                Show me how
              </button>
            </>
          )}
        </li>
        <li className={status.signedIn ? "is-done" : ""}>
          Open Terminal, type <code>claude</code> and sign in with your Claude account.
        </li>
        <li>Come back here and check again.</li>
      </ol>
      <div className="assistant__setup-actions">
        <button type="button" className="primary-btn" onClick={onRecheck}>
          Check again
        </button>
        <button type="button" className="secondary-btn" onClick={onOpenSettings}>
          Use an API key instead
        </button>
      </div>
    </div>
  );
}

function TurnView({ turn, last }: { turn: Turn; last: boolean }) {
  if (turn.role === "user") return <div className="assistant__msg assistant__msg--user">{turn.text}</div>;
  // Group runs of steps together between Claude's words.
  const blocks: (Part | Part[])[] = [];
  for (const p of turn.parts) {
    const prev = blocks[blocks.length - 1];
    if (p.type === "step" && Array.isArray(prev)) prev.push(p);
    else blocks.push(p.type === "step" ? [p] : p);
  }
  return (
    <div className="assistant__msg assistant__msg--claude">
      {blocks.map((b, i) =>
        Array.isArray(b) ? (
          <ul key={i} className="assistant__steps">
            {b.map((s) =>
              s.type === "step" ? (
                <li key={s.id} className={`assistant__step is-${s.state}`}>
                  <span className="assistant__step-icon" aria-hidden />
                  {s.label}
                </li>
              ) : null,
            )}
          </ul>
        ) : b.type === "text" ? (
          <div key={i} className="assistant__text">
            {formatReply(b.text)}
          </div>
        ) : null,
      )}
      {turn.status === "running" && turn.parts.length === 0 && <div className="assistant__thinking">Thinking…</div>}
      {turn.status === "running" && turn.parts.length > 0 && <div className="assistant__thinking">Working…</div>}
      {turn.status === "stopped" && <div className="assistant__note">Stopped. What Claude did so far is still on the board.</div>}
      {turn.status === "error" && <div className="assistant__error">{turn.error}</div>}
      {last && <UndoRun turn={turn} />}
    </div>
  );
}

/** Undo everything Claude just did, while nothing else has changed since. */
function UndoRun({ turn }: { turn: Turn }) {
  const board = useBoard((s) => s.boardId);
  const past = useBoard((s) => s.past.length);
  if (turn.role !== "assistant" || !turn.undoMark || turn.status === "running") return null;
  const { boardId, past: mark } = turn.undoMark;
  const changed = turn.parts.some((p) => p.type === "step" && !/^(Reading|Looking)/.test(p.label));
  if (!changed || board !== boardId || past !== mark || past === 0) return null;
  return (
    <button type="button" className="assistant__undo" onClick={() => boardStore.getState().undo()}>
      Undo Claude's changes
    </button>
  );
}

/** Claude's replies: paragraphs, bullet lists and **bold**. */
function formatReply(text: string): ReactNode {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={out.length}>{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) bullets.push(bullet[2]);
    else {
      flush();
      if (line) out.push(<p key={out.length}>{bold(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return out;
}
