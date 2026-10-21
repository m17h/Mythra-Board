import type { ReactNode, SVGProps } from "react";

const Icon = ({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...props}
  >
    {children}
  </svg>
);

export const CursorIcon = () => (
  <Icon>
    <path d="M5 3.5 18.5 10l-6 1.6L9.8 17.5z" />
  </Icon>
);
export const HandIcon = () => (
  <Icon>
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.5 5.5 0 0 1-4.3-2.1L4.3 14a1.5 1.5 0 0 1 2.3-1.9L8 13.5" />
  </Icon>
);
export const NoteIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="3" />
    <path d="M8 10h8M8 14h5" />
  </Icon>
);
export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);
export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
export const FitIcon = () => (
  <Icon>
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);
export const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
  </Icon>
);
export const MapIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <rect x="12" y="11" width="6" height="5" rx="1" />
  </Icon>
);
export const CurveIcon = () => (
  <Icon>
    <path d="M4 18c8 0 8-12 16-12" />
  </Icon>
);
export const StraightIcon = () => (
  <Icon>
    <path d="M4 18 20 6" />
  </Icon>
);
export const ElbowIcon = () => (
  <Icon>
    <path d="M4 18h6a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);
export const ArrowNoneIcon = () => (
  <Icon>
    <path d="M4 12h16" />
  </Icon>
);
export const ArrowEndIcon = () => (
  <Icon>
    <path d="M4 12h15M14 7l5 5-5 5" />
  </Icon>
);
export const ArrowBothIcon = () => (
  <Icon>
    <path d="M5 12h14M9 7l-5 5 5 5M15 7l5 5-5 5" />
  </Icon>
);
export const DashIcon = () => (
  <Icon>
    <path d="M3 12h3M10.5 12h3M18 12h3" />
  </Icon>
);
export const SwapIcon = () => (
  <Icon>
    <path d="M4 8h14l-3-3M20 16H6l3 3" />
  </Icon>
);
export const LabelIcon = () => (
  <Icon>
    <path d="M5 7V5h14v2M12 5v14M9 19h6" />
  </Icon>
);
export const LinkedNoteIcon = () => (
  <Icon>
    <rect x="2.5" y="8" width="8" height="8" rx="2" />
    <rect x="15" y="5" width="6.5" height="6.5" rx="1.8" strokeDasharray="2.5 2" />
    <path d="M10.5 12c2.5 0 2.5-3.8 4.5-3.8M18.25 14v5M15.75 16.5h5" />
  </Icon>
);
export const TextIcon = () => (
  <Icon>
    <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
  </Icon>
);
export const RectIcon = () => (
  <Icon>
    <rect x="4" y="6" width="16" height="12" rx="2.5" />
  </Icon>
);
export const EllipseIcon = () => (
  <Icon>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
  </Icon>
);
export const DiamondIcon = () => (
  <Icon>
    <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
  </Icon>
);
export const FrameIcon = () => (
  <Icon>
    <path d="M4 8h16M4 16h16M8 4v16M16 4v16" />
  </Icon>
);
export const PenIcon = () => (
  <Icon>
    <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
    <path d="M13.5 7l3 3" />
  </Icon>
);
export const EraserIcon = () => (
  <Icon>
    <path d="M8.5 19.5 3.8 14.8a2 2 0 0 1 0-2.8L12 3.8a2 2 0 0 1 2.8 0l5.4 5.4a2 2 0 0 1 0 2.8l-7.5 7.5zM8.5 19.5H20M7 9.5l7.5 7.5" />
  </Icon>
);
export const ImageIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 15.5-5-5-9 9" />
  </Icon>
);
export const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z" />
  </Icon>
);
export const OpenIcon = () => (
  <Icon>
    <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);
