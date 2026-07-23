import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentRunEmitter, AgentRunInput } from "../types.js";
import { clearMcpReachabilityCacheForTests } from "../mcp-reachability-cache.js";
import { GrokBuildRuntime } from "./grok-build-runtime.js";

const ENV_KEYS = [
  "OPENONE_GROK_ARGS",
  "OPENONE_GROK_COMMAND",
  "OPENONE_GROK_HOME",
  "OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS",
];

const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];
const servers: Server[] = [];

beforeEach(() => {
  originalEnv.clear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  clearMcpReachabilityCacheForTests();
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
  await Promise.all(servers.splice(0).map(closeServer));
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
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";
    const pluginPath = join(dir, ".opencode", "plugins", "sap-dev-core-plugin");

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
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
      capabilities: {
        mcpServers: {
          "openwork-cloud": {
            type: "http",
            url: "https://mcp.internal/mcp",
            headers: {
              Authorization: "Bearer local",
            },
          },
        },
        skillRoots: [join(dir, ".opencode", "skills")],
        skills: [],
        pluginPaths: [pluginPath],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(String(payload.baseUrl).startsWith("http://127.0.0.1:")).toBe(true);
    expect(payload.xaiBaseUrl).toBe(payload.baseUrl);
    expect(payload.modelsListUrl).toBe(`${payload.baseUrl}/models`);
    expect(payload).toEqual({
      baseUrl: payload.baseUrl,
      xaiBaseUrl: payload.baseUrl,
      modelsListUrl: `${payload.baseUrl}/models`,
      apiKey: "workspace-key",
      xaiApiKey: "workspace-key",
      grokCodeApiKey: "workspace-key",
      openOneApiKey: "workspace-key",
      grokHomeConfigured: true,
      managedConfigDisabled: "0",
      apiKeyAuthEnabled: "0",
      configHasDefaultModel: true,
      configHasSessionSummaryModel: true,
      configHasGrokBuildAlias: true,
      configUsesChatCompletions: true,
      configDisablesStreamToolCalls: true,
      configContextWindows: [258000, 258000],
      configHasSkillPaths: true,
      configHasPluginPaths: true,
      configPluginPaths: [pluginPath.replaceAll("\\", "\\\\")],
      configDisablesExternalMcp: true,
      envDisablesExternalMcp: true,
      promptHasBroadSkillList: false,
      promptHasGrokSlashSkill: false,
      promptHasOpenCodeSkillToken: false,
      promptHasSelectedSkill: false,
      promptHasLoadedSkillContent: false,
      promptHasSelectedSkillPath: false,
      configSapLoginPaths: [],
      mcpServers: [
        {
          name: "openwork-cloud",
          type: "http",
          url: "https://mcp.internal/mcp",
          headers: [
            {
              name: "Authorization",
              value: "Bearer local",
            },
          ],
        },
      ],
    });
  });

  test("starts managed Grok runs without a context override when the model catalog has no context window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-missing-context-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok.mjs");
    await writeFile(scriptPath, fakeGrokScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
      model: "company-model",
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
      capabilities: {
        mcpServers: {},
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.configContextWindows).toEqual([]);
  });

  test("passes selected Open One skills through Grok native skill paths and slash invocation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-selected-skill-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok.mjs");
    await writeFile(scriptPath, fakeGrokScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const skillDir = join(dir, ".opencode", "skills", "sap-login");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "# sap-login\n\nUse SAP GUI Login from Open One.\n", "utf8");

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "the \"sap-login\" skill. Confirm the selected skill context is available.",
      model: "company-model",
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
      selectedSkills: ["sap-login"],
      capabilities: {
        mcpServers: {},
        skillRoots: [join(dir, ".opencode", "skills")],
        skills: [
          {
            name: "sap-login",
            path: skillPath,
            description: "Log in to SAP GUI",
            scope: "project",
            trigger: "/sap-login",
          },
          {
            name: "sap-sm30",
            path: join(dir, ".opencode", "skills", "sap-sm30", "SKILL.md"),
            description: "Maintain customizing views",
            scope: "project",
            trigger: "/sap-sm30",
          },
        ],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.promptHasBroadSkillList).toBe(false);
    expect(payload.configHasSkillPaths).toBe(true);
    expect(Array.isArray(payload.configSapLoginPaths)).toBe(true);
    expect(payload.configSapLoginPaths.some((path: string) => path.includes("sap-login"))).toBe(true);
    expect(payload.promptHasGrokSlashSkill).toBe(true);
    expect(payload.promptHasOpenCodeSkillToken).toBe(false);
    expect(payload.promptHasSelectedSkill).toBe(true);
    expect(payload.promptHasLoadedSkillContent).toBe(false);
    expect(payload.promptHasSelectedSkillPath).toBe(true);
    expect(events.some((event) => event.type === "tool_call" && event.title === "Load skill sap-login")).toBe(false);
    expect(events.some((event) => event.type === "log" && event.title === "Skill selected" && event.details?.skill === "sap-login")).toBe(true);
  });

  test("passes uploaded images to Grok ACP prompt blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-image-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok.mjs");
    await writeFile(scriptPath, fakeGrokScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "describe this image",
      model: "company-model",
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
      attachments: [
        {
          name: "image.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
      ],
      capabilities: {
        mcpServers: {},
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.imageCount).toBe(1);
    expect(payload.firstImageMime).toBe("image/png");
    expect(payload.firstImageData).toBe("aGVsbG8=");
  });

  test("emits a unified diff event for Grok ACP file writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-file-write-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-file-write.mjs");
    await writeFile(scriptPath, fakeGrokFileWriteScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const sourceDir = join(dir, "src");
    const sourcePath = join(sourceDir, "app.ts");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(sourcePath, "const name = \"old\";\nconsole.log(name);\n", "utf8");

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "edit src/app.ts",
      model: "company-model",
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: "http://models.internal/v1",
        apiKey: "workspace-key",
      },
      capabilities: {
        mcpServers: {},
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    expect(await readFile(sourcePath, "utf8")).toBe("const name = \"new\";\nconsole.log(name);\n");
    const editEvent = events.find((event) => event.type === "tool_call" && event.details?.activityKind === "file_write");
    expect(editEvent?.title).toBe("Edited file");
    expect(editEvent?.text).toBe(sourcePath);
    expect(editEvent?.details?.path).toBe(sourcePath);
    expect(editEvent?.details?.additions).toBe(1);
    expect(editEvent?.details?.deletions).toBe(1);
    const diff = editEvent?.details?.diff;
    expect(typeof diff).toBe("string");
    if (typeof diff !== "string") throw new Error("missing diff");
    expect(diff).toContain(`--- ${sourcePath}`);
    expect(diff).toContain(`+++ ${sourcePath}`);
    expect(diff).toContain("-const name = \"old\";");
    expect(diff).toContain("+const name = \"new\";");
  });

  test("normalizes company local streaming chunks for the Grok process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-proxy-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-proxy.mjs");
    await writeFile(scriptPath, fakeGrokProxyScript, "utf8");
    const provider = await startStreamingProvider();
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

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
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: provider.baseUrl,
        apiKey: "workspace-key",
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(String(payload.proxyBaseUrl).startsWith("http://127.0.0.1:")).toBe(true);
    expect(payload.chunkHasCreated).toBe(true);
    expect(payload.chunkObject).toBe("chat.completion.chunk");
    expect(payload.choiceIndex).toBe(0);
    expect(payload.modelStreamToolCalls).toBe(false);
    expect(provider.authorization()).toBe("Bearer workspace-key");
  });

  test("coalesces split streaming tool call deltas for Grok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-proxy-tool-call-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-proxy.mjs");
    await writeFile(scriptPath, fakeGrokProxyScript, "utf8");
    const provider = await startSplitToolCallProvider();
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

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
      modelContextWindow: 258000,
      runtimeProvider: {
        providerId: "company-local",
        baseUrl: provider.baseUrl,
        apiKey: "workspace-key",
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.toolCallDataLineCount).toBe(1);
    expect(payload.firstToolName).toBe("run_terminal_command");
    expect(payload.firstToolArguments).toBe("{\"command\":\"echo hi\"}");
    expect(payload.finishReason).toBe("tool_calls");
    expect(provider.authorization()).toBe("Bearer workspace-key");
  });

  test("handles Grok x.ai session notifications for subagent lifecycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-xai-notification-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-xai-notification.mjs");
    await writeFile(scriptPath, fakeGrokXaiNotificationScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    expect(events.some((event) => event.type === "child_agent_started" && event.agentId === "child-1" && event.title === "scan src")).toBe(true);
    expect(events.some((event) => event.type === "child_agent_completed" && event.agentId === "child-1" && event.status === "completed")).toBe(true);
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
    expect(events.some((event) => event.type === "tool_call" && event.title === "x.ai/request_permission")).toBe(false);
    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      outcome: {
        outcome: "selected",
        optionId: "allow-once",
      },
    });
  });

  test("normalizes Grok tool updates into stable timeline events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-tool-timeline-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-tool-timeline.mjs");
    await writeFile(scriptPath, fakeGrokToolTimelineScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const readEvent = events.find((event) => event.type === "tool_call" && event.details?.itemId === "call-read");
    expect(readEvent?.title).toBe("Read C:\\sap_dev_work\\settings.json");
    expect(readEvent?.details?.tool).toBe("read_file");
    expect(readEvent?.details?.path).toBe("C:\\sap_dev_work\\settings.json");
    const commandEvent = events.find((event) => event.type === "tool_call" && event.details?.itemId === "call-command" && event.status === "completed");
    expect(commandEvent?.title).toBe("Get-Content -LiteralPath 'C:\\sap_dev_work\\settings.json'");
    expect(commandEvent?.details?.tool).toBe("run_terminal_command");
    expect(commandEvent?.details?.command).toBe("Get-Content -LiteralPath 'C:\\sap_dev_work\\settings.json'");
    expect(commandEvent?.details?.cwd).toBe(dir);
    expect(commandEvent?.details?.files).toEqual(["C:\\sap_dev_work\\settings.json"]);
    expect(commandEvent?.details?.sourceProtocol).toBe("grok-acp-session-update");
    expect(commandEvent?.details?.sourceType).toBe("tool_call_update");
    expect(commandEvent?.details?.activityKind).toBe("command");
  });

  test("handles Grok ACP client file and terminal requests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-acp-client-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-acp-client.mjs");
    await writeFile(scriptPath, fakeGrokAcpClientScript, "utf8");
    await writeFile(join(dir, "sample.txt"), "one\ntwo\nthree\n", "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.fileContent).toBe("two\nthree");
    expect(payload.terminalId).toStartWith("openone-");
    expect(payload.exitCode).toBe(0);
    expect(payload.terminalOutput).toContain("terminal-ok");
  });

  test("does not emit unnamed Grok tool placeholders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-grok-unnamed-tool-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-grok-unnamed-tool.mjs");
    await writeFile(scriptPath, fakeGrokUnnamedToolScript, "utf8");
    process.env.OPENONE_GROK_COMMAND = process.execPath;
    process.env.OPENONE_GROK_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "0";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new GrokBuildRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "grok-build",
      approvalMode: "auto-review",
      prompt: "hello",
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    expect(events.some((event) => event.type === "tool_call" && event.title === "Grok Build tool")).toBe(false);
    expect(events.some((event) => event.type === "message_delta" && event.text === "done")).toBe(true);
  });
});

