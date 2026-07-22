import { dirname } from "node:path";
import { containsNeedle, extractText, isJsonObject, readNestedString, readString, type JsonObject, type JsonValue, StdioJsonRpcClient } from "../json-rpc.js";
import { cachedMcpUrlReachable } from "../mcp-reachability-cache.js";
import { isRuntimeCommandAvailable, missingRuntimeCommandMessage, resolveCodexCommand, resolveCodexModelProvider, resolveRuntimeEnv } from "../runtime-config.js";
import type { AgentRunApprovalReply, AgentRunCapabilities, AgentRunEmitter, AgentRunInput, AgentRunSkill, AgentRuntime } from "../types.js";

const DEFAULT_MCP_PROBE_TIMEOUT_MS = 2_000;

type SelectedSkillContext = {
  skill: AgentRunSkill;
};

export class CodexRuntime implements AgentRuntime {
  readonly kind = "codex";

  async run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void> {
    const modelProvider = resolveCodexModelProvider(input.modelProvider, input.runtimeProvider);
    const capabilities = await reachableCodexCapabilities(input, emit, signal);
    const runtimeInput: AgentRunInput = { ...input, capabilities };
    const selectedSkillContexts = await resolveSelectedSkillContexts(runtimeInput, emit);
    const command = resolveCodexCommand(modelProvider, runtimeInput.runtimeProvider, runtimeInput.capabilities);
    const available = await isRuntimeCommandAvailable(command.command);
    if (!available) {
      throw new Error(missingRuntimeCommandMessage("Codex", command.command, "OPENONE_CODEX_COMMAND"));
    }
    if (runtimeInput.runtimeProvider && runtimeInput.model) {
      runtimeModelContextWindow(runtimeInput);
    }
    let completed = false;
    let failureMessage = "";
    let failureTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveCompleted: (() => void) | null = null;
    let rejectCompleted: ((error: Error) => void) | null = null;
    const completedPromise = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const client = new StdioJsonRpcClient({
      command: command.command,
      args: command.args,
      cwd: runtimeInput.workspacePath,
      env: resolveRuntimeEnv("CODEX", runtimeInput.runtimeProvider, runtimeInput),
      includeJsonrpc: false,
      onStderr: (line) => {
        emit({ type: "log", runtime: this.kind, agentId: "codex", title: "Codex", text: line });
      },
      onRequest: async (message) => {
        return codexApprovalResponse(input, message.method, message.params);
      },
      onNotification: (message) => {
        this.handleNotification(message.method, message.params, emit);
        const notificationFailure = notificationErrorMessage(message.method, message.params);
        if (notificationFailure && !failureMessage) {
          failureMessage = notificationFailure;
          emit({
            type: "error",
            runtime: this.kind,
            agentId: "codex",
            title: "Codex failed",
            text: notificationFailure,
            status: "failed",
          });
          failureTimer = setTimeout(() => {
            if (completed) return;
            completed = true;
            resolveCompleted?.();
          }, 5_000);
        }
        if (message.method === "turn/completed") {
          const turnFailure = turnCompletionErrorMessage(message.params);
          if (turnFailure && !failureMessage) {
            failureMessage = turnFailure;
            emit({
              type: "error",
              runtime: this.kind,
              agentId: "codex",
              title: "Codex failed",
              text: turnFailure,
              status: "failed",
            });
          }
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
      await client.request("skills/extraRoots/set", {
        extraRoots: codexSkillExtraRoots(runtimeInput, selectedSkillContexts),
      });
      const thread = await client.request("thread/start", codexThreadStartParams(runtimeInput, modelProvider, selectedSkillContexts));
      const threadId = resolveThreadId(thread);
      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id");
      }
      await client.request("turn/start", {
        threadId,
        input: codexTurnInput(runtimeInput, selectedSkillContexts),
        cwd: runtimeInput.workspacePath,
        ...(shouldPassCodexModel(runtimeInput, modelProvider) ? { model: runtimeInput.model } : {}),
        ...(modelProvider ? { modelProvider } : {}),
      });
      if (!completed) await completedPromise;
      emit({ type: "agent_completed", runtime: this.kind, agentId: "codex", title: "Codex", status: failureMessage ? "failed" : "completed" });
    } finally {
      if (failureTimer) clearTimeout(failureTimer);
      signal.removeEventListener("abort", onAbort);
      client.dispose();
    }
  }

  private handleNotification(method: string, params: JsonValue | undefined, emit: AgentRunEmitter): void {
    if (method === "turn/plan/updated") {
      handleTurnPlanUpdated(params, emit);
      return;
    }
    if (method === "item/plan/delta") {
      const text = extractText(params);
      if (text) emit({ type: "plan", runtime: this.kind, agentId: "codex", title: "Planning", text, status: "running" });
      return;
    }
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
      if (handleThreadItem(item, isCompleted, emit)) return;
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
        details: {
          sourceProtocol: "codex-thread-item",
          sourceType: "thread/started",
          activityKind: "subagent",
        },
      });
      return;
    }
    if (method === "turn/completed") {
      const text = extractText(params);
      if (text) emit({ type: "message_delta", runtime: this.kind, agentId: "codex", text });
    }
  }
}