export const BoardsIcon = () => (
  <Icon>
    <rect x="4" y="4" width="7" height="7" rx="1.8" />
    <rect x="13" y="4" width="7" height="7" rx="1.8" />
    <rect x="4" y="13" width="7" height="7" rx="1.8" />
    <rect x="13" y="13" width="7" height="7" rx="1.8" />
  </Icon>
);
export const MoreIcon = () => (
  <Icon>
    <circle cx="6" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="18" cy="12" r="1.2" fill="currentColor" />
  </Icon>
);
export const StarIcon = ({ filled }: { filled?: boolean }) => (
  <Icon fill={filled ? "currentColor" : "none"}>
    <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
export const DuplicateIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);
export const RenameIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
  </Icon>
);
export const ChecklistIcon = () => (
  <Icon>
    <path d="m4 7 1.5 1.5L8.5 5.5M4 15l1.5 1.5 3-3M12 7h8M12 15h8" />
  </Icon>
);
export const SectionIcon = () => (
  <Icon>
    <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" strokeDasharray="3 2.5" />
    <path d="M3.5 3.5h7" />
  </Icon>
);
export const AlignLeftIcon = () => (
  <Icon>
    <path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10" />
  </Icon>
);
export const AlignCenterIcon = () => (
  <Icon>
    <path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10" />
  </Icon>
);
export const AlignRightIcon = () => (
  <Icon>
    <path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10" />
  </Icon>
);
export const OutlineIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="3.5" strokeWidth="2.6" />
  </Icon>
);
export const CardTitleIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="17" height="16" rx="3" />
    <path d="M7 8.5h7" strokeWidth="2.4" />
    <path d="M3.5 11.5h17M7 15h10" />
  </Icon>
);
export const ChevronIcon = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="M1.5 3 4 5.5 6.5 3" />
  </svg>
);
export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);
export const MoonIcon = () => (
  <Icon>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </Icon>
);
export const AutoThemeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
  </Icon>
);
export const ArrowToolIcon = () => (
  <Icon>
    <path d="M5 19 19 5M10 5h9v9" />
  </Icon>
);
export const LineToolIcon = () => (
  <Icon>
    <path d="M5 19 19 5" />
  </Icon>
);
export const LassoIcon = () => (
  <Icon>
    <path d="M7.5 15.5C4.5 14.3 3 12.6 3 10.5 3 6.9 7 4 12 4s9 2.9 9 6.5S17 17 12 17c-1.1 0-2.2-.1-3.2-.4" />
    <path d="M8.5 15.5c0 1.5-.8 2.6-2 3.3M6.5 18.8c-.7.4-1 .9-.8 1.7" />
  </Icon>
);
export const BoardLinkIcon = () => (
  <Icon>
    <rect x="3" y="5" width="12" height="10" rx="2" />
    <path d="M9 19h10a2 2 0 0 0 2-2V9M13 11l8-8M16 3h5v5" />
  </Icon>
);
export const FoldIcon = () => (
  <Icon>
    <circle cx="6" cy="12" r="2.5" />
    <path d="M8.5 12h4M12.5 7v10M12.5 7h3M12.5 17h3" />
    <path d="M18 5.5v3M16.5 7h3" />
  </Icon>
);
export const TidyIcon = () => (
  <Icon>
    <rect x="3" y="10" width="5" height="4" rx="1" />
    <rect x="16" y="4" width="5" height="4" rx="1" />
    <rect x="16" y="10" width="5" height="4" rx="1" />
    <rect x="16" y="16" width="5" height="4" rx="1" />
    <path d="M8 12h4M12 6v12M12 6h4M12 12h4M12 18h4" />
  </Icon>
);
export const LockIcon = ({ open }: { open?: boolean }) => (
  <Icon>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d={open ? "M8 11V7.5a4 4 0 0 1 7.5-2" : "M8 11V7.5a4 4 0 0 1 8 0V11"} />
  </Icon>
);
export const GroupIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" strokeDasharray="3 2.5" />
    <rect x="7" y="7" width="5" height="5" rx="1" />
    <rect x="12" y="12" width="5" height="5" rx="1" />
  </Icon>
);
export const AlignItemsIcon = () => (
  <Icon>
    <path d="M4 3v18" />
    <rect x="7" y="6" width="12" height="4" rx="1" />
    <rect x="7" y="14" width="7" height="4" rx="1" />
  </Icon>
);
export const PresentIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M12 16v4M8 20h8M10 8l4 2-4 2z" />
  </Icon>
);
export const HistoryIcon = () => (
  <Icon>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 4v4h4M12 7.5V12l3 2" />
  </Icon>
);
export const FileIcon = () => (
  <Icon>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" />
    <path d="M14 3.5v5h5" />
  </Icon>
);
export const CommandIcon = () => (
  <Icon>
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v6m0-6h6m-6 6v2.5A2.5 2.5 0 1 1 6.5 15H9zm0 0h6m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm0 0V9m0 0V6.5A2.5 2.5 0 1 1 17.5 9H15z" />
  </Icon>
);
export const SparkleIcon = () => (
  <Icon>
    <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z" />
    <path d="M19 3v3M17.5 4.5h3M5 17v3M3.5 18.5h3" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="M15 5 8 12l7 7" />
  </Icon>
);
export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
  </Icon>
);

const ARRANGE_PATHS: Record<string, string> = {
  left: "M4 3v18M7 7h11M7 7v3h11V7M7 14h7M7 14v3h7v-3",
  hcenter: "M12 3v18M6 7h12v3H6zM8.5 14h7v3h-7z",
  right: "M20 3v18M6 7h11v3H6zM10 14h7v3h-7z",
  top: "M3 4h18M7 7v11h3V7zM14 7v7h3V7z",
  vmiddle: "M3 12h18M7 6v12h3V6zM14 8.5v7h3v-7z",
  bottom: "M3 20h18M7 6v11h3V6zM14 10v7h3v-7z",
  distributeX: "M3 4v16M21 4v16M8 8h3v8H8zM13 8h3v8h-3z",
  distributeY: "M4 3h16M4 21h16M8 8h8v3H8zM8 13h8v3H8z",
};
export const ArrangeGlyph = ({ mode }: { mode: string }) => (
  <Icon strokeWidth={1.6}>
    <path d={ARRANGE_PATHS[mode]} />
  </Icon>
);
