import { ipcMain } from "electron";
import type { PrepareResponse } from "@mc-server-manager/shared";
import * as auth from "./auth.js";
import * as launcher from "./launcher.js";

// Electron strips non-standard Error properties across the IPC boundary,
// so we re-throw as plain Error with just the message string.
function serializableHandler<T>(
  fn: (args: Record<string, unknown>) => T | Promise<T>,
): (
  _event: Electron.IpcMainInvokeEvent,
  args?: Record<string, unknown>,
) => Promise<T> {
  return async (_event, args = {}) => {
    try {
      return await fn(args);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(
    "ms-auth-start",
    serializableHandler(() => auth.msAuthStart()),
  );

  ipcMain.handle(
    "ms-auth-poll",
    serializableHandler(() => auth.msAuthPoll()),
  );

  ipcMain.handle(
    "ms-auth-cancel",
    serializableHandler(() => auth.msAuthCancel()),
  );

  ipcMain.handle(
    "ms-auth-refresh",
    serializableHandler((args) => auth.msAuthRefresh(args.uuid as string)),
  );

  ipcMain.handle(
    "get-mc-access-token",
    serializableHandler((args) => auth.getMcAccessToken(args.uuid as string)),
  );

  ipcMain.handle(
    "remove-account",
    serializableHandler((args) => auth.removeAccount(args.uuid as string)),
  );

  ipcMain.handle(
    "launch-game",
    serializableHandler((args) =>
      launcher.launchGame(
        args.instanceId as string,
        args.accountId as string,
        args.prepareResult as PrepareResponse,
      ),
    ),
  );

  ipcMain.handle(
    "get-running-games",
    serializableHandler(() => launcher.getRunningGames()),
  );

  ipcMain.handle(
    "kill-game",
    serializableHandler((args) => launcher.killGame(args.instanceId as string)),
  );

  ipcMain.handle(
    "get-java-installations",
    serializableHandler(async () => {
      const port = process.env.PORT ?? "3001";
      const res = await fetch(`http://localhost:${port}/api/launcher/java`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to get Java installations: ${body}`);
      }
      return res.json();
    }),
  );

  ipcMain.handle(
    "download-java",
    serializableHandler(async (args) => {
      const port = process.env.PORT ?? "3001";
      const res = await fetch(
        `http://localhost:${port}/api/launcher/java/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: args.version }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to download Java: ${body}`);
      }
      return res.json();
    }),
  );
}
