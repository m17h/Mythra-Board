import { useEffect, useRef, type CSSProperties } from "react";
import { BOARD_TINTS, boardLook, FONT_NAMES, isHex, THEMES, type Theme } from "../look";
import { boardStore, useBoard } from "../store";
import { useTheme } from "../theme";
import { BACKGROUNDS, FONTS, type BoardBackground } from "../types";
import { useEscape, useLeave } from "../useDismiss";

const PATTERN_NAMES: Record<BoardBackground, string> = { dots: "Dots", grid: "Grid", lines: "Lined", cross: "Crosses", plain: "Plain" };

/** A small picture of a board colour with its pattern. */
function BoardSwatch({ color, pattern, font, label }: { color: string; pattern: BoardBackground; font?: string; label?: string }) {
  const { theme } = useTheme();
  const look = boardLook(color, theme);
  return (
    <span
      className={`look-swatch scheme-${look.scheme} bg-sample--${pattern}`}
      style={(look.bg ? { "--bg": look.bg, "--dots": look.pattern, "--grid": look.pattern } : {}) as CSSProperties}
    >
      {label && <span className={`look-swatch__text font-sample--${font ?? "sans"}`}>{label}</span>}
    </span>
  );
}

/** Any board colour, from the system picker: one undo step once it's chosen. */
function CustomBoardColor({ value, onPick }: { value: string | null; onPick: (c: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => pick.current(el.value.toLowerCase());
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, []);
  return (
    <label className={`look-color look-color--custom${value ? " is-active" : ""}`} title="Any colour">
      <span className="look-swatch" style={value ? { background: value } : undefined} />
      <input ref={input} type="color" aria-label="Any board colour" defaultValue={value ?? "#f4efe6"} />
    </label>
  );
}

/** Choose how the whole board looks: a ready-made theme, or its colour, pattern, typeface and style. */
export function BoardLookDialog({ onClose }: { onClose: () => void }) {
  const [leaving, close] = useLeave(onClose);
  useEscape(close);
  const boardColor = useBoard((s) => s.boardColor);
  const background = useBoard((s) => s.background);
  const font = useBoard((s) => s.font);
  const style = useBoard((s) => s.style);
  const set = boardStore.getState().setLook;
  const isTheme = (t: Theme) => t.boardColor === boardColor && t.background === background && t.font === font && t.style === style;
  const custom = isHex(boardColor) ? boardColor : null;

  return (
    <>
      <div className={`palette-scrim${leaving ? " is-leaving" : ""}`} onPointerDown={close} />
      <div className={`dialog board-look${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Customise board" onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog__title">Customise board</div>

        <div className="dialog__section">
          <div className="popover__label">Themes</div>
          <div className="look-themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`look-theme${isTheme(t) ? " is-active" : ""}`}
                onClick={() => set({ boardColor: t.boardColor, background: t.background, font: t.font, style: t.style })}
              >
                <BoardSwatch color={t.boardColor} pattern={t.background} font={t.font} label="Aa" />
                <span className="look-theme__name">{t.name}</span>
                <span className="look-theme__desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dialog__section">
          <div className="popover__label">Board colour</div>
          <div className="look-colors">
            {(["default", ...Object.keys(BOARD_TINTS)] as string[]).map((c) => (
              <button
                key={c}
                type="button"
                className={`look-color${boardColor === c ? " is-active" : ""}`}
                title={c === "default" ? "Match the app (light or dark)" : BOARD_TINTS[c as keyof typeof BOARD_TINTS].name}
                aria-label={c === "default" ? "Match the app" : BOARD_TINTS[c as keyof typeof BOARD_TINTS].name}
                onClick={() => set({ boardColor: c })}
              >
                <BoardSwatch color={c} pattern="plain" />
              </button>
            ))}
            <CustomBoardColor value={custom} onPick={(c) => set({ boardColor: c })} />
          </div>
        </div>

        <div className="dialog__section">
          <div className="popover__label">Pattern</div>
          <div className="segmented">
            {BACKGROUNDS.map((b) => (
              <button key={b} type="button" className={`segmented__item${background === b ? " is-active" : ""}`} onClick={() => set({ background: b })}>
                <span className={`bg-sample bg-sample--${b}`} />
                {PATTERN_NAMES[b]}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog__section">
          <div className="popover__label">Typeface</div>
          <div className="segmented">
            {FONTS.map((f) => (
              <button key={f} type="button" className={`segmented__item${font === f ? " is-active" : ""}`} onClick={() => set({ font: f })} title={FONT_NAMES[f]}>
                <span className={`font-sample font-sample--${f}`}>Aa</span>
                {FONT_NAMES[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog__section">
          <div className="popover__label">Drawing style</div>
          <div className="segmented">
            {(["clean", "sketchy"] as const).map((st) => (
              <button key={st} type="button" className={`segmented__item${style === st ? " is-active" : ""}`} onClick={() => set({ style: st })}>
                <span className={`style-sample style-sample--${st}`}>Aa</span>
                {st === "clean" ? "Clean" : "Hand-drawn"}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog__actions">
          <span className="settings__note">Each change can be undone with ⌘Z.</span>
          <span className="dialog__spacer" />
          <button type="button" className="primary-btn" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
