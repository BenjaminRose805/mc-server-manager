import type {
  MSAuthDeviceCode,
  MSAuthStatus,
  LauncherAccount,
  GameProcess,
  JavaInstallation,
} from "@mc-server-manager/shared";

export interface ElectronAPI {
  platform: string;

  // Auth
  msAuthStart(): Promise<MSAuthDeviceCode>;
  msAuthPoll(): Promise<MSAuthStatus>;
  msAuthCancel(): Promise<void>;
  msAuthRefresh(uuid: string): Promise<LauncherAccount>;
  getMcAccessToken(uuid: string): Promise<string>;
  removeAccount(uuid: string): Promise<void>;

  // Game launcher
  launchGame(instanceId: string, accountId: string): Promise<GameProcess>;
  getRunningGames(): Promise<GameProcess[]>;
  killGame(instanceId: string): Promise<void>;

  // Java management
  getJavaInstallations(): Promise<JavaInstallation[]>;
  downloadJava(version: number): Promise<JavaInstallation>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
