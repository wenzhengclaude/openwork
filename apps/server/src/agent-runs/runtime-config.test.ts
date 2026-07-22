import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { grokMcpServers, resolveCodexCommand, resolveCodexModelProvider, resolveGrokCommand, resolveRuntimeEnv } from "./runtime-config.js";

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
  "OPENONE_SAPDEV_WORK_DIR",
  "SAPDEV_AI_WORK_DIR",
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

  test("injects shared Open One MCP servers into Codex config", () => {
    expect(resolveCodexCommand(undefined, undefined, {
      mcpServers: {
        "openwork-cloud": {
          type: "remote",
          url: "https://mcp.internal/mcp",
          headers: {
            Authorization: "Bearer local",
          },
          oauth: false,
        },
        disabled: {
          enabled: false,
          url: "https://disabled.internal/mcp",
        },
      },
      skillRoots: [],
      skills: [],
      pluginPaths: [],
    })).toEqual({
      command: "codex",
      args: [
        "app-server",
        "-c",
        'mcp_servers.openwork-cloud.url="https://mcp.internal/mcp"',
        "-c",
        'mcp_servers.openwork-cloud.http_headers={ "Authorization" = "Bearer local" }',
      ],
    });
  });

  test("translates Open One local MCP config into Codex native MCP fields", () => {
    expect(resolveCodexCommand(undefined, undefined, {
      mcpServers: {
        sap: {
          type: "local",
          command: ["node", "server.js", "--stdio"],
          environment: {
            SAP_TOKEN: "secret",
          },
        },
      },
      skillRoots: [],
      skills: [],
      pluginPaths: [],
    })).toEqual({
      command: "codex",
      args: [
        "app-server",
        "-c",
        'mcp_servers.sap.command="node"',
        "-c",
        'mcp_servers.sap.args=["server.js", "--stdio"]',
        "-c",
        'mcp_servers.sap.env={ "SAP_TOKEN" = "secret" }',
      ],
    });
  });
});

describe("resolveCodexModelProvider", () => {
  test("does not pass Open One managed provider ids to Codex without provider config", () => {
    expect(resolveCodexModelProvider("company-local")).toBeUndefined();
    expect(resolveCodexModelProvider("company-local-http-models")).toBeUndefined();
  });

  test("keeps external Codex provider ids without Open One provider config", () => {
    expect(resolveCodexModelProvider("openai")).toBe("openai");
  });
});

describe("grokMcpServers", () => {
  test("normalizes shared Open One MCP servers for Grok Build sessions", () => {
    expect(grokMcpServers({
      mcpServers: {
        "openwork-cloud": {
          type: "remote",
          url: "https://mcp.internal/mcp",
          headers: {
            Authorization: "Bearer local",
          },
          oauth: false,
        },
        disabled: {
          enabled: false,
          url: "https://disabled.internal/mcp",
        },
      },
      skillRoots: [],
      skills: [],
      pluginPaths: [],
    })).toEqual([
      {
        name: "openwork-cloud",
        type: "http",
        url: "https://mcp.internal/mcp",
        headers: [
          {
            name: "Authorization",
            value: "Bearer local",
          },
        ],
      },
    ]);
  });

  test("translates Open One local MCP config into Grok native MCP fields", () => {
    expect(grokMcpServers({
      mcpServers: {
        sap: {
          type: "local",
          command: ["node", "server.js", "--stdio"],
          environment: {
            SAP_TOKEN: "secret",
          },
        },
      },
      skillRoots: [],
      skills: [],
      pluginPaths: [],
    })).toEqual([
      {
        name: "sap",
        command: "node",
        args: ["server.js", "--stdio"],
        env: [
          {
            name: "SAP_TOKEN",
            value: "secret",
          },
        ],
      },
    ]);
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

  test("passes SAP work dir only for selected SAP skills", () => {
    process.env.OPENONE_SAPDEV_WORK_DIR = "D:\\sap-work";

    expect(resolveRuntimeEnv("CODEX", {}, {
      prompt: "the \"sap-login\" skill",
      selectedSkills: ["sap-login"],
    })).toEqual({
      SAPDEV_AI_WORK_DIR: "D:\\sap-work",
    });
    expect(resolveRuntimeEnv("CODEX", {}, {
      prompt: "hello",
      selectedSkills: [],
    })).toEqual({});
  });
});