const fakeGrokScript = `
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rl = createInterface({ input: process.stdin });
let lastMcpServers = [];

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
    lastMcpServers = Array.isArray(message.params?.mcpServers) ? message.params.mcpServers : [];
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-test" } }) + "\\n");
    return;
  }
  if (message.method === "session/prompt") {
    const promptBlocks = Array.isArray(message.params?.prompt) ? message.params.prompt : [];
    const promptText = promptBlocks[0]?.text ?? "";
    const images = promptBlocks.filter((block) => block?.type === "image");
    const configText = process.env.GROK_HOME ? readFileSync(join(process.env.GROK_HOME, "config.toml"), "utf8") : "";
    const payload = {
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
      configHasSessionSummaryModel: configText.includes('session_summary = "company-model"'),
      configHasGrokBuildAlias: configText.includes('[model."grok-build"]') && configText.includes('model = "company-model"'),
      configUsesChatCompletions: configText.includes('api_backend = "chat_completions"'),
      configDisablesStreamToolCalls: configText.includes('stream_tool_calls = false'),
      configContextWindows: Array.from(configText.matchAll(/context_window = (\\d+)/g), (match) => Number(match[1])),
      configHasSkillPaths: configText.includes('[skills]') && configText.includes('paths = ['),
      configHasPluginPaths: configText.includes('[plugins]') && configText.includes('paths = ['),
      configPluginPaths: Array.from(configText.matchAll(/"([^"]*sap-dev-core-plugin[^"]*)"/g), (match) => match[1]),
      configDisablesExternalMcp: configText.includes('[compat.cursor]') && configText.includes('mcps = false') && configText.includes('[compat.claude]') && configText.includes('[managed_mcps]') && configText.includes('enabled = false'),
      envDisablesExternalMcp: process.env.GROK_CURSOR_MCPS_ENABLED === "0" && process.env.GROK_CLAUDE_MCPS_ENABLED === "0" && process.env.GROK_MANAGED_MCPS_ENABLED === "0",
      promptHasBroadSkillList: promptText.includes("Open One skills available in this workspace:"),
      promptHasGrokSlashSkill: promptText.includes("/sap-login"),
      promptHasOpenCodeSkillToken: promptText.includes("Load [skill sap-login] and follow its instructions."),
      promptHasSelectedSkill: promptText.includes("Open One selected Grok Build skills:") && promptText.includes("- sap-login"),
      promptHasLoadedSkillContent: promptText.includes("# sap-login") && promptText.includes("Use SAP GUI Login from Open One."),
      promptHasSelectedSkillPath: promptText.includes("SKILL.md path:") && promptText.includes("sap-login"),
      configSapLoginPaths: Array.from(configText.matchAll(/"([^"]*sap-login[^"]*)"/g), (match) => match[1]),
      mcpServers: lastMcpServers,
    };
    if (images.length > 0) {
      payload.imageCount = images.length;
      payload.firstImageMime = images[0]?.mimeType ?? images[0]?.mime_type ?? "";
      payload.firstImageData = images[0]?.data ?? "";
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            text: JSON.stringify(payload),
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokFileWriteScript = `
import { createInterface } from "node:readline";
import { join } from "node:path";

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
      id: 200,
      method: "fs/write_text_file",
      params: {
        path: join(process.cwd(), "src", "app.ts"),
        content: "const name = \\"new\\";\\nconsole.log(name);\\n",
      },
    }) + "\\n");
    return;
  }
  if (message.id === 200 && promptRequestId !== null) {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "done" },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: promptRequestId, result: { ok: true } }) + "\\n");
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

