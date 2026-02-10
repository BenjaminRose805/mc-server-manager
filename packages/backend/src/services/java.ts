import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { JavaInfo } from '@mc-server-manager/shared';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Common Java installation locations to scan, by platform.
 */
function getCommonJavaLocations(): string[] {
  const platform = os.platform();

  if (platform === 'linux') {
    return [
      '/usr/bin/java',
      '/usr/lib/jvm/java-21-openjdk-amd64/bin/java',
      '/usr/lib/jvm/java-21-openjdk/bin/java',
      '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
      '/usr/lib/jvm/java-17-openjdk/bin/java',
      '/usr/lib/jvm/default-java/bin/java',
      '/snap/bin/java',
    ];
  }

  if (platform === 'darwin') {
    return [
      '/usr/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java',
      '/opt/homebrew/opt/openjdk/bin/java',
      '/opt/homebrew/opt/openjdk@21/bin/java',
      '/opt/homebrew/opt/openjdk@17/bin/java',
      '/usr/local/opt/openjdk/bin/java',
    ];
  }

  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe',
      'C:\\Program Files\\Microsoft\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Microsoft\\jdk-17\\bin\\java.exe',
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
  if (version.startsWith('1.')) {
    const parts = version.split('.');
    return parseInt(parts[1], 10);
  }
  // Modern format: first number is the major version
  const parts = version.split('.');
  return parseInt(parts[0], 10);
}

/**
 * Try to get Java info from a specific binary path.
 */
async function probeJava(javaPath: string): Promise<JavaInfo | null> {
  try {
    // java -version outputs to stderr
    const { stderr } = await execFileAsync(javaPath, ['-version'], {
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
  } catch {
    // Binary not found or not executable — ignore
  }
  return null;
}

/**
 * Try to resolve the real path of 'java' on PATH using `which` (Unix) or `where` (Windows).
 */
async function findJavaOnPath(): Promise<string | null> {
  const cmd = os.platform() === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, ['java'], { timeout: 5_000 });
    const resolved = stdout.trim().split('\n')[0].trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // 'which' returns non-zero if not found
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
    const javaBin = path.join(javaHome, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
    const info = await probeJava(javaBin);
    if (info) {
      logger.debug({ path: javaBin, version: info.version }, 'Found Java via JAVA_HOME');
      return info;
    }
  }

  // 2. Check PATH
  const pathJava = await findJavaOnPath();
  if (pathJava) {
    const info = await probeJava(pathJava);
    if (info) {
      logger.debug({ path: pathJava, version: info.version }, 'Found Java on PATH');
      return info;
    }
  }

  // 3. Check common locations
  for (const loc of getCommonJavaLocations()) {
    const info = await probeJava(loc);
    if (info) {
      logger.debug({ path: loc, version: info.version }, 'Found Java at common location');
      return info;
    }
  }

  logger.warn('Java not found on this system');
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
