import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containsNeedle, extractText, isJsonObject, readNestedString, readString, type JsonObject, type JsonValue, StdioJsonRpcClient } from "../json-rpc.js";
import { isRuntimeCommandAvailable, missingRuntimeCommandMessage, resolveGrokCommand, resolveRuntimeEnv } from "../runtime-config.js";
import type { AgentRunEmitter, AgentRunInput, AgentRuntime } from "../types.js";

export class GrokBuildRuntime implements AgentRuntime {
  readonly kind = "grok-build";

  async run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void> {
    const command = resolveGrokCommand(input.model, input.approvalMode, input.runtimeProvider);
    const available = await isRuntimeCommandAvailable(command.command);
    if (!available) {
      throw new Error(missingRuntimeCommandMessage("Grok Build", command.command, "OPENONE_GROK_COMMAND"));
    }
    const managedGrokHome = await createManagedGrokHome(input);
    const client = new StdioJsonRpcClient({
      command: command.command,
      args: command.args,
      cwd: input.workspacePath,
      env: {
        ...resolveRuntimeEnv("GROK", input.runtimeProvider),
        ...(managedGrokHome ? { GROK_HOME: managedGrokHome } : {}),
      },
      includeJsonrpc: true,
      onStderr: (line) => {
        emit({ type: "log", runtime: this.kind, agentId: "grok-build", title: "Grok Build", text: line });
      },
      onRequest: async (message) => {
        emit({
          type: "tool_call",
          runtime: this.kind,
          agentId: "grok-build",
          title: message.method,
          status: "running",
        });
        if (message.method.includes("request_permission")) return permissionResponse(input, message.method, message.params);
        const response: JsonObject = {};
        return response;
      },
      onNotification: (message) => {
        this.handleNotification(message.method, message.params, emit);
      },
    });
    const onAbort = () => {
      client.dispose();
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      emit({ type: "agent_started", runtime: this.kind, agentId: "grok-build", title: "Grok Build" });
      const initializeResponse = await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        _meta: {
          startupHints: {
            nonInteractive: true,
            skipGitStatus: true,
            skipProjectLayout: true,
          },
          clientType: "open-one",
        },
      });
      await authenticateGrokClient(client, initializeResponse);
      const session = await client.request("session/new", {
        cwd: input.workspacePath,
        mcpServers: [],
      });
      const sessionId = resolveSessionId(session);
      if (!sessionId) {
        throw new Error("Grok Build ACP did not return a session id");
      }
      await client.request("session/prompt", {
        sessionId,
        prompt: [
          {
            type: "text",
            text: collaborativePrompt(input.prompt),
          },
        ],
      });
      emit({ type: "agent_completed", runtime: this.kind, agentId: "grok-build", title: "Grok Build", status: "completed" });
    } finally {
      signal.removeEventListener("abort", onAbort);
      client.dispose();
      if (managedGrokHome) await removeManagedGrokHome(managedGrokHome);
    }
  }

  private handleNotification(method: string, params: JsonValue | undefined, emit: AgentRunEmitter): void {
    if (method !== "session/update" && method !== "x.ai/session/update") return;
    const update = resolveUpdate(params);
    const updateKind = readString(update, "sessionUpdate") || readString(update, "type");
    if (updateKind === "agent_message_chunk") {
      const text = extractText(update);
      if (text) emit({ type: "message_delta", runtime: this.kind, agentId: "grok-build", text });
      return;
    }
    if (updateKind === "agent_thought_chunk") {
      const text = extractText(update);
      if (text) emit({ type: "thought_delta", runtime: this.kind, agentId: "grok-build", text });
      return;
    }
    if (updateKind === "plan") {
      const text = extractText(update);
      emit({ type: "plan", runtime: this.kind, agentId: "grok-build", title: "Grok Build plan", text });
      return;
    }
    if (updateKind === "tool_call" || updateKind === "tool_call_update") {
      const title = inferTitle(update) || "Grok Build tool";
      const status = inferStatus(update);
      if (isSubagentToolCall(update)) {
        emit({
          type: status === "completed" ? "child_agent_completed" : "child_agent_started",
          runtime: this.kind,
          agentId: inferAgentId(update) || "grok-subagent",
          parentAgentId: "grok-build",
          title,
          status,
        });
        return;
      }
      emit({ type: "tool_call", runtime: this.kind, agentId: "grok-build", title, status });
      return;
    }
    const text = extractText(update);
    if (text) emit({ type: "log", runtime: this.kind, agentId: "grok-build", text });
  }
}

async function authenticateGrokClient(client: StdioJsonRpcClient, initializeResponse: JsonValue | undefined): Promise<void> {
  const methodId = selectGrokAuthMethod(initializeResponse);
  await client.request("authenticate", {
    methodId,
    _meta: { headless: true },
  });
}

