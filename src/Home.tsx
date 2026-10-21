import { useEffect, useMemo, useRef, useState } from "react";
import { DuplicateIcon, MoreIcon, PlusIcon, RenameIcon, SearchIcon, StarIcon, TrashIcon } from "./components/icons";
import { ThemeSwitch } from "./components/ThemeSwitch";
import Thumbnail from "./components/Thumbnail";
import { createBoard, makeBoardDoc, refreshBoardIndex, updateIndexedBoard } from "./navigation";
import { isTauri, newBoardId, restoreBoard, trashBoard, writeBoard } from "./persistence";
import type { BoardDoc } from "./store";
import { TEMPLATES, type Template } from "./templates";

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
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshBoardIndex().then(setBoards, (err) => {
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
    const doc = makeBoardDoc(t.id === "blank" ? "Untitled board" : t.name, { nodes, edges, background: t.background });
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const replace = (doc: BoardDoc) => setBoards((bs) => bs && bs.map((b) => (b.id === doc.id ? doc : b)));

  const update = async (doc: BoardDoc, patch: Partial<BoardDoc>) => {
    const next = { ...doc, ...patch };
    replace(next);
    try {
      await writeBoard(next);
      updateIndexedBoard(next);
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
        />
      ))}
    </div>
  );

  return (
    <div className={`app home${isTauri() ? " is-tauri" : ""}`}>
      {isTauri() && <div className="drag-strip" data-tauri-drag-region />}
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
          <button type="button" className="primary-btn" onClick={() => void create(TEMPLATES[0])} title="New board (⌘N)">
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
      </div>

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

function TemplateCard({ template, onPick }: { template: Template; onPick: () => void }) {
  const preview = useMemo(() => template.build(), [template]);
  return (
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
  onDelete: () => void;
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
