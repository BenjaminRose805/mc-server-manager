import { Tray, Menu, nativeImage, type BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function createTray(
  mainWindow: BrowserWindow,
  onQuit: () => void,
): Tray {
  const iconPath = path.join(__dirname, "..", "assets", "tray-icon.png");
  const icon = nativeImage.createEmpty();

  try {
    const loaded = nativeImage.createFromPath(iconPath);
    if (!loaded.isEmpty()) {
      tray = new Tray(loaded.resize({ width: 16, height: 16 }));
    } else {
      tray = new Tray(icon);
    }
  } catch {
    tray = new Tray(icon);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: onQuit,
    },
  ]);

  tray.setToolTip("MC Server Manager");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}