function handleTurnPlanUpdated(params: JsonValue | undefined, emit: AgentRunEmitter): void {
  const explanation = readString(params, "explanation");
  const plan = readJsonField(params, "plan");
  const lines: string[] = [];
  let activeStep = "";
  if (Array.isArray(plan)) {
    for (const item of plan) {
      if (!isJsonObject(item)) continue;
      const step = readString(item, "step").trim();
      if (!step) continue;
      const status = readString(item, "status").trim();
      if (!activeStep && (status === "inProgress" || status === "running")) activeStep = step;
      lines.push(`${planStatusLabel(status)} ${step}`);
    }
  }
  const title = explanation.trim() || activeStep || "Planning";
  emit({
    type: "plan",
    runtime: "codex",
    agentId: "codex",
    title: compactTitle(title),
    text: lines.join("\n"),
    status: "running",
    details: {
      sourceProtocol: "codex-thread-item",
      sourceType: "turnPlanUpdated",
      activityKind: "plan",
    },
  });
}

function handleThreadItem(item: JsonValue | undefined, isCompleted: boolean, emit: AgentRunEmitter): boolean {
  const type = readString(item, "type");
  if (!type) return false;
  const status = codexThreadItemStatus(item, isCompleted);
  const itemId = readString(item, "id");
  if (type === "commandExecution") {
    const command = readString(item, "command");
    const cwd = readString(item, "cwd");
    emit({
      type: "tool_call",
      runtime: "codex",
      agentId: "codex",
      title: command || "Run command",
      text: cwd,
      status,
      details: codexThreadItemDetails(type, itemId, "command", { command, cwd }),
    });
    return true;
  }
  if (type === "dynamicToolCall") {
    const tool = readString(item, "tool");
    const skillName = dynamicToolSkillName(item);
    const title = dynamicToolTitle(item);
    const text = jsonPreview(readJsonField(item, "arguments"));
    const details: Record<string, unknown> = codexThreadItemDetails(
      type,
      itemId,
      skillName ? "skill_load" : "tool",
      { tool },
    );
    if (skillName) details.skill = skillName;
    emit({
      type: "tool_call",
      runtime: "codex",
      agentId: "codex",
      title,
      text,
      status,
      details,
    });
    return true;
  }
  if (type === "mcpToolCall") {
    const server = readString(item, "server");
    const tool = readString(item, "tool");
    const title = server && tool ? `${server}.${tool}` : tool || server || "MCP tool";
    emit({
      type: "tool_call",
      runtime: "codex",
      agentId: "codex",
      title,
      text: jsonPreview(readJsonField(item, "arguments")),
      status,
      details: codexThreadItemDetails(type, itemId, "mcp_tool", { server, tool }),
    });
    return true;
  }
  if (type === "fileChange") {
    const changes = codexFileChanges(item);
    if (changes.length === 0) {
      emit({
        type: "tool_call",
        runtime: "codex",
        agentId: "codex",
        title: "File changes",
        status,
        details: codexThreadItemDetails(type, itemId, "file_change"),
      });
      return true;
    }
    for (const change of changes) {
      emit({
        type: "tool_call",
        runtime: "codex",
        agentId: "codex",
        title: "Edited file",
        text: change.path,
        status,
        details: codexThreadItemDetails(type, `${itemId}:${change.path}`, "file_edit", {
          path: change.path,
          changeKind: change.kind,
          diff: change.diff,
          additions: change.additions,
          deletions: change.deletions,
        }),
      });
    }
    return true;
  }
  if (type === "plan") {
    const text = readString(item, "text");
    emit({
      type: "plan",
      runtime: "codex",
      agentId: "codex",
      title: compactTitle(text || "Planning"),
      text,
      status,
      details: codexThreadItemDetails(type, itemId, "plan"),
    });
    return true;
  }
  if (type === "webSearch") {
    emit({ type: "tool_call", runtime: "codex", agentId: "codex", title: "Web search", status, details: codexThreadItemDetails(type, itemId, "web_search") });
    return true;
  }
  if (type === "imageGeneration") {
    emit({ type: "tool_call", runtime: "codex", agentId: "codex", title: "Image generation", status, details: codexThreadItemDetails(type, itemId, "image_generation") });
    return true;
  }
  if (type === "sleep") {
    emit({ type: "tool_call", runtime: "codex", agentId: "codex", title: "Wait", text: readString(item, "durationMs"), status, details: codexThreadItemDetails(type, itemId, "wait") });
    return true;
  }
  return false;
}

