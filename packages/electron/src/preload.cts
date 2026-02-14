import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  msAuthStart: () => ipcRenderer.invoke("ms-auth-start"),
  msAuthPoll: () => ipcRenderer.invoke("ms-auth-poll"),
  msAuthRefresh: (uuid: string) =>
    ipcRenderer.invoke("ms-auth-refresh", { uuid }),
  getMcAccessToken: (uuid: string) =>
    ipcRenderer.invoke("get-mc-access-token", { uuid }),
  removeAccount: (uuid: string) =>
    ipcRenderer.invoke("remove-account", { uuid }),

  launchGame: (instanceId: string, accountId: string) =>
    ipcRenderer.invoke("launch-game", { instanceId, accountId }),
  getRunningGames: () => ipcRenderer.invoke("get-running-games"),
  killGame: (instanceId: string) =>
    ipcRenderer.invoke("kill-game", { instanceId }),

  getJavaInstallations: () => ipcRenderer.invoke("get-java-installations"),
  downloadJava: (version: number) =>
    ipcRenderer.invoke("download-java", { version }),
});