const fakeGrokToolTimelineScript = `
import { createInterface } from "node:readline";

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
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          status: "completed",
          toolCall: {
            id: "call-read",
            name: "read_file",
            input: { path: "C:\\\\sap_dev_work\\\\settings.json" },
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          status: "running",
          toolCall: {
            id: "call-command",
            name: "run_terminal_command",
            input: {
              command: "Get-Content -LiteralPath 'C:\\\\sap_dev_work\\\\settings.json'",
              cwd: process.cwd(),
            },
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          status: "completed",
          toolCall: {
            id: "call-command",
            name: "run_terminal_command",
            input: {
              command: "Get-Content -LiteralPath 'C:\\\\sap_dev_work\\\\settings.json'",
              cwd: process.cwd(),
            },
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokAcpClientScript = `
import { createInterface } from "node:readline";
import { join } from "node:path";

const rl = createInterface({ input: process.stdin });
let promptRequestId = null;
let fileContent = "";
let terminalId = "";
let exitCode = null;

function sendRequest(id, method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
}

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
    sendRequest(10, "fs/read_text_file", {
      sessionId: "session-test",
      path: join(process.cwd(), "sample.txt"),
      line: 2,
      limit: 2,
    });
    return;
  }
  if (message.id === 10) {
    fileContent = message.result?.content ?? "";
    sendRequest(11, "terminal/create", {
      sessionId: "session-test",
      command: process.execPath,
      args: ["-e", "process.stdout.write('terminal-ok')"],
      cwd: process.cwd(),
      outputByteLimit: 4096,
    });
    return;
  }
  if (message.id === 11) {
    terminalId = message.result?.terminalId ?? "";
    sendRequest(12, "terminal/wait_for_exit", {
      sessionId: "session-test",
      terminalId,
    });
    return;
  }
  if (message.id === 12) {
    exitCode = message.result?.exitCode ?? null;
    sendRequest(13, "terminal/output", {
      sessionId: "session-test",
      terminalId,
    });
    return;
  }
  if (message.id === 13) {
    const terminalOutput = message.result?.output ?? "";
    sendRequest(14, "terminal/release", {
      sessionId: "session-test",
      terminalId,
    });
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            text: JSON.stringify({ fileContent, terminalId, exitCode, terminalOutput }),
          },
        },
      },
    }) + "\\n");
    return;
  }
  if (message.id === 14 && promptRequestId !== null) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: promptRequestId, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokUnnamedToolScript = `
import { createInterface } from "node:readline";

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
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          status: "running",
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "done" },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokProxyScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
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
    const modelsResponse = await fetch(process.env.GROK_MODELS_BASE_URL + "/models");
    const models = await modelsResponse.json();
    const response = await fetch(process.env.GROK_MODELS_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "company-model", messages: [{ role: "user", content: "hello" }], stream: true }),
    });
    const text = await response.text();
    const events = text
      .split(/\\r?\\n\\r?\\n/)
      .filter((item) => item.includes("data: ") && !item.includes("[DONE]"));
    const chunks = events.map((item) => JSON.parse(item
      .split(/\\r?\\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\\n")));
    const chunk = chunks[0] ?? {};
    const firstToolChunk = chunks.find((item) => Array.isArray(item?.choices?.[0]?.delta?.tool_calls));
    const finishChunk = chunks.find((item) => item?.choices?.[0]?.finish_reason === "tool_calls");
    const toolCalls = firstToolChunk?.choices?.[0]?.delta?.tool_calls ?? [];
    const firstToolCall = toolCalls[0] ?? {};
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            text: JSON.stringify({
              proxyBaseUrl: process.env.GROK_MODELS_BASE_URL,
              chunkHasCreated: typeof chunk.created === "number",
              chunkObject: chunk.object,
              choiceIndex: chunk.choices?.[0]?.index,
              modelStreamToolCalls: models.data?.[0]?.stream_tool_calls,
              toolCallDataLineCount: chunks.filter((item) => Array.isArray(item?.choices?.[0]?.delta?.tool_calls)).length,
              firstToolName: firstToolCall?.function?.name ?? null,
              firstToolArguments: firstToolCall?.function?.arguments ?? null,
              finishReason: finishChunk?.choices?.[0]?.finish_reason ?? null,
            }),
          },
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

const fakeGrokXaiNotificationScript = `
import { createInterface } from "node:readline";

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
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "x.ai/session_notification",
      params: {
        sessionId: "session-test",
        update: {
          sessionUpdate: "subagent_spawned",
          subagent_id: "child-1",
          parent_session_id: "session-test",
          child_session_id: "child-1",
          subagent_type: "explore",
          description: "scan src",
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_x.ai/session/update",
      params: {
        sessionId: "session-test",
        update: {
          sessionUpdate: "subagent_finished",
          subagent_id: "child-1",
          child_session_id: "child-1",
          status: "completed",
          tool_calls: 2,
          turns: 1,
          duration_ms: 100,
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
  }
});
`;

async function startStreamingProvider(): Promise<{ baseUrl: string; authorization: () => string }> {
  let authorization = "";
  const server = createServer((request, response) => {
    authorization = headerValue(request.headers.authorization);
    if (request.url === "/v1/chat/completions") {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ data: [{ id: "company-model", object: "model" }] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await listenServer(server);
  servers.push(server);
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error("test provider did not bind to a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    authorization: () => authorization,
  };
}

async function startSplitToolCallProvider(): Promise<{ baseUrl: string; authorization: () => string }> {
  let authorization = "";
  const server = createServer((request, response) => {
    authorization = headerValue(request.headers.authorization);
    if (request.url === "/v1/chat/completions") {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "run_terminal_command", arguments: "" },
            }],
          },
        }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"command":"' },
            }],
          },
        }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: 'echo hi"}' },
            }],
          },
        }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ data: [{ id: "company-model", object: "model" }] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await listenServer(server);
  servers.push(server);
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error("test provider did not bind to a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    authorization: () => authorization,
  };
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function listenServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function isAddressInfo(value: ReturnType<Server["address"]>): value is AddressInfo {
  return value !== null && typeof value === "object" && typeof value.port === "number";
}

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