function codexThreadItemDetails(type: string, itemId: string, activityKind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemType: type,
    itemId,
    sourceProtocol: "codex-thread-item",
    sourceType: type,
    activityKind,
    ...extra,
  };
}

type CodexFileChange = {
  path: string;
  kind: string;
  diff: string;
  additions: number;
  deletions: number;
};

function codexFileChanges(item: JsonValue | undefined): CodexFileChange[] {
  const result: CodexFileChange[] = [];
  for (const change of readJsonArrayField(item, "changes")) {
    if (!isJsonObject(change)) continue;
    const path = readString(change, "path");
    if (!path) continue;
    const kind = codexFileChangeKind(change);
    const diff = codexFileChangeDiff(path, kind, readString(change, "diff"));
    const stats = countUnifiedDiffLines(diff);
    result.push({ path, kind, diff, additions: stats.additions, deletions: stats.deletions });
  }
  return result;
}

function codexFileChangeKind(change: JsonObject): string {
  const kind = readJsonField(change, "kind");
  if (typeof kind === "string") return kind;
  if (isJsonObject(kind)) return readString(kind, "type");
  return "";
}

function codexFileChangeDiff(path: string, kind: string, diff: string): string {
  if (kind === "add") return contentOnlyFileDiff("/dev/null", path, "+", diff);
  if (kind === "delete") return contentOnlyFileDiff(path, "/dev/null", "-", diff);
  return diff;
}

function contentOnlyFileDiff(beforePath: string, afterPath: string, prefix: "+" | "-", content: string): string {
  const lines = splitComparableLines(content);
  const header = prefix === "+"
    ? `@@ -0,0 +1,${lines.length} @@`
    : `@@ -1,${lines.length} +0,0 @@`;
  return [
    `--- ${beforePath}`,
    `+++ ${afterPath}`,
    header,
    ...lines.map((line) => `${prefix}${line}`),
  ].join("\n");
}

function splitComparableLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countUnifiedDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function codexThreadItemStatus(item: JsonValue | undefined, isCompleted: boolean): "running" | "completed" | "failed" {
  const normalized = readString(item, "status").toLowerCase();
  if (normalized === "failed" || normalized === "declined") return "failed";
  if (normalized === "completed" || isCompleted) return "completed";
  return "running";
}

