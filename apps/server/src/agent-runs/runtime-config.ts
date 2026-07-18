import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import type { AgentRunApprovalMode, AgentRunInput } from "./types.js";

export type RuntimeCommand = {
  command: string;
  args: string[];
};

type RuntimeProviderConfig = NonNullable<AgentRunInput["runtimeProvider"]>;
type RuntimeEnvOverrides = {
  baseUrl?: string;
  apiKey?: string;
};

export function resolveCodexCommand(modelProvider?: string, providerConfig?: RuntimeProviderConfig): RuntimeCommand {
  const args = parseArgs(process.env.OPENONE_CODEX_ARGS);
  if (args) {
    return {
      command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
      args,
    };
  }
  return {
    command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
    args: ["app-server", ...codexProviderConfigArgs(modelProvider, providerConfig)],
  };
}

export function resolveCodexModelProvider(modelProvider?: string, providerConfig?: RuntimeProviderConfig): string | undefined {
  const trimmed = modelProvider?.trim();
  const baseUrl = providerConfig?.baseUrl?.trim() || process.env.OPENONE_CODEX_BASE_URL?.trim();
  if (!baseUrl) return trimmed || undefined;
  const override = process.env.OPENONE_CODEX_PROVIDER_ID?.trim();
  const providerId = providerConfig?.providerId.trim();
  return safeCodexProviderId(override || providerId || trimmed || "openone");
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

export function resolveRuntimeEnv(prefix: "CODEX" | "GROK", overrides: RuntimeEnvOverrides = {}): Record<string, string> {
  const env: Record<string, string> = {};
  const home = process.env[`OPENONE_${prefix}_HOME`]?.trim();
  if (home) env[`${prefix}_HOME`] = home;
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
