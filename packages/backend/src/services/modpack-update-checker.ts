import type { ModpackUpdateInfo } from "@mc-server-manager/shared";
import { getModpackById, getModpacksByServerId } from "../models/modpack.js";
import { getAllServers } from "../models/server.js";
import { getModpackVersions } from "./modpack-manager.js";
import { eventBus } from "./event-bus.js";
import { logger } from "../utils/logger.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let periodicInterval: ReturnType<typeof setInterval> | null = null;

export async function checkModpackUpdate(
  modpackId: string,
): Promise<ModpackUpdateInfo> {
  const modpack = getModpackById(modpackId);
  const versions = await getModpackVersions(modpack.source, modpack.sourceId);

  const latest = versions[0];

  const updateAvailable =
    latest !== undefined && latest.versionId !== modpack.versionId;

  return {
    modpackId: modpack.id,
    currentVersionId: modpack.versionId,
    currentVersionNumber: modpack.versionNumber,
    latestVersionId: latest?.versionId ?? modpack.versionId,
    latestVersionNumber: latest?.versionNumber ?? modpack.versionNumber,
    latestMcVersions: latest?.mcVersions ?? [],
    latestLoaders: latest?.loaders ?? [],
    updateAvailable,
  };
}

export function startPeriodicUpdateCheck(): void {
  logger.info("Starting periodic modpack update checker (every 24h)");

  const runCheck = async () => {
    const servers = getAllServers();
    let totalChecked = 0;
    let updatesFound = 0;

    for (const server of servers) {
      const modpacks = getModpacksByServerId(server.id);

      for (const modpack of modpacks) {
        try {
          const info = await checkModpackUpdate(modpack.id);
          totalChecked++;

          if (info.updateAvailable) {
            updatesFound++;
            eventBus.emit(
              "modpack:update",
              server.id,
              modpack.id,
              info.latestVersionId,
              info.latestVersionNumber,
            );
          }
        } catch (err) {
          logger.warn(
            { err, modpackId: modpack.id, serverId: server.id },
            "Failed to check modpack update",
          );
        }
      }
    }

    logger.info(
      { totalChecked, updatesFound },
      "Periodic modpack update check completed",
    );
  };

  runCheck();
  periodicInterval = setInterval(runCheck, CHECK_INTERVAL_MS);
}

export function stopPeriodicUpdateCheck(): void {
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
    logger.info("Stopped periodic modpack update checker");
  }
}
