import { ApiError } from "../errors.js";
import { AgentRunManager } from "../agent-runs/manager.js";
import type { AgentRunMode, AgentRunSnapshot } from "../agent-runs/types.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

interface RegisterAgentRunRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

const manager = new AgentRunManager();

export function registerAgentRunRoutes(options: RegisterAgentRunRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    readJsonBody,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
  } = options;

  addRoute(routes, "POST", "/workspace/:id/agent-runs", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const prompt = readRequiredString(body, "prompt").slice(0, 120_000);
    const mode = readMode(body.mode);
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const run = manager.start({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      mode,
      prompt,
      model,
    });
    return jsonResponse({ run: publicSnapshot(run) }, 202);
  });

  addRoute(routes, "GET", "/workspace/:id/agent-runs/:runId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const run = requireRun(ctx.params.runId, workspace.id);
    return jsonResponse({ run: publicSnapshot(run) });
  });

  addRoute(routes, "GET", "/workspace/:id/agent-runs/:runId/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const run = requireRun(ctx.params.runId, workspace.id);
    return eventStreamResponse(run.id);
  });

  addRoute(routes, "POST", "/workspace/:id/agent-runs/:runId/cancel", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const run = requireRun(ctx.params.runId, workspace.id);
    manager.cancel(run.id);
    return jsonResponse({ ok: true });
  });
}

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_payload", `${key} is required`);
  }
  return value.trim();
}

function readMode(value: unknown): AgentRunMode {
  if (value === "codex" || value === "grok-build" || value === "multi-agent") return value;
  throw new ApiError(400, "invalid_payload", "mode must be codex, grok-build, or multi-agent");
}

function requireRun(runId: string, workspaceId: string): AgentRunSnapshot {
  const run = manager.get(runId);
  if (!run || run.workspaceId !== workspaceId) {
    throw new ApiError(404, "agent_run_not_found", "Agent run not found");
  }
  return run;
}

function publicSnapshot(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return {
    ...snapshot,
    prompt: snapshot.prompt.length > 800 ? `${snapshot.prompt.slice(0, 797)}...` : snapshot.prompt,
  };
}

function eventStreamResponse(runId: string): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      write(": connected\n\n");
      unsubscribe = manager.subscribe(runId, (event) => {
        write(`id: ${event.seq}\n`);
        write("event: agent-run\n");
        write(`data: ${JSON.stringify(event)}\n\n`);
      });
      if (!unsubscribe) {
        controller.error(new Error("Agent run not found"));
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
