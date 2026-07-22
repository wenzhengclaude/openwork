import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "--") cliArgs.shift();
const child = spawn("bun", ["src/cli.ts", ...cliArgs], {
  cwd: serverRoot,
  env: {
    ...process.env,
    OPENWORK_DEV_MODE: process.env.OPENWORK_DEV_MODE ?? "1",
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
