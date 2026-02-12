import { execSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  createWriteStream,
  chmodSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { get } from "https";
import type { IncomingMessage } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NODE_VERSION = "22.14.0";

const TARGET_MAP: Record<string, { nodeArch: string; platform: string }> = {
  "x86_64-unknown-linux-gnu": { nodeArch: "linux-x64", platform: "linux" },
  "aarch64-unknown-linux-gnu": { nodeArch: "linux-arm64", platform: "linux" },
  "x86_64-apple-darwin": { nodeArch: "darwin-x64", platform: "darwin" },
  "aarch64-apple-darwin": { nodeArch: "darwin-arm64", platform: "darwin" },
  "x86_64-pc-windows-msvc": { nodeArch: "win-x64", platform: "win32" },
};

const rustTarget =
  execSync("rustc -Vv")
    .toString()
    .match(/host: (.+)/)?.[1]
    ?.trim() ?? "";

const targetInfo = TARGET_MAP[rustTarget];
if (!targetInfo) {
  throw new Error(
    `Unsupported target: ${rustTarget}. Supported: ${Object.keys(TARGET_MAP).join(", ")}`,
  );
}

const rootDir = join(__dirname, "..", "..", "..");
const backendDir = join(rootDir, "packages", "backend");
const tauriDir = join(__dirname, "..", "src-tauri");
const resourcesDir = join(tauriDir, "resources");
const binariesDir = join(tauriDir, "binaries");
const isWindows = targetInfo.platform === "win32";
const ext = isWindows ? ".exe" : "";

console.log("Step 1: Building shared + backend via tsc project references...");
execSync("npx tsc -b packages/backend/tsconfig.json --force", {
  cwd: rootDir,
  stdio: "inherit",
});

console.log("Step 2: Bundling backend with esbuild...");
mkdirSync(resourcesDir, { recursive: true });
const serverCjs = join(resourcesDir, "server.cjs");
const banner = `var __filename_url = require("url").pathToFileURL(__filename).href;`;

execSync(
  [
    "npx esbuild dist/index.js",
    "--bundle",
    "--platform=node",
    "--target=node22",
    "--format=cjs",
    `--outfile=${serverCjs}`,
    `--banner:js=${JSON.stringify(banner)}`,
    "--define:import.meta.url=__filename_url",
    "--external:better-sqlite3",
    "--external:argon2",
    "--external:ursa-optional",
    "--external:@node-rs/*",
  ].join(" "),
  { cwd: backendDir, stdio: "inherit" },
);

console.log("Step 3: Copying native addon files...");
const resNodeModules = join(resourcesDir, "node_modules");

function copyNativeAddon(name: string, parts: string[]): void {
  const srcBase = [
    join(rootDir, "node_modules", name),
    join(backendDir, "node_modules", name),
  ].find(existsSync);
  if (!srcBase) throw new Error(`${name} not found in node_modules`);

  const destBase = join(resNodeModules, name);
  rmSync(destBase, { recursive: true, force: true });
  mkdirSync(destBase, { recursive: true });

  for (const part of parts) {
    const src = join(srcBase, part);
    if (!existsSync(src)) continue;
    const dest = join(destBase, part);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

copyNativeAddon("better-sqlite3", ["package.json", "lib", "build"]);
copyNativeAddon("argon2", ["package.json", "argon2.cjs", "prebuilds"]);

const argon2Deps = ["@phc/format", "node-gyp-build"];
for (const dep of argon2Deps) {
  const srcPaths = [
    join(rootDir, "node_modules", "argon2", "node_modules", dep),
    join(rootDir, "node_modules", dep),
  ];
  const src = srcPaths.find(existsSync);
  if (!src) {
    console.warn(`Warning: ${dep} not found, skipping`);
    continue;
  }
  const dest = join(resNodeModules, dep);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

const NODE_RS_CRC32_MAP: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "@node-rs/crc32-linux-x64-gnu",
  "aarch64-unknown-linux-gnu": "@node-rs/crc32-linux-arm64-gnu",
  "x86_64-apple-darwin": "@node-rs/crc32-darwin-x64",
  "aarch64-apple-darwin": "@node-rs/crc32-darwin-arm64",
  "x86_64-pc-windows-msvc": "@node-rs/crc32-win32-x64-msvc",
};
const crc32Packages = ["@node-rs/crc32"];
const platformCrc32 = NODE_RS_CRC32_MAP[rustTarget];
if (platformCrc32) crc32Packages.push(platformCrc32);

for (const pkg of crc32Packages) {
  const src = join(rootDir, "node_modules", pkg);
  if (!existsSync(src)) {
    console.warn(`Warning: ${pkg} not found, skipping`);
    continue;
  }
  const dest = join(resNodeModules, pkg);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

console.log("Step 4: Downloading Node.js binary...");
const nodeOutputPath = join(resourcesDir, isWindows ? "node.exe" : "node");

function httpsGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        httpsGet(res.headers.location!).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on("error", reject);
  });
}

async function downloadNode(): Promise<void> {
  if (existsSync(nodeOutputPath)) {
    console.log("  Node.js binary already exists, skipping download");
    return;
  }

  if (isWindows) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
    console.log(`  Downloading ${url}...`);
    const res = await httpsGet(url);
    const ws = createWriteStream(nodeOutputPath);
    await pipeline(res, ws);
  } else {
    const archiveName = `node-v${NODE_VERSION}-${targetInfo.nodeArch}.tar.gz`;
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
    console.log(`  Downloading ${url}...`);
    const res = await httpsGet(url);

    const tmpDir = join(tauriDir, ".node-tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tarPath = join(tmpDir, archiveName);
    const ws = createWriteStream(tarPath);
    await pipeline(res, ws);

    execSync(
      `tar -xf ${JSON.stringify(tarPath)} --strip-components=2 -C ${JSON.stringify(tmpDir)} node-v${NODE_VERSION}-${targetInfo.nodeArch}/bin/node`,
      { stdio: "inherit" },
    );
    cpSync(join(tmpDir, "node"), nodeOutputPath);
    chmodSync(nodeOutputPath, 0o755);
    rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(`  Node.js binary saved to ${nodeOutputPath}`);
}

await downloadNode();

console.log("Step 5: Building Rust launcher...");
execSync("cargo build --release --bin mc-backend", {
  cwd: tauriDir,
  stdio: "inherit",
});

mkdirSync(binariesDir, { recursive: true });
const launcherSrc = join(tauriDir, "target", "release", `mc-backend${ext}`);
const launcherDest = join(binariesDir, `mc-backend-${rustTarget}${ext}`);
cpSync(launcherSrc, launcherDest);

console.log("Step 6: Cleaning up old pkg artifacts...");
if (existsSync(binariesDir)) {
  for (const f of readdirSync(binariesDir)) {
    if (f.startsWith("mc-server-backend-") || f === "better_sqlite3.node") {
      console.log(`  Removing old artifact: ${f}`);
      unlinkSync(join(binariesDir, f));
    }
  }
}

const bundleDir = join(backendDir, "bundle");
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
}

console.log("Backend packaging complete!");
console.log(`  Launcher: ${launcherDest}`);
console.log(`  Resources: ${resourcesDir}`);
