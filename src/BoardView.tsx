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
import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { CanvasGestures } from "./components/CanvasGestures";
import { ContextMenu, type MenuTarget } from "./components/ContextMenu";
import { Dock } from "./components/Dock";
import { BoardsIcon, FitIcon, HelpIcon, MapIcon, MinusIcon, MoreIcon, PlusIcon, RedoIcon, UndoIcon } from "./components/icons";
import { nodeTypes } from "./components/items";
import { edgeTypes } from "./components/LinkLine";
import LinkPreview from "./components/LinkPreview";
import { LinkToolbar, SelectionToolbar, ToolButton } from "./components/Toolbars";
import { addImages } from "./images";
import { rectOf } from "./layout";
import { isTauri, type SaveStatus } from "./persistence";
import { boardStore, pauseSnapping, setSnapZoom, useBoard } from "./store";
import { BACKGROUNDS, DEFAULT_NOTE_WIDTH, type BoardBackground, type BoardNode, type Color, type LinkEdge } from "./types";
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

export default function BoardView({ status, onHome }: { status: SaveStatus; onHome: () => void }) {
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const tool = useBoard((s) => s.tool);
  const background = useBoard((s) => s.background);
  const connecting = useBoard((s) => s.connecting);
  const editingId = useBoard((s) => s.editingId);
  const [showHelp, setShowHelp] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
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

  const exportPng = useCallback(async () => {
    const s = boardStore.getState();
    if (!s.nodes.length) {
      setNotice("Add something to the board first");
      return;
    }
    s.stopEditing();
    s.clearSelection();
    setNotice("Exporting…");
    // Let the deselection paint so selection outlines don't end up in the picture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      // Loaded on first use so it doesn't slow down opening the app.
      const { exportBoardPng } = await import("./exportImage");
      const saved = await exportBoardPng(boardStore.getState().nodes, s.title);
      setNotice(saved ? "Exported" : null);
    } catch (err) {
      console.error("Export failed", err);
      setNotice("Couldn't export the board");
    }
  }, []);

  useEffect(() => {
    if (!notice || notice === "Exporting…") return;
    const t = setTimeout(() => setNotice(null), 2500);
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
    goHome: onHome,
    exportPng: () => void exportPng(),
  });

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
    void addImages(files, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const drawing = tool === "pen" || tool === "eraser" || tool === "shape" || tool === "frame";

  return (
    <div
      ref={container}
      className={`app board tool-${tool}${drawing ? " is-drawing" : ""}${connecting ? " is-connecting" : ""}${IS_TAURI ? " is-tauri" : ""}`}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <ReactFlow<BoardNode, LinkEdge>
        nodes={nodes}
        edges={edges}
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
        onInit={(instance) => setSnapZoom(instance.getZoom())}
        defaultViewport={initialViewport.current ?? undefined}
        fitView={fitOnOpen.current}
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.1}
        maxZoom={3}
        zoomOnDoubleClick={false}
        panOnScroll
        zoomOnPinch
        panOnDrag={tool === "hand" ? true : [1]}
        selectionOnDrag={tool === "select"}
        selectionMode={SelectionMode.Full}
        nodesDraggable={tool !== "hand" && !drawing}
        elementsSelectable={tool !== "hand" && !drawing}
        elevateNodesOnSelect={false}
        multiSelectionKeyCode={["Shift", "Meta"]}
        deleteKeyCode={null}
        disableKeyboardA11y
        nodeDragThreshold={2}
        onlyRenderVisibleElements={nodes.length > 400}
        colorMode="system"
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
        <SelectionToolbar />
        <LinkToolbar />
        <CanvasGestures container={container} />
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

      <TitleBar status={status} onHome={onHome} onExport={() => void exportPng()} />

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
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          void addImages(files, c);
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
        <ToolButton label="Mini map (M)" active={showMap} onClick={() => setShowMap((v) => !v)}>
          <MapIcon />
        </ToolButton>
        <ToolButton label="Shortcuts (?)" active={showHelp} onClick={() => setShowHelp((v) => !v)}>
          <HelpIcon />
        </ToolButton>
      </div>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {menu && <ContextMenu target={menu} onClose={() => setMenu(null)} onExport={() => void exportPng()} />}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
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

function TitleBar({ status, onHome, onExport }: { status: SaveStatus; onHome: () => void; onExport: () => void }) {
  const title = useBoard((s) => s.title);
  const background = useBoard((s) => s.background);
  const snapping = useBoard((s) => s.snapping);
  const [draft, setDraft] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [menu, setMenu] = useState(false);

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
      <ToolButton label="All boards (⌘[)" onClick={onHome}>
        <BoardsIcon />
      </ToolButton>
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
      <div className="menu-anchor">
        <ToolButton label="Board options" active={menu} onClick={() => setMenu((v) => !v)}>
          <MoreIcon />
        </ToolButton>
        {menu && (
          <>
            <div className="menu-scrim" onPointerDown={() => setMenu(false)} />
            <div className="menu" role="menu">
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
                <span>Export as PNG…</span>
                <kbd className="menu__keys">⇧⌘E</kbd>
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
  ["⌘[", "Back to all boards"],
];

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-panel" role="dialog" aria-label="Keyboard shortcuts">
      <div className="help-panel__head">
        <span>Shortcuts</span>
        <button type="button" className="help-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <dl>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="help-row">
            <dt>{keys}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
