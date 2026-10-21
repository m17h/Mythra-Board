import { useEffect, useMemo, useRef, useState } from "react";
import { DuplicateIcon, FileIcon, MoreIcon, SettingsIcon, PlusIcon, RenameIcon, SearchIcon, StarIcon, TrashIcon } from "./components/icons";
import { SettingsDialog } from "./components/SettingsDialog";
import { markKeyHandled, onMenu } from "./menuEvents";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { isMac, keyLabel } from "./platform";
import Thumbnail from "./components/Thumbnail";
import {
  boardIndex,
  createBoard,
  makeBoardDoc,
  openBoardAt,
  refreshBoardIndex,
  renameLinks,
  tagsIn,
  updateIndexedBoard,
} from "./navigation";
import { exportBoardFile, importBoardFile } from "./boardFile";
import { deleteTemplate, listTemplates, saveTemplate } from "./persistence";
import { isTauri, newBoardId, pickBoardFile, restoreBoard, trashBoard, writeBoard } from "./persistence";
import type { BoardDoc } from "./store";
import { customTemplate, saveAsTemplate, TEMPLATES, welcomeBoard, type Template } from "./templates";
import { TrashDialog } from "./components/TrashDialog";

const WELCOMED_KEY = "mythra-board:welcomed";

type Sort = "recent" | "name" | "created";
type Toast = { message: string; undo?: () => void };

const SORT_NAMES: Record<Sort, string> = { recent: "Last edited", name: "Name", created: "Date created" };

export function timeAgo(t: number, now = Date.now()): string {
  if (!t) return "Never edited";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "Edited just now";
  if (s < 3600) return `Edited ${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `Edited ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (s < 2 * 86400) return "Edited yesterday";
  if (s < 7 * 86400) return `Edited ${Math.floor(s / 86400)} days ago`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `Edited ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })}`;
}

const countLabel = (doc: BoardDoc) => {
  const n = doc.nodes.length;
  return n === 0 ? "Empty" : `${n} item${n === 1 ? "" : "s"}`;
};

