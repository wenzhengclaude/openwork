import { containsNeedle, extractText, isJsonObject, readNestedString, readString, type JsonObject, type JsonValue, StdioJsonRpcClient } from "../json-rpc.js";
import { resolveCodexCommand, resolveRuntimeEnv } from "../runtime-config.js";
import type { AgentRunApprovalMode, AgentRunEmitter, AgentRunInput, AgentRuntime } from "../types.js";

export class CodexRuntime implements AgentRuntime {
  readonly kind = "codex";

  async run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void> {
    const command = resolveCodexCommand();
    let completed = false;
    let resolveCompleted: (() => void) | null = null;
    let rejectCompleted: ((error: Error) => void) | null = null;
    const completedPromise = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const client = new StdioJsonRpcClient({
      command: command.command,
      args: command.args,
      cwd: input.workspacePath,
      env: resolveRuntimeEnv("CODEX"),
      includeJsonrpc: false,
      onStderr: (line) => {
        emit({ type: "log", runtime: this.kind, agentId: "codex", title: "Codex", text: line });
      },
      onRequest: (message) => {
        emit({
          type: "tool_call",
          runtime: this.kind,
          agentId: "codex",
          title: approvalTitle(message.method),
          status: "running",
        });
        return codexApprovalResponse(input.approvalMode, message.method, message.params);
      },
      onNotification: (message) => {
        this.handleNotification(message.method, message.params, emit);
        if (message.method === "turn/completed") {
          completed = true;
          resolveCompleted?.();
        }
      },
    });

    const onAbort = () => {
      client.dispose();
      rejectCompleted?.(new Error("Codex run cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      emit({ type: "agent_started", runtime: this.kind, agentId: "codex", title: "Codex" });
      await client.request("initialize", {
        clientInfo: {
          name: "open_one",
          title: "Open One",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      client.notify("initialized");
      const thread = await client.request("thread/start", codexThreadStartParams(input));
      const threadId = resolveThreadId(thread);
      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id");
      }
      await client.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: collaborativePrompt(input.prompt),
          },
        ],
        cwd: input.workspacePath,
        ...(input.model ? { model: input.model } : {}),
      });
      if (!completed) await completedPromise;
      emit({ type: "agent_completed", runtime: this.kind, agentId: "codex", title: "Codex", status: "completed" });
    } finally {
      signal.removeEventListener("abort", onAbort);
      client.dispose();
    }
  }

  private handleNotification(method: string, params: JsonValue | undefined, emit: AgentRunEmitter): void {
    if (method === "item/agentMessage/delta") {
      const text = extractText(params);
      if (text) emit({ type: "message_delta", runtime: this.kind, agentId: "codex", text });
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      const isCompleted = method === "item/completed";
      const item = resolveItem(params);
      if (handleCollabToolCall(item, isCompleted, emit)) return;
      if (handleSubAgentActivity(item, emit)) return;
      const title = inferTitle(params) || method.replace("item/", "Codex item ");
      if (containsNeedle(params, "tool")) {
        emit({
          type: "tool_call",
          runtime: this.kind,
          agentId: "codex",
          title,
          status: isCompleted ? "completed" : "running",
        });
      }
      return;
    }
    if (method === "thread/started" && containsNeedle(params, "parentThreadId")) {
      emit({
        type: "child_agent_started",
        runtime: this.kind,
        agentId: inferAgentId(params) || "codex-subagent",
        parentAgentId: "codex",
        title: inferTitle(params) || "Codex subagent",
        status: "running",
      });
      return;
    }
    if (method === "turn/completed") {
      const text = extractText(params);
      if (text) emit({ type: "message_delta", runtime: this.kind, agentId: "codex", text });
    }
  }
}

function codexThreadStartParams(input: AgentRunInput): JsonObject {
  const params: JsonObject = {
    cwd: input.workspacePath,
    ephemeral: true,
    runtimeWorkspaceRoots: [input.workspacePath],
  };
  if (input.model) params.model = input.model;

  if (input.approvalMode === "full-access") {
    params.approvalPolicy = "never";
    params.approvalsReviewer = "user";
    params.sandbox = "danger-full-access";
    return params;
  }

  params.approvalPolicy = "on-request";
  params.approvalsReviewer = input.approvalMode === "auto-review" ? "auto_review" : "user";

  if (input.approvalMode === "custom") {
    const permissionsProfile = process.env.OPENONE_CODEX_PERMISSIONS_PROFILE?.trim() || ":workspace";
    params.permissions = permissionsProfile;
    return params;
  }

  params.sandbox = "workspace-write";
  return params;
}

function codexApprovalResponse(
  approvalMode: AgentRunApprovalMode,
  method: string,
  params: JsonValue | undefined,
): JsonObject {
  if (method === "item/permissions/requestApproval") {
    return codexPermissionApprovalResponse(approvalMode, params);
  }
  if (method === "mcpServer/elicitation/request") {
    return { action: "decline", content: null };
  }
  if (!method.includes("requestApproval")) return {};
  if (approvalMode === "full-access") return { decision: "acceptForSession" };
  if (approvalMode === "auto-review") return { decision: "accept" };
  return { decision: "decline" };
}

