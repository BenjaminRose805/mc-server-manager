import * as yauzl from "yauzl-promise";
import type {
  ParsedModpack,
  ModpackEntry,
  ModSide,
  ModLoader,
} from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";

// ── Modrinth index.json shapes ──────────────────────────────────────

interface MrpackIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  dependencies: Record<string, string>;
  files: MrpackFile[];
}

interface MrpackFile {
  path: string;
  hashes: { sha1?: string; sha512?: string };
  env?: { client?: string; server?: string };
  downloads: string[];
  fileSize: number;
}

// ── CurseForge manifest.json shapes ─────────────────────────────────

interface CurseManifest {
  minecraft: {
    version: string;
    modLoaders: { id: string; primary: boolean }[];
  };
  manifestType: string;
  manifestVersion: number;
  name: string;
  version: string;
  files: CurseManifestFile[];
  overrides: string;
}

interface CurseManifestFile {
  projectID: number;
  fileID: number;
  required: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function readEntryAsString(entry: yauzl.Entry): Promise<string> {
  const stream = await entry.openReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function deriveModSideFromEnv(env?: {
  client?: string;
  server?: string;
}): ModSide {
  if (!env) return "both";

  const client = env.client ?? "unknown";
  const server = env.server ?? "unknown";

  const clientActive = client === "required" || client === "optional";
  const serverActive = server === "required" || server === "optional";

  if (clientActive && server === "unsupported") return "client";
  if (serverActive && client === "unsupported") return "server";
  if (clientActive && serverActive) return "both";

  return "unknown";
}

function detectLoader(dependencies: Record<string, string>): {
  loader: ModLoader;
  loaderVersion: string;
} {
  const loaderKeys: [string, ModLoader][] = [
    ["fabric-loader", "fabric"],
    ["neoforge", "neoforge"],
    ["forge", "forge"],
  ];

  for (const [key, loader] of loaderKeys) {
    if (key in dependencies) {
      return { loader, loaderVersion: dependencies[key] };
    }
  }

  return { loader: "forge", loaderVersion: "" };
}

// ── parseMrpack ─────────────────────────────────────────────────────

export async function parseMrpack(zipPath: string): Promise<ParsedModpack> {
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.open(zipPath);

    let indexEntry: yauzl.Entry | undefined;
    const overrideFiles: string[] = [];
    let hasServerOverrides = false;

    for await (const entry of zipFile) {
      if (entry.filename === "modrinth.index.json") {
        indexEntry = entry;
      }

      if (
        entry.filename.startsWith("overrides/") &&
        !entry.filename.endsWith("/")
      ) {
        overrideFiles.push(entry.filename.slice("overrides/".length));
      } else if (
        entry.filename.startsWith("server-overrides/") &&
        !entry.filename.endsWith("/")
      ) {
        hasServerOverrides = true;
        overrideFiles.push(entry.filename.slice("server-overrides/".length));
      }
    }

    if (!indexEntry) {
      throw new Error("modrinth.index.json not found in .mrpack file");
    }

    const rawJson = await readEntryAsString(indexEntry);
    const index: MrpackIndex = JSON.parse(rawJson) as MrpackIndex;

    const { loader, loaderVersion } = detectLoader(index.dependencies);
    const mcVersion = index.dependencies["minecraft"] ?? "";

    const entries: ModpackEntry[] = index.files.map((file) => ({
      path: file.path,
      downloadUrl: file.downloads[0] ?? "",
      fileSize: file.fileSize,
      hashes: file.hashes,
      side: deriveModSideFromEnv(file.env),
    }));

    logger.debug(
      {
        name: index.name,
        loader,
        mcVersion,
        entries: entries.length,
        overrides: overrideFiles.length,
      },
      "Parsed .mrpack modpack",
    );

    return {
      name: index.name,
      versionId: index.versionId,
      mcVersion,
      loader,
      loaderVersion,
      entries,
      overrideFileCount: overrideFiles.length,
      hasServerOverrides,
      overrideFiles,
    };
  } finally {
    if (zipFile) {
      await zipFile.close();
    }
  }
}

// ── parseCurseForgeManifest ─────────────────────────────────────────

export async function parseCurseForgeManifest(
  zipPath: string,
): Promise<ParsedModpack> {
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.open(zipPath);

    let manifestEntry: yauzl.Entry | undefined;
    const allEntries: string[] = [];

    for await (const entry of zipFile) {
      allEntries.push(entry.filename);
      if (entry.filename === "manifest.json") {
        manifestEntry = entry;
      }
    }

    if (!manifestEntry) {
      throw new Error("manifest.json not found in CurseForge modpack ZIP");
    }

    const rawJson = await readEntryAsString(manifestEntry);
    const manifest: CurseManifest = JSON.parse(rawJson) as CurseManifest;

    const mcVersion = manifest.minecraft.version;

    // Parse loader from id like "forge-47.2.0" or "neoforge-21.1.77"
    let loader: ModLoader = "forge";
    let loaderVersion = "";
    const primaryLoader = manifest.minecraft.modLoaders.find(
      (ml) => ml.primary,
    );
    if (primaryLoader) {
      const dashIdx = primaryLoader.id.indexOf("-");
      if (dashIdx !== -1) {
        const loaderName = primaryLoader.id.slice(0, dashIdx);
        loaderVersion = primaryLoader.id.slice(dashIdx + 1);
        if (loaderName === "fabric") loader = "fabric";
        else if (loaderName === "neoforge") loader = "neoforge";
        else loader = "forge";
      }
    }

    const entries: ModpackEntry[] = manifest.files.map((file) => ({
      path: `mods/${file.projectID}-${file.fileID}.jar`,
      downloadUrl: "",
      fileSize: 0,
      side: "unknown" as ModSide,
      curseforgeProjectId: file.projectID,
      curseforgeFileId: file.fileID,
    }));

    const overridesDir = manifest.overrides || "overrides";
    const overridePrefix = overridesDir.endsWith("/")
      ? overridesDir
      : `${overridesDir}/`;
    const overrideFiles = allEntries
      .filter((name) => name.startsWith(overridePrefix) && !name.endsWith("/"))
      .map((name) => name.slice(overridePrefix.length));

    logger.debug(
      {
        name: manifest.name,
        loader,
        mcVersion,
        entries: entries.length,
        overrides: overrideFiles.length,
      },
      "Parsed CurseForge modpack",
    );

    return {
      name: manifest.name,
      versionId: manifest.version,
      mcVersion,
      loader,
      loaderVersion,
      entries,
      overrideFileCount: overrideFiles.length,
      hasServerOverrides: false,
      overrideFiles,
    };
  } finally {
    if (zipFile) {
      await zipFile.close();
    }
  }
}
