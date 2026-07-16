import { afterEach, describe, expect, test } from "bun:test";

import { startServer } from "./server.js";
import { bypassProxyForPrivateHost, isPrivateNetworkHost } from "./openai-compatible-provider.js";
import type { ServerConfig } from "./types.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const HOST_TOKEN = "openai_compatible_host_token";
const nativeFetch = globalThis.fetch;
const stops: Array<() => void | Promise<void>> = [];

function baseConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "openai_compatible_client_token",
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function boot() {
  const server = await startServer(baseConfig()) as Served;
  stops.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

function hostHeaders() {
  return {
    "content-type": "application/json",
    "x-openwork-host-token": HOST_TOKEN,
  };
}

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  while (stops.length) {
    await stops.pop()?.();
  }
});

describe("OpenAI-compatible model probe", () => {
  test("identifies private network addresses and bypasses a configured proxy", () => {
    const priorUpper = process.env.NO_PROXY;
    process.env.NO_PROXY = "localhost";
    try {
      expect(isPrivateNetworkHost("10.10.150.4")).toBe(true);
      expect(isPrivateNetworkHost("192.168.1.5")).toBe(true);
      expect(isPrivateNetworkHost("172.20.0.8")).toBe(true);
      expect(isPrivateNetworkHost("203.0.113.2")).toBe(false);
      bypassProxyForPrivateHost("10.10.150.4");
      expect(process.env.NO_PROXY).toBe("localhost,10.10.150.4");
    } finally {
      if (priorUpper === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = priorUpper;
    }
  });

  test("normalizes a root URL and returns the models authorized by the supplied key", async () => {
    const base = await boot();
    let requestUrl = "";
    let authorization = "";
    const providerFetch: typeof globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url === "http://models.example.test/v1/models") {
          requestUrl = request.url;
          authorization = request.headers.get("authorization") ?? "";
          return Response.json({
            data: [
              {
                id: "model-a",
                name: "Model A",
                context_window: 128000,
                max_output_tokens: 4096,
                supports_reasoning: true,
                capabilities: {
                  input_modalities: ["text", "image"],
                  output_modalities: ["text"],
                },
              },
              { id: "minimax-m27-with-qwen-vl" },
              { id: "model-a", name: "Duplicate" },
            ],
          });
        }
        return nativeFetch(input, init);
      },
      { preconnect: nativeFetch.preconnect },
    );
    globalThis.fetch = providerFetch;

    const response = await nativeFetch(`${base}/providers/openai-compatible/models`, {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ baseUrl: "http://models.example.test", apiKey: "personal-key" }),
    });

    expect(response.status).toBe(200);
    expect(requestUrl).toBe("http://models.example.test/v1/models");
    expect(authorization).toBe("Bearer personal-key");
    expect(await response.json()).toEqual({
      baseUrl: "http://models.example.test/v1",
      models: [
        {
          id: "model-a",
          name: "Model A",
          contextWindow: 128000,
          outputLimit: 4096,
          reasoning: true,
          modalities: { input: ["text", "image"], output: ["text"] },
        },
        {
          id: "minimax-m27-with-qwen-vl",
          name: "minimax-m27-with-qwen-vl",
          modalities: { input: ["text", "image"], output: ["text"] },
        },
      ],
    });
  });

  test("does not expose a provider API key when the provider rejects it", async () => {
    const base = await boot();
    const providerFetch: typeof globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url === "http://models.example.test/v1/models") {
          return new Response("provider response containing a secret", { status: 401 });
        }
        return nativeFetch(input, init);
      },
      { preconnect: nativeFetch.preconnect },
    );
    globalThis.fetch = providerFetch;

    const response = await nativeFetch(`${base}/providers/openai-compatible/models`, {
      method: "POST",
      headers: hostHeaders(),
      body: JSON.stringify({ baseUrl: "http://models.example.test/v1", apiKey: "personal-key" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "provider_auth_failed",
      message: "The provider rejected this API key",
    });
  });

  test("requires local host authorization", async () => {
    const base = await boot();
    const response = await nativeFetch(`${base}/providers/openai-compatible/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://models.example.test", apiKey: "personal-key" }),
    });

    expect(response.status).toBe(401);
  });
});