function codexPermissionApprovalResponse(approvalMode: AgentRunApprovalMode, params: JsonValue | undefined): JsonObject {
  if ((approvalMode === "auto-review" || approvalMode === "full-access") && isJsonObject(params) && isJsonObject(params.permissions)) {
    return {
      scope: approvalMode === "full-access" ? "session" : "turn",
      permissions: params.permissions,
    };
  }
  return { scope: "turn", permissions: {} };
}

function collaborativePrompt(prompt: string): string {
  return [
    "Open One multi-agent collaboration is enabled.",
    "Use Codex native subagents when the task benefits from parallel code exploration, testing, or review.",
    "Keep subagent task names short and report their findings clearly for the Open One coordinator.",
    "",
    prompt,
  ].join("\n");
}

function resolveThreadId(value: JsonValue | undefined): string {
  const direct = readString(value, "id");
  if (direct) return direct;
  const nested = readNestedString(value, ["thread", "id"]);
  if (nested) return nested;
  return "";
}

function inferTitle(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "title"),
    readString(value, "name"),
    readString(value, "description"),
    readNestedString(value, ["item", "title"]),
    readNestedString(value, ["item", "name"]),
    readNestedString(value, ["item", "description"]),
    readNestedString(value, ["item", "toolName"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function inferAgentId(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "agentId"),
    readString(value, "agentPath"),
    readString(value, "agentThreadId"),
    readNestedString(value, ["thread", "id"]),
    readNestedString(value, ["item", "agentId"]),
    readNestedString(value, ["item", "agentPath"]),
    readNestedString(value, ["item", "agentThreadId"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function approvalTitle(method: string): string {
  if (method.includes("fileChange")) return "Codex file approval";
  if (method.includes("commandExecution")) return "Codex command approval";
  return method;
}

function resolveItem(params: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(params)) return params;
  if (isJsonObject(params.item)) return params.item;
  return params;
}

function handleCollabToolCall(item: JsonValue | undefined, fallbackCompleted: boolean, emit: AgentRunEmitter): boolean {
  const type = readString(item, "type");
  if (type !== "collabAgentToolCall" && type !== "collabToolCall") return false;
  const tool = normalizeToolName(readString(item, "tool"));
  const status = collabStatus(readString(item, "status"), fallbackCompleted);
  const receiverId = firstString(item, "receiverThreadIds") || readString(item, "receiverThreadId") || readString(item, "newThreadId");
  const agentId = receiverId || readString(item, "id") || "codex-subagent";
  const prompt = readString(item, "prompt");
  const title = collabTitle(tool, prompt);
  if (tool === "spawnagent") {
    emit({
      type: status === "running" ? "child_agent_started" : "child_agent_completed",
      runtime: "codex",
      agentId,
      parentAgentId: "codex",
      title,
      text: prompt,
      status,
    });
    return true;
  }
  emit({
    type: "tool_call",
    runtime: "codex",
    agentId: "codex",
    title,
    text: prompt,
    status,
  });
  return true;
}

function handleSubAgentActivity(item: JsonValue | undefined, emit: AgentRunEmitter): boolean {
  const type = readString(item, "type");
  if (type !== "subAgentActivity") return false;
  const kind = readString(item, "kind");
  const agentId = readString(item, "agentThreadId") || "codex-subagent";
  const title = readString(item, "agentPath") || "Codex subagent";
  if (kind === "started") {
    emit({
      type: "child_agent_started",
      runtime: "codex",
      agentId,
      parentAgentId: "codex",
      title,
      status: "running",
    });
    return true;
  }
  if (kind === "interrupted") {
    emit({
      type: "child_agent_completed",
      runtime: "codex",
      agentId,
      parentAgentId: "codex",
      title,
      status: "failed",
    });
    return true;
  }
  emit({
    type: "tool_call",
    runtime: "codex",
    agentId: "codex",
    title: `Codex subagent ${kind || "activity"}`,
    status: "running",
  });
  return true;
}

function firstString(value: JsonValue | undefined, key: string): string {
  if (!isJsonObject(value)) return "";
  const field = value[key];
  if (!Array.isArray(field)) return "";
  return field.find((item): item is string => typeof item === "string") ?? "";
}

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collabStatus(value: string, fallbackCompleted: boolean): "running" | "completed" | "failed" {
  const normalized = value.toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  return fallbackCompleted ? "completed" : "running";
}

function collabTitle(tool: string, prompt: string): string {
  if (tool === "spawnagent") return prompt ? compactTitle(prompt) : "Codex subagent";
  if (tool === "sendinput") return "Codex subagent input";
  if (tool === "resumeagent") return "Codex subagent resume";
  if (tool === "closeagent") return "Codex subagent close";
  if (tool === "wait") return "Codex subagent wait";
  return "Codex collaboration";
}

function compactTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61)}...`;
}
