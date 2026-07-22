import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentRunEmitter, AgentRunInput } from "../types.js";
import { clearMcpReachabilityCacheForTests } from "../mcp-reachability-cache.js";
import { CodexRuntime } from "./codex-runtime.js";

const ENV_KEYS = [
  "OPENONE_CODEX_ARGS",
  "OPENONE_CODEX_COMMAND",
  "OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS",
  "OPENONE_SAPDEV_WORK_DIR",
  "SAPDEV_AI_WORK_DIR",
  "CODEX_COMMAND",
];

const originalEnv = new Map<string, string | undefined>();
const tempDirs: string[] = [];

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
  await Promise.all(tempDirs.splice(0).map(removeTempDir));
});

describe("CodexRuntime", () => {
  test("registers Open One skill roots through the Codex app-server skill API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-runtime-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const skillRoot = join(dir, ".opencode", "skills");
    const pluginPath = join(dir, ".opencode", "plugins", "sap-dev-core-plugin");
    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "hello",
      capabilities: {
        mcpServers: {},
        skillRoots: [skillRoot],
        skills: [],
        pluginPaths: [pluginPath],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      extraRoots: [skillRoot],
      selectedCapabilityRoots: [
        codexSelectedRoot(skillRoot),
        codexSelectedRoot(pluginPath),
      ],
      promptHasBroadSkillList: false,
      promptHasCodexSkillMarker: false,
      promptHasOpenCodeSkillToken: false,
      promptHasSelectedSkill: false,
      promptHasLoadedSkillContent: false,
      promptHasSelectedSkillPath: false,
      skillItems: [],
      sapWorkDir: null,
    });
  });

  test("passes the selected model context window to Codex thread config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-context-window-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
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
        mcpServers: {},
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.codexConfig).toEqual({
      model_context_window: 258000,
    });
  });

  test("starts managed Codex runs without a context override when the model catalog has no context window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-missing-context-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "hello",
      model: "company-model",
      modelProvider: "company-local",
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
    expect(payload.codexConfig).toBeUndefined();
  });

  test("passes selected Open One skills through native Codex skill input items", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-selected-skill-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const skillDir = join(dir, ".opencode", "skills", "sap-login");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "# sap-login\n\nUse SAP GUI Login from Open One.\n", "utf8");
    const sapWorkDir = join(dir, "sap-work");
    process.env.OPENONE_SAPDEV_WORK_DIR = sapWorkDir;

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "the \"sap-login\" skill. Confirm the selected skill context is available.",
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
    expect(payload).toEqual({
      extraRoots: [
        join(dir, ".opencode", "skills"),
      ],
      selectedCapabilityRoots: [
        codexSelectedRoot(join(dir, ".opencode", "skills")),
      ],
      promptHasBroadSkillList: false,
      promptHasCodexSkillMarker: true,
      promptHasOpenCodeSkillToken: false,
      promptHasSelectedSkill: true,
      promptHasLoadedSkillContent: false,
      promptHasSelectedSkillPath: true,
      skillItems: [
        {
          name: "sap-login",
          path: skillPath,
        },
      ],
      sapWorkDir,
    });
    expect(events.some((event) => event.type === "tool_call" && event.title === "Load skill sap-login")).toBe(false);
    expect(events.some((event) => event.type === "log" && event.title === "Skill selected" && event.details?.skill === "sap-login")).toBe(true);
  });

  test("passes uploaded images to Codex turn input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-image-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const imageDataUrl = "data:image/png;base64,aGVsbG8=";
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "describe this image",
      attachments: [
        {
          name: "image.png",
          mime: "image/png",
          dataUrl: imageDataUrl,
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
    expect(payload.firstImageUrl).toBe(imageDataUrl);
  });

  test("emits Codex file change diff events from thread item changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-file-change-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex-file-change.mjs");
    await writeFile(scriptPath, fakeCodexFileChangeScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "edit files",
      capabilities: {
        mcpServers: {},
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    const updateEvent = events.find((event) => event.type === "tool_call" && event.details?.path === "src/app.ts");
    expect(updateEvent?.title).toBe("Edited file");
    expect(updateEvent?.details?.activityKind).toBe("file_edit");
    expect(updateEvent?.details?.changeKind).toBe("update");
    expect(updateEvent?.details?.additions).toBe(1);
    expect(updateEvent?.details?.deletions).toBe(1);
    expect(updateEvent?.details?.diff).toContain("-const name = \"old\";");
    expect(updateEvent?.details?.diff).toContain("+const name = \"new\";");

    const deleteEvent = events.find((event) => event.type === "tool_call" && event.details?.path === "src/old.ts");
    expect(deleteEvent?.details?.changeKind).toBe("delete");
    expect(deleteEvent?.details?.additions).toBe(0);
    expect(deleteEvent?.details?.deletions).toBe(1);
    expect(deleteEvent?.details?.diff).toContain("--- src/old.ts");
    expect(deleteEvent?.details?.diff).toContain("+++ /dev/null");
    expect(deleteEvent?.details?.diff).toContain("-console.log(\"old\");");
  });

  test("skips unreachable MCP servers before starting Codex", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-mcp-skip-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex.mjs");
    await writeFile(scriptPath, fakeCodexScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);
    process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS = "1";

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "auto-review",
      prompt: "hello",
      capabilities: {
        mcpServers: {
          "openwork-cloud": {
            type: "http",
            url: "http://127.0.0.1:9/mcp",
          },
        },
        skillRoots: [],
        skills: [],
        pluginPaths: [],
      },
    };

    await runtime.run(input, (event) => events.push(event), new AbortController().signal);

    expect(events.some((event) => event.type === "log" && event.title === "MCP unavailable" && event.text?.includes("openwork-cloud"))).toBe(true);
    expect(events.some((event) => event.type === "agent_completed" && event.status === "completed")).toBe(true);
  });

  test("routes Codex command approval requests through Open One approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openone-codex-approval-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "fake-codex-approval.mjs");
    await writeFile(scriptPath, fakeCodexApprovalScript, "utf8");
    process.env.OPENONE_CODEX_COMMAND = process.execPath;
    process.env.OPENONE_CODEX_ARGS = JSON.stringify([scriptPath]);

    const events: Array<Parameters<AgentRunEmitter>[0]> = [];
    const runtime = new CodexRuntime();
    const input: AgentRunInput = {
      workspaceId: "ws_test",
      workspacePath: dir,
      mode: "codex",
      approvalMode: "ask",
      prompt: "hello",
      requestApproval: async (request) => {
        events.push({
          type: "approval_requested",
          runtime: "codex",
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
    expect(approvalEvent?.title).toBe("Codex command approval");
    expect(events.some((event) => event.type === "tool_call" && event.title === "Codex command approval")).toBe(false);
    const text = events.find((event) => event.type === "message_delta")?.text ?? "";
    expect(JSON.parse(text)).toEqual({ decision: "accept" });
  });
});

function codexSelectedRoot(path: string) {
  return {
    id: `openone:${path}`,
    location: {
      type: "environment",
      environmentId: "local",
      path,
    },
  };
}

const fakeCodexScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let extraRoots = [];
let threadStartParams = null;

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "skills/extraRoots/set") {
    extraRoots = Array.isArray(message.params?.extraRoots) ? message.params.extraRoots : [];
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "thread/start") {
    threadStartParams = message.params ?? null;
    process.stdout.write(JSON.stringify({ id: message.id, result: { id: "thread-test" } }) + "\\n");
    return;
  }
  if (message.method === "turn/start") {
    const promptText = message.params?.input?.[0]?.text ?? "";
    const blocks = Array.isArray(message.params?.input) ? message.params.input : [];
    const images = blocks.filter((block) => block?.type === "image");
    const skillItems = blocks
      .filter((block) => block?.type === "skill")
      .map((block) => ({ name: block?.name ?? "", path: block?.path ?? "" }));
    const payload = {
      extraRoots,
      selectedCapabilityRoots: Array.isArray(threadStartParams?.selectedCapabilityRoots) ? threadStartParams.selectedCapabilityRoots : [],
      promptHasBroadSkillList: promptText.includes("Open One skills available in this workspace:"),
      promptHasCodexSkillMarker: promptText.includes("$sap-login"),
      promptHasOpenCodeSkillToken: promptText.includes("Load [skill sap-login] and follow its instructions."),
      promptHasSelectedSkill: promptText.includes("Open One selected Codex skills:") && promptText.includes("- sap-login"),
      promptHasLoadedSkillContent: promptText.includes("# sap-login") && promptText.includes("Use SAP GUI Login from Open One."),
      promptHasSelectedSkillPath: promptText.includes("SKILL.md path:") && promptText.includes("sap-login"),
      skillItems,
      sapWorkDir: process.env.SAPDEV_AI_WORK_DIR ?? null,
    };
    if (threadStartParams?.config) {
      payload.codexConfig = threadStartParams.config;
    }
    if (images.length > 0) {
      payload.imageCount = images.length;
      payload.firstImageUrl = images[0]?.url ?? "";
    }
    process.stdout.write(JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        delta: JSON.stringify(payload),
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: {} }) + "\\n");
  }
});
`;

const fakeCodexFileChangeScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "skills/extraRoots/set") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "thread/start") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { id: "thread-test" } }) + "\\n");
    return;
  }
  if (message.method === "turn/start") {
    process.stdout.write(JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          type: "fileChange",
          id: "patch-1",
          status: "completed",
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update", move_path: null },
              diff: "--- src/app.ts\\n+++ src/app.ts\\n@@ -1 +1 @@\\n-const name = \\"old\\";\\n+const name = \\"new\\";",
            },
            {
              path: "src/old.ts",
              kind: { type: "delete" },
              diff: "console.log(\\"old\\");\\n",
            },
          ],
        },
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: {} }) + "\\n");
  }
});
`;

const fakeCodexApprovalScript = `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let turnRequestId = null;

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "skills/extraRoots/set") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "thread/start") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { id: "thread-test" } }) + "\\n");
    return;
  }
  if (message.method === "turn/start") {
    turnRequestId = message.id;
    process.stdout.write(JSON.stringify({
      id: 100,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "echo hi",
        cwd: process.cwd(),
        availableDecisions: ["accept", "decline"],
      },
    }) + "\\n");
    return;
  }
  if (message.id === 100 && turnRequestId !== null) {
    process.stdout.write(JSON.stringify({
      method: "item/agentMessage/delta",
      params: { delta: JSON.stringify(message.result) },
    }) + "\\n");
    process.stdout.write(JSON.stringify({ id: turnRequestId, result: { ok: true } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: {} }) + "\\n");
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
