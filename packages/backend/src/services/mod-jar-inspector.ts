import * as yauzl from "yauzl-promise";
import { parse as parseToml } from "smol-toml";
import type { ModSide } from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";

interface InspectResult {
  side: ModSide;
  source: string;
}

async function readEntryAsString(entry: yauzl.Entry): Promise<string> {
  const stream = await entry.openReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseFabricSide(json: Record<string, unknown>): ModSide {
  const env = json.environment;
  if (env === "client") return "client";
  if (env === "server") return "server";
  return "both";
}

function parseForgeSide(
  tomlData: Record<string, unknown>,
  tomlSource: string,
): InspectResult {
  const modsArray = tomlData.mods;
  if (!Array.isArray(modsArray) || modsArray.length === 0) {
    return { side: "both", source: tomlSource };
  }

  const modId = (modsArray[0] as Record<string, unknown>).modId;
  if (typeof modId !== "string") {
    return { side: "both", source: tomlSource };
  }

  const deps = tomlData.dependencies;
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    return { side: "both", source: tomlSource };
  }

  const modDeps = (deps as Record<string, unknown>)[modId];
  if (!Array.isArray(modDeps)) {
    return { side: "both", source: tomlSource };
  }

  const relevantIds = new Set(["minecraft", "forge", "neoforge"]);
  const sides: string[] = [];

  for (const dep of modDeps) {
    if (typeof dep !== "object" || dep === null) continue;
    const depRecord = dep as Record<string, unknown>;
    const depModId = depRecord.modId;
    if (typeof depModId === "string" && relevantIds.has(depModId)) {
      const side = depRecord.side;
      if (typeof side === "string") {
        sides.push(side.toUpperCase());
      }
    }
  }

  if (sides.length === 0) {
    return { side: "both", source: tomlSource };
  }

  if (sides.every((s) => s === "CLIENT")) {
    return { side: "client", source: tomlSource };
  }

  if (sides.every((s) => s === "SERVER")) {
    return { side: "server", source: tomlSource };
  }

  return { side: "both", source: tomlSource };
}

export async function inspectModJar(jarPath: string): Promise<InspectResult> {
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.open(jarPath);

    let fabricEntry: yauzl.Entry | undefined;
    let neoforgeEntry: yauzl.Entry | undefined;
    let forgeEntry: yauzl.Entry | undefined;

    for await (const entry of zipFile) {
      if (entry.filename === "fabric.mod.json") {
        fabricEntry = entry;
      } else if (entry.filename === "META-INF/neoforge.mods.toml") {
        neoforgeEntry = entry;
      } else if (entry.filename === "META-INF/mods.toml") {
        forgeEntry = entry;
      }
    }

    if (fabricEntry) {
      const content = await readEntryAsString(fabricEntry);
      const json = JSON.parse(content) as Record<string, unknown>;
      const side = parseFabricSide(json);
      return { side, source: "fabric.mod.json" };
    }

    const tomlEntry = neoforgeEntry ?? forgeEntry;
    if (tomlEntry) {
      const content = await readEntryAsString(tomlEntry);
      const tomlData = parseToml(content) as Record<string, unknown>;
      return parseForgeSide(tomlData, tomlEntry.filename);
    }

    return { side: "unknown", source: "none" };
  } catch (err) {
    logger.warn({ err }, "Failed to inspect mod JAR");
    return { side: "unknown", source: "none" };
  } finally {
    if (zipFile) {
      await zipFile.close();
    }
  }
}
