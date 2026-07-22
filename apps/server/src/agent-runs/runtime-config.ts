import { existsSync, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import type { JsonObject } from "./json-rpc.js";
import type { AgentRunApprovalMode, AgentRunInput } from "./types.js";

export type RuntimeCommand = {
  command: string;
  args: string[];
};

type RuntimeProviderConfig = NonNullable<AgentRunInput["runtimeProvider"]>;
type RuntimeCapabilities = NonNullable<AgentRunInput["capabilities"]>;
type McpServerConfig = RuntimeCapabilities["mcpServers"][string];
type RuntimeEnvOverrides = {
  baseUrl?: string;
  apiKey?: string;
};
type RuntimeEnvContext = Pick<AgentRunInput, "prompt" | "selectedSkills">;

export function resolveCodexCommand(
  modelProvider?: string,
  providerConfig?: RuntimeProviderConfig,
  capabilities?: RuntimeCapabilities,
): RuntimeCommand {
  const args = parseArgs(process.env.OPENONE_CODEX_ARGS);
  if (args) {
    return {
      command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
      args,
    };
  }
  return {
    command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
    args: ["app-server", ...codexProviderConfigArgs(modelProvider, providerConfig), ...codexMcpConfigArgs(capabilities)],
  };
}

export function resolveCodexModelProvider(modelProvider?: string, providerConfig?: RuntimeProviderConfig): string | undefined {
  const trimmed = modelProvider?.trim();
  const baseUrl = providerConfig?.baseUrl?.trim() || process.env.OPENONE_CODEX_BASE_URL?.trim();
  if (!baseUrl) return trimmed && !isOpenOneManagedProviderId(trimmed) ? trimmed : undefined;
  const override = process.env.OPENONE_CODEX_PROVIDER_ID?.trim();
  const providerId = providerConfig?.providerId.trim();
  return safeCodexProviderId(override || providerId || trimmed || "openone");
}

function isOpenOneManagedProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === "company-local" || normalized.startsWith("company-local-");
}

export function resolveGrokCommand(
  model?: string,
  approvalMode: AgentRunApprovalMode = "auto-review",
  providerConfig?: RuntimeProviderConfig,
): RuntimeCommand {
  const args = parseArgs(process.env.OPENONE_GROK_ARGS);
  if (args) {
    return {
      command: process.env.OPENONE_GROK_COMMAND?.trim() || process.env.GROK_COMMAND?.trim() || "grok",
      args,
    };
  }
  const selectedModel = process.env.OPENONE_GROK_MODEL?.trim() || model?.trim() || "";
  const alwaysApprove = resolveGrokAlwaysApprove(approvalMode);
  const baseUrl = providerConfig?.baseUrl?.trim() || process.env.OPENONE_GROK_BASE_URL?.trim() || "";
  return {
    command: process.env.OPENONE_GROK_COMMAND?.trim() || process.env.GROK_COMMAND?.trim() || "grok",
    args: [
      "agent",
      ...(selectedModel ? ["--model", selectedModel] : []),
      ...(baseUrl ? ["--xai-api-base-url", baseUrl, "--no-leader"] : []),
      ...(alwaysApprove ? ["--always-approve"] : []),
      "stdio",
    ],
  };
}

export function resolveRuntimeEnv(prefix: "CODEX" | "GROK", overrides: RuntimeEnvOverrides = {}, context?: RuntimeEnvContext): Record<string, string> {
  const env: Record<string, string> = {};
  const home = process.env[`OPENONE_${prefix}_HOME`]?.trim();
  if (home) env[`${prefix}_HOME`] = home;
  const sapWorkDir = resolveSapDevWorkDir(context);
  if (sapWorkDir) env.SAPDEV_AI_WORK_DIR = sapWorkDir;
  const baseUrl = overrides.baseUrl?.trim() || process.env[`OPENONE_${prefix}_BASE_URL`]?.trim();
  if (baseUrl) {
    env[`${prefix}_MODELS_BASE_URL`] = baseUrl;
    if (prefix === "GROK") {
      env.GROK_XAI_API_BASE_URL = baseUrl;
      env.GROK_MODELS_LIST_URL = appendModelsPath(baseUrl);
      env.GROK_MANAGED_CONFIG = "0";
      env.GROK_DISABLE_API_KEY_AUTH = "0";
    }
  }
  const apiKey = overrides.apiKey?.trim() || process.env[`OPENONE_${prefix}_API_KEY`]?.trim();
  if (apiKey) {
    env[`${prefix}_API_KEY`] = apiKey;
    env[`OPENONE_${prefix}_API_KEY`] = apiKey;
    if (prefix === "GROK") {
      env.XAI_API_KEY = apiKey;
      env.GROK_CODE_XAI_API_KEY = apiKey;
    }
  }
  return env;
}

