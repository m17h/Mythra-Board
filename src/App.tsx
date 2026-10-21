import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import BoardView from "./BoardView";
import Home from "./Home";
import { importBoardFile } from "./boardFile";
import { listenToMenu, onMenu, typingNow, undoText } from "./menuEvents";
import {
  createBoard,
  focusOnOpen,
  followRenamesFromOtherWindows,
  makeBoardDoc,
  refreshBoardIndex,
  setNavigator,
  updateIndexedBoard,
} from "./navigation";
import { setThemeSetting, type ThemeSetting } from "./theme";
import {
  closeEditor,
  currentDoc,
  loadBoard,
  onSaveStatus,
  openInEditor,
  pickBoardFile,
  saveOnQuit,
  type SaveStatus,
} from "./persistence";
import { boardStore, type BoardDoc } from "./store";
import { claimBoard, onWindowFocus, openWindow, startBoard } from "./windows";
import { checkNowAndThen, saveWhenAsked } from "./updates";
import { UpdateNotice } from "./components/UpdateNotice";

type Screen = { name: "starting" } | { name: "home" } | { name: "board"; id: string };
export type TrailStep = { id: string; title: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "starting" });
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Boards you followed links from, most recent last, so Back can retrace them.
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    onSaveStatus(setStatus);
    void saveOnQuit();
    void listenToMenu();
    followRenamesFromOtherWindows();
    saveWhenAsked();
    checkNowAndThen();
  }, []);

  // Other windows may have changed boards: catch up (for links and backlinks) on coming back.
  useEffect(() => onWindowFocus(() => {
    if (screenRef.current.name === "board") void refreshBoardIndex().catch(() => {});
  }), []);

  /** Save the open board and keep the board index in step with it. */
  const leaveBoard = useCallback(async () => {
    if (screenRef.current.name !== "board") return;
    await closeEditor();
    updateIndexedBoard(currentDoc());
  }, []);

  const show = useCallback((doc: BoardDoc) => {
    openInEditor(doc);
    setScreen({ name: "board", id: doc.id });
  }, []);

  // A window opened for a particular board starts on it; otherwise on the home screen.
  useEffect(() => {
    void startBoard()
      .then((id) => (id ? loadBoard(id) : null))
      .then(
        (doc) => (doc ? show(doc) : setScreen({ name: "home" })),
        () => setScreen({ name: "home" }),
      );
  }, [show]);

  const open = useCallback(
    async (doc: BoardDoc) => {
      // Already open in another window: that window comes forward instead.
      if (!(await claimBoard(doc.id))) return;
      await leaveBoard();
      setTrail([]);
      show(doc);
    },
    [leaveBoard, show],
  );

  // Following a link from one board to another remembers where you came from.
  useEffect(() => {
    setNavigator(async (id) => {
      const from = screenRef.current.name === "board" ? { id: boardStore.getState().boardId, title: boardStore.getState().title } : null;
      if (from?.id === id) return;
      const doc = await loadBoard(id);
      if (!doc) return;
      if (!(await claimBoard(id))) {
        focusOnOpen(null);
        return;
      }
      await leaveBoard();
      setTrail((t) => (from ? [...t, from] : []));
      show(doc);
    });
  }, [leaveBoard, show]);

  const goBack = useCallback(async () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    const doc = await loadBoard(prev.id);
    if (doc && !(await claimBoard(doc.id))) return;
    await leaveBoard();
    setTrail((t) => t.slice(0, -1));
    if (doc) show(doc);
    else {
      void claimBoard(null);
      setScreen({ name: "home" });
    }
  }, [trail, leaveBoard, show]);

  const goHome = useCallback(async () => {
    await leaveBoard();
    await claimBoard(null);
    setTrail([]);
    setScreen({ name: "home" });
  }, [leaveBoard]);

  // Menu items that work anywhere in the app.
  useEffect(
    () =>
      onMenu((id) => {
        // Off a board, Undo and Redo only apply to text fields.
        if (id === "undo" || id === "redo") {
          if (typingNow()) undoText(id === "redo");
          return true;
        }
        if (id.startsWith("theme-")) {
          setThemeSetting(id.slice(6) as ThemeSetting);
          return true;
        }
        if (id === "all-boards") {
          void goHome();
          return true;
        }
        if (id === "back") {
          void goBack();
          return true;
        }
        if (id === "new-window") {
          void openWindow();
          return true;
        }
        if (id === "new-board") {
          void createBoard(makeBoardDoc("Untitled board")).then(open);
          return true;
        }
        if (id === "open-file") {
          void pickBoardFile()
            .then((text) => (text ? importBoardFile(text).then(open) : undefined))
            .catch((err) => console.error("Couldn't open that file", err));
          return true;
        }
        return false;
      }),
    [goHome, goBack, open],
  );

  if (screen.name === "starting") return null;
  return (
    <>
      {screen.name === "home" ? (
        <Home onOpen={(doc) => void open(doc)} />
      ) : (
        <ReactFlowProvider key={screen.id}>
          <BoardView
            status={status}
            onHome={() => void goHome()}
            back={trail[trail.length - 1] ?? null}
            onBack={() => void goBack()}
          />
        </ReactFlowProvider>
      )}
      <UpdateNotice />
    </>
  );
}
