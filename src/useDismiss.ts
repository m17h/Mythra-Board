import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Close a menu when you click outside it or press Esc. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ref, open, onClose]);
}

/** Close a dialog with Esc, wherever keyboard focus happens to be. */
export function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, enabled]);
}

/** How long closing animations take (keep in step with the CSS). */
export const LEAVE_MS = 160;

/**
 * Close with a short closing animation first. Returns whether it's closing (to add the
 * `is-leaving` class) and the function to call instead of `onClose`.
 */
export function useLeave(onClose: () => void): [boolean, () => void] {
  const [leaving, setLeaving] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const started = useRef(false);
  const close = useCallback(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return latest.current();
    setLeaving(true);
    setTimeout(() => latest.current(), LEAVE_MS);
  }, []);
  return [leaving, close];
}

/**
 * Keep something on screen briefly after it's switched off, so it can animate out.
 * Returns whether to show it, and whether it's on its way out.
 */
export function usePresence(open: boolean): [boolean, boolean] {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return [shown, leaving];
}
