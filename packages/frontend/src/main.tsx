import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";
import { isTauri } from "./utils/tauri";
import { waitForBackend } from "./utils/wait-for-backend";
import "./index.css";

async function init() {
  if (isTauri()) {
    await waitForBackend();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

init();
