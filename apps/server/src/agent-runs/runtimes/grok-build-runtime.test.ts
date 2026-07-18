import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentRunEmitter, AgentRunInput } from "../types.js";
import { GrokBuildRuntime } from "./grok-build-runtime.js";

const ENV_KEYS = [
  "OPENONE_GROK_ARGS",
  "OPENONE_GROK_COMMAND",
  "OPENONE_GROK_HOME",
];

const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];

beforeEach(() => {
  originalEnv.clear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map(removeTempDir));
});

describe("GrokBuildRuntime", () => {
  test("passes the shared Open One runtime provider to the Grok process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-runtime-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok.mjs");
    await writeFile(scriptPath, fakeGrokScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
      model: "company-model",
      modelProvider: "company-local",
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      baseUrl: "http://models.internal/v1",
      xaiBaseUrl: "http://models.internal/v1",
      modelsListUrl: "http://models.internal/v1/models",
      apiKey: "workspace-key",
      xaiApiKey: "workspace-key",
      grokCodeApiKey: "workspace-key",
      openOneApiKey: "workspace-key",
      grokHomeConfigured: true,
      managedConfigDisabled: "0",
      apiKeyAuthEnabled: "0",
      configHasDefaultModel: true,
      configHasGrokBuildAlias: true,
      configUsesChatCompletions: true,
    });
  });

  test("waits for human approval in ask mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-approval-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-approval.mjs");
    await writeFile(scriptPath, fakeGrokApprovalScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "ask",
      prompt: "hello",
      requestApproval: async (request) => {
        events.push({
          type: "approval_requested",
          runtime: "grok-build",
          agentId: request.agentId,
          title: request.title,
          status: "pending",
          details: { request },
        });
        return "once";
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const approvalEvent = events.find((event) => event.type === "approval_requested");
    expect(approvalEvent?.title).toBe("Grok Build permission");
    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      outcome: {
        selected: {
          optionId: "allow-once",
        },
      },
    });
  });
});

const fakeGrokScript = `
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { authMethods: [{ id: "xai.api_key" }] },
    }) + "\\n");
    return;
  }
  if (message.method === "authenticate") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-test" } }) + "\\n");
    return;
  }
  if (message.method === "session/prompt") {
    const configText = process.env.GROK_HOME ? readFileSync(join(process.env.GROK_HOME, "config.toml"), "utf8") : "";
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            text: JSON.stringify({
              baseUrl: process.env.GROK_MODELS_BASE_URL,
              xaiBaseUrl: process.env.GROK_XAI_API_BASE_URL,
              modelsListUrl: process.env.GROK_MODELS_LIST_URL,
              apiKey: process.env.GROK_API_KEY,
              xaiApiKey: process.env.XAI_API_KEY,
              grokCodeApiKey: process.env.GROK_CODE_XAI_API_KEY,
              openOneApiKey: process.env.OPENONE_GROK_API_KEY,
              grokHomeConfigured: Boolean(process.env.GROK_HOME),
              managedConfigDisabled: process.env.GROK_MANAGED_CONFIG,
              apiKeyAuthEnabled: process.env.GROK_DISABLE_API_KEY_AUTH,
              configHasDefaultModel: configText.includes('default = "company-model"'),
              configHasGrokBuildAlias: configText.includes('[model."grok-build"]') && configText.includes('model = "company-model"'),
              configUsesChatCompletions: configText.includes('api_backend = "chat_completions"'),
            }),
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokApprovalScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let promptRequestId = null;

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { authMethods: [{ id: "xai.api_key" }] },
    }) + "\\n");
    return;
  }
  if (message.method === "authenticate") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-test" } }) + "\\n");
    return;
  }
  if (message.method === "session/prompt") {
    promptRequestId = message.id;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 100,
      method: "x.ai/request_permission",
      params: {
        action: "file.write",
        resources: ["src/app.ts"],
        options: [
          { optionId: "reject", label: "Reject" },
          { optionId: "allow-once", label: "Allow once" },
          { optionId: "always-allow", label: "Always allow" },
        ],
      },
    }) + "\\n");
    return;
  }
  if (message.id === 100 && promptRequestId !== null) {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            text: JSON.stringify(message.result),
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: promptRequestId, result: { ok: true } }) + "\\n");
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
