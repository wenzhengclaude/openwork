import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { StdioJsonRpcClient } from "./json-rpc.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(removeTempDir));
});

describe("StdioJsonRpcClient", () => {
  test("handles notifications and server-initiated requests over stdio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-json-rpc-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "agent.mjs");
    await writeFile(scriptPath, fakeAgentScript, "utf8");

    const notifications: string[] = [];
    const permissionRequests: string[] = [];
    const client = new StdioJsonRpcClient({
      command: process.execPath,
      args: [scriptPath],
      cwd: dir,
      includeJsonrpc: true,
      onNotification: (message) => {
        notifications.push(message.method);
      },
      onRequest: (message) => {
        permissionRequests.push(message.method);
        return { accepted: true };
      },
    });

    try {
      const initialized = await client.request("initialize", {});
      expect(initialized).toEqual({ ok: true });
      expect(notifications).toContain("session/update");

      const result = await client.request("prompt", {});
      expect(result).toEqual({ accepted: true });
      expect(permissionRequests).toEqual(["request_permission"]);
    } finally {
      client.dispose();
    }
  });
});

const fakeAgentScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let promptRequestId = 0;

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "ready" } } },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "prompt") {
    promptRequestId = message.id;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "request_permission",
      params: { reason: "test" },
    }) + "\\n");
    return;
  }
  if (message.id === 99) {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: promptRequestId,
      result: { accepted: message.result?.accepted === true },
    }) + "\\n");
  }
});
`;

async function removeTempDir(dir: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw lastError;
}
