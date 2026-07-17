import type { AgentRunApprovalMode } from "./types.js";

export type RuntimeCommand = {
  command: string;
  args: string[];
};

export function resolveCodexCommand(modelProvider?: string): RuntimeCommand {
  const args = parseArgs(process.env.OPENONE_CODEX_ARGS);
  if (args) {
    return {
      command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
      args,
    };
  }
  return {
    command: process.env.OPENONE_CODEX_COMMAND?.trim() || process.env.CODEX_COMMAND?.trim() || "codex",
    args: ["app-server", ...codexProviderConfigArgs(modelProvider)],
  };
}

export function resolveCodexModelProvider(modelProvider?: string): string | undefined {
  const trimmed = modelProvider?.trim();
  const baseUrl = process.env.OPENONE_CODEX_BASE_URL?.trim();
  if (!baseUrl) return trimmed || undefined;
  const override = process.env.OPENONE_CODEX_PROVIDER_ID?.trim();
  return safeCodexProviderId(override || trimmed || "openone");
}

export function resolveGrokCommand(model?: string, approvalMode: AgentRunApprovalMode = "auto-review"): RuntimeCommand {
  const args = parseArgs(process.env.OPENONE_GROK_ARGS);
  if (args) {
    return {
      command: process.env.OPENONE_GROK_COMMAND?.trim() || process.env.GROK_COMMAND?.trim() || "grok",
      args,
    };
  }
  const selectedModel = process.env.OPENONE_GROK_MODEL?.trim() || model?.trim() || "";
  const alwaysApprove = resolveGrokAlwaysApprove(approvalMode);
  return {
    command: process.env.OPENONE_GROK_COMMAND?.trim() || process.env.GROK_COMMAND?.trim() || "grok",
    args: ["agent", ...(selectedModel ? ["--model", selectedModel] : []), ...(alwaysApprove ? ["--always-approve"] : []), "stdio"],
  };
}

export function resolveRuntimeEnv(prefix: "CODEX" | "GROK"): Record<string, string> {
  const env: Record<string, string> = {};
  const home = process.env[`OPENONE_${prefix}_HOME`]?.trim();
  if (home) env[`${prefix}_HOME`] = home;
  const baseUrl = process.env[`OPENONE_${prefix}_BASE_URL`]?.trim();
  if (baseUrl) env[`${prefix}_MODELS_BASE_URL`] = baseUrl;
  const apiKey = process.env[`OPENONE_${prefix}_API_KEY`]?.trim();
  if (apiKey) {
    env[`${prefix}_API_KEY`] = apiKey;
    env[`OPENONE_${prefix}_API_KEY`] = apiKey;
  }
  return env;
}

function codexProviderConfigArgs(modelProvider?: string): string[] {
  const baseUrl = process.env.OPENONE_CODEX_BASE_URL?.trim();
  if (!baseUrl) return [];
  const providerId = resolveCodexModelProvider(modelProvider) ?? "openone";
  const hasApiKey = Boolean(process.env.OPENONE_CODEX_API_KEY?.trim());
  const fields = [
    `name=${quoteTomlString("Open One")}`,
    `base_url=${quoteTomlString(baseUrl)}`,
    'wire_api="responses"',
    ...(hasApiKey ? ['env_key="OPENONE_CODEX_API_KEY"'] : []),
  ];
  return [
    "-c",
    `model_provider=${quoteTomlString(providerId)}`,
    "-c",
    `model_providers.${providerId}={ ${fields.join(", ")} }`,
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

function safeCodexProviderId(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : "openone";
}

function resolveGrokAlwaysApprove(approvalMode: AgentRunApprovalMode): boolean {
  const override = process.env.OPENONE_GROK_ALWAYS_APPROVE?.trim().toLowerCase();
  if (override) return override !== "0" && override !== "false";
  return approvalMode === "full-access";
}
