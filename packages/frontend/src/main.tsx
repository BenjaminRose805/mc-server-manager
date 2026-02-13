import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";
import { isDesktop } from "./utils/desktop";
import { waitForBackend } from "./utils/wait-for-backend";
import "./index.css";

async function init() {
  if (isDesktop()) {
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