export default function Home({ onOpen }: { onOpen: (doc: BoardDoc) => void }) {
  const [boards, setBoards] = useState<BoardDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [mine, setMine] = useState<Template[]>([]);
  const loadMine = () => listTemplates().then((t) => setMine(t.map(customTemplate)), () => setMine([]));
  useEffect(() => {
    void loadMine();
  }, []);

  const makeTemplate = async (doc: BoardDoc) => {
    try {
      await saveAsTemplate(doc);
      await loadMine();
      setToast({ message: `Saved “${doc.title}” as a template` });
    } catch (err) {
      console.error(err);
      setToast({ message: "Couldn't save the template" });
    }
  };

  const removeTemplate = async (t: Template) => {
    if (!t.customId) return;
    const kept = (await listTemplates()).find((d) => d.id === t.customId);
    await deleteTemplate(t.customId);
    await loadMine();
    setToast({
      message: `Removed the “${t.name}” template`,
      undo: kept
        ? async () => {
            await saveTemplate(kept);
            await loadMine();
            setToast(null);
          }
        : undefined,
    });
  };
  useEffect(
    () =>
      onMenu((id) => {
        if (id !== "settings") return false;
        setSettingsOpen(true);
        return true;
      }),
    [],
  );
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshBoardIndex().then(async (list) => {
      // The very first time the app opens, start with a short hands-on tour.
      if (!list.length && !localStorage.getItem(WELCOMED_KEY)) {
        localStorage.setItem(WELCOMED_KEY, "1");
        const { nodes, edges } = welcomeBoard();
        try {
          const doc = await createBoard(makeBoardDoc("Welcome to Mythra Board", { nodes, edges }));
          onOpen(doc);
          return;
        } catch (err) {
          console.error("Couldn't create the welcome board", err);
        }
      }
      setBoards(list);
    }, (err) => {
      console.error(err);
      setError(true);
      setBoards([]);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const create = async (t: Template) => {
    const { nodes, edges } = t.build();
    const doc = makeBoardDoc(t.id === "blank" ? "Untitled board" : t.name, { nodes, edges, background: t.background, style: t.style });
    try {
      await createBoard(doc);
      onOpen(doc);
    } catch (err) {
      console.error(err);
      setToast({ message: "Couldn't create the board" });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void create(TEMPLATES[0]);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openFile();
      } else {
        return;
      }
      markKeyHandled();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openFile = async () => {
    try {
      const text = await pickBoardFile();
      if (!text) return;
      const doc = await importBoardFile(text);
      onOpen(doc);
    } catch (err) {
      console.error(err);
      setToast({ message: err instanceof Error ? err.message : "Couldn't open that file" });
    }
  };

  const saveCopy = async (doc: BoardDoc) => {
    try {
      if (await exportBoardFile(doc)) setToast({ message: `Saved “${doc.title}” as a board file` });
    } catch (err) {
      console.error(err);
      setToast({ message: "Couldn't save the board file" });
    }
  };

  const replace = (doc: BoardDoc) => setBoards((bs) => bs && bs.map((b) => (b.id === doc.id ? doc : b)));

  const update = async (doc: BoardDoc, patch: Partial<BoardDoc>) => {
    const next = { ...doc, ...patch };
    replace(next);
    try {
      await writeBoard(next);
      updateIndexedBoard(next);
      if (patch.title !== undefined && (await renameLinks(doc.title, patch.title, doc.id))) setBoards(boardIndex());
    } catch (err) {
      console.error(err);
      replace(doc);
      setToast({ message: "Couldn't save that change" });
    }
  };

  const duplicate = async (doc: BoardDoc) => {
    const now = Date.now();
    const copy: BoardDoc = { ...doc, id: newBoardId(), title: `${doc.title} copy`, createdAt: now, updatedAt: now, pinned: false };
    try {
      await writeBoard(copy);
      updateIndexedBoard(copy);
      setBoards((bs) => bs && [copy, ...bs]);
    } catch (err) {
      console.error(err);
      setToast({ message: "Couldn't duplicate the board" });
    }
  };

  const remove = async (doc: BoardDoc) => {
    try {
      await trashBoard(doc.id);
    } catch (err) {
      console.error(err);
      setToast({ message: "Couldn't delete the board" });
      return;
    }
    setBoards((bs) => bs && bs.filter((b) => b.id !== doc.id));
    setToast({
      message: `Deleted “${doc.title}”`,
      undo: async () => {
        await restoreBoard(doc.id);
        setBoards((bs) => bs && [doc, ...bs.filter((b) => b.id !== doc.id)]);
        setToast(null);
      },
    });
  };

  const visible = useMemo(() => {
    if (!boards) return [];
    const q = query.trim().toLowerCase();
    const matches = q
      ? boards.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.nodes.some((n) =>
              [n.data.text, n.data.title, n.data.url].some((t) => t?.toLowerCase().includes(q)),
            ),
        )
      : boards;
    const sorted = [...matches].sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        : sort === "created"
          ? b.createdAt - a.createdAt
          : b.updatedAt - a.updatedAt,
    );
    return sorted;
  }, [boards, query, sort]);

  // Individual notes that match the search, so you can jump straight to them.
  const noteHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!boards || q.length < 2) return [];
    const hits: { board: BoardDoc; id: string; title?: string; snippet: string }[] = [];
    for (const b of boards) {
      for (const n of b.nodes) {
        const text = [n.data.title, n.data.text].filter(Boolean).join(" — ");
        const at = text.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const from = Math.max(0, at - 40);
        const snippet = (from ? "…" : "") + text.slice(from, at + q.length + 70).replace(/\s+/g, " ") + (at + q.length + 70 < text.length ? "…" : "");
        hits.push({ board: b, id: n.id, title: n.data.title, snippet });
        if (hits.length >= 40) return hits;
      }
    }
    return hits;
  }, [boards, query]);

  // Every #tag across all boards, most used first.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of boards ?? []) for (const n of b.nodes) for (const t of tagsIn(`${n.data.title ?? ""} ${n.data.text}`)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  }, [boards]);

  const pinned = visible.filter((b) => b.pinned);
  const others = visible.filter((b) => !b.pinned);
  const searching = query.trim().length > 0;

  const grid = (docs: BoardDoc[]) => (
    <div className="board-grid">
      {docs.map((doc) => (
        <BoardCard
          key={doc.id}
          doc={doc}
          renaming={renamingId === doc.id}
          menuOpen={menuId === doc.id}
          onOpen={() => onOpen(doc)}
          onMenu={(open) => setMenuId(open ? doc.id : null)}
          onRename={(title) => {
            setRenamingId(null);
            if (title !== null && title.trim() && title.trim() !== doc.title) void update(doc, { title: title.trim() });
          }}
          onStartRename={() => {
            setMenuId(null);
            setRenamingId(doc.id);
          }}
          onPin={() => void update(doc, { pinned: !doc.pinned })}
          onDuplicate={() => {
            setMenuId(null);
            void duplicate(doc);
          }}
          onDelete={() => {
            setMenuId(null);
            void remove(doc);
          }}
          onExport={() => {
            setMenuId(null);
            void saveCopy(doc);
          }}
          onTemplate={() => {
            setMenuId(null);
            void makeTemplate(doc);
          }}
        />
      ))}
    </div>
  );

  return (
    <div className={`app home${isTauri() ? " is-tauri" : ""}${isMac ? " is-mac" : ""}`}>
      {isTauri() && isMac && <div className="drag-strip" data-tauri-drag-region />}
      <div className="home__inner">
        <header className="home__header">
          <div className="brand">
            <span className="brand__mark" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            Mythra Board
          </div>
          <label className="search">
            <SearchIcon />
            <input
              ref={search}
              value={query}
              placeholder="Search boards and notes"
              aria-label="Search boards and notes"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && visible[0]) onOpen(visible[0]);
              }}
            />
          </label>
          <ThemeSwitch />
          <button type="button" className="secondary-btn secondary-btn--icon secondary-btn--square" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <SettingsIcon />
          </button>
          <button type="button" className="secondary-btn secondary-btn--icon" onClick={() => void openFile()} title={keyLabel("Open a board file (⌘O)")}>
            <FileIcon />
            Open file
          </button>
          <button type="button" className="primary-btn" onClick={() => void create(TEMPLATES[0])} title={keyLabel("New board (⌘N)")}>
            <PlusIcon />
            New board
          </button>
        </header>

        {!searching && (
          <section>
            <h2 className="section-title">Start something new</h2>
            <div className="template-row">
              {TEMPLATES.map((t) => (
                <TemplateCard key={t.id} template={t} onPick={() => void create(t)} />
              ))}
              {mine.map((t) => (
                <TemplateCard key={t.id} template={t} onPick={() => void create(t)} onRemove={() => void removeTemplate(t)} />
              ))}
            </div>
          </section>
        )}

        {tags.length > 0 && (
          <div className="tag-row" role="group" aria-label="Tags">
            {tags.map(([t, n]) => (
              <button
                key={t}
                type="button"
                className={`tag-chip${query.trim().toLowerCase() === `#${t}` ? " is-active" : ""}`}
                onClick={() => setQuery(query.trim().toLowerCase() === `#${t}` ? "" : `#${t}`)}
              >
                #{t} <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {noteHits.length > 0 && (
          <section>
            <h2 className="section-title">In your notes</h2>
            <div className="note-hits">
              {noteHits.map((h) => (
                <button key={`${h.board.id}:${h.id}`} type="button" className="note-hit" onClick={() => void openBoardAt(h.board.id, h.id)}>
                  <span className="note-hit__board">{h.board.title}</span>
                  <span className="note-hit__text">{h.snippet}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {boards === null ? null : boards.length === 0 ? (
          <div className="home-empty">
            {error ? "Your boards couldn't be read. Nothing has been changed on disk." : "Your boards will show up here. Pick a template above to begin."}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section>
                <h2 className="section-title">Pinned</h2>
                {grid(pinned)}
              </section>
            )}
            <section>
              <div className="section-head">
                <h2 className="section-title">{searching ? `Results for “${query.trim()}”` : pinned.length ? "Other boards" : "Your boards"}</h2>
                <label className="sort">
                  Sort by
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    {(Object.keys(SORT_NAMES) as Sort[]).map((s) => (
                      <option key={s} value={s}>
                        {SORT_NAMES[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {others.length ? grid(others) : <div className="home-empty">{searching ? "No boards match your search." : "No other boards yet."}</div>}
            </section>
          </>
        )}
        <footer className="home__footer">
          <button type="button" className="link-btn" onClick={() => setTrashOpen(true)}>
            <TrashIcon /> Recently deleted
          </button>
        </footer>
      </div>

      {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} onRestored={() => setBoards(boardIndex())} />}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} onChanged={() => void refreshBoardIndex().then(setBoards)} />
      )}
      {menuId && <div className="menu-scrim" onPointerDown={() => setMenuId(null)} />}
      {toast && (
        <div className="toast" role="status">
          {toast.message}
          {toast.undo && (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, onPick, onRemove }: { template: Template; onPick: () => void; onRemove?: () => void }) {
  const preview = useMemo(() => template.build(), [template]);
  return (
    <div className="template-card-wrap">
      {onRemove && (
        <button
          type="button"
          className="card-btn template-card__remove"
          title="Remove this template"
          aria-label={`Remove the ${template.name} template`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
      <button type="button" className="template-card" onClick={onPick}>
      <div className={`template-card__preview bg--${template.background}`}>
        {template.id === "blank" ? (
          <span className="template-card__plus">
            <PlusIcon />
          </span>
        ) : (
          <Thumbnail nodes={preview.nodes} edges={preview.edges} />
        )}
      </div>
      <div className="template-card__name">{template.name}</div>
      <div className="template-card__desc">{template.description}</div>
      </button>
    </div>
  );
}

function BoardCard({
  doc,
  renaming,
  menuOpen,
  onOpen,
  onMenu,
  onRename,
  onStartRename,
  onPin,
  onDuplicate,
  onDelete,
  onExport,
  onTemplate,
}: {
  doc: BoardDoc;
  renaming: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: (open: boolean) => void;
  onRename: (title: string | null) => void;
  onStartRename: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onTemplate: () => void;
}) {
  return (
    <div className={`board-card${menuOpen ? " is-menu-open" : ""}`}>
      <button type="button" className={`board-card__preview bg--${doc.background}`} onClick={onOpen} aria-label={`Open ${doc.title}`}>
        <Thumbnail nodes={doc.nodes} edges={doc.edges} />
      </button>
      <div className="board-card__meta">
        {renaming ? (
          <input
            className="board-card__rename"
            defaultValue={doc.title}
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onRename(null);
            }}
          />
        ) : (
          <button type="button" className="board-card__title" onClick={onOpen} onDoubleClick={onStartRename} title={doc.title}>
            {doc.title}
          </button>
        )}
        <div className="board-card__sub">
          {timeAgo(doc.updatedAt)} · {countLabel(doc)}
        </div>
      </div>
      <div className="board-card__actions">
        <button
          type="button"
          className={`card-btn${doc.pinned ? " is-on" : ""}`}
          title={doc.pinned ? "Unpin" : "Pin to top"}
          aria-label={doc.pinned ? "Unpin" : "Pin to top"}
          onClick={onPin}
        >
          <StarIcon filled={doc.pinned} />
        </button>
        <div className="menu-anchor">
          <button type="button" className="card-btn" title="More" aria-label="More options" onClick={() => onMenu(!menuOpen)}>
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="menu menu--card" role="menu">
              <button type="button" role="menuitem" className="menu__item" onClick={onStartRename}>
                <RenameIcon /> Rename
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={onDuplicate}>
                <DuplicateIcon /> Duplicate
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={onExport}>
                <FileIcon /> Save as board file…
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={onTemplate}>
                <DuplicateIcon /> Save as template
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={onPin}>
                <StarIcon /> {doc.pinned ? "Unpin" : "Pin to top"}
              </button>
              <div className="menu__sep" />
              <button type="button" role="menuitem" className="menu__item is-danger" onClick={onDelete}>
                <TrashIcon /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