function dynamicToolTitle(item: JsonValue | undefined): string {
  const tool = readString(item, "tool");
  const namespace = readString(item, "namespace");
  const skillName = dynamicToolSkillName(item);
  if (normalizeToolName(tool) === "skill" && skillName) return `Load skill ${skillName}`;
  if (namespace && tool) return `${namespace}.${tool}`;
  return tool || "Tool";
}

function dynamicToolSkillName(item: JsonValue | undefined): string {
  const tool = readString(item, "tool");
  if (normalizeToolName(tool) !== "skill") return "";
  return readNestedString(item, ["arguments", "name"]);
}

function planStatusLabel(status: string): string {
  if (status === "completed") return "done";
  if (status === "inProgress" || status === "running") return "doing";
  return "todo";
}

function readJsonField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (!isJsonObject(value)) return undefined;
  return value[key];
}

function readJsonArrayField(value: JsonValue | undefined, key: string): JsonValue[] {
  const field = readJsonField(value, key);
  return Array.isArray(field) ? field : [];
}

function jsonPreview(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return compactTitle(value);
  try {
    return compactTitle(JSON.stringify(value));
  } catch {
    return "";
  }
}

async function reachableCodexCapabilities(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<AgentRunCapabilities | undefined> {
  const capabilities = input.capabilities;
  if (!capabilities) return undefined;
  const timeoutMs = mcpProbeTimeoutMs();
  if (timeoutMs <= 0) return capabilities;
  const entries = await Promise.all(Object.entries(capabilities.mcpServers).map(async ([name, server]) => {
    const url = mcpServerUrl(server);
    if (!url) return { name, server };
    if (await cachedMcpUrlReachable({ url, headers: mcpProbeHeaders(server), timeoutMs, signal })) return { name, server };
    if (!signal.aborted) {
      emit({
        type: "log",
        runtime: "codex",
        agentId: "codex",
        title: "MCP unavailable",
        text: `Skipping unreachable MCP server ${name} (${url}) for this Codex run.`,
      });
    }
    return null;
  }));
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    if (!entry) continue;
    mcpServers[entry.name] = entry.server;
  }
  return { ...capabilities, mcpServers };
}

function mcpServerUrl(server: Record<string, unknown>): string {
  const value = server.url;
  return typeof value === "string" ? value.trim() : "";
}

function mcpProbeHeaders(server: Record<string, unknown>): Record<string, string> {
  const headers = server.headers ?? server.http_headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" && name.trim()) result[name] = value;
  }
  return result;
}

function mcpProbeTimeoutMs(): number {
  const raw = process.env.OPENONE_AGENT_MCP_PROBE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_MCP_PROBE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MCP_PROBE_TIMEOUT_MS;
  return parsed;
}

function codexThreadStartParams(input: AgentRunInput, modelProvider: string | undefined, selectedSkillContexts: SelectedSkillContext[]): JsonObject {
  const selectedCapabilityRoots = codexSelectedCapabilityRoots(input, selectedSkillContexts);
  const params: JsonObject = {
    cwd: input.workspacePath,
    ephemeral: true,
    runtimeWorkspaceRoots: codexRuntimeWorkspaceRoots(input, selectedSkillContexts),
  };
  if (selectedCapabilityRoots.length > 0) params.selectedCapabilityRoots = selectedCapabilityRoots;
  const model = input.model;
  if (model && shouldPassCodexModel(input, modelProvider)) params.model = model;
  if (modelProvider) params.modelProvider = modelProvider;
  const modelContextWindow = runtimeModelContextWindow(input);
  if (modelContextWindow !== undefined) {
    params.config = { model_context_window: modelContextWindow };
  }

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

function runtimeModelContextWindow(input: AgentRunInput): number | undefined {
  const value = input.modelContextWindow;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return undefined;
}

function shouldPassCodexModel(input: AgentRunInput, modelProvider: string | undefined): boolean {
  if (!input.model) return false;
  if (modelProvider) return true;
  return !isOpenOneManagedProviderId(input.modelProvider ?? "");
}

function isOpenOneManagedProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === "company-local" || normalized.startsWith("company-local-");
}