function resolveSapDevWorkDir(context?: RuntimeEnvContext): string | undefined {
  if (!isSapSelected(context)) return undefined;
  const explicit = process.env.OPENONE_SAPDEV_WORK_DIR?.trim() || process.env.SAPDEV_AI_WORK_DIR?.trim();
  if (explicit) return explicit;
  const pointer = readSapDevWorkDirPointer();
  if (pointer) return pointer;
  if (process.platform === "win32") return "C:\\sap_dev_work";
  return undefined;
}

function isSapSelected(context?: RuntimeEnvContext): boolean {
  if (!context) return false;
  if ((context.selectedSkills ?? []).some((name) => name.trim().toLowerCase().startsWith("sap-"))) return true;
  const prompt = context.prompt.trim();
  return /^\/sap(?:[-\s]|$)/i.test(prompt) || /\bthe\s+["']sap-[^"']+["']\s+skill\b/i.test(prompt);
}

function readSapDevWorkDirPointer(): string {
  const appData = process.env.APPDATA?.trim();
  if (!appData) return "";
  const pointerPath = join(appData, "sapdev-ai", "work_dir.txt");
  if (!existsSync(pointerPath)) return "";
  try {
    return readFileSync(pointerPath, "utf8").trim();
  } catch {
    return "";
  }
}

export function codexMcpConfigArgs(capabilities?: RuntimeCapabilities): string[] {
  const servers = capabilities?.mcpServers ?? {};
  const args: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const trimmed = name.trim();
    if (!trimmed || server.enabled === false) continue;
    const config = codexMcpServerConfig(server);
    for (const [key, value] of Object.entries(config)) {
      args.push("-c", `mcp_servers.${tomlKey(trimmed)}.${tomlKey(key)}=${tomlValue(value)}`);
    }
  }
  return args;
}

export function grokMcpServers(capabilities?: RuntimeCapabilities): JsonObject[] {
  const servers = capabilities?.mcpServers ?? {};
  const result: JsonObject[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const trimmed = name.trim();
    if (!trimmed || server.enabled === false) continue;
    const config = grokMcpServerConfig(trimmed, server);
    if (config) result.push(config);
  }
  return result;
}

