import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type { JavaInfo, JavaInstallation } from "@mc-server-manager/shared";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Common Java installation locations to scan, by platform.
 */
function getCommonJavaLocations(): string[] {
  const platform = os.platform();

  if (platform === "linux") {
    return [
      "/usr/bin/java",
      "/usr/lib/jvm/java-21-openjdk-amd64/bin/java",
      "/usr/lib/jvm/java-21-openjdk/bin/java",
      "/usr/lib/jvm/java-17-openjdk-amd64/bin/java",
      "/usr/lib/jvm/java-17-openjdk/bin/java",
      "/usr/lib/jvm/default-java/bin/java",
      "/snap/bin/java",
    ];
  }

  if (platform === "darwin") {
    return [
      "/usr/bin/java",
      "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java",
      "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java",
      "/opt/homebrew/opt/openjdk/bin/java",
      "/opt/homebrew/opt/openjdk@21/bin/java",
      "/opt/homebrew/opt/openjdk@17/bin/java",
      "/usr/local/opt/openjdk/bin/java",
    ];
  }

  if (platform === "win32") {
    return [
      "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",
      "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
      "C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe",
      "C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe",
      "C:\\Program Files\\Microsoft\\jdk-21\\bin\\java.exe",
      "C:\\Program Files\\Microsoft\\jdk-17\\bin\\java.exe",
    ];
  }

  return [];
}

/**
 * Parse `java -version` output to extract the version string.
 * Java outputs version info to stderr, e.g.:
 *   openjdk version "21.0.1" 2023-10-17
 *   OpenJDK Runtime Environment (build 21.0.1+12-29)
 *   OpenJDK 64-Bit Server VM (build 21.0.1+12-29, mixed mode, sharing)
 */
function parseJavaVersion(output: string): string | null {
  // Match patterns like: "21.0.1", "17.0.9", "1.8.0_392"
  const match = output.match(/version\s+"([^"]+)"/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Extract the major version number from a Java version string.
 * Examples: "21.0.1" -> 21, "17.0.9" -> 17, "1.8.0_392" -> 8
 */
export function getJavaMajorVersion(version: string): number {
  // Handle legacy 1.x format (Java 8 and earlier)
  if (version.startsWith("1.")) {
    const parts = version.split(".");
    return parseInt(parts[1], 10);
  }
  // Modern format: first number is the major version
  const parts = version.split(".");
  return parseInt(parts[0], 10);
}

/**
 * Try to get Java info from a specific binary path.
 */
async function probeJava(javaPath: string): Promise<JavaInfo | null> {
  try {
    // java -version outputs to stderr
    const { stderr } = await execFileAsync(javaPath, ["-version"], {
      timeout: 10_000,
    });
    const version = parseJavaVersion(stderr);
    if (version) {
      return {
        found: true,
        path: javaPath,
        version,
      };
    }
  } catch (err) {
    logger.debug({ err, path: javaPath }, "Java probe failed");
  }
  return null;
}

/**
 * Try to resolve the real path of 'java' on PATH using `which` (Unix) or `where` (Windows).
 */
async function findJavaOnPath(): Promise<string | null> {
  const cmd = os.platform() === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, ["java"], { timeout: 5_000 });
    const resolved = stdout.trim().split("\n")[0].trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch (err) {
    logger.debug({ err }, "Java not found on PATH via which/where");
  }
  return null;
}

/**
 * Detect Java installation on the system.
 * Search order:
 *   1. JAVA_HOME environment variable
 *   2. 'java' on PATH
 *   3. Common installation locations
 */
export async function detectJava(): Promise<JavaInfo> {
  // 1. Check JAVA_HOME
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const javaBin = path.join(
      javaHome,
      "bin",
      os.platform() === "win32" ? "java.exe" : "java",
    );
    const info = await probeJava(javaBin);
    if (info) {
      logger.debug(
        { path: javaBin, version: info.version },
        "Found Java via JAVA_HOME",
      );
      return info;
    }
  }

  // 2. Check PATH
  const pathJava = await findJavaOnPath();
  if (pathJava) {
    const info = await probeJava(pathJava);
    if (info) {
      logger.debug(
        { path: pathJava, version: info.version },
        "Found Java on PATH",
      );
      return info;
    }
  }

  // 3. Check common locations
  for (const loc of getCommonJavaLocations()) {
    const info = await probeJava(loc);
    if (info) {
      logger.debug(
        { path: loc, version: info.version },
        "Found Java at common location",
      );
      return info;
    }
  }

  logger.warn("Java not found on this system");
  return { found: false, path: null, version: null };
}

