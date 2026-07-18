import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveCodexCommand, resolveGrokCommand, resolveRuntimeEnv } from "./runtime-config.js";

const ENV_KEYS = [
  "OPENONE_CODEX_ARGS",
  "OPENONE_CODEX_API_KEY",
  "OPENONE_CODEX_BASE_URL",
  "OPENONE_CODEX_COMMAND",
  "OPENONE_CODEX_PROVIDER_ID",
  "CODEX_COMMAND",
  "OPENONE_GROK_ARGS",
  "OPENONE_GROK_API_KEY",
  "OPENONE_GROK_BASE_URL",
  "OPENONE_GROK_COMMAND",
  "OPENONE_GROK_HOME",
  "OPENONE_GROK_MODEL",
  "OPENONE_GROK_ALWAYS_APPROVE",
  "GROK_COMMAND",
  "XAI_API_KEY",
];

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  originalEnv.clear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("resolveCodexCommand", () => {
  test("starts app-server over its default stdio listener", () => {
    expect(resolveCodexCommand()).toEqual({
      command: "codex",
      args: ["app-server"],
    });
  });

  test("keeps explicit argument overrides authoritative", () => {
    process.env.OPENONE_CODEX_ARGS = '["app-server","--listen","stdio://"]';
    process.env.OPENONE_CODEX_COMMAND = "custom-codex";

    expect(resolveCodexCommand()).toEqual({
      command: "custom-codex",
      args: ["app-server", "--listen", "stdio://"],
    });
  });

  test("injects Open One provider config for managed Codex models", () => {
    process.env.OPENONE_CODEX_BASE_URL = "http://models.internal/v1";
    process.env.OPENONE_CODEX_API_KEY = "internal-key";

    expect(resolveCodexCommand("company-local")).toEqual({
      command: "codex",
      args: [
        "app-server",
        "-c",
        'model_provider="company_local"',
        "-c",
        'model_providers.company_local.name="OpenOne"',
        "-c",
        'model_providers.company_local.base_url="http://models.internal/v1"',
        "-c",
        'model_providers.company_local.wire_api="responses"',
        "-c",
        "model_providers.company_local.requires_openai_auth=false",
        "-c",
        "model_providers.company_local.request_max_retries=0",
        "-c",
        "model_providers.company_local.stream_max_retries=0",
        "-c",
        'model_providers.company_local.env_key="OPENONE_CODEX_API_KEY"',
      ],
    });
  });

  test("uses workspace provider config for managed Codex models", () => {
    expect(resolveCodexCommand("company-local", {
      providerId: "company-local",
      baseUrl: "http://models.internal/v1",
      apiKey: "workspace-key",
    })).toEqual({
      command: "codex",
      args: [
        "app-server",
        "-c",
        'model_provider="company_local"',
        "-c",
        'model_providers.company_local.name="OpenOne"',
        "-c",
        'model_providers.company_local.base_url="http://models.internal/v1"',
        "-c",
        'model_providers.company_local.wire_api="responses"',
        "-c",
        "model_providers.company_local.requires_openai_auth=false",
        "-c",
        "model_providers.company_local.request_max_retries=0",
        "-c",
        "model_providers.company_local.stream_max_retries=0",
        "-c",
        'model_providers.company_local.env_key="OPENONE_CODEX_API_KEY"',
      ],
    });
  });
});

describe("resolveGrokCommand", () => {
  test("does not enable always-approve for auto-review by default", () => {
    expect(resolveGrokCommand("local-model", "auto-review")).toEqual({
      command: "grok",
      args: ["agent", "--model", "local-model", "stdio"],
    });
  });

  test("enables always-approve for full-access mode", () => {
    expect(resolveGrokCommand("local-model", "full-access")).toEqual({
      command: "grok",
      args: ["agent", "--model", "local-model", "--always-approve", "stdio"],
    });
  });

  test("passes company local endpoints to managed Grok Build runs", () => {
    expect(resolveGrokCommand("local-model", "auto-review", {
      providerId: "company-local",
      baseUrl: "http://models.internal/v1",
      apiKey: "workspace-key",
    })).toEqual({
      command: "grok",
      args: ["agent", "--model", "local-model", "--xai-api-base-url", "http://models.internal/v1", "--no-leader", "stdio"],
    });
  });

  test("keeps explicit argument overrides authoritative", () => {
    process.env.OPENONE_GROK_ARGS = '["agent","--foo","stdio"]';
    process.env.OPENONE_GROK_COMMAND = "custom-grok";

    expect(resolveGrokCommand("ignored", "full-access")).toEqual({
      command: "custom-grok",
      args: ["agent", "--foo", "stdio"],
    });
  });
});

describe("resolveRuntimeEnv", () => {
  test("passes workspace provider config to Grok Build", () => {
    expect(resolveRuntimeEnv("GROK", {
      baseUrl: "http://models.internal/v1",
      apiKey: "workspace-key",
    })).toEqual({
      GROK_MODELS_BASE_URL: "http://models.internal/v1",
      GROK_XAI_API_BASE_URL: "http://models.internal/v1",
      GROK_MODELS_LIST_URL: "http://models.internal/v1/models",
      GROK_MANAGED_CONFIG: "0",
      GROK_DISABLE_API_KEY_AUTH: "0",
      GROK_API_KEY: "workspace-key",
      OPENONE_GROK_API_KEY: "workspace-key",
      XAI_API_KEY: "workspace-key",
      GROK_CODE_XAI_API_KEY: "workspace-key",
    });
  });

  test("keeps explicit Grok environment as a fallback", () => {
    process.env.OPENONE_GROK_BASE_URL = "http://env-models.internal/v1";
    process.env.OPENONE_GROK_API_KEY = "env-key";

    expect(resolveRuntimeEnv("GROK")).toEqual({
      GROK_MODELS_BASE_URL: "http://env-models.internal/v1",
      GROK_XAI_API_BASE_URL: "http://env-models.internal/v1",
      GROK_MODELS_LIST_URL: "http://env-models.internal/v1/models",
      GROK_MANAGED_CONFIG: "0",
      GROK_DISABLE_API_KEY_AUTH: "0",
      GROK_API_KEY: "env-key",
      OPENONE_GROK_API_KEY: "env-key",
      XAI_API_KEY: "env-key",
      GROK_CODE_XAI_API_KEY: "env-key",
    });
  });
});
