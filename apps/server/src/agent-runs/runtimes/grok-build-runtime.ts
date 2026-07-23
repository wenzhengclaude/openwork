import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { containsNeedle, extractText, isJsonObject, readNestedString, readString, type JsonObject, type JsonValue, StdioJsonRpcClient } from "../json-rpc.js";
import { startGrokProviderProxy } from "../grok-provider-proxy.js";
import { cachedMcpUrlReachable } from "../mcp-reachability-cache.js";
import { grokMcpServers, isRuntimeCommandAvailable, missingRuntimeCommandMessage, resolveGrokCommand, resolveRuntimeEnv } from "../runtime-config.js";
import type { AgentRunEmitter, AgentRunInput, AgentRunSkill, AgentRuntime } from "../types.js";

const DEFAULT_MCP_PROBE_TIMEOUT_MS = 2_000;

type SelectedSkillContext = {
  skill: AgentRunSkill;
};

export class GrokBuildRuntime implements AgentRuntime {
  readonly kind = "grok-build";

  async run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void> {
    const selectedSkillContexts = await resolveSelectedSkillContexts(input, emit);
    const commandProbe = resolveGrokCommand(input.model, input.approvalMode, input.runtimeProvider);
    const available = await isRuntimeCommandAvailable(commandProbe.command);
    if (!available) {
      throw new Error(missingRuntimeCommandMessage("Grok Build", commandProbe.command, "OPENONE_GROK_COMMAND"));
    }
    const providerProxy = await startGrokProviderProxy(input.runtimeProvider);
    const runtimeInput = providerProxy && input.runtimeProvider
      ? { ...input, runtimeProvider: { ...input.runtimeProvider, baseUrl: providerProxy.baseUrl } }
      : input;
    const command = resolveGrokCommand(runtimeInput.model, runtimeInput.approvalMode, runtimeInput.runtimeProvider);
    const managedGrokHome = await createManagedGrokHome(runtimeInput, selectedSkillContexts);
    const acpClient = new GrokAcpClient(runtimeInput, emit);
    const client = new StdioJsonRpcClient({
      command: command.command,
      args: command.args,
      cwd: runtimeInput.workspacePath,
      env: {
        ...resolveRuntimeEnv("GROK", runtimeInput.runtimeProvider, runtimeInput),
        ...managedGrokIsolationEnv(),
        ...(managedGrokHome ? { GROK_HOME: managedGrokHome } : {}),
      },
      includeJsonrpc: true,
      onStderr: (line) => {
        emit({ type: "log", runtime: this.kind, agentId: "grok-build", title: "Grok Build", text: line });
      },
      onRequest: async (message) => {
        if (message.method.includes("request_permission")) return permissionResponse(runtimeInput, message.method, message.params);
        return acpClient.handle(message.method, message.params);
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
      const mcpServers = await reachableGrokMcpServers(runtimeInput, emit, signal);
      const session = await client.request("session/new", {
        cwd: runtimeInput.workspacePath,
        mcpServers,
      });
      const sessionId = resolveSessionId(session);
      if (!sessionId) {
        throw new Error("Grok Build ACP did not return a session id");
      }
      await client.request("session/prompt", {
        sessionId,
        prompt: grokPrompt(runtimeInput, selectedSkillContexts),
      });
      emit({ type: "agent_completed", runtime: this.kind, agentId: "grok-build", title: "Grok Build", status: "completed" });
    } finally {
      signal.removeEventListener("abort", onAbort);
      client.dispose();
      acpClient.dispose();
      if (managedGrokHome) await removeManagedGrokHome(managedGrokHome);
      if (providerProxy) await providerProxy.close();
    }
  }

  private handleNotification(method: string, params: JsonValue | undefined, emit: AgentRunEmitter): void {
    if (isGrokPromptCompleteMethod(method)) {
      this.handlePromptComplete(params, emit);
      return;
    }
    if (!isGrokSessionUpdateMethod(method)) return;
    const update = resolveUpdate(params);
    this.handleSessionUpdate(update, emit);
  }

  private handlePromptComplete(params: JsonValue | undefined, emit: AgentRunEmitter): void {
    const stopReason = readString(params, "stopReason") || readString(params, "stop_reason");
    if (!isFailureStopReason(stopReason)) return;
    const text = readString(params, "agentResult") || readString(params, "agent_result") || extractText(params) || stopReason;
    emit({ type: "error", runtime: this.kind, agentId: "grok-build", title: "Grok Build failed", text });
  }

  private handleSessionUpdate(update: JsonValue | undefined, emit: AgentRunEmitter): void {
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
    if (updateKind === "user_message" || updateKind === "user_message_chunk") {
      return;
    }
    if (updateKind === "plan") {
      const text = extractText(update);
      emit({
        type: "plan",
        runtime: this.kind,
        agentId: "grok-build",
        title: "Grok Build plan",
        text,
        details: grokSourceDetails(update, "plan"),
      });
      return;
    }
    if (updateKind === "subagent_spawned") {
      emit({
        type: "child_agent_started",
        runtime: this.kind,
        agentId: inferAgentId(update) || "grok-subagent",
        parentAgentId: "grok-build",
        title: inferTitle(update) || "Grok Build subagent",
        status: "running",
        details: grokSourceDetails(update, "subagent"),
      });
      return;
    }
    if (updateKind === "subagent_finished") {
      emit({
        type: "child_agent_completed",
        runtime: this.kind,
        agentId: inferAgentId(update) || "grok-subagent",
        parentAgentId: "grok-build",
        title: inferTitle(update) || "Grok Build subagent",
        status: inferStatus(update),
        details: grokSourceDetails(update, "subagent"),
      });
      return;
    }
    if (updateKind === "turn_completed") {
      const stopReason = readString(update, "stop_reason") || readString(update, "stopReason");
      if (isFailureStopReason(stopReason)) {
        const text = readString(update, "agent_result") || readString(update, "agentResult") || stopReason;
        emit({ type: "error", runtime: this.kind, agentId: "grok-build", title: "Grok Build failed", text });
      }
      return;
    }
    if (updateKind === "retry_state") {
      const text = extractText(update);
      if (text) emit({ type: "log", runtime: this.kind, agentId: "grok-build", title: "Grok retry", text });
      return;
    }
    if (updateKind === "pending_interaction") {
      const toolEvent = grokToolEvent(update);
      if (toolEvent) {
        emit({ type: "tool_call", runtime: this.kind, agentId: "grok-build", title: toolEvent.title, text: toolEvent.text, status: "pending", details: toolEvent.details });
      }
      return;
    }
    if (updateKind === "tool_call" || updateKind === "tool_call_update") {
      const toolEvent = grokToolEvent(update);
      if (!toolEvent) return;
      const status = inferStatus(update);
      if (isSubagentToolCall(update)) {
        emit({
          type: status === "completed" ? "child_agent_completed" : "child_agent_started",
          runtime: this.kind,
          agentId: inferAgentId(update) || "grok-subagent",
        parentAgentId: "grok-build",
        title: toolEvent.title,
        status,
        details: { ...toolEvent.details, activityKind: "subagent" },
      });
      return;
    }
      emit({ type: "tool_call", runtime: this.kind, agentId: "grok-build", title: toolEvent.title, text: toolEvent.text, status, details: toolEvent.details });
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

async function createManagedGrokHome(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): Promise<string | null> {
  if (process.env.OPENONE_GROK_HOME?.trim()) return null;
  const baseUrl = input.runtimeProvider?.baseUrl.trim();
  const model = input.model?.trim();
  if (!baseUrl || !model) return null;
  const modelContextWindow = runtimeModelContextWindow(input);
  const home = await mkdtemp(join(tmpdir(), "openone-grok-home-"));
  await writeFile(
    join(home, "config.toml"),
    grokConfigToml(baseUrl, model, modelContextWindow, grokSkillPaths(input, selectedSkillContexts), grokPluginPaths(input)),
    "utf8",
  );
  return home;
}

async function removeManagedGrokHome(home: string): Promise<void> {
  try {
    await rm(home, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function grokConfigToml(baseUrl: string, model: string, modelContextWindow: number | undefined, skillRoots: string[], pluginPaths: string[]): string {
  const contextWindowLine = modelContextWindow === undefined ? [] : [`context_window = ${modelContextWindow}`];
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
    `session_summary = ${tomlString(model)}`,
    "stream_tool_calls = false",
    "",
    "[features]",
    "managed_config = false",
    "telemetry = false",
    "feedback = false",
    "",
    "[managed_mcps]",
    "enabled = false",
    "gateway_tools_enabled = false",
    "",
    "[compat.cursor]",
    "skills = false",
    "rules = false",
    "agents = false",
    "mcps = false",
    "hooks = false",
    "sessions = false",
    "",
    "[compat.claude]",
    "skills = false",
    "rules = false",
    "agents = false",
    "mcps = false",
    "hooks = false",
    "sessions = false",
    "",
    `[model.${tomlString("grok-build")}]`,
    `model = ${tomlString(model)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `api_base_url = ${tomlString(baseUrl)}`,
    `name = ${tomlString(model)}`,
    `env_key = ${tomlString("OPENONE_GROK_API_KEY")}`,
    `api_backend = ${tomlString("chat_completions")}`,
    ...contextWindowLine,
    "supported_in_api = true",
    "supports_reasoning_effort = true",
    "stream_tool_calls = false",
    "agent_type = \"grok-build\"",
    "",
    `[model.${tomlString(model)}]`,
    `model = ${tomlString(model)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `api_base_url = ${tomlString(baseUrl)}`,
    `name = ${tomlString(model)}`,
    `env_key = ${tomlString("OPENONE_GROK_API_KEY")}`,
    `api_backend = ${tomlString("chat_completions")}`,
    ...contextWindowLine,
    "supported_in_api = true",
    "supports_reasoning_effort = true",
    "stream_tool_calls = false",
    "agent_type = \"grok-build\"",
    "",
    ...grokSkillsToml(skillRoots),
    ...grokPluginsToml(pluginPaths),
  ].join("\n");
}

function runtimeModelContextWindow(input: AgentRunInput): number | undefined {
  const value = input.modelContextWindow;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return undefined;
}

function managedGrokIsolationEnv(): Record<string, string> {
  return {
    GROK_MANAGED_MCPS_ENABLED: "0",
    GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "0",
    GROK_CURSOR_SKILLS_ENABLED: "0",
    GROK_CURSOR_RULES_ENABLED: "0",
    GROK_CURSOR_AGENTS_ENABLED: "0",
    GROK_CURSOR_MCPS_ENABLED: "0",
    GROK_CURSOR_HOOKS_ENABLED: "0",
    GROK_CURSOR_SESSIONS_ENABLED: "0",
    GROK_CLAUDE_SKILLS_ENABLED: "0",
    GROK_CLAUDE_RULES_ENABLED: "0",
    GROK_CLAUDE_AGENTS_ENABLED: "0",
    GROK_CLAUDE_MCPS_ENABLED: "0",
    GROK_CLAUDE_HOOKS_ENABLED: "0",
    GROK_CLAUDE_SESSIONS_ENABLED: "0",
  };
}

function grokSkillsToml(skillRoots: string[]): string[] {
  const paths = uniqueStrings(skillRoots);
  if (paths.length === 0) return [];
  return [
    "[skills]",
    `paths = [${paths.map(tomlString).join(", ")}]`,
    "",
  ];
}

function grokSkillPaths(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): string[] {
  if (selectedSkillContexts.length > 0) {
    return selectedSkillContexts.map((context) => context.skill.path);
  }
  return input.capabilities?.skillRoots ?? [];
}

function grokPluginPaths(input: AgentRunInput): string[] {
  return input.capabilities?.pluginPaths ?? [];
}

function grokPluginsToml(pluginPaths: string[]): string[] {
  const paths = uniqueStrings(pluginPaths);
  if (paths.length === 0) return [];
  return [
    "[plugins]",
    `paths = [${paths.map(tomlString).join(", ")}]`,
    "",
  ];
}

function appendModelsPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function collaborativePrompt(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): string {
  return [
    ...coordinationPromptLines(input),
    "When Open One provides selected Grok Build skills below, they are also available through Grok Build native [skills].paths discovery.",
    ...capabilityPromptLines(input, selectedSkillContexts.length > 0),
    ...selectedSkillPromptLines(selectedSkillContexts),
    "",
    promptWithGrokSkillInvocations(input.prompt, selectedSkillContexts),
  ].join("\n");
}

function grokPrompt(input: AgentRunInput, selectedSkillContexts: SelectedSkillContext[]): JsonObject[] {
  const blocks: JsonObject[] = [{
    type: "text",
    text: collaborativePrompt(input, selectedSkillContexts),
  }];
  for (const attachment of input.attachments ?? []) {
    if (!attachment.mime.startsWith("image/")) continue;
    const data = dataUrlBase64Payload(attachment.dataUrl, attachment.mime);
    if (!data) continue;
    blocks.push({
      type: "image",
      data,
      mimeType: attachment.mime,
    });
  }
  return blocks;
}

function dataUrlBase64Payload(dataUrl: string, mime: string): string {
  const prefix = `data:${mime};base64,`;
  if (!dataUrl.toLowerCase().startsWith(prefix)) return "";
  return dataUrl.slice(prefix.length);
}

function coordinationPromptLines(input: AgentRunInput): string[] {
  if (input.mode === "multi-agent") {
    return [
      "Open One multi-agent collaboration is enabled.",
      "Use Grok Build native subagents when the task benefits from parallel code exploration, testing, or review.",
      "Expose subagent/task progress through normal ACP updates so Open One can render the collaboration timeline.",
    ];
  }
  return [
    "Open One is running this task with Grok Build.",
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
    "Open One selected Grok Build skills:",
    "Grok Build should resolve these through its native slash skill command path.",
    "If required user inputs are missing for the selected skill, ask only for those inputs before running skill scripts or tools.",
    "Keep user-facing replies concise and in the user's language.",
  ];
  for (const context of selectedSkillContexts) {
    const { skill } = context;
    lines.push(`- ${skill.name}`);
    lines.push(`  Slash command: /${skill.name}`);
    lines.push(`  SKILL.md path: ${skill.path}`);
    if (skill.description) lines.push(`  Description: ${skill.description}`);
    if (skill.trigger) lines.push(`  Trigger: ${skill.trigger}`);
  }
  return lines;
}

function promptWithGrokSkillInvocations(prompt: string, selectedSkillContexts: SelectedSkillContext[]): string {
  const invocations = selectedSkillContexts
    .map((context) => `/${context.skill.name}`)
    .filter((invocation) => !containsSlashInvocation(prompt, invocation));
  if (invocations.length === 0) return prompt;
  return [invocations.join(" "), prompt].join("\n");
}

function containsSlashInvocation(prompt: string, invocation: string): boolean {
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(invocation)}(?=\\s|$)`, "i");
  return pattern.test(prompt);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      runtime: "grok-build",
      agentId: "grok-build",
      title: "Skill selected",
      text: skill.path,
      status: "completed",
      details: {
        itemType: "skillSelection",
        sourceProtocol: "grok-build-skills-config",
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

type GrokTerminalExitStatus = {
  exitCode: number | null;
  signal: string | null;
};

class GrokAcpClient {
  private readonly input: AgentRunInput;
  private readonly emit: AgentRunEmitter;
  private readonly terminals = new Map<string, GrokTerminal>();

  constructor(input: AgentRunInput, emit: AgentRunEmitter) {
    this.input = input;
    this.emit = emit;
  }

  async handle(method: string, params: JsonValue | undefined): Promise<JsonObject> {
    if (method === "session/update") return {};
    if (method === "fs/read_text_file") return this.readTextFile(params);
    if (method === "fs/write_text_file") return this.writeTextFile(params);
    if (method === "terminal/create") return this.createTerminal(params);
    if (method === "terminal/output") return this.terminalOutput(params);
    if (method === "terminal/wait_for_exit") return this.waitForTerminalExit(params);
    if (method === "terminal/kill") return this.killTerminal(params);
    if (method === "terminal/release") return this.releaseTerminal(params);
    return {};
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) terminal.kill();
    this.terminals.clear();
  }

  private async readTextFile(params: JsonValue | undefined): Promise<JsonObject> {
    const path = requiredString(params, "path");
    const content = await readFile(path, "utf8");
    return { content: sliceRequestedLines(content, readNumber(params, "line"), readNumber(params, "limit")) };
  }

  private async writeTextFile(params: JsonValue | undefined): Promise<JsonObject> {
    const path = requiredString(params, "path");
    const before = await readTextFileForDiff(path);
    const content = readString(params, "content");
    await writeFile(path, content, "utf8");
    const summary = createUnifiedTextDiff(path, before, content);
    if (summary.diff) {
      this.emit({
        type: "tool_call",
        runtime: "grok-build",
        agentId: "grok-build",
        title: "Edited file",
        text: path,
        status: "completed",
        details: {
          itemType: "fileChange",
          itemId: `file_write:${path}`,
          sourceProtocol: "grok-acp-session-update",
          sourceType: "fs/write_text_file",
          activityKind: "file_write",
          path,
          diff: summary.diff,
          additions: summary.additions,
          deletions: summary.deletions,
        },
      });
    }
    return {};
  }

  private createTerminal(params: JsonValue | undefined): JsonObject {
    const command = requiredString(params, "command");
    const terminal = new GrokTerminal({
      command,
      args: readStringArray(params, "args"),
      cwd: readString(params, "cwd") || this.input.workspacePath,
      env: readEnvVars(params),
      outputByteLimit: readNumber(params, "outputByteLimit"),
    });
    this.terminals.set(terminal.id, terminal);
    return { terminalId: terminal.id };
  }

  private terminalOutput(params: JsonValue | undefined): JsonObject {
    return this.requiredTerminal(params).outputResponse();
  }

  private async waitForTerminalExit(params: JsonValue | undefined): Promise<JsonObject> {
    return this.requiredTerminal(params).waitForExit();
  }

  private killTerminal(params: JsonValue | undefined): JsonObject {
    this.requiredTerminal(params).kill();
    return {};
  }

  private releaseTerminal(params: JsonValue | undefined): JsonObject {
    const terminalId = requiredString(params, "terminalId");
    this.terminals.delete(terminalId);
    return {};
  }

  private requiredTerminal(params: JsonValue | undefined): GrokTerminal {
    const terminalId = requiredString(params, "terminalId");
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`terminal not found: ${terminalId}`);
    return terminal;
  }
}

type TextDiffSummary = {
  diff: string;
  additions: number;
  deletions: number;
};

type DiffPart = {
  kind: "same" | "add" | "remove";
  line: string;
};

async function readTextFileForDiff(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function createUnifiedTextDiff(path: string, before: string, after: string): TextDiffSummary {
  if (before === after) return { diff: "", additions: 0, deletions: 0 };
  const beforeLines = splitComparableLines(before);
  const afterLines = splitComparableLines(after);
  const parts = diffLineParts(beforeLines, afterLines);
  let additions = 0;
  let deletions = 0;
  const lines = [
    `--- ${before ? path : "/dev/null"}`,
    `+++ ${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  for (const part of parts) {
    if (part.kind === "add") {
      additions += 1;
      lines.push(`+${part.line}`);
    } else if (part.kind === "remove") {
      deletions += 1;
      lines.push(`-${part.line}`);
    } else {
      lines.push(` ${part.line}`);
    }
  }
  return { diff: lines.join("\n"), additions, deletions };
}

function splitComparableLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffLineParts(before: string[], after: string[]): DiffPart[] {
  const table: number[][] = [];
  for (let i = 0; i <= before.length; i += 1) {
    const row: number[] = [];
    for (let j = 0; j <= after.length; j += 1) row.push(0);
    table.push(row);
  }
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  const parts: DiffPart[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      parts.push({ kind: "same", line: before[beforeIndex] ?? "" });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      parts.push({ kind: "remove", line: before[beforeIndex] ?? "" });
      beforeIndex += 1;
    } else {
      parts.push({ kind: "add", line: after[afterIndex] ?? "" });
      afterIndex += 1;
    }
  }
  while (beforeIndex < before.length) {
    parts.push({ kind: "remove", line: before[beforeIndex] ?? "" });
    beforeIndex += 1;
  }
  while (afterIndex < after.length) {
    parts.push({ kind: "add", line: after[afterIndex] ?? "" });
    afterIndex += 1;
  }
  return parts;
}

class GrokTerminal {
  readonly id = `openone-${randomUUID()}`;
  private readonly outputByteLimit: number;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exitPromise: Promise<JsonObject>;
  private output = "";
  private truncated = false;
  private exitStatus: GrokTerminalExitStatus | null = null;
  private resolveExit: (status: JsonObject) => void = () => {};

  constructor(options: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    outputByteLimit: number;
  }) {
    this.outputByteLimit = options.outputByteLimit;
    this.exitPromise = new Promise<JsonObject>((resolve) => {
      this.resolveExit = resolve;
    });
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: process.platform === "win32" || options.args.length === 0,
      windowsHide: true,
    });
    this.child.stdout.on("data", (chunk) => this.appendOutput(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk) => this.appendOutput(chunk.toString("utf8")));
    this.child.once("error", (error) => {
      this.appendOutput(error.message);
      this.finish({ exitCode: 1, signal: null });
    });
    this.child.once("close", (code, signal) => {
      this.finish({ exitCode: code, signal });
    });
  }

  outputResponse(): JsonObject {
    return {
      output: this.output,
      truncated: this.truncated,
      exitStatus: this.exitStatus,
    };
  }

  waitForExit(): Promise<JsonObject> {
    return this.exitPromise;
  }

  kill(): void {
    if (!this.exitStatus) this.child.kill();
  }

  private appendOutput(text: string): void {
    this.output += text;
    const limit = this.outputByteLimit;
    if (limit > 0 && Buffer.byteLength(this.output, "utf8") > limit) {
      this.output = truncateUtf8FromStart(this.output, limit);
      this.truncated = true;
    }
  }

  private finish(status: GrokTerminalExitStatus): void {
    if (this.exitStatus) return;
    this.exitStatus = status;
    this.resolveExit(status);
  }
}

async function reachableGrokMcpServers(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<JsonObject[]> {
  const servers = grokMcpServers(input.capabilities);
  const timeoutMs = mcpProbeTimeoutMs();
  if (timeoutMs <= 0) return servers;
  const checks = await Promise.all(servers.map(async (server) => {
    const url = readString(server, "url");
    if (!url) return server;
    if (await cachedMcpUrlReachable({ url, headers: mcpProbeHeaders(server), timeoutMs, signal })) return server;
    if (!signal.aborted) {
      const name = readString(server, "name") || url;
      emit({
        type: "log",
        runtime: "grok-build",
        agentId: "grok-build",
        title: "MCP unavailable",
        text: `Skipping unreachable MCP server ${name} (${url}) for this Grok Build run.`,
      });
    }
    return null;
  }));
  return checks.filter((server): server is JsonObject => server !== null);
}

function mcpProbeHeaders(server: JsonObject): Record<string, string> {
  const headers = server.headers;
  if (!Array.isArray(headers)) return {};
  const result: Record<string, string> = {};
  for (const header of headers) {
    if (!isJsonObject(header)) continue;
    const name = readString(header, "name");
    const value = readString(header, "value");
    if (name && value) result[name] = value;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredString(value: JsonValue | undefined, key: string): string {
  const result = readString(value, key);
  if (!result) throw new Error(`missing required ACP field ${key}`);
  return result;
}

function readNumber(value: JsonValue | undefined, key: string): number {
  if (!isJsonObject(value)) return 0;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : 0;
}

function readStringArray(value: JsonValue | undefined, key: string): string[] {
  if (!isJsonObject(value)) return [];
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string");
}

function readEnvVars(value: JsonValue | undefined): Record<string, string> {
  if (!isJsonObject(value) || !Array.isArray(value.env)) return {};
  const env: Record<string, string> = {};
  for (const item of value.env) {
    if (!isJsonObject(item)) continue;
    const name = readString(item, "name");
    if (!name) continue;
    env[name] = readString(item, "value");
  }
  return env;
}

function sliceRequestedLines(content: string, line: number, limit: number): string {
  if (line <= 0 && limit <= 0) return content;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = line > 0 ? Math.max(0, Math.floor(line) - 1) : 0;
  const end = limit > 0 ? start + Math.floor(limit) : undefined;
  return lines.slice(start, end).join("\n");
}

function truncateUtf8FromStart(value: string, byteLimit: number): string {
  let result = "";
  for (const char of Array.from(value).reverse()) {
    const next = `${char}${result}`;
    if (Buffer.byteLength(next, "utf8") > byteLimit) break;
    result = next;
  }
  return result;
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

function isGrokSessionUpdateMethod(method: string): boolean {
  return method === "session/update"
    || method === "x.ai/session/update"
    || method === "_x.ai/session/update"
    || method === "x.ai/session_notification"
    || method === "_x.ai/session_notification";
}

function isGrokPromptCompleteMethod(method: string): boolean {
  return method === "x.ai/session/prompt_complete" || method === "_x.ai/session/prompt_complete";
}

function isFailureStopReason(stopReason: string): boolean {
  const normalized = stopReason.toLowerCase();
  return normalized === "error" || normalized === "failed" || normalized === "rate_limit";
}

function inferTitle(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "toolName"),
    readString(value, "tool_name"),
    readString(value, "command"),
    readNestedString(value, ["input", "description"]),
    readNestedString(value, ["input", "subagent_type"]),
    readNestedString(value, ["input", "tool"]),
    readNestedString(value, ["input", "command"]),
    readNestedString(value, ["toolCall", "toolName"]),
    readNestedString(value, ["toolCall", "tool_name"]),
    readNestedString(value, ["toolCall", "input", "description"]),
    readNestedString(value, ["toolCall", "input", "subagent_type"]),
    readNestedString(value, ["toolCall", "input", "tool"]),
    readNestedString(value, ["toolCall", "input", "command"]),
    readString(value, "title"),
    readString(value, "name"),
    readString(value, "description"),
    readNestedString(value, ["toolCall", "title"]),
    readNestedString(value, ["toolCall", "name"]),
    readNestedString(value, ["toolCall", "function", "name"]),
    readNestedString(value, ["tool", "name"]),
    readNestedString(value, ["call", "name"]),
    readNestedString(value, ["content", "text"]),
  ];
  const title = candidates.find((candidate) => candidate.trim()) ?? "";
  return title ? compactTitle(title) : "";
}

function grokToolEvent(value: JsonValue | undefined): { title: string; text: string; details: Record<string, unknown> } | null {
  const toolName = grokToolName(value);
  const skillName = grokToolSkillName(value, toolName);
  const command = grokToolCommand(value);
  const path = grokToolPath(value);
  const description = grokToolDescription(value);
  const title = grokToolTitle(toolName, skillName, command, path, description);
  if (!title) return null;
  const cwd = grokToolCwd(value);
  const itemId = grokToolItemId(value, toolName, command, path, title);
  const activityKind = grokToolActivityKind(toolName, skillName, command, path);
  const details: Record<string, unknown> = {
    itemType: command ? "commandExecution" : "dynamicToolCall",
    itemId,
    sourceProtocol: "grok-acp-session-update",
    sourceType: grokSourceType(value),
    activityKind,
  };
  const files = commandFilePaths(command, cwd);
  if (toolName) details.tool = toolName;
  if (skillName) details.skill = skillName;
  if (command) details.command = command;
  if (cwd) details.cwd = cwd;
  if (path) details.path = path;
  if (files.length > 0) details.files = files;
  if (description) details.description = description;
  return {
    title,
    text: grokToolText(command, cwd, path, description, title),
    details,
  };
}

function grokSourceDetails(value: JsonValue | undefined, activityKind: string): Record<string, unknown> {
  return {
    sourceProtocol: "grok-acp-session-update",
    sourceType: grokSourceType(value),
    activityKind,
  };
}

function grokSourceType(value: JsonValue | undefined): string {
  return readString(value, "sessionUpdate") || readString(value, "type") || "sessionUpdate";
}

function grokToolActivityKind(toolName: string, skillName: string, command: string, path: string): string {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (skillName) return "skill_load";
  if (command || normalized.includes("terminal") || normalized.includes("command")) return "command";
  if (path && normalized.includes("read")) return "file_read";
  if (path && normalized.includes("write")) return "file_write";
  return "tool";
}

const COMMAND_FILE_PATTERN = /(?:^|[\s"'`([{<:=])((?:[a-zA-Z]:[/\\]|\.{1,2}[/\\]|~[/\\]|[/\\])?(?:[^/\\\s"'`()\[\]{}<>:]+[/\\])+[^/\\\s"'`()\[\]{}<>:]+\.[a-z][a-z0-9]{0,9}|[^/\\\s"'`()\[\]{}<>:]+\.[a-z][a-z0-9]{0,9})/giu;

function commandFilePaths(command: string, cwd: string): string[] {
  if (!commandMayReadFiles(command)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  COMMAND_FILE_PATTERN.lastIndex = 0;
  for (const match of command.matchAll(COMMAND_FILE_PATTERN)) {
    const rawPath = match[1]?.trim();
    if (!rawPath || rawPath.includes("*")) continue;
    const path = commandPathFromCwd(rawPath, cwd);
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

function commandMayReadFiles(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:get-content|gc|cat|type|more|head|tail|sed)\b/i.test(command);
}

function commandPathFromCwd(path: string, cwd: string): string {
  if (!cwd || isAbsolute(path) || path.startsWith("~")) return path;
  return join(cwd, path);
}

function grokToolName(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "toolName"),
    readString(value, "tool_name"),
    readString(value, "name"),
    readNestedString(value, ["toolCall", "toolName"]),
    readNestedString(value, ["toolCall", "tool_name"]),
    readNestedString(value, ["toolCall", "name"]),
    readNestedString(value, ["toolCall", "function", "name"]),
    readNestedString(value, ["tool", "name"]),
    readNestedString(value, ["call", "name"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolSkillName(value: JsonValue | undefined, toolName: string): string {
  if (toolName.trim().toLowerCase() !== "skill") return "";
  const candidates = [
    readNestedString(value, ["input", "name"]),
    readNestedString(value, ["arguments", "name"]),
    readNestedString(value, ["args", "name"]),
    readNestedString(value, ["toolCall", "input", "name"]),
    readNestedString(value, ["toolCall", "arguments", "name"]),
    readNestedString(value, ["toolCall", "args", "name"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolCommand(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "command"),
    readNestedString(value, ["input", "command"]),
    readNestedString(value, ["arguments", "command"]),
    readNestedString(value, ["args", "command"]),
    readNestedString(value, ["toolCall", "command"]),
    readNestedString(value, ["toolCall", "input", "command"]),
    readNestedString(value, ["toolCall", "arguments", "command"]),
    readNestedString(value, ["toolCall", "args", "command"]),
    commandFromActionText(readString(value, "title")),
    commandFromActionText(readString(value, "description")),
    commandFromActionText(readNestedString(value, ["content", "text"])),
    commandFromActionText(readNestedString(value, ["toolCall", "title"])),
    commandFromActionText(readNestedString(value, ["toolCall", "description"])),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolPath(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "path"),
    readString(value, "file"),
    readString(value, "filePath"),
    readString(value, "file_path"),
    readNestedString(value, ["input", "path"]),
    readNestedString(value, ["input", "file"]),
    readNestedString(value, ["input", "filePath"]),
    readNestedString(value, ["input", "file_path"]),
    readNestedString(value, ["arguments", "path"]),
    readNestedString(value, ["arguments", "file"]),
    readNestedString(value, ["toolCall", "path"]),
    readNestedString(value, ["toolCall", "file"]),
    readNestedString(value, ["toolCall", "input", "path"]),
    readNestedString(value, ["toolCall", "input", "file"]),
    readNestedString(value, ["toolCall", "input", "filePath"]),
    readNestedString(value, ["toolCall", "input", "file_path"]),
    pathFromReadText(readString(value, "title")),
    pathFromReadText(readString(value, "description")),
    pathFromReadText(readNestedString(value, ["content", "text"])),
    pathFromReadText(readNestedString(value, ["toolCall", "title"])),
    pathFromReadText(readNestedString(value, ["toolCall", "description"])),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolCwd(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "cwd"),
    readNestedString(value, ["input", "cwd"]),
    readNestedString(value, ["arguments", "cwd"]),
    readNestedString(value, ["toolCall", "cwd"]),
    readNestedString(value, ["toolCall", "input", "cwd"]),
    readNestedString(value, ["toolCall", "arguments", "cwd"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolDescription(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "title"),
    readString(value, "description"),
    readNestedString(value, ["input", "description"]),
    readNestedString(value, ["toolCall", "title"]),
    readNestedString(value, ["toolCall", "description"]),
    readNestedString(value, ["toolCall", "input", "description"]),
    readNestedString(value, ["content", "text"]),
  ];
  return candidates.find((candidate) => candidate.trim()) ?? "";
}

function grokToolTitle(toolName: string, skillName: string, command: string, path: string, description: string): string {
  if (skillName) return compactTitle(`Load skill ${skillName}`);
  if (command) return compactTitle(command);
  if (path && isReadToolName(toolName)) return compactTitle(`Read ${path}`);
  const cleanDescription = description.replace(/\s+/g, " ").trim();
  if (cleanDescription) return compactTitle(cleanDescription);
  if (toolName) return compactTitle(toolName);
  return "";
}

function grokToolText(command: string, cwd: string, path: string, description: string, title: string): string {
  if (command) return cwd;
  if (path) return path;
  const normalized = description.replace(/\s+/g, " ").trim();
  return normalized && normalized !== title ? compactTitle(normalized) : "";
}

function grokToolItemId(value: JsonValue | undefined, toolName: string, command: string, path: string, title: string): string {
  const candidates = [
    readString(value, "toolCallId"),
    readString(value, "tool_call_id"),
    readString(value, "callId"),
    readString(value, "call_id"),
    readString(value, "id"),
    readNestedString(value, ["toolCall", "id"]),
    readNestedString(value, ["toolCall", "toolCallId"]),
    readNestedString(value, ["toolCall", "tool_call_id"]),
    readNestedString(value, ["call", "id"]),
  ];
  const explicit = candidates.find((candidate) => candidate.trim());
  if (explicit) return explicit;
  return [toolName, command || path || title].filter((part) => part.trim()).join(":");
}

function commandFromActionText(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  const backtick = normalized.match(/^(?:Execute|Run|Ran)\s+`([^`]+)`/i);
  if (backtick?.[1]) return backtick[1].trim();
  const quoted = normalized.match(/^(?:Execute|Run|Ran)\s+["']([^"']+)["']/i);
  if (quoted?.[1]) return quoted[1].trim();
  return "";
}

function pathFromReadText(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  const backtick = normalized.match(/^Read\s+`([^`]+)`/i);
  if (backtick?.[1]) return backtick[1].trim();
  const quoted = normalized.match(/^Read\s+["']([^"']+)["']/i);
  if (quoted?.[1]) return quoted[1].trim();
  return "";
}

function isReadToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "read_file" || normalized === "read_text_file" || normalized.includes("read");
}

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferAgentId(value: JsonValue | undefined): string {
  const candidates = [
    readString(value, "subagentId"),
    readString(value, "subagent_id"),
    readString(value, "childSessionId"),
    readString(value, "child_session_id"),
    readString(value, "taskId"),
    readString(value, "task_id"),
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
  return optionId ? selectedPermissionResponse(optionId) : cancelledPermissionResponse();
}

function allowPermission(value: JsonValue | undefined, reply: "once" | "always"): JsonObject {
  const optionId = selectAllowPermissionOption(value, reply);
  return optionId ? selectedPermissionResponse(optionId) : cancelledPermissionResponse();
}

function rejectPermission(value: JsonValue | undefined): JsonObject {
  const optionId = selectRejectPermissionOption(value);
  if (!optionId) return cancelledPermissionResponse();
  return selectedPermissionResponse(optionId);
}

function selectedPermissionResponse(optionId: string): JsonObject {
  return {
    outcome: {
      outcome: "selected",
      optionId,
    },
  };
}

function cancelledPermissionResponse(): JsonObject {
  return {
    outcome: {
      outcome: "cancelled",
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
    const label = readString(option, "label") || readString(option, "title") || readString(option, "name") || readString(option, "optionId") || readString(option, "option_id");
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