/**
 * Validate a specific java binary path provided by the user.
 */
export async function validateJavaPath(javaPath: string): Promise<JavaInfo> {
  const info = await probeJava(javaPath);
  if (info) {
    return info;
  }
  return { found: false, path: javaPath, version: null };
}

function parseJavaVendor(stderr: string): string {
  if (stderr.includes("Eclipse Adoptium") || stderr.includes("Temurin")) {
    return "Eclipse Adoptium";
  } else if (stderr.includes("Oracle") || stderr.includes("Java(TM)")) {
    return "Oracle";
  } else if (stderr.includes("Microsoft")) {
    return "Microsoft";
  } else if (stderr.includes("GraalVM")) {
    return "GraalVM";
  } else if (stderr.includes("Azul") || stderr.includes("Zulu")) {
    return "Azul Zulu";
  } else if (stderr.includes("Amazon") || stderr.includes("Corretto")) {
    return "Amazon Corretto";
  } else if (stderr.includes("OpenJDK")) {
    return "OpenJDK";
  }
  return "Unknown";
}

async function probeJavaInstallation(
  javaPath: string,
): Promise<JavaInstallation | null> {
  try {
    const { stderr } = await execFileAsync(javaPath, ["-version"], {
      timeout: 10_000,
    });
    const fullVersion = parseJavaVersion(stderr);
    if (!fullVersion) return null;
    const majorVersion = getJavaMajorVersion(fullVersion);
    if (isNaN(majorVersion)) return null;
    return {
      version: majorVersion,
      path: javaPath,
      vendor: parseJavaVendor(stderr),
      fullVersion,
    };
  } catch (err) {
    logger.debug({ err, path: javaPath }, "Java installation probe failed");
    return null;
  }
}

function getJavaSearchDirs(): string[] {
  const platform = os.platform();
  const dirs: string[] = [];

  if (platform === "linux") {
    dirs.push("/usr/lib/jvm");
    dirs.push("/usr/java");
  } else if (platform === "darwin") {
    dirs.push("/Library/Java/JavaVirtualMachines");
    dirs.push("/opt/homebrew/opt");
    dirs.push("/usr/local/opt");
  } else if (platform === "win32") {
    dirs.push("C:\\Program Files\\Java");
    dirs.push("C:\\Program Files\\Eclipse Adoptium");
    dirs.push("C:\\Program Files\\Microsoft\\jdk");
  }

  return dirs;
}

function javaBinName(): string {
  return os.platform() === "win32" ? "java.exe" : "java";
}

function discoverJavaBinsInDir(dir: string): string[] {
  const results: string[] = [];
  const binName = javaBinName();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    logger.debug({ err, dir }, "Failed to read Java search directory");
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dir, entry.name);

    // macOS: <name>.jdk/Contents/Home/bin/java
    const macosJava = path.join(entryPath, "Contents", "Home", "bin", binName);
    if (fs.existsSync(macosJava)) {
      results.push(macosJava);
      continue;
    }

    // Standard: <jdk-dir>/bin/java
    const stdJava = path.join(entryPath, "bin", binName);
    if (fs.existsSync(stdJava)) {
      results.push(stdJava);
    }
  }

  return results;
}

export async function detectAllJavaInstallations(
  dataDir?: string,
): Promise<JavaInstallation[]> {
  const seenPaths = new Set<string>();
  const installations: JavaInstallation[] = [];

  const tryAdd = async (javaBin: string): Promise<void> => {
    let canonical: string;
    try {
      canonical = fs.realpathSync(javaBin);
    } catch (err) {
      logger.debug(
        { err, path: javaBin },
        "Failed to resolve realpath for Java binary",
      );
      canonical = javaBin;
    }
    if (seenPaths.has(canonical)) return;

    const inst = await probeJavaInstallation(javaBin);
    if (inst) {
      seenPaths.add(canonical);
      installations.push(inst);
    }
  };

  // 1. JAVA_HOME
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const bin = path.join(javaHome, "bin", javaBinName());
    if (fs.existsSync(bin)) {
      await tryAdd(bin);
    }
  }

  // 2. PATH
  const pathJava = await findJavaOnPath();
  if (pathJava) {
    await tryAdd(pathJava);
  }

  // 3. Common system directories
  for (const dir of getJavaSearchDirs()) {
    if (!fs.existsSync(dir)) continue;
    const bins = discoverJavaBinsInDir(dir);
    for (const bin of bins) {
      await tryAdd(bin);
    }
  }

  // 4. Previously downloaded JDKs in launcher runtime dir
  if (dataDir) {
    const runtimeDir = path.join(dataDir, "launcher", "runtime");
    if (fs.existsSync(runtimeDir)) {
      const bins = discoverJavaBinsInDir(runtimeDir);
      for (const bin of bins) {
        await tryAdd(bin);
      }
      try {
        const entries = fs.readdirSync(runtimeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryPath = path.join(runtimeDir, entry.name);
          const nestedBins = discoverJavaBinsInDir(entryPath);
          for (const bin of nestedBins) {
            await tryAdd(bin);
          }
        }
      } catch (err) {
        logger.debug(
          { err, runtimeDir },
          "Failed to read launcher runtime directory",
        );
      }
    }
  }

  installations.sort((a, b) => b.version - a.version);

  return installations;
}

