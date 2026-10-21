import { useReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import type { Command } from "./components/CommandPalette";
import {
  ArrangeGlyph,
  ArrowToolIcon,
  GroupIcon,
  LockIcon,
  BackIcon,
  BoardLinkIcon,
  BoardsIcon,
  CursorIcon,
  EraserIcon,
  FitIcon,
  FoldIcon,
  FrameIcon,
  HandIcon,
  HelpIcon,
  ImageIcon,
  LassoIcon,
  MapIcon,
  MoonIcon,
  NoteIcon,
  PenIcon,
  SearchIcon,
  SunIcon,
  TextIcon,
  TidyIcon,
  AutoThemeIcon,
  SettingsIcon,
  SparkleIcon,
} from "./components/icons";
import { aiActions, aiSupported } from "./ai";
import { runAi } from "./notify";
import { childrenOf } from "./mindmap";
import { boardIndex } from "./navigation";
import { ShapeGlyph, SHAPE_NAMES } from "./shapes";
import { boardStore } from "./store";
import { setThemeSetting } from "./theme";
import { BACKGROUNDS, SHAPES, type ArrangeMode, type BoardNode, type LinkEdge } from "./types";

export type BoardActions = {
  openFind: () => void;
  pickBoard: () => void;
  pickImage: () => void;
  toggleMap: () => void;
  toggleHelp: () => void;
  exportPng: () => void;
  goHome: () => void;
  goBack?: () => void;
  openBoardById: (id: string) => void;
  openSettings: () => void;
  /** Extra commands from features that live elsewhere (presenting, history, …). */
  extra?: Command[];
};

/** Everything the ⌘K palette can do on a board. */
export function useBoardCommands(actions: BoardActions, open: boolean): Command[] {
  const rf = useReactFlow<BoardNode, LinkEdge>();
  return useMemo(() => {
    if (!open) return [];
    const s = boardStore.getState();
    const selected = s.nodes.filter((n) => n.selected);
    const ids = selected.map((n) => n.id);
    const single = selected.length === 1 ? selected[0] : null;
    const hasKids = single ? (childrenOf(s.nodes, s.edges).get(single.id)?.length ?? 0) > 0 : false;
    const center = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const cmds: Command[] = [];
    const add = (group: string, c: Omit<Command, "group" | "id"> & { id?: string }) =>
      cmds.push({ id: c.id ?? `${group}:${c.label}`, group, ...c });

    add("Add", {
      label: "New note",
      keys: "N",
      icon: <NoteIcon />,
      run: () => {
        const c = center();
        s.addNote({ x: c.x - 110, y: c.y - 25 }, { edit: true });
      },
    });
    add("Add", {
      label: "New text",
      keys: "T",
      icon: <TextIcon />,
      run: () => {
        const c = center();
        s.addItem("text", { x: c.x - 130, y: c.y - 20 }, { edit: true });
      },
    });
    for (const k of SHAPES) add("Add", { label: `${SHAPE_NAMES[k]} shape`, icon: <ShapeGlyph kind={k} />, run: () => s.setShapeKind(k) });
    add("Add", { label: "Section", keys: "F", icon: <FrameIcon />, run: () => s.setTool("frame") });
    add("Add", { label: "Arrow or line", keys: "A", icon: <ArrowToolIcon />, run: () => s.setTool("arrow") });
    add("Add", { label: "Image…", keys: "I", icon: <ImageIcon />, run: actions.pickImage });
    add("Add", { label: "Link to another board…", icon: <BoardLinkIcon />, keywords: "card wiki", run: actions.pickBoard });

    add("Tools", { label: "Select", keys: "V", icon: <CursorIcon />, run: () => s.setTool("select") });
    add("Tools", { label: "Lasso select", keys: "L", icon: <LassoIcon />, run: () => s.setTool("lasso") });
    add("Tools", { label: "Pan", keys: "H", icon: <HandIcon />, run: () => s.setTool("hand") });
    add("Tools", { label: "Pen", keys: "P", icon: <PenIcon />, run: () => s.setTool("pen") });
    add("Tools", { label: "Eraser", keys: "E", icon: <EraserIcon />, run: () => s.setTool("eraser") });

    add("Mind map", {
      label: single && hasKids ? "Tidy up this branch" : "Tidy up all mind maps",
      icon: <TidyIcon />,
      keywords: "arrange layout tree",
      run: () => s.tidyUp(single && hasKids ? [single.id] : undefined),
    });
    if (single && (hasKids || single.data.collapsed))
      add("Mind map", {
        label: single.data.collapsed ? "Unfold branch" : "Fold branch",
        keys: "C",
        icon: <FoldIcon />,
        keywords: "collapse expand hide",
        run: () => s.toggleCollapse(single.id),
      });
    if (s.nodes.some((n) => n.data.collapsed))
      add("Mind map", {
        label: "Unfold everything",
        icon: <FoldIcon />,
        keywords: "expand all",
        run: () => s.nodes.filter((n) => n.data.collapsed).forEach((n) => s.toggleCollapse(n.id)),
      });

    add("Edit", { label: "Undo", keys: "⌘Z", run: () => s.undo() });
    add("Edit", { label: "Redo", keys: "⇧⌘Z", run: () => s.redo() });
    add("Edit", { label: "Select all", keys: "⌘A", run: () => s.selectAll() });
    if (ids.length) {
      add("Edit", { label: "Duplicate", keys: "⌘D", run: () => s.duplicateSelection() });
      add("Edit", { label: "Bring to front", keys: "⇧⌘]", run: () => s.reorder(ids, "front") });
      add("Edit", { label: "Send to back", keys: "⇧⌘[", run: () => s.reorder(ids, "back") });
      add("Edit", { label: "Put in a section", keys: "⌥⌘G", run: () => void s.frameSelection() });
      add("Edit", { label: "Delete", keys: "⌫", run: () => s.deleteNodes(ids) });
      const locked = selected.every((n) => n.data.locked);
      add("Arrange", { label: locked ? "Unlock" : "Lock", keys: "⇧⌘L", icon: <LockIcon open={locked} />, run: () => s.setLocked(ids, !locked) });
      if (ids.length > 1) {
        add("Arrange", { label: "Group", keys: "⌘G", icon: <GroupIcon />, run: () => s.group(ids) });
        const modes: [ArrangeMode, string, string][] = [
          ["left", "Align left edges", "⌥A"],
          ["hcenter", "Align centres", "⌥H"],
          ["right", "Align right edges", "⌥D"],
          ["top", "Align top edges", "⌥W"],
          ["vmiddle", "Align middles", "⌥V"],
          ["bottom", "Align bottom edges", "⌥S"],
          ["distributeX", "Space evenly across", "⌃⌥H"],
          ["distributeY", "Space evenly down", "⌃⌥V"],
        ];
        for (const [m, label, keys] of modes) add("Arrange", { label, keys, icon: <ArrangeGlyph mode={m} />, run: () => s.arrange(ids, m) });
      }
      if (selected.some((n) => n.data.group)) add("Arrange", { label: "Ungroup", keys: "⇧⌘G", icon: <GroupIcon />, run: () => s.ungroup(ids) });
    }

    add("View", { label: "Find on this board", keys: "⌘F", icon: <SearchIcon />, run: actions.openFind });
    add("View", { label: "Fit everything", keys: "⇧1", icon: <FitIcon />, run: () => void rf.fitView({ padding: 0.25, maxZoom: 1, duration: 250 }) });
    add("View", { label: "Zoom to 100%", keys: "⇧0", run: () => void rf.zoomTo(1, { duration: 200 }) });
    add("View", { label: "Mini map", keys: "M", icon: <MapIcon />, run: actions.toggleMap });
    add("View", { label: "Keyboard shortcuts", keys: "?", icon: <HelpIcon />, run: actions.toggleHelp });

    for (const b of BACKGROUNDS)
      add("Board", { label: `Background: ${b[0].toUpperCase()}${b.slice(1)}`, run: () => s.setBackground(b) });
    add("Board", { label: s.snapping ? "Turn off snapping" : "Turn on snapping", run: () => s.setSnapping(!s.snapping) });
    add("Board", { label: "Export…", keys: "⇧⌘E", keywords: "png svg pdf picture image", run: actions.exportPng });
    add("Board", {
      label: "Rename board",
      run: () => document.querySelector<HTMLInputElement>(".title-input")?.focus(),
    });
    cmds.push(...(actions.extra ?? []));
    if (aiSupported()) {
      if (single && ["note", "text", "shape"].includes(single.type)) {
        add("AI", { label: "Brainstorm ideas from this", icon: <SparkleIcon />, keywords: "claude ai suggest", run: () => void runAi(() => aiActions.brainstorm(single.id)) });
        add("AI", { label: "Turn this into a mind map", icon: <SparkleIcon />, keywords: "claude ai", run: () => void runAi(() => aiActions.mindMap(single.id)) });
      }
      add("AI", { label: "Summarise this board", icon: <SparkleIcon />, keywords: "claude ai summary", run: () => void runAi(aiActions.summarise) });
    }
    add("App", { label: "Settings…", icon: <SettingsIcon />, keywords: "preferences icloud sync storage ai key", run: actions.openSettings });

    add("App", { label: "Appearance: Auto", icon: <AutoThemeIcon />, keywords: "theme system", run: () => setThemeSetting("system") });
    add("App", { label: "Appearance: Light", icon: <SunIcon />, keywords: "theme", run: () => setThemeSetting("light") });
    add("App", { label: "Appearance: Dark", icon: <MoonIcon />, keywords: "theme", run: () => setThemeSetting("dark") });
    if (actions.goBack) add("App", { label: "Back to previous board", keys: "⌘[", icon: <BackIcon />, run: actions.goBack });
    add("App", { label: "All boards", icon: <BoardsIcon />, keywords: "home", run: actions.goHome });

    for (const b of boardIndex()) {
      if (b.id === s.boardId) continue;
      add("Open board", {
        id: `board:${b.id}`,
        label: b.title,
        detail: `${b.nodes.length} item${b.nodes.length === 1 ? "" : "s"}`,
        icon: <BoardsIcon />,
        keywords: "open go",
        run: () => actions.openBoardById(b.id),
      });
    }
    return cmds;
  }, [open, rf, actions]);
}
