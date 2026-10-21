import { memo, type ReactNode } from "react";
import { findBoardByTitle, findOnBoard, openBoardByTitle, useBoardIndex } from "../navigation";
import { openExternal } from "../persistence";

/** A [[Board name]] link: opens that board, or creates it if it doesn't exist yet. */
function BoardLinkChip({ name }: { name: string }) {
  const exists = useBoardIndex((s) => s.loaded && !!findBoardByTitle(name));
  return (
    <button
      type="button"
      className={`rt-board nodrag${exists ? "" : " is-new"}`}
      title={exists ? `Open “${name}”` : `Create and open a board called “${name}”`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void openBoardByTitle(name);
      }}
    >
      {name}
    </button>
  );
}

const TASK = /^\s*[-*] \[( |x|X)\] ?(.*)$/;
const BULLET = /^\s*[-*•] (.*)$/;
const NUMBERED = /^\s*(\d+)[.)] (.*)$/;
const HEADING = /^(#{1,3}) (.*)$/;
const QUOTE = /^> ?(.*)$/;
const INLINE = /(\[\[[^\]\n]+\]\]|\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|(?<![\w#/&])#[A-Za-z][\w-]{0,40})/g;

export function taskStats(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of text.split("\n")) {
    const m = TASK.exec(line);
    if (!m) continue;
    total++;
    if (m[1] !== " ") done++;
  }
  return { done, total };
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const t = m[0];
    const i = m.index!;
    if (i > last) out.push(text.slice(last, i));
    if (t.startsWith("[[")) out.push(<BoardLinkChip key={i} name={t.slice(2, -2)} />);
    else if (t.startsWith("#"))
      out.push(
        <button
          key={i}
          type="button"
          className="rt-tag nodrag"
          title={`Find ${t} on this board`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            findOnBoard(t);
          }}
        >
          {t}
        </button>,
      );
    else if (t.startsWith("**")) out.push(<strong key={i}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("~~")) out.push(<s key={i}>{t.slice(2, -2)}</s>);
    else if (t.startsWith("`")) out.push(<code key={i}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("*")) out.push(<em key={i}>{t.slice(1, -1)}</em>);
    else
      out.push(
        <a
          key={i}
          className="rt-link nodrag"
          href={t}
          title={`Open ${t}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void openExternal(t);
          }}
        >
          {t}
        </a>,
      );
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Notes are plain text with a little Markdown: `# headings`, `- bullets`, `- [ ] tasks`,
 * `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` and clickable web addresses.
 */
function RichText({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        let m: RegExpExecArray | null;
        if ((m = TASK.exec(line))) {
          const done = m[1] !== " ";
          return (
            <div key={i} className={`rt-task${done ? " is-done" : ""}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                className="rt-check nodrag"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle?.(i);
                }}
              />
              <span>{inline(m[2]) }</span>
            </div>
          );
        }
        if ((m = HEADING.exec(line))) {
          return (
            <div key={i} className={`rt-h${m[1].length}`}>
              {inline(m[2])}
            </div>
          );
        }
        if ((m = BULLET.exec(line))) {
          return (
            <div key={i} className="rt-bullet">
              <span className="rt-marker">•</span>
              <span>{inline(m[1])}</span>
            </div>
          );
        }
        if ((m = NUMBERED.exec(line))) {
          return (
            <div key={i} className="rt-bullet">
              <span className="rt-marker rt-number">{m[1]}.</span>
              <span>{inline(m[2])}</span>
            </div>
          );
        }
        if ((m = QUOTE.exec(line))) {
          return (
            <div key={i} className="rt-quote">
              {inline(m[1])}
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="rt-gap" />;
        return <div key={i}>{inline(line)}</div>;
      })}
    </>
  );
}

export default memo(RichText);