function findJavaBinaryInDir(dir: string): string | null {
  const binName = javaBinName();

  const direct = path.join(dir, "bin", binName);
  if (fs.existsSync(direct)) return direct;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    logger.debug(
      { err, dir },
      "Failed to read directory while searching for Java binary",
    );
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, "bin", binName);
    if (fs.existsSync(candidate)) return candidate;

    // macOS: dir/<subdir>/Contents/Home/bin/java
    const macCandidate = path.join(
      dir,
      entry.name,
      "Contents",
      "Home",
      "bin",
      binName,
    );
    if (fs.existsSync(macCandidate)) return macCandidate;
  }

  return null;
}

function getAdoptiumPlatform(): { os: string; arch: string } {
  const platform = os.platform();
  const arch = os.arch();

  let adoptiumOs: string;
  if (platform === "win32") adoptiumOs = "windows";
  else if (platform === "darwin") adoptiumOs = "mac";
  else if (platform === "linux") adoptiumOs = "linux";
  else throw new Error(`Unsupported OS: ${platform}`);

  let adoptiumArch: string;
  if (arch === "x64") adoptiumArch = "x64";
  else if (arch === "arm64") adoptiumArch = "aarch64";
  else throw new Error(`Unsupported architecture: ${arch}`);

  return { os: adoptiumOs, arch: adoptiumArch };
}

export async function downloadJava(
  version: number,
  dataDir: string,
): Promise<JavaInstallation> {
  const { os: adoptiumOs, arch: adoptiumArch } = getAdoptiumPlatform();

  const url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/${adoptiumOs}/${adoptiumArch}/jdk/hotspot/normal/eclipse`;

  logger.info({ version, url }, "Downloading Java from Adoptium");

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Failed to download Java ${version}: HTTP ${response.status}`,
    );
  }
  if (!response.body) {
    throw new Error("Empty response body from Adoptium");
  }

  const runtimeDir = path.join(
    dataDir,
    "launcher",
    "runtime",
    `java-${version}`,
  );
  fs.mkdirSync(runtimeDir, { recursive: true });

  const isWindows = os.platform() === "win32";
  const tmpFile = path.join(
    os.tmpdir(),
    `java-${version}-${Date.now()}${isWindows ? ".zip" : ".tar.gz"}`,
  );

  try {
    const fileStream = createWriteStream(tmpFile);
    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(nodeStream, fileStream);

    logger.info({ tmpFile }, "Download complete, extracting");

    if (isWindows) {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(tmpFile);
      zip.extractAllTo(runtimeDir, true);
    } else {
      await execFileAsync("tar", ["xzf", tmpFile, "-C", runtimeDir], {
        timeout: 120_000,
      });
    }

    const javaBinary = findJavaBinaryInDir(runtimeDir);
    if (!javaBinary) {
      throw new Error("Could not find java binary after extraction");
    }

    if (!isWindows) {
      try {
        fs.chmodSync(javaBinary, 0o755);
      } catch (err) {
        logger.debug({ err, path: javaBinary }, "Failed to chmod Java binary");
      }
    }

    const installation = await probeJavaInstallation(javaBinary);
    if (installation) {
      logger.info({ installation }, "Java downloaded and verified");
      return installation;
    }

    return {
      version,
      path: javaBinary,
      vendor: "Eclipse Adoptium",
      fullVersion: `${version}.0.0`,
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (err) {
      logger.debug(
        { err, tmpFile },
        "Failed to clean up temporary download file",
      );
    }
  }
}
