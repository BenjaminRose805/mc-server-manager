import { EventEmitter } from "node:events";
import type { ModpackInstallProgress } from "@mc-server-manager/shared";

interface EventBusEvents {
  "modpack:progress": [serverId: string, progress: ModpackInstallProgress];
  "modpack:update": [
    serverId: string,
    modpackId: string,
    latestVersionId: string,
    latestVersionNumber: string,
  ];
}

class TypedEventBus {
  private emitter = new EventEmitter();

  emit<K extends keyof EventBusEvents>(
    event: K,
    ...args: EventBusEvents[K]
  ): void {
    this.emitter.emit(event, ...args);
  }

  on<K extends keyof EventBusEvents>(
    event: K,
    listener: (...args: EventBusEvents[K]) => void,
  ): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventBusEvents>(
    event: K,
    listener: (...args: EventBusEvents[K]) => void,
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }
}

export const eventBus = new TypedEventBus();
