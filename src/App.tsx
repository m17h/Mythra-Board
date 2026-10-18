import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import BoardView from "./BoardView";
import Home from "./Home";
import { closeEditor, onSaveStatus, openInEditor, saveOnQuit, type SaveStatus } from "./persistence";
import type { BoardDoc } from "./store";

type Screen = { name: "home" } | { name: "board"; id: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    onSaveStatus(setStatus);
    void saveOnQuit();
  }, []);

  const open = useCallback((doc: BoardDoc) => {
    openInEditor(doc);
    setScreen({ name: "board", id: doc.id });
  }, []);

  const goHome = useCallback(async () => {
    await closeEditor();
    setScreen({ name: "home" });
  }, []);

  if (screen.name === "home") return <Home onOpen={open} />;
  return (
    <ReactFlowProvider key={screen.id}>
      <BoardView status={status} onHome={() => void goHome()} />
    </ReactFlowProvider>
  );
}
