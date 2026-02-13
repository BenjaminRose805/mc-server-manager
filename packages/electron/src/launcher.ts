import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { getMcAccessToken } from "./auth.js";
import type {
  GameProcess,
  LauncherInstance,
  LauncherAccount,
  JavaInstallation,
  PrepareResponse,
} from "@mc-server-manager/shared";

const BACKEND_PORT = process.env.BACKEND_PORT
  ? parseInt(process.env.BACKEND_PORT, 10)
  : 3001;

function baseUrl(): string {
  return `http://localhost:${BACKEND_PORT}`;
}

interface RunningGame {
  process: GameProcess;
  child: ChildProcess;
}

const runningGames: RunningGame[] = [];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${init?.method ?? "GET"} ${url} failed (${res.status}): ${body}`,
    );
  }
  return res.json() as Promise<T>;
}

async function resolveJavaPath(instance: LauncherInstance): Promise<string> {
  if (instance.javaPath) {
    return instance.javaPath;
  }

  const installations = await fetchJson<JavaInstallation[]>(
    `${baseUrl()}/api/launcher/java`,
  );

  const matching = installations.find(
    (j) => j.version === instance.javaVersion,
  );

  if (matching) {
    return matching.path;
  }

  throw new Error(
    `Java ${instance.javaVersion} not found. Please install it or specify a custom path.`,
  );
}

export async function launchGame(
  instanceId: string,
  accountId: string,
): Promise<GameProcess> {
  if (runningGames.some((g) => g.process.instanceId === instanceId)) {
    throw new Error("Game is already running for this instance");
  }

  const mcToken = await getMcAccessToken(accountId);

  const instance = await fetchJson<LauncherInstance>(
    `${baseUrl()}/api/launcher/instances/${instanceId}`,
  );

  const accounts = await fetchJson<LauncherAccount[]>(
    `${baseUrl()}/api/launcher/accounts`,
  );
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const prepareRes = await fetchJson<PrepareResponse>(
    `${baseUrl()}/api/launcher/prepare/${instanceId}`,
    { method: "POST" },
  );

  const javaPath = await resolveJavaPath(instance);

  const launcherBase = path.dirname(prepareRes.assetsDir);

  const nativesDir = path.join(
    launcherBase,
    "natives",
    `${instanceId}-${Date.now()}`,
  );
  mkdirSync(nativesDir, { recursive: true });

  const allClasspath = [...prepareRes.classpath, prepareRes.gameJarPath];
  const separator = process.platform === "win32" ? ";" : ":";
  const classpathStr = allClasspath.join(separator);

  const instanceDir = path.join(launcherBase, "instances", instance.id);

  const jvmArgs: string[] = [
    `-Xms${instance.ramMin}G`,
    `-Xmx${instance.ramMax}G`,
    `-Djava.library.path=${nativesDir}`,
    "-Dminecraft.launcher.brand=MCServerManager",
    "-Dminecraft.launcher.version=1.0",
    ...instance.jvmArgs,
    "-cp",
    classpathStr,
  ];

  const gameArgs: string[] = [
    "--username",
    account.username,
    "--version",
    instance.mcVersion,
    "--gameDir",
    instanceDir,
    "--assetsDir",
    prepareRes.assetsDir,
    "--assetIndex",
    prepareRes.assetIndex,
    "--uuid",
    account.uuid,
    "--accessToken",
    mcToken,
    "--userType",
    "msa",
    "--versionType",
    instance.versionType,
  ];

  if (instance.resolutionWidth != null && instance.resolutionHeight != null) {
    gameArgs.push(
      "--width",
      instance.resolutionWidth.toString(),
      "--height",
      instance.resolutionHeight.toString(),
    );
  }

  gameArgs.push(...instance.gameArgs);

  const args = [...jvmArgs, prepareRes.mainClass, ...gameArgs];

  const child = spawn(javaPath, args, {
    cwd: instanceDir,
    detached: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pid = child.pid;
  if (pid == null) {
    throw new Error("Failed to spawn Minecraft process: no PID returned");
  }

  const startedAt = new Date().toISOString();
  const gameProcess: GameProcess = {
    instanceId,
    pid,
    startedAt,
  };

  const entry: RunningGame = { process: gameProcess, child };
  runningGames.push(entry);

  const removeFromRunning = () => {
    const idx = runningGames.findIndex(
      (g) => g.process.instanceId === instanceId,
    );
    if (idx !== -1) {
      runningGames.splice(idx, 1);
    }
  };

  child.on("exit", removeFromRunning);
  child.on("error", removeFromRunning);

  return gameProcess;
}

export function getRunningGames(): GameProcess[] {
  return runningGames.map((g) => ({ ...g.process }));
}

export async function killGame(instanceId: string): Promise<void> {
  const idx = runningGames.findIndex(
    (g) => g.process.instanceId === instanceId,
  );
  if (idx === -1) {
    throw new Error("No running game found for this instance");
  }

  const entry = runningGames[idx];
  entry.child.kill("SIGKILL");
  runningGames.splice(idx, 1);
}
