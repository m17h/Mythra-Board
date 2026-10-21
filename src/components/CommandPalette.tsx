import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type Command = {
  id: string;
  label: string;
  group: string;
  run: () => void;
  keys?: string;
  icon?: ReactNode;
  /** Extra words that should find this command. */
  keywords?: string;
  /** Shown faintly after the label (e.g. "12 items"). */
  detail?: string;
};

/**
 * How well `query` matches `text`: every query letter must appear in order. Matches at the
 * start of words and runs of consecutive letters score higher. Null means no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-_/(]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + run * 2 - Math.min(found - ti, 5) * 0.2;
    ti = found + 1;
  }
  // Prefer shorter labels when scores tie.
  return score - t.length * 0.01;
}

export function CommandPalette({
  commands,
  placeholder = "Type a command or search…",
  dynamic,
  onClose,
}: {
  commands: Command[];
  placeholder?: string;
  /** Commands that depend on what's typed (e.g. "Create a board called …"). */
  dynamic?: (query: string) => Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: fuzzyScore(query, `${c.label} ${c.group} ${c.keywords ?? ""}`) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null);
    if (query.trim()) scored.sort((a, b) => b.s - a.s);
    const extra = dynamic?.(query.trim()) ?? [];
    return [...scored.map((x) => x.c), ...extra].slice(0, 60);
  }, [commands, dynamic, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".palette__item.is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette close (and focus return) before the command runs.
    requestAnimationFrame(() => c.run());
  };

  // Group headings only make sense when showing everything in its natural order.
  const grouped = !query.trim();

  return (
    <>
      <div className="palette-scrim" onPointerDown={onClose} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          className="palette__input"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[active]);
            }
          }}
        />
        <div ref={list} className="palette__list" role="listbox">
          {results.length === 0 && <div className="palette__empty">Nothing matches “{query}”</div>}
          {results.map((c, i) => (
            <div key={c.id}>
              {grouped && (i === 0 || results[i - 1].group !== c.group) && <div className="palette__group">{c.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`palette__item${i === active ? " is-active" : ""}`}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(c)}
              >
                <span className="palette__icon">{c.icon}</span>
                <span className="palette__label">{c.label}</span>
                {c.detail && <span className="palette__detail">{c.detail}</span>}
                {c.keys && <kbd className="menu__keys">{c.keys}</kbd>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