function selectGrokAuthMethod(value: JsonValue | undefined): string {
  const authMethods = isJsonObject(value) ? value.authMethods ?? value.auth_methods : undefined;
  if (!Array.isArray(authMethods)) return "xai.api_key";
  const methodIds = authMethods
    .filter(isJsonObject)
    .map((method) => readString(method, "id") || readString(method, "methodId") || readString(method, "method_id"))
    .filter((methodId) => methodId.trim().length > 0);
  return methodIds.find((methodId) => methodId === "xai.api_key") ?? methodIds[0] ?? "xai.api_key";
}

async function createManagedGrokHome(input: AgentRunInput): Promise<string | null> {
  if (process.env.OPENONE_GROK_HOME?.trim()) return null;
  const baseUrl = input.runtimeProvider?.baseUrl.trim();
  const model = input.model?.trim();
  if (!baseUrl || !model) return null;
  const home = await mkdtemp(join(tmpdir(), "openone-grok-home-"));
  await writeFile(join(home, "config.toml"), grokConfigToml(baseUrl, model), "utf8");
  return home;
}

async function removeManagedGrokHome(home: string): Promise<void> {
  try {
    await rm(home, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function grokConfigToml(baseUrl: string, model: string): string {
  return [
    "[auth]",
    `preferred_method = ${tomlString("api_key")}`,
    "disable_api_key_auth = false",
    "",
    "[endpoints]",
    `xai_api_base_url = ${tomlString(baseUrl)}`,
    `models_base_url = ${tomlString(baseUrl)}`,
    `models_list_url = ${tomlString(appendModelsPath(baseUrl))}`,
    "",
    "[models]",
    `default = ${tomlString(model)}`,
    `web_search = ${tomlString(model)}`,
    "",
    "[features]",
    "managed_config = false",
    "telemetry = false",
    "feedback = false",
    "",
    `[model.${tomlString("grok-build")}]`,
    `model = ${tomlString(model)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `api_base_url = ${tomlString(baseUrl)}`,
    `name = ${tomlString(model)}`,
    `env_key = ${tomlString("OPENONE_GROK_API_KEY")}`,
    `api_backend = ${tomlString("chat_completions")}`,
    "context_window = 200000",
    "supported_in_api = true",
    "supports_reasoning_effort = true",
    "agent_type = \"grok-build\"",
    "",
    `[model.${tomlString(model)}]`,
    `model = ${tomlString(model)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `api_base_url = ${tomlString(baseUrl)}`,
    `name = ${tomlString(model)}`,
    `env_key = ${tomlString("OPENONE_GROK_API_KEY")}`,
    `api_backend = ${tomlString("chat_completions")}`,
    "context_window = 200000",
    "supported_in_api = true",
    "supports_reasoning_effort = true",
    "agent_type = \"grok-build\"",
    "",
  ].join("\n");
}

function appendModelsPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function collaborativePrompt(prompt: string): string {
  return [
    "Open One multi-agent collaboration is enabled.",
    "Use Grok Build native subagents when the task benefits from parallel code exploration, testing, or review.",
    "Expose subagent/task progress through normal ACP updates so Open One can render the collaboration timeline.",
    "",
    prompt,
  ].join("\n");
}

function resolveSessionId(value: JsonValue | undefined): string {
  const direct = readString(value, "sessionId");
  if (direct) return direct;
  const nested = readNestedString(value, ["session", "id"]);
  if (nested) return nested;
  return "";
}

function resolveUpdate(params: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(params)) return params;
  if (isJsonObject(params.update)) return params.update;
  if (isJsonObject(params.sessionUpdate)) return params.sessionUpdate;
  return params;
}

function inferTitle(value: JsonValue | undefined): string {
  const candidates = [
    readNestedString(value, ["input", "description"]),
    readNestedString(value, ["input", "subagent_type"]),
    readNestedString(value, ["toolCall", "input", "description"]),
    readNestedString(value, ["toolCall", "input", "subagent_type"]),
    readString(value, "title"),
    readString(value, "name"),
    readString(value, "description"),
    readNestedString(value, ["toolCall", "title"]),
    readNestedString(value, ["toolCall", "name"]),
    readNestedString(value, ["content", "text"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function inferAgentId(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "subagentId"),
    readString(value, "taskId"),
    readString(value, "id"),
    readNestedString(value, ["input", "subagent_id"]),
    readNestedString(value, ["toolCall", "input", "subagent_id"]),
    readNestedString(value, ["toolCall", "id"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function isSubagentToolCall(value: JsonValue | undefined): boolean {
  const names = [
    readString(value, "name"),
    readString(value, "title"),
    readNestedString(value, ["toolCall", "name"]),
    readNestedString(value, ["toolCall", "title"]),
  ].map((candidate) => candidate.toLowerCase());
  if (names.some((candidate) => candidate.includes("spawn_subagent"))) return true;
  if (readNestedString(value, ["input", "subagent_type"])) return true;
  if (readNestedString(value, ["toolCall", "input", "subagent_type"])) return true;
  return containsNeedle(value, "spawn_subagent") || containsNeedle(value, "subagent");
}

function inferStatus(value: JsonValue | undefined): "pending" | "running" | "completed" | "failed" {
  const status = (readString(value, "status") || readNestedString(value, ["toolCall", "status"])).toLowerCase();
  if (status === "completed" || status === "success" || status === "done") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "pending") return "pending";
  return "running";
}

async function permissionResponse(input: AgentRunInput, method: string, value: JsonValue | undefined): Promise<JsonObject> {
  if (input.approvalMode === "auto-review" || input.approvalMode === "full-access") return autoSelectPermission(value);
  if (input.approvalMode === "ask" && input.requestApproval) {
    const reply = await input.requestApproval({
      agentId: "grok-build",
      title: "Grok Build permission",
      permission: inferPermissionKind(value),
      patterns: permissionPatterns(value),
      metadata: permissionMetadata(method, value),
    });
    if (reply === "reject") return rejectPermission(value);
    return allowPermission(value, reply);
  }
  return rejectPermission(value);
}

function autoSelectPermission(value: JsonValue | undefined): JsonObject {
  const optionId = selectAllowPermissionOption(value, "always");
  if (!optionId) return {};
  return {
    outcome: {
      selected: {
        optionId,
      },
    },
  };
}

function allowPermission(value: JsonValue | undefined, reply: "once" | "always"): JsonObject {
  const optionId = selectAllowPermissionOption(value, reply);
  if (!optionId) return {};
  return {
    outcome: {
      selected: {
        optionId,
      },
    },
  };
}

function rejectPermission(value: JsonValue | undefined): JsonObject {
  const optionId = selectRejectPermissionOption(value);
  if (!optionId) return {};
  return {
    outcome: {
      selected: {
        optionId,
      },
    },
  };
}

function selectAllowPermissionOption(value: JsonValue | undefined, reply: "once" | "always"): string {
  if (!isJsonObject(value) || !Array.isArray(value.options)) return "";
  const options = value.options.filter(isJsonObject);
  const preferred = reply === "always"
    ? ["always-allow", "allow-always-mcp", "allow-always-domain", "allow-for-session", "allow-once", "opt-allow-once", "allow"]
    : ["allow-once", "opt-allow-once", "allow", "always-allow", "allow-always-mcp", "allow-always-domain", "allow-for-session"];
  for (const id of preferred) {
    if (options.some((option) => readString(option, "optionId") === id || readString(option, "option_id") === id)) {
      return id;
    }
  }
  for (const option of options) {
    const kind = readString(option, "kind").toLowerCase();
    if (kind.includes("allow")) return readString(option, "optionId") || readString(option, "option_id");
  }
  const first = options[0];
  return first ? readString(first, "optionId") || readString(first, "option_id") : "";
}

function inferPermissionKind(value: JsonValue | undefined): string {
  const action = readString(value, "action") || readNestedString(value, ["permission", "action"]);
  if (action.includes("file.read")) return "read";
  if (action.includes("file") || action.includes("write") || action.includes("edit")) return "edit";
  if (action.includes("command") || action.includes("shell") || action.includes("terminal")) return "bash";
  const tool = readString(value, "tool") || readNestedString(value, ["input", "tool"]);
  if (tool.includes("bash") || tool.includes("shell") || tool.includes("terminal")) return "bash";
  return "task";
}

function permissionPatterns(value: JsonValue | undefined): string[] {
  const resources = stringArray(value, "resources");
  if (resources.length > 0) return resources;
  const options = optionLabels(value);
  if (options.length > 0) return options;
  const text = extractText(value).trim();
  return [text ? compactTitle(text) : "Grok Build permission request"];
}

function optionLabels(value: JsonValue | undefined): string[] {
  if (!isJsonObject(value) || !Array.isArray(value.options)) return [];
  return value.options.filter(isJsonObject).flatMap((option) => {
    const label = readString(option, "label") || readString(option, "title") || readString(option, "optionId") || readString(option, "option_id");
    return label ? [label] : [];
  });
}

function stringArray(value: JsonValue | undefined, key: string): string[] {
  if (!isJsonObject(value)) return [];
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function permissionMetadata(method: string, value: JsonValue | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = { method };
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      metadata[key] = item;
    }
    return metadata;
  }
  if (value !== undefined) metadata.params = value;
  return metadata;
}

function compactTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61)}...`;
}

function selectRejectPermissionOption(value: JsonValue | undefined): string {
  if (!isJsonObject(value) || !Array.isArray(value.options)) return "";
  const options = value.options.filter(isJsonObject);
  const preferred = ["opt-reject-once", "reject-once", "opt-reject", "reject", "deny", "cancel"];
  for (const id of preferred) {
    if (options.some((option) => readString(option, "optionId") === id || readString(option, "option_id") === id)) {
      return id;
    }
  }
  for (const option of options) {
    const kind = readString(option, "kind").toLowerCase();
    if (kind.includes("reject") || kind.includes("deny") || kind.includes("cancel")) {
      return readString(option, "optionId") || readString(option, "option_id");
    }
  }
  return "";
}
