import { containsNeedle, extractText, isJsonObject, readNestedString, readString, type JsonObject, type JsonValue, StdioJsonRpcClient } from "../json-rpc.js";
import { resolveGrokCommand, resolveRuntimeEnv } from "../runtime-config.js";
import type { AgentRunEmitter, AgentRunInput, AgentRuntime } from "../types.js";

export class GrokBuildRuntime implements AgentRuntime {
  readonly kind = "grok-build";

  async run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void> {
    const command = resolveGrokCommand(input.model);
    const client = new StdioJsonRpcClient({
      command: command.command,
      args: command.args,
      cwd: input.workspacePath,
      env: resolveRuntimeEnv("GROK"),
      includeJsonrpc: true,
      onStderr: (line) => {
        emit({ type: "log", runtime: this.kind, agentId: "grok-build", title: "Grok Build", text: line });
      },
      onRequest: (message) => {
        emit({
          type: "tool_call",
          runtime: this.kind,
          agentId: "grok-build",
          title: message.method,
          status: "running",
        });
        if (message.method.includes("request_permission")) {
          return autoSelectPermission(message.params);
        }
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
      await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      });
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

function autoSelectPermission(value: JsonValue | undefined): JsonObject {
  const optionId = selectPermissionOption(value);
  if (!optionId) return {};
  return {
    outcome: {
      selected: {
        optionId,
      },
    },
  };
}

function selectPermissionOption(value: JsonValue | undefined): string {
  if (!isJsonObject(value) || !Array.isArray(value.options)) return "";
  const options = value.options.filter(isJsonObject);
  const preferred = ["always-allow", "allow-always-mcp", "allow-always-domain", "allow-once", "opt-allow-once", "allow"];
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
