import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import BoardView from "./BoardView";
import Home from "./Home";
import { setNavigator, updateIndexedBoard } from "./navigation";
import { closeEditor, currentDoc, loadBoard, onSaveStatus, openInEditor, saveOnQuit, type SaveStatus } from "./persistence";
import { boardStore, type BoardDoc } from "./store";

type Screen = { name: "home" } | { name: "board"; id: string };
export type TrailStep = { id: string; title: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Boards you followed links from, most recent last, so Back can retrace them.
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    onSaveStatus(setStatus);
    void saveOnQuit();
  }, []);

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

  const open = useCallback(
    async (doc: BoardDoc) => {
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
      await leaveBoard();
      setTrail((t) => (from ? [...t, from] : []));
      show(doc);
    });
  }, [leaveBoard, show]);

  const goBack = useCallback(async () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    const doc = await loadBoard(prev.id);
    await leaveBoard();
    setTrail((t) => t.slice(0, -1));
    if (doc) show(doc);
    else setScreen({ name: "home" });
  }, [trail, leaveBoard, show]);

  const goHome = useCallback(async () => {
    await leaveBoard();
    setTrail([]);
    setScreen({ name: "home" });
  }, [leaveBoard]);

  if (screen.name === "home") return <Home onOpen={(doc) => void open(doc)} />;
  return (
    <ReactFlowProvider key={screen.id}>
      <BoardView
        status={status}
        onHome={() => void goHome()}
        back={trail[trail.length - 1] ?? null}
        onBack={() => void goBack()}
      />
    </ReactFlowProvider>
  );
}
