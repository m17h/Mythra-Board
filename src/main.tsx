import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/base.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-700.css";
import "./styles.css";
import App from "./App";
import { initTheme } from "./theme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