async function codexApprovalResponse(
  input: AgentRunInput,
  method: string,
  params: JsonValue | undefined,
): Promise<JsonObject> {
  if (method === "item/permissions/requestApproval") {
    return codexPermissionApprovalResponse(input, method, params);
  }
  if (method === "mcpServer/elicitation/request") {
    return { action: "decline", content: null };
  }
  if (!method.includes("requestApproval")) return {};
  if (input.approvalMode === "full-access") return { decision: "acceptForSession" };
  if (input.approvalMode === "auto-review") return { decision: "accept" };
  if (input.approvalMode === "ask") {
    const reply = await requestCodexApproval(input, method, params);
    if (reply === "always") return { decision: "acceptForSession" };
    if (reply === "once") return { decision: "accept" };
  }
  return { decision: "decline" };
}

async function codexPermissionApprovalResponse(input: AgentRunInput, method: string, params: JsonValue | undefined): Promise<JsonObject> {
  if ((input.approvalMode === "auto-review" || input.approvalMode === "full-access") && isJsonObject(params) && isJsonObject(params.permissions)) {
    return {
      scope: input.approvalMode === "full-access" ? "session" : "turn",
      permissions: params.permissions,
    };
  }
  if (input.approvalMode === "ask" && isJsonObject(params) && isJsonObject(params.permissions)) {
    const reply = await requestCodexApproval(input, method, params);
    if (reply === "always" || reply === "once") {
      return {
        scope: reply === "always" ? "session" : "turn",
        permissions: params.permissions,
      };
    }
  }
  return { scope: "turn", permissions: {} };
}

async function requestCodexApproval(input: AgentRunInput, method: string, params: JsonValue | undefined): Promise<AgentRunApprovalReply> {
  if (!input.requestApproval) return "reject";
  return input.requestApproval({
    agentId: "codex",
    title: approvalTitle(method),
    permission: inferApprovalPermission(method, params),
    patterns: approvalPatterns(params),
    metadata: approvalMetadata(method, params),
  });
}

function inferApprovalPermission(method: string, params: JsonValue | undefined): string {
  if (method.includes("commandExecution") || containsNeedle(params, "command")) return "bash";
  if (method.includes("fileChange") || containsNeedle(params, "file")) return "edit";
  if (containsNeedle(params, "read")) return "read";
  return "task";
}

function approvalPatterns(params: JsonValue | undefined): string[] {
  const permissions = isJsonObject(params) && isJsonObject(params.permissions) ? params.permissions : params;
  if (isJsonObject(permissions)) {
    const patterns = Object.entries(permissions).flatMap(([key, value]) => permissionPattern(key, value));
    if (patterns.length > 0) return patterns;
  }
  const text = extractText(params).trim();
  return [text ? compactTitle(text) : "Codex permission request"];
}

function permissionPattern(key: string, value: JsonValue): string[] {
  if (typeof value === "string" && value.trim()) return [`${key}: ${value}`];
  if (typeof value === "number" || typeof value === "boolean") return [`${key}: ${String(value)}`];
  if (Array.isArray(value)) {
    const rendered = value.slice(0, 3).map((item) => compactTitle(JSON.stringify(item))).join(", ");
    return rendered ? [`${key}: ${rendered}`] : [key];
  }
  return [key];
}

function approvalMetadata(method: string, params: JsonValue | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = { method };
  if (isJsonObject(params)) {
    for (const [key, value] of Object.entries(params)) {
      metadata[key] = value;
    }
    return metadata;
  }
  if (params !== undefined) metadata.params = params;
  return metadata;
}

function collaborativePrompt(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): string {
  return [
    ...coordinationPromptLines(input),
    "When Open One provides selected Codex skills below, they are also attached as native Codex skill input items.",
    ...capabilityPromptLines(input, selectedSkillContexts.length > 0),
    ...selectedSkillPromptLines(selectedSkillContexts),
    "",
    promptWithCodexSkillMarkers(input.prompt, selectedSkillContexts),
  ].join("\n");
}

