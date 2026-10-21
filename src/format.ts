/** Text plus where the selection is, for formatting commands. */
export type Edit = { text: string; start: number; end: number };

export type InlineStyle = "bold" | "italic" | "strike" | "code" | "link";
export type LineStyle = "heading" | "bullet" | "number" | "task";

const MARKERS: Record<InlineStyle, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
  link: ["[[", "]]"],
};

const LINE_PREFIX = /^(\s*)(#{1,3} |[-*•] \[[ xX]\] |[-*•] |\d+[.)] )?/;

/**
 * Wrap the selection in a style's markers (or remove them if it's already wrapped).
 * With nothing selected, the markers go in with the cursor between them.
 */
export function toggleInline(edit: Edit, style: InlineStyle): Edit {
  let { start } = edit;
  const { text, end } = edit;
  // Never wrap a line's bullet or checkbox marker: start after it.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const prefix = LINE_PREFIX.exec(text.slice(lineStart))![0].length;
  if (start < lineStart + prefix && end > lineStart + prefix) start = lineStart + prefix;
  const [open, close] = MARKERS[style];
  const before = text.slice(0, start);
  const sel = text.slice(start, end);
  const after = text.slice(end);
  // Already wrapped just outside the selection: unwrap.
  // (Bold's "**" also ends in "*", so italic must not mistake bold for italic.)
  const outside =
    before.endsWith(open) && after.startsWith(close) && !(style === "italic" && before.endsWith("**") && after.startsWith("**"));
  if (outside) {
    return { text: before.slice(0, -open.length) + sel + after.slice(close.length), start: start - open.length, end: end - open.length };
  }
  // The selection itself includes the markers: unwrap.
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close) && !(style === "italic" && sel.startsWith("**"))) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  return { text: before + open + sel + close + after, start: start + open.length, end: end + open.length };
}

/** The start of each line touched by the selection. */
function lineStarts(text: string, start: number, end: number): number[] {
  const first = text.lastIndexOf("\n", start - 1) + 1;
  const starts = [first];
  for (let i = text.indexOf("\n", first); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

const prefixFor = (style: LineStyle, n: number) =>
  style === "heading" ? "# " : style === "bullet" ? "- " : style === "task" ? "- [ ] " : `${n}. `;

const isStyle = (prefix: string, style: LineStyle) =>
  style === "heading"
    ? /^#{1,3} $/.test(prefix)
    : style === "task"
      ? /^[-*•] \[[ xX]\] $/.test(prefix)
      : style === "bullet"
        ? /^[-*•] $/.test(prefix)
        : /^\d+[.)] $/.test(prefix);

/**
 * Turn the selected lines into headings, bullets, numbered items or to-dos, replacing any
 * other line style. If every selected line already has this style, it's removed instead.
 */
export function toggleLines({ text, start, end }: Edit, style: LineStyle): Edit {
  const starts = lineStarts(text, start, end);
  const prefixes = starts.map((s) => LINE_PREFIX.exec(text.slice(s))![2] ?? "");
  const remove = prefixes.every((p) => isStyle(p, style));
  let out = text;
  let delta = 0;
  let selStart = start;
  let selEnd = end;
  starts.forEach((s, i) => {
    const at = s + delta;
    const indent = LINE_PREFIX.exec(out.slice(at))![1];
    const old = prefixes[i];
    const next = remove ? "" : prefixFor(style, i + 1);
    const pos = at + indent.length;
    out = out.slice(0, pos) + next + out.slice(pos + old.length);
    const change = next.length - old.length;
    if (s <= start) selStart = Math.max(pos, selStart + change);
    selEnd += change;
    delta += change;
  });
  return { text: out, start: Math.min(selStart, selEnd), end: Math.max(selEnd, selStart) };
}

/** The line style (heading, bullet…) of the line the cursor is on, for showing its button as "on". */
export function activeLineStyle(text: string, pos: number): LineStyle | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const prefix = LINE_PREFIX.exec(text.slice(lineStart))![2] ?? "";
  for (const style of ["heading", "task", "bullet", "number"] as LineStyle[]) if (prefix && isStyle(prefix, style)) return style;
  return null;
}
