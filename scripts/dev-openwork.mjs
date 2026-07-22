import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? "desktop";
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = target === "ui"
  ? ["--filter", "@openwork/app", "dev"]
  : target === "electron"
    ? ["--filter", "@openwork/desktop", "dev:electron"]
    : ["--filter", "@openwork/desktop", "dev"];

const child = spawn("pnpm", args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    OPENWORK_DEV_MODE: process.env.OPENWORK_DEV_MODE ?? "1",
    ...(target === "desktop"
      ? { OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: process.env.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT ?? "9823" }
      : {}),
  },
  shell: process.platform === "win32",
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