function codexTurnInput(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): JsonObject[] {
  const items: JsonObject[] = [{
    type: "text",
    text: collaborativePrompt(input, selectedSkillContexts),
  }];
  for (const context of selectedSkillContexts) {
    items.push({
      type: "skill",
      name: context.skill.name,
      path: context.skill.path,
    });
  }
  for (const attachment of input.attachments ?? []) {
    if (!attachment.mime.startsWith("image/")) continue;
    items.push({
      type: "image",
      url: attachment.dataUrl,
    });
  }
  return items;
}

function coordinationPromptLines(input: AgentRunInput): string[] {
  if (input.mode === "multi-agent") {
    return [
      "Open One multi-agent collaboration is enabled.",
      "Use Codex native subagents when the task benefits from parallel code exploration, testing, or review.",
      "Keep subagent task names short and report their findings clearly for the Open One coordinator.",
    ];
  }
  return [
    "Open One is running this task with Codex.",
    "Do not create subagents for a single selected skill unless the user explicitly asks for parallel agents.",
    "For selected skill runs, keep progress in tool/activity updates and reserve assistant message text for the final result or the next required user input.",
  ];
}

function capabilityPromptLines(input: AgentRunInput, hasSelectedSkills: boolean): string[] {
  const capabilities = input.capabilities;
  if (!capabilities) return [];
  const lines: string[] = [];
  const mcpNames = Object.keys(capabilities.mcpServers);
  if (mcpNames.length > 0) {
    lines.push(`Open One MCP servers shared with this run: ${mcpNames.join(", ")}.`);
  }
  if (!hasSelectedSkills && capabilities.skills.length > 0) {
    lines.push("Open One skills available in this workspace:");
    for (const skill of capabilities.skills.slice(0, 12)) {
      const detail = skill.trigger || skill.description;
      lines.push(`- ${skill.name}${detail ? `: ${detail}` : ""}`);
    }
    if (capabilities.skills.length > 12) {
      lines.push(`- ...and ${capabilities.skills.length - 12} more Open One skills managed by this workspace.`);
    }
  }
  return lines;
}

function selectedSkillPromptLines(selectedSkillContexts: SelectedSkillContext[]): string[] {
  if (selectedSkillContexts.length === 0) return [];
  const lines = [
    "",
    "Open One selected Codex skills:",
    "Codex app-server receives these as structured skill input items and should load their instructions from the attached paths.",
    "If required user inputs are missing for the selected skill, ask only for those inputs before running skill scripts or tools.",
    "Keep user-facing replies concise and in the user's language.",
  ];
  for (const context of selectedSkillContexts) {
    const { skill } = context;
    lines.push(`- ${skill.name}`);
    lines.push(`  Codex marker: ${codexSkillMarker(skill.name)}`);
    lines.push(`  SKILL.md path: ${skill.path}`);
    if (skill.description) lines.push(`  Description: ${skill.description}`);
    if (skill.trigger) lines.push(`  Trigger: ${skill.trigger}`);
  }
  return lines;
}

function promptWithCodexSkillMarkers(prompt: string, selectedSkillContexts: SelectedSkillContext[]): string {
  const markers = selectedSkillContexts
    .map((context) => codexSkillMarker(context.skill.name))
    .filter((marker) => !containsToken(prompt, marker));
  if (markers.length === 0) return prompt;
  return [markers.join(" "), prompt].join("\n");
}

function codexSkillMarker(name: string): string {
  return `$${name}`;
}

function containsToken(prompt: string, token: string): boolean {
  return prompt.toLowerCase().includes(token.toLowerCase());
}

function codexRuntimeWorkspaceRoots(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): string[] {
  return uniqueStrings([
    input.workspacePath,
    ...(input.capabilities?.skillRoots ?? []),
    ...(input.capabilities?.pluginPaths ?? []),
    ...selectedSkillContexts.map((context) => dirname(context.skill.path)),
  ]);
}

