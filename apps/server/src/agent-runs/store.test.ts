import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import type { AgentRunSnapshot } from "./types.js";
import { agentRunStore, closeAgentRunStoresForTests } from "./store.js";

const WORKSPACE_ID = "ws_agent_runs";

const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  await closeAgentRunStoresForTests();
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
});

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("agentRunStore", () => {
  test("persists agent runs by session", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-agent-runs-"));
    process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const config = serverConfig(root);
    const snapshot: AgentRunSnapshot = {
      id: "run_1",
      workspaceId: WORKSPACE_ID,
      mode: "grok-build",
      approvalMode: "auto-review",
      status: "completed",
      prompt: "hello",
      model: "gpt-5.5",
      modelProvider: "company-local",
      modelContextWindow: 258000,
      sessionId: "session_1",
      attachments: [],
      createdAt: 100,
      updatedAt: 200,
      events: [
        {
          seq: 1,
          runId: "run_1",
          workspaceId: WORKSPACE_ID,
          type: "message_delta",
          runtime: "grok-build",
          timestamp: 150,
          text: "hi",
        },
      ],
    };

    try {
      const first = await agentRunStore(config);
      first.upsert(snapshot);
      expect(first.get("run_1")).toEqual(snapshot);

      await closeAgentRunStoresForTests();

      const reopened = await agentRunStore(config);
      expect(reopened.list({ workspaceId: WORKSPACE_ID, sessionId: "session_1" })).toEqual([snapshot]);
      expect(reopened.list({ workspaceId: WORKSPACE_ID, sessionId: "session_2" })).toEqual([]);
    } finally {
      await closeAgentRunStoresForTests();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY") return;
        throw error;
      });
    }
  });
});