export async function isRuntimeCommandAvailable(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    try {
      await access(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    const child = spawn(resolver, [trimmed], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export function missingRuntimeCommandMessage(runtimeName: string, command: string, envKey: string): string {
  return `${runtimeName} 运行器未就绪：找不到 "${command}"。请更新/重新打包 Open One 以包含内置 agent runtime，或设置 ${envKey} 指向对应可执行文件。`;
}

function codexProviderConfigArgs(modelProvider?: string, providerConfig?: RuntimeProviderConfig): string[] {
  const baseUrl = providerConfig?.baseUrl?.trim() || process.env.OPENONE_CODEX_BASE_URL?.trim();
  if (!baseUrl) return [];
  const providerId = resolveCodexModelProvider(modelProvider, providerConfig) ?? "openone";
  const hasApiKey = Boolean(providerConfig?.apiKey?.trim() || process.env.OPENONE_CODEX_API_KEY?.trim());
  return [
    "-c",
    `model_provider=${quoteTomlString(providerId)}`,
    "-c",
    `model_providers.${providerId}.name=${quoteTomlString("OpenOne")}`,
    "-c",
    `model_providers.${providerId}.base_url=${quoteTomlString(baseUrl)}`,
    "-c",
    `model_providers.${providerId}.wire_api=${quoteTomlString("responses")}`,
    "-c",
    `model_providers.${providerId}.requires_openai_auth=false`,
    "-c",
    `model_providers.${providerId}.request_max_retries=0`,
    "-c",
    `model_providers.${providerId}.stream_max_retries=0`,
    ...(hasApiKey ? ["-c", `model_providers.${providerId}.env_key=${quoteTomlString("OPENONE_CODEX_API_KEY")}`] : []),
  ];
}

type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };

function codexMcpServerConfig(server: McpServerConfig): Record<string, TomlValue> {
  const result: Record<string, TomlValue> = {};
  const url = stringField(server, "url");
  const command = mcpCommandField(server);
  if (url) result.url = url;
  if (command.command) result.command = command.command;
  const args = command.args.length > 0 ? command.args : stringArrayField(server, "args");
  if (args.length > 0) result.args = args;
  const env = tomlRecordField(server, "env", "environment");
  if (Object.keys(env).length > 0) result.env = env;
  const headers = tomlRecordField(server, "http_headers", "headers");
  if (Object.keys(headers).length > 0) result.http_headers = headers;
  copyTomlField(server, result, "env_http_headers");
  copyTomlObjectField(server, result, "oauth");
  copyTomlField(server, result, "oauth_resource");
  copyTomlField(server, result, "bearer_token_env_var");
  copyTomlField(server, result, "startup_timeout_sec");
  copyTomlField(server, result, "tool_timeout_sec");
  copyTomlField(server, result, "supports_parallel_tool_calls");
  const enabledTools = stringArrayField(server, "enabled_tools");
  if (enabledTools.length > 0) result.enabled_tools = enabledTools;
  const disabledTools = stringArrayField(server, "disabled_tools");
  if (disabledTools.length > 0) result.disabled_tools = disabledTools;
  return result;
}

function grokMcpServerConfig(name: string, server: McpServerConfig): JsonObject | null {
  const type = grokMcpType(stringField(server, "type"), server);
  const url = stringField(server, "url");
  const command = mcpCommandField(server);
  if (url) {
    const result: JsonObject = { name, type: type === "sse" ? "sse" : "http", url };
    const headers = jsonNameValueListField(server, "headers", "http_headers");
    if (headers.length > 0) result.headers = headers;
    return result;
  }
  if (command.command) {
    const result: JsonObject = { name, command: command.command };
    const args = command.args.length > 0 ? command.args : stringArrayField(server, "args");
    if (args.length > 0) result.args = args;
    const env = jsonNameValueListField(server, "env", "environment");
    if (env.length > 0) result.env = env;
    return result;
  }
  return null;
}

function mcpCommandField(source: Record<string, unknown>): { command: string; args: string[] } {
  const command = source.command;
  if (typeof command === "string") return { command: command.trim(), args: [] };
  if (!Array.isArray(command)) return { command: "", args: [] };
  const parts = command.filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  const [head, ...tail] = parts;
  return { command: head ?? "", args: tail };
}

function jsonNameValueListField(source: Record<string, unknown>, primaryKey: string, fallbackKey?: string): JsonObject[] {
  const primary = jsonNameValueList(source[primaryKey]);
  if (primary.length > 0 || !fallbackKey) return primary;
  return jsonNameValueList(source[fallbackKey]);
}

function jsonNameValueList(value: unknown): JsonObject[] {
  const result: JsonObject[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      const entry = jsonNameValueEntry(item.name, item.value);
      if (entry) result.push(entry);
    }
    return result;
  }
  if (!isRecord(value)) return result;
  for (const [name, item] of Object.entries(value)) {
    const entry = jsonNameValueEntry(name, item);
    if (entry) result.push(entry);
  }
  return result;
}

function jsonNameValueEntry(name: unknown, value: unknown): JsonObject | null {
  const key = typeof name === "string" ? name.trim() : "";
  const text = primitiveString(value);
  if (!key || text === undefined) return null;
  return { name: key, value: text };
}

function primitiveString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function grokMcpType(type: string, server: McpServerConfig): string {
  if (type === "remote") return "http";
  if (type) return type;
  if (stringField(server, "url")) return "http";
  if (stringField(server, "command")) return "stdio";
  return "";
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function copyTomlField(source: Record<string, unknown>, target: Record<string, TomlValue>, key: string): void {
  const value = toTomlValue(source[key]);
  if (value !== undefined) target[key] = value;
}

function copyTomlObjectField(source: Record<string, unknown>, target: Record<string, TomlValue>, key: string): void {
  const value = toTomlRecord(source[key]);
  if (Object.keys(value).length > 0) target[key] = value;
}

function stringArrayField(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

function tomlRecordField(source: Record<string, unknown>, primaryKey: string, fallbackKey?: string): Record<string, TomlValue> {
  const primary = toTomlRecord(source[primaryKey]);
  if (Object.keys(primary).length > 0 || !fallbackKey) return primary;
  return toTomlRecord(source[fallbackKey]);
}

function toTomlValue(value: unknown): TomlValue | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const result: TomlValue[] = [];
    for (const item of value) {
      const converted = toTomlValue(item);
      if (converted !== undefined) result.push(converted);
    }
    return result;
  }
  const record = toTomlRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function toTomlRecord(value: unknown): Record<string, TomlValue> {
  if (!isRecord(value)) return {};
  const result: Record<string, TomlValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const converted = toTomlValue(item);
    if (converted !== undefined) result[key] = converted;
  }
  return result;
}

function parseArgs(input: string | undefined): string[] | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to shell-like whitespace splitting for simple local overrides.
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : quoteTomlString(trimmed);
}

function tomlValue(value: TomlValue): string {
  if (typeof value === "string") return quoteTomlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  const entries = Object.entries(value).map(([key, item]) => `${quoteTomlString(key)} = ${tomlValue(item)}`);
  return `{ ${entries.join(", ")} }`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendModelsPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function safeCodexProviderId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "openone";
}

function resolveGrokAlwaysApprove(approvalMode: AgentRunApprovalMode): boolean {
  const override = process.env.OPENONE_GROK_ALWAYS_APPROVE?.trim().toLowerCase();
  if (override) return override !== "0" && override !== "false";
  return approvalMode === "full-access";
}