function codexSkillExtraRoots(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): string[] {
  return uniqueStrings([
    ...(input.capabilities?.skillRoots ?? []),
    ...selectedSkillContexts.map((context) => dirname(dirname(context.skill.path))),
  ]);
}

function codexSelectedCapabilityRoots(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): JsonObject[] {
  return uniqueStrings([
    ...(input.capabilities?.skillRoots ?? []),
    ...(input.capabilities?.pluginPaths ?? []),
    ...selectedSkillContexts.map((context) => dirname(dirname(context.skill.path))),
  ]).map((path) => ({
    id: `openone:${path}`,
    location: {
      type: "environment",
      environmentId: "local",
      path,
    },
  }));
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

async function resolveSelectedSkillContexts(input: AgentRunInput, emit: AgentRunEmitter): Promise<SelectedSkillContext[]> {
  const capabilities = input.capabilities;
  if (!capabilities) return [];
  const names = selectedSkillNames(input);
  if (names.length === 0) return [];
  const skillsByName = new Map(capabilities.skills.map((skill) => [skill.name.toLowerCase(), skill]));
  const result: SelectedSkillContext[] = [];
  for (const name of names) {
    const skill = skillsByName.get(name.toLowerCase());
    if (!skill) continue;
    result.push({ skill });
    emit({
      type: "log",
      runtime: "codex",
      agentId: "codex",
      title: "Skill selected",
      text: skill.path,
      status: "completed",
      details: {
        itemType: "skillSelection",
        sourceProtocol: "codex-app-server-skill-input",
        sourceType: "skillSelection",
        activityKind: "skill_selection",
        skill: skill.name,
        path: skill.path,
      },
    });
  }
  return result;
}

function selectedSkillNames(input: AgentRunInput): string[] {
  const result: string[] = [];
  for (const name of input.selectedSkills ?? []) addSkillName(result, name);
  for (const match of input.prompt.matchAll(/\[skill\s+([^\]]+)\]/gi)) {
    addSkillName(result, match[1] ?? "");
  }
  for (const match of input.prompt.matchAll(/\bthe\s+["']([^"']+)["']\s+skill\b/gi)) {
    addSkillName(result, match[1] ?? "");
  }
  const slashMatch = input.prompt.trim().match(/^\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\s|$)/);
  addSkillName(result, slashMatch?.[1] ?? "");
  return result;
}

function addSkillName(result: string[], value: string): void {
  const name = value.trim();
  if (!name) return;
  if (result.some((item) => item.toLowerCase() === name.toLowerCase())) return;
  result.push(name);
}

function resolveThreadId(value: JsonValue | undefined): string {
  const direct = readString(value, "id");
  if (direct) return direct;
  const nested = readNestedString(value, ["thread", "id"]);
  if (nested) return nested;
  return "";
}

function notificationErrorMessage(method: string, params: JsonValue | undefined): string {
  if (method !== "error") return "";
  return readNestedString(params, ["error", "message"]) || readString(params, "message") || extractText(params);
}

function turnCompletionErrorMessage(params: JsonValue | undefined): string {
  return readNestedString(params, ["turn", "error", "message"]) || readNestedString(params, ["error", "message"]) || "";
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
      details: codexThreadItemDetails(type, readString(item, "id"), "subagent", { tool, receiverId }),
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
    details: codexThreadItemDetails(type, readString(item, "id"), "tool", { tool }),
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
      details: codexThreadItemDetails(type, readString(item, "id"), "subagent", { kind }),
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
      details: codexThreadItemDetails(type, readString(item, "id"), "subagent", { kind }),
    });
    return true;
  }
  emit({
    type: "tool_call",
    runtime: "codex",
    agentId: "codex",
    title: `Codex subagent ${kind || "activity"}`,
    status: "running",
    details: codexThreadItemDetails(type, readString(item, "id"), "subagent", { kind }),
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
