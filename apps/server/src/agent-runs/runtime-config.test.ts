import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveCodexCommand, resolveGrokCommand } from "./runtime-config.js";

const ENV_KEYS = [
  "OPENONE_CODEX_ARGS",
  "OPENONE_CODEX_API_KEY",
  "OPENONE_CODEX_BASE_URL",
  "OPENONE_CODEX_COMMAND",
  "OPENONE_CODEX_PROVIDER_ID",
  "CODEX_COMMAND",
  "OPENONE_GROK_ARGS",
  "OPENONE_GROK_COMMAND",
  "OPENONE_GROK_MODEL",
  "OPENONE_GROK_ALWAYS_APPROVE",
  "GROK_COMMAND",
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
        'model_provider="company-local"',
        "-c",
        'model_providers.company-local={ name="Open One", base_url="http://models.internal/v1", wire_api="responses", env_key="OPENONE_CODEX_API_KEY" }',
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

  test("keeps explicit argument overrides authoritative", () => {
    process.env.OPENONE_GROK_ARGS = '["agent","--foo","stdio"]';
    process.env.OPENONE_GROK_COMMAND = "custom-grok";

    expect(resolveGrokCommand("ignored", "full-access")).toEqual({
      command: "custom-grok",
      args: ["agent", "--foo", "stdio"],
    });
  });
});
