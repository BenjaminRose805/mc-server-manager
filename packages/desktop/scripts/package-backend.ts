import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGETS: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "node22-linux-x64",
  "aarch64-unknown-linux-gnu": "node22-linux-arm64",
  "x86_64-apple-darwin": "node22-macos-x64",
  "aarch64-apple-darwin": "node22-macos-arm64",
  "x86_64-pc-windows-msvc": "node22-win-x64",
};

const rustTarget =
  execSync("rustc -Vv")
    .toString()
    .match(/host: (.+)/)?.[1]
    ?.trim() ?? "";

const pkgTarget = TARGETS[rustTarget];
if (!pkgTarget) {
  throw new Error(
    `Unsupported target: ${rustTarget}. Supported: ${Object.keys(TARGETS).join(", ")}`,
  );
}

const rootDir = join(__dirname, "..", "..", "..");
const backendDir = join(rootDir, "packages", "backend");
const binariesDir = join(__dirname, "..", "src-tauri", "binaries");
const ext = process.platform === "win32" ? ".exe" : "";
const outputName = `mc-server-backend-${rustTarget}${ext}`;

const sharedDist = join(rootDir, "shared", "dist", "index.js");
if (!existsSync(sharedDist)) {
  console.log("Building shared types...");
  execSync("npm run build -w @mc-server-manager/shared", {
    cwd: rootDir,
    stdio: "inherit",
  });
}

const backendDist = join(backendDir, "dist", "index.js");
if (!existsSync(backendDist)) {
  console.log("Building backend...");
  execSync("npm run build", { cwd: backendDir, stdio: "inherit" });
}

console.log(`Packaging backend for ${pkgTarget}...`);
mkdirSync(binariesDir, { recursive: true });
execSync(
  `npx @yao-pkg/pkg dist/index.js --target ${pkgTarget} --output "${join(binariesDir, outputName)}"`,
  { cwd: backendDir, stdio: "inherit" },
);

console.log("Copying native modules...");
cpSync(
  join(
    backendDir,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  ),
  join(binariesDir, "better_sqlite3.node"),
);

console.log(`Backend packaged: ${outputName}`);
