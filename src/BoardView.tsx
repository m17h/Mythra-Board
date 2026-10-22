import {
  Background,
  ViewportPortal,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  type FinalConnectionState,
  type IsValidConnection,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { TrailStep } from "./App";
import { useBoardCommands, type BoardActions } from "./boardCommands";
import { CommandPalette, type Command } from "./components/CommandPalette";
import BoardDefs from "./components/BoardDefs";
import { ExportDialog } from "./components/ExportDialog";
import { Presentation } from "./components/Presentation";
import { SettingsDialog } from "./components/SettingsDialog";
import { onMenu, typingNow, undoText } from "./menuEvents";
import { notify, setNotifier } from "./notify";
import { saveAsTemplate } from "./templates";
import { canOpenWindows, openWindow } from "./windows";
import { chat, useChat } from "./assistant/run";
import { AssistantPanel } from "./components/AssistantPanel";
import { aiSupported } from "./ai";
import { isMac, keyLabel } from "./platform";
import { FindBar } from "./components/FindBar";
import { FormatToolbar } from "./components/FormatToolbar";
import { VersionHistory } from "./components/VersionHistory";
import type { Point } from "./geometry";
import { hiddenItems } from "./mindmap";
import {
  backlinksTo,
  createBoard,
  findBoardByTitle,
  makeBoardDoc,
  openBoard,
  refreshBoardIndex,
  renameLinks,
  takePendingFocus,
  useBoardIndex,
} from "./navigation";
import { CanvasGestures } from "./components/CanvasGestures";
import { ContextMenu, type MenuTarget } from "./components/ContextMenu";
import { Dock } from "./components/Dock";
import {
  BackIcon,
  SparkleIcon,
  BoardLinkIcon,
  BoardsIcon,
  DuplicateIcon,
  FileIcon,
  FitIcon,
  HistoryIcon,
  NewWindowIcon,
  PresentIcon,
  HelpIcon,
  MapIcon,
  MinusIcon,
  MoreIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from "./components/icons";
import { describe, nodeTypes } from "./components/items";
import { edgeTypes } from "./components/LinkLine";
import LinkPreview from "./components/LinkPreview";
import { LinkToolbar, SelectionToolbar, ToolButton } from "./components/Toolbars";
import { addFiles, FILE_EXTENSIONS } from "./images";
import { rectOf } from "./layout";
import { isTauri, onSaveNotice, type SaveStatus } from "./persistence";
import { boardStore, pauseSnapping, setSnapZoom, useBoard } from "./store";
import { BACKGROUNDS, DEFAULT_NOTE_WIDTH, type BoardBackground, type BoardNode, type Color, type LinkEdge } from "./types";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { useTheme } from "./theme";
import { useDismiss, usePresence } from "./useDismiss";
import { useShortcuts } from "./useShortcuts";

const IS_TAURI = isTauri();
const FIT_OPTIONS = { padding: 0.25, maxZoom: 1, duration: 250 };

const MINIMAP_COLORS: Record<Color, string> = {
  plain: "#c9c9d4",
  yellow: "#f5d565",
  orange: "#f6b17a",
  pink: "#f1a7c3",
  purple: "#c3b1f5",
  blue: "#9cc7f5",
  green: "#a5dcb0",
};

const BACKGROUND_NAMES: Record<BoardBackground, string> = { dots: "Dots", grid: "Grid", plain: "Plain" };

type Props = { status: SaveStatus; onHome: () => void; back: TrailStep | null; onBack: () => void };

export default function BoardView({ status, onHome, back, onBack }: Props) {
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const [palette, setPalette] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  // Where a board card will go when a board is picked from the "Link to a board" list.
  const [pickerAt, setPickerAt] = useState<Point | null>(null);

  // Folded branches: hide everything under them (React Flow skips hidden items entirely).
  const hidden = useMemo(() => hiddenItems(nodes, edges), [nodes, edges]);
  const shownNodes = useMemo(() => (hidden.size ? nodes.map((n) => (hidden.has(n.id) ? { ...n, hidden: true } : n)) : nodes), [nodes, hidden]);
  const shownEdges = useMemo(
    () => (hidden.size ? edges.map((e) => (hidden.has(e.source) || hidden.has(e.target) ? { ...e, hidden: true } : e)) : edges),
    [edges, hidden],
  );
  const tool = useBoard((s) => s.tool);
  const background = useBoard((s) => s.background);
  const connecting = useBoard((s) => s.connecting);
  const editingId = useBoard((s) => s.editingId);
  const [showHelp, setShowHelp] = useState(false);
  const [helpShown, helpLeaving] = usePresence(showHelp);
  const [showMap, setShowMap] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { theme } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const rf = useReactFlow<BoardNode, LinkEdge>();
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const store = boardStore.getState();

  // Decided once on open: restore where you were, or frame the whole board.
  const initialViewport = useRef(boardStore.getState().viewport);
  const fitOnOpen = useRef(!initialViewport.current && boardStore.getState().nodes.length > 0);
  const width = useFlowStore((s) => s.width);
  const height = useFlowStore((s) => s.height);
  const zoom = useFlowStore((s) => s.transform[2]);

  const pickImage = useCallback(() => fileInput.current?.click(), []);
  const viewCenter = useCallback(() => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), [rf]);
  const backOrHome = back ? onBack : onHome;

  // Renaming this board (or undoing a rename) keeps [[links]] to it on other boards working.
  const title = useBoard((s) => s.title);
  const boardId = useBoard((s) => s.boardId);
  const shownTitle = useRef({ id: boardId, title });
  useEffect(() => {
    const prev = shownTitle.current;
    shownTitle.current = { id: boardId, title };
    if (prev.id === boardId && prev.title !== title) void renameLinks(prev.title, title, boardId);
  }, [title, boardId]);

  // Clicking a #tag finds it on the board.
  useEffect(() => {
    const onFind = (e: Event) => {
      setFindQuery((e as CustomEvent<string>).detail);
      setFindOpen(true);
    };
    window.addEventListener("mythra:find", onFind);
    return () => window.removeEventListener("mythra:find", onFind);
  }, []);

  // Claude's changes are brought into view as they happen.
  useEffect(() => {
    const onShow = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      const box = document.querySelector(".react-flow")?.getBoundingClientRect();
      if (!ids.length || !box) return;
      const bounds = rf.getNodesBounds(ids);
      // Leave room for the Claude panel, the title bar and the dock.
      const right = chat.getState().open ? (document.querySelector(".assistant")?.getBoundingClientRect().width ?? 0) + 24 : 0;
      const area = { x: 40, y: 80, width: box.width - right - 80, height: box.height - 170 };
      if (area.width < 100 || area.height < 100) return;
      const zoom = Math.max(0.1, Math.min(1, area.width / Math.max(bounds.width, 1), area.height / Math.max(bounds.height, 1)));
      void rf.setViewport(
        {
          x: area.x + (area.width - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: area.y + (area.height - bounds.height * zoom) / 2 - bounds.y * zoom,
          zoom,
        },
        { duration: 450 },
      );
    };
    window.addEventListener("mythra:show-items", onShow);
    return () => window.removeEventListener("mythra:show-items", onShow);
  }, [rf]);

  useEffect(() => {
    void refreshBoardIndex();
    onSaveNotice(setNotice);
    setNotifier(setNotice);
  }, []);

  const [exportOpen, setExportOpen] = useState<false | "png" | "mythra">(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const boardStyle = useBoard((s) => s.style);
  const present = useCallback(() => {
    const s = boardStore.getState();
    s.stopEditing();
    s.clearSelection();
    s.setTool("select");
    setMenu(null);
    setPalette(false);
    setFindOpen(false);
    setPresenting(true);
  }, []);
  const exportPng = useCallback(() => {
    boardStore.getState().stopEditing();
    setExportOpen("png");
  }, []);

  useEffect(() => {
    if (!notice || notice.endsWith("…")) return;
    const t = setTimeout(() => setNotice(null), notice.length > 50 ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // Modifier keys change how dragging works.
  useEffect(() => {
    const track = (e: KeyboardEvent) => {
      pauseSnapping(e.altKey);
      // Holding Shift lets a drag inside a section draw a selection box instead of moving it.
      document.body.classList.toggle("shift-held", e.shiftKey);
    };
    const reset = () => {
      pauseSnapping(false);
      document.body.classList.remove("shift-held");
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", reset);
    };
  }, []);

  useShortcuts({
    pointer,
    toggleHelp: () => setShowHelp((v) => !v),
    toggleMap: () => setShowMap((v) => !v),
    pickImage,
    goHome: backOrHome,
    exportPng,
    openPalette: () => setPalette(true),
    openFind: () => setFindOpen(true),
    present,
  });

  const actions = useMemo<BoardActions>(
    () => ({
      openFind: () => setFindOpen(true),
      pickBoard: () => setPickerAt(viewCenter()),
      pickImage,
      toggleMap: () => setShowMap((v) => !v),
      toggleHelp: () => setShowHelp((v) => !v),
      exportPng,
      goHome: onHome,
      goBack: back ? onBack : undefined,
      openBoardById: (id) => void openBoard(id),
      openSettings: () => setSettingsOpen(true),
      extra: [
        { id: "board:present", group: "Board", label: "Present sections", keys: "⇧⌘P", icon: <PresentIcon />, keywords: "slides slideshow", run: present },
        {
          id: "board:style",
          group: "Board",
          label: boardStore.getState().style === "sketchy" ? "Style: Clean" : "Style: Hand-drawn",
          keywords: "sketchy rough excalidraw look",
          run: () => boardStore.getState().setStyle(boardStore.getState().style === "sketchy" ? "clean" : "sketchy"),
        },
        { id: "board:history", group: "Board", label: "Version history…", icon: <HistoryIcon />, keywords: "restore undo backup", run: () => setHistoryOpen(true) },
        {
          id: "board:template",
          group: "Board",
          label: "Save as template",
          icon: <DuplicateIcon />,
          keywords: "reuse starter",
          run: () => void saveAsTemplate(boardStore.getState()).then(() => setNotice("Saved as a template. Find it on the home screen.")),
        },
        { id: "board:file", group: "Board", label: "Save a board file…", icon: <FileIcon />, keywords: "backup share export mythra", run: () => setExportOpen("mythra") },
        ...(canOpenWindows()
          ? [{ id: "app:window", group: "Board", label: "New window", keys: "⇧⌘N", icon: <NewWindowIcon />, keywords: "second another side by side", run: () => void openWindow() }]
          : []),
      ],
    }),
    [viewCenter, pickImage, exportPng, onHome, back, onBack, present, boardStyle],
  );
  const commands = useBoardCommands(actions, palette);

  // Menu bar choices that belong to the board.
  useEffect(
    () =>
      onMenu((id) => {
        const s = boardStore.getState();
        const ids = s.nodes.filter((n) => n.selected).map((n) => n.id);
        const anywhere: Record<string, () => void> = {
          settings: () => setSettingsOpen(true),
          export: exportPng,
          "save-file": () => setExportOpen("mythra"),
          history: () => setHistoryOpen(true),
          find: () => setFindOpen(true),
          palette: () => setPalette(true),
          "ask-claude": () => chat.setState((c) => ({ open: !c.open })),
          "zoom-in": () => void rf.zoomIn({ duration: 150 }),
          "zoom-out": () => void rf.zoomOut({ duration: 150 }),
          "zoom-reset": () => void rf.zoomTo(1, { duration: 200 }),
          fit: () => void rf.fitView(FIT_OPTIONS),
          minimap: () => setShowMap((v) => !v),
          style: () => s.setStyle(s.style === "sketchy" ? "clean" : "sketchy"),
          present,
          shortcuts: () => setShowHelp((v) => !v),
          "link-board": () => setPickerAt(viewCenter()),
        };
        // Edits to the selection stay out of the way while you're typing.
        const edits: Record<string, () => void> = {
          duplicate: () => s.duplicateSelection(),
          delete: () => s.deleteSelection(),
          group: () => s.group(ids),
          ungroup: () => s.ungroup(ids),
          section: () => void s.frameSelection(),
          lock: () => s.setLocked(ids, !s.nodes.filter((n) => n.selected).every((n) => n.data.locked)),
          front: () => s.reorder(ids, "front"),
          "back-layer": () => s.reorder(ids, "back"),
          tidy: () => void s.tidyUp(ids.length === 1 ? ids : undefined),
          fold: () => ids.length === 1 && s.toggleCollapse(ids[0]),
        };
        if (id === "undo" || id === "redo") {
          if (typingNow()) undoText(id === "redo");
          else if (id === "undo") s.undo();
          else s.redo();
          return true;
        }
        if (anywhere[id]) {
          anywhere[id]();
          return true;
        }
        if (edits[id]) {
          if (!typingNow()) edits[id]();
          return true;
        }
        return false;
      }),
    [rf, exportPng, present, viewCenter],
  );

  // Keep an item you've just started typing into on screen.
  useEffect(() => {
    if (!editingId || !width) return;
    const node = boardStore.getState().nodes.find((n) => n.id === editingId);
    if (!node) return;
    const r = rectOf(node);
    const { x, y, zoom } = rf.getViewport();
    const margin = 60;
    const left = r.x * zoom + x;
    const top = r.y * zoom + y;
    const right = (r.x + r.width) * zoom + x;
    const bottom = (r.y + r.height) * zoom + y;
    if (left < margin || top < margin || right > width - margin || bottom > height - margin) {
      void rf.setCenter(r.x + r.width / 2, r.y + r.height / 2, { zoom, duration: 220 });
    }
  }, [editingId, rf, width, height]);

  const placeAt = useCallback(
    (clientX: number, clientY: number, type: "note" | "text") => {
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const w = type === "text" ? 260 : DEFAULT_NOTE_WIDTH;
      store.addItem(type, { x: p.x - (type === "text" ? 8 : w / 2), y: p.y - 22 }, { edit: true });
    },
    [rf, store],
  );

  const onDoubleClick = (e: ReactMouseEvent) => {
    if ((e.target as Element).classList?.contains("react-flow__pane") && tool === "select") {
      placeAt(e.clientX, e.clientY, "note");
    }
  };

  const isValidConnection: IsValidConnection<LinkEdge> = useCallback(
    (c) => boardStore.getState().canConnect(c.source, c.target),
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      boardStore.getState().setConnecting(false);
      if (state.isValid || state.toNode || !state.fromNode) return;
      // Dropped on empty canvas: start a new note there, already linked.
      const target = event.target as Element | null;
      if (!target?.classList?.contains("react-flow__pane") && !target?.closest?.(".react-flow__node-frame")) return;
      const { clientX, clientY } = "changedTouches" in event ? event.changedTouches[0] : event;
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      boardStore.getState().addConnectedNote(state.fromNode.id, { x: p.x - DEFAULT_NOTE_WIDTH / 2, y: p.y - 22 });
    },
    [rf],
  );

  const onDrop = (e: DragEvent) => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })).then((m) => m && setNotice(m));
  };

  const drawing = tool === "pen" || tool === "eraser" || tool === "shape" || tool === "frame" || tool === "arrow" || tool === "lasso";

  return (
    <div
      ref={container}
      className={`app board tool-${tool} style-${boardStyle}${drawing ? " is-drawing" : ""}${connecting ? " is-connecting" : ""}${IS_TAURI ? " is-tauri" : ""}${isMac ? " is-mac" : ""}${presenting ? " is-presenting" : ""}`}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <ReactFlow<BoardNode, LinkEdge>
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={store.onNodesChange}
        onEdgesChange={store.onEdgesChange}
        onNodeDragStart={(_, __, dragged) => store.beginDrag(dragged.map((n) => n.id))}
        onNodeDragStop={() => store.endDrag()}
        onSelectionDragStart={(_, dragged) => store.beginDrag(dragged.map((n) => n.id))}
        onSelectionDragStop={() => store.endDrag()}
        onConnect={(c) => store.connect(c.source, c.target)}
        onConnectStart={() => {
          store.stopEditing();
          store.setConnecting(true);
        }}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={LinkPreview}
        connectionRadius={28}
        connectionDragThreshold={4}
        connectOnClick={false}
        onEdgeDoubleClick={(_, edge) => store.startEditingLabel(edge.id)}
        onNodeClick={(e, node) => {
          // The note and text tools work inside sections too.
          if (node.type === "frame" && (tool === "note" || tool === "text")) {
            store.setTool("select");
            placeAt(e.clientX, e.clientY, tool);
          }
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          if (!node.selected) store.selectOnly([node.id]);
          setMenu({ x: e.clientX, y: e.clientY, kind: "items" });
        }}
        onSelectionContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, kind: "items" });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          store.selectOnly([], [edge.id]);
          setMenu({ x: e.clientX, y: e.clientY, kind: "link" });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          store.clearSelection();
          setMenu({ x: e.clientX, y: e.clientY, kind: "pane" });
        }}
        onPaneClick={(e) => {
          store.stopEditing();
          if (tool === "note" || tool === "text") {
            // Switch back first: changing tools closes any open editor.
            store.setTool("select");
            placeAt(e.clientX, e.clientY, tool);
          }
        }}
        onDoubleClick={onDoubleClick}
        onMove={(_, viewport) => setSnapZoom(viewport.zoom)}
        onMoveEnd={(_, viewport) => store.setViewport(viewport)}
        onInit={(instance) => {
          setSnapZoom(instance.getZoom());
          // Opened from a search result: show that item.
          const focus = takePendingFocus();
          const target = focus && boardStore.getState().nodes.find((n) => n.id === focus);
          if (target) {
            boardStore.getState().selectOnly([target.id]);
            setTimeout(() => void instance.fitView({ nodes: [{ id: target.id }], padding: 0.8, maxZoom: 1.2, duration: 300 }), 60);
          }
        }}
        defaultViewport={initialViewport.current ?? undefined}
        fitView={fitOnOpen.current}
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.1}
        maxZoom={3}
        zoomOnDoubleClick={false}
        panOnScroll={!presenting}
        zoomOnScroll={!presenting}
        zoomOnPinch={!presenting}
        panOnDrag={presenting ? false : tool === "hand" ? true : [1]}
        selectionOnDrag={tool === "select"}
        selectionMode={SelectionMode.Full}
        nodesDraggable={tool !== "hand" && !drawing && !presenting}
        elementsSelectable={tool !== "hand" && !drawing && !presenting}
        elevateNodesOnSelect={false}
        multiSelectionKeyCode={["Shift", "Meta"]}
        deleteKeyCode={null}
        disableKeyboardA11y
        nodeDragThreshold={2}
        onlyRenderVisibleElements={nodes.length > 400}
        colorMode={theme}
        attributionPosition="top-right"
      >
        {background !== "plain" && (
          <Background
            variant={background === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={background === "grid" ? 32 : 24}
            size={background === "grid" ? 1 : 1.4}
            className="board-bg"
          />
        )}
        <SelectionToolbar onMore={(x, y) => setMenu({ x, y, kind: "items" })} />
        <LinkToolbar />
        <FormatToolbar />
        <CanvasGestures container={container} />
        <BoardDefs />
        <Guides />
        {showMap && (
          <MiniMap<BoardNode>
            pannable
            zoomable
            position="bottom-right"
            className="minimap"
            nodeColor={(n) => (n.type === "frame" ? "transparent" : n.type === "image" ? "#b8b8c4" : MINIMAP_COLORS[n.data.color])}
            nodeStrokeColor={(n) => (n.type === "frame" ? MINIMAP_COLORS[n.data.color] : "transparent")}
            nodeStrokeWidth={6}
            nodeBorderRadius={6}
          />
        )}
      </ReactFlow>

      <TitleBar
        status={status}
        onHome={onHome}
        back={back}
        onBack={onBack}
        onExport={exportPng}
        onHistory={() => setHistoryOpen(true)}
        onPresent={present}
        onSettings={() => setSettingsOpen(true)}
      />
      {findOpen && (
        <FindBar
          initial={findQuery}
          onClose={() => {
            setFindOpen(false);
            setFindQuery("");
          }}
        />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {pickerAt && <BoardPicker at={pickerAt} onClose={() => setPickerAt(null)} />}

      {nodes.length === 0 && (
        <div className="empty-hint">
          <div className="empty-hint__title">Double-click anywhere to add a note</div>
          <div className="empty-hint__body">
            Drag from the dots on a note to link it to another idea. Press <kbd>Tab</kbd> to grow a linked note. Use the
            tools below for text, shapes, sections, drawing and images.
          </div>
        </div>
      )}

      <Dock onPickImage={pickImage} />
      <input
        ref={fileInput}
        type="file"
        accept={["image/png", "image/jpeg", "image/gif", "image/webp", ...FILE_EXTENSIONS.map((x) => `.${x}`)].join(",")}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          void addFiles(files, c).then((m) => m && setNotice(m));
        }}
      />

      <div className="dock dock--left">
        <ToolButton label="Zoom out (⌘−)" onClick={() => void rf.zoomOut({ duration: 150 })}>
          <MinusIcon />
        </ToolButton>
        <button
          type="button"
          className="zoom-readout"
          title="Reset to 100% (⇧0)"
          onClick={() => void rf.zoomTo(1, { duration: 200 })}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton label="Zoom in (⌘+)" onClick={() => void rf.zoomIn({ duration: 150 })}>
          <PlusIcon />
        </ToolButton>
        <ToolButton label="Fit everything (⇧1)" onClick={() => void rf.fitView(FIT_OPTIONS)}>
          <FitIcon />
        </ToolButton>
        <span className="bar-divider" />
        <HistoryButtons />
      </div>

      <div className="dock dock--right">
        {(aiSupported() || import.meta.env.DEV) && <ClaudeButton />}
        <ToolButton label="Mini map (M)" active={showMap} onClick={() => setShowMap((v) => !v)}>
          <MapIcon />
        </ToolButton>
        <ToolButton label="Shortcuts (?)" active={showHelp} onClick={() => setShowHelp((v) => !v)}>
          <HelpIcon />
        </ToolButton>
      </div>

      {helpShown && <HelpPanel leaving={helpLeaving} onClose={() => setShowHelp(false)} />}
      <AssistantPanel onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {presenting && <Presentation onExit={() => setPresenting(false)} />}
      {exportOpen && <ExportDialog initialFormat={exportOpen} onClose={() => setExportOpen(false)} onNotice={setNotice} />}
      {historyOpen && <VersionHistory onClose={() => setHistoryOpen(false)} onNotice={setNotice} />}
      {menu && (
        <ContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onExport={exportPng}
          onPickBoard={(at) => setPickerAt(at)}
        />
      )}
      <SelectionAnnouncer />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

/** "Link to a board": pick an existing board (or name a new one) and drop a card for it. */
function BoardPicker({ at, onClose }: { at: Point; onClose: () => void }) {
  const currentId = useBoard((s) => s.boardId);
  const boards = useBoardIndex((s) => s.boards);
  const commands = useMemo<Command[]>(
    () =>
      boards
        .filter((b) => b.id !== currentId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((b) => ({
          id: b.id,
          label: b.title,
          group: "Your boards",
          detail: `${b.nodes.length} item${b.nodes.length === 1 ? "" : "s"}`,
          icon: <BoardsIcon />,
          run: () => void boardStore.getState().addBoardCard(b.id, b.title, at),
        })),
    [boards, currentId, at],
  );
  const create = useCallback(
    (query: string): Command[] =>
      query && !findBoardByTitle(query)
        ? [
            {
              id: "create",
              label: `Create a board called “${query}”`,
              group: "New",
              icon: <PlusIcon />,
              run: () =>
                void createBoard(makeBoardDoc(query)).then((doc) => boardStore.getState().addBoardCard(doc.id, doc.title, at)),
            },
          ]
        : [],
    [at],
  );
  return <CommandPalette commands={commands} dynamic={create} placeholder="Link to which board? Type to search or name a new one" onClose={onClose} />;
}

/** Tells screen readers what's selected, so the board can be explored by keyboard. */
function SelectionAnnouncer() {
  const message = useBoard((s) => {
    const sel = s.nodes.filter((n) => n.selected);
    if (sel.length === 1) {
      const n = sel[0];
      const links = s.edges.filter((e) => e.source === n.id || e.target === n.id).length;
      return `${describe(n.type, n.data)}${links ? `. ${links} link${links === 1 ? "" : "s"}` : ""}. Selected.`;
    }
    return sel.length ? `${sel.length} items selected.` : "";
  });
  return (
    <div className="sr-only" aria-live="polite">
      {message}
    </div>
  );
}

/** Alignment lines shown while dragging. Kept one screen pixel thick at any zoom. */
function Guides() {
  const guides = useBoard((s) => s.guides);
  const zoom = useFlowStore((s) => s.transform[2]);
  if (!guides.length) return null;
  const t = 1 / zoom;
  return (
    <ViewportPortal>
      {guides.map((g, i) => (
        <div
          key={i}
          className="guide"
          style={
            g.axis === "x"
              ? { transform: `translate(${g.at - t / 2}px, ${g.from}px)`, width: t, height: g.to - g.from }
              : { transform: `translate(${g.from}px, ${g.at - t / 2}px)`, width: g.to - g.from, height: t }
          }
        />
      ))}
    </ViewportPortal>
  );
}

function HistoryButtons() {
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  return (
    <>
      <ToolButton label="Undo (⌘Z)" disabled={!canUndo} onClick={() => boardStore.getState().undo()}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => boardStore.getState().redo()}>
        <RedoIcon />
      </ToolButton>
    </>
  );
}

function TitleBar({
  status,
  onHome,
  back,
  onBack,
  onExport,
  onHistory,
  onPresent,
  onSettings,
}: {
  status: SaveStatus;
  onHome: () => void;
  back: TrailStep | null;
  onBack: () => void;
  onExport: () => void;
  onHistory: () => void;
  onPresent: () => void;
  onSettings: () => void;
}) {
  const title = useBoard((s) => s.title);
  const boardId = useBoard((s) => s.boardId);
  const boards = useBoardIndex((s) => s.boards);
  const linkedFrom = useMemo(() => backlinksTo({ id: boardId, title }), [boards, boardId, title]);
  const [showLinks, setShowLinks] = useState(false);
  const linksRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(linksRef, showLinks, useCallback(() => setShowLinks(false), []));
  const background = useBoard((s) => s.background);
  const snapping = useBoard((s) => s.snapping);
  const boardStyle = useBoard((s) => s.style);
  const [draft, setDraft] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [menu, setMenu] = useState(false);
  useDismiss(menuRef, menu, useCallback(() => setMenu(false), []));

  useEffect(() => {
    if (status !== "saved") return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 1400);
    return () => clearTimeout(t);
  }, [status]);

  const finish = () => {
    if (draft !== null) boardStore.getState().setTitle(draft.trim() || "Untitled board");
    setDraft(null);
  };

  return (
    <div className="title-bar" data-tauri-drag-region={IS_TAURI || undefined}>
      <ToolButton label={back ? "All boards" : "All boards (⌘[)"} onClick={onHome}>
        <BoardsIcon />
      </ToolButton>
      {back && (
        <button type="button" className="back-btn" title={keyLabel(`Back to “${back.title}” (⌘[)`)} onClick={onBack}>
          <BackIcon />
          <span>{back.title}</span>
        </button>
      )}
      <span className="bar-divider" />
      <input
        className="title-input"
        value={draft ?? title}
        size={Math.max((draft ?? title).length, 6)}
        aria-label="Board name"
        spellCheck={false}
        onFocus={() => setDraft(title)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
      {status === "error" ? (
        <span className="save-status is-error" title="Your latest changes are not saved yet">
          Couldn't save
        </span>
      ) : (
        <span className={`save-status${status === "saving" || showSaved ? " is-visible" : ""}`}>
          {status === "saving" ? "Saving…" : "Saved"}
        </span>
      )}
      {linkedFrom.length > 0 && (
        <div className="menu-anchor" ref={linksRef}>
          <button
            type="button"
            className={`backlinks-btn${showLinks ? " is-active" : ""}`}
            title="Boards that link here"
            onClick={() => setShowLinks((v) => !v)}
          >
            <BoardLinkIcon />
            {linkedFrom.length}
          </button>
          {showLinks && (
            <>
              <div className="menu" role="menu">
                <div className="menu__label">Linked from</div>
                {linkedFrom.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={() => {
                      setShowLinks(false);
                      void openBoard(b.id);
                    }}
                  >
                    <BoardsIcon /> <span>{b.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="menu-anchor" ref={menuRef}>
        <ToolButton label="Board options" active={menu} onClick={() => setMenu((v) => !v)}>
          <MoreIcon />
        </ToolButton>
        {menu && (
          <>
            <div className="menu" role="menu">
              <div className="menu__label">Appearance</div>
              <ThemeSwitch labels />
              <div className="menu__sep" />
              <div className="menu__label">Style</div>
              <div className="segmented">
                {(["clean", "sketchy"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`segmented__item${boardStyle === st ? " is-active" : ""}`}
                    onClick={() => boardStore.getState().setStyle(st)}
                  >
                    <span className={`style-sample style-sample--${st}`}>Aa</span>
                    {st === "clean" ? "Clean" : "Hand-drawn"}
                  </button>
                ))}
              </div>
              <div className="menu__sep" />
              <div className="menu__label">Background</div>
              <div className="segmented">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`segmented__item${background === b ? " is-active" : ""}`}
                    onClick={() => boardStore.getState().setBackground(b)}
                  >
                    <span className={`bg-sample bg-sample--${b}`} />
                    {BACKGROUND_NAMES[b]}
                  </button>
                ))}
              </div>
              <div className="menu__sep" />
              <label className="menu__item menu__toggle">
                <span>Snap to items</span>
                <input type="checkbox" checked={snapping} onChange={(e) => boardStore.getState().setSnapping(e.target.checked)} />
                <span className="switch" aria-hidden />
              </label>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(false);
                  onExport();
                }}
              >
                <span>Export…</span>
                <kbd className="menu__keys">{keyLabel("⇧⌘E")}</kbd>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(false);
                  onHistory();
                }}
              >
                <span>Version history…</span>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(false);
                  void saveAsTemplate(boardStore.getState()).then(
                    () => notify("Saved as a template. Find it on the home screen."),
                    () => notify("Couldn't save the template"),
                  );
                }}
              >
                <span>Save as template</span>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(false);
                  onPresent();
                }}
              >
                <span>Present sections</span>
                <kbd className="menu__keys">{keyLabel("⇧⌘P")}</kbd>
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(false);
                  onSettings();
                }}
              >
                <span>Settings…</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Double-click canvas", "New note"],
  ["Double-click an item", "Edit its text"],
  ["Drag an item's dot", "Link it (drop on empty space for a new note)"],
  ["Click an item's dot", "Add a linked note on that side"],
  ["Tab", "Add a linked note to the right"],
  ["Enter", "Edit selected item or link label"],
  ["Esc or ⌘Enter", "Finish editing"],
  ["Double-click link", "Add or edit its label"],
  ["V / H", "Select / Pan"],
  ["N / T / S / F", "Note / Text / Shape / Section"],
  ["P / E", "Pen / Eraser"],
  ["I", "Insert an image"],
  ["⌥⌘G", "Put selection in a section"],
  ["⇧⌘] / ⇧⌘[", "Bring to front / Send to back"],
  ["Hold ⌥ while dragging", "Move without snapping"],
  ["⇧ + drag in a section", "Select the items inside it"],
  ["Right-click", "More options"],
  ["⇧⌘E", "Export as PNG"],
  ["- [ ] in a note", "A to-do you can tick off"],
  ["# / - / **bold**", "Heading / Bullet / Bold in notes"],
  ["⌫", "Delete selection"],
  ["⌘Z / ⇧⌘Z", "Undo / Redo"],
  ["⌘C / ⌘X / ⌘V", "Copy / Cut / Paste (text, links, images)"],
  ["⌘D", "Duplicate"],
  ["⌘A", "Select all"],
  ["Arrow keys", "Nudge (hold ⇧ for more)"],
  ["Two-finger scroll", "Pan the board"],
  ["Pinch or ⌘ scroll", "Zoom"],
  ["Space + drag", "Pan"],
  ["⇧1 / ⇧2 / ⇧0", "Fit all / Zoom to selection / 100%"],
  ["⌘K", "Command palette: every action and board"],
  ["⌘J", "Ask Claude to build or change the board"],
  ["⌘F", "Find on this board"],
  ["⌥ + arrow keys", "Move to the nearest item in that direction"],
  ["⌘B / ⌘I", "Bold / Italic while typing"],
  ["#tag in a note", "A tag you can click to find"],
  ["⇧⌘P", "Present your sections as slides"],
  ["⌘G / ⇧⌘G", "Group / Ungroup"],
  ["⇧⌘L", "Lock or unlock"],
  ["⌥A / ⌥D / ⌥W / ⌥S", "Align left / right / top / bottom"],
  ["A / L", "Arrow or line / Lasso select"],
  ["Drag with the arrow tool", "Between two items: link them"],
  ["[[Board name]] in a note", "Link to (or create) another board"],
  ["C", "Fold or unfold a branch"],
  ["⌘[", "Back to the previous board, or all boards"],
];

function ClaudeButton() {
  const open = useChat((s) => s.open);
  const running = useChat((s) => s.running);
  return (
    <ToolButton label="Claude (⌘J)" active={open} onClick={() => chat.setState((c) => ({ open: !c.open }))}>
      <span className={running ? "claude-btn is-running" : "claude-btn"}>
        <SparkleIcon />
      </span>
    </ToolButton>
  );
}

function HelpPanel({ onClose, leaving }: { onClose: () => void; leaving: boolean }) {
  return (
    <div className={`help-panel${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Keyboard shortcuts">
      <div className="help-panel__head">
        <span>Shortcuts</span>
        <button type="button" className="help-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <dl>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="help-row">
            <dt>{keyLabel(keys)}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
