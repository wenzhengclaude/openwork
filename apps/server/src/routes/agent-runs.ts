import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import { resolveAgentRunCapabilities } from "../agent-runs/capabilities.js";
import { AgentRunManager } from "../agent-runs/manager.js";
import { agentRunStore } from "../agent-runs/store.js";
import type { AgentRunApprovalMode, AgentRunApprovalReply, AgentRunAttachment, AgentRunInput, AgentRunMode, AgentRunSnapshot } from "../agent-runs/types.js";
import { readRuntimeOpencodeConfig, runtimeStorageDir, type RuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
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
  const managerPromise = agentRunStore(config).then((store) => new AgentRunManager(store));

  addRoute(routes, "POST", "/workspace/:id/agent-runs", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const prompt = readRequiredString(body, "prompt").slice(0, 120_000);
    const mode = readMode(body.mode);
    const approvalMode = readApprovalMode(body.approvalMode);
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const modelProvider = typeof body.modelProvider === "string" && body.modelProvider.trim() ? body.modelProvider.trim() : undefined;
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : undefined;
    const selectedSkills = readStringList(body.selectedSkills);
    const attachments = readAttachments(body.attachments);
    const runtimeOpencode = await readRuntimeOpencodeConfig(config, workspace.id);
    const runtimeProvider = await resolveRuntimeProvider(config, runtimeOpencode, modelProvider);
    const modelContextWindow = resolveRuntimeModelContextWindow(runtimeOpencode, runtimeProvider?.providerId, model)
      ?? readPositiveInteger(body.modelContextWindow);
    const capabilities = await resolveAgentRunCapabilities(workspace.path, runtimeOpencode);
    const manager = await managerPromise;
    const run = manager.start({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      mode,
      approvalMode,
      prompt,
      model,
      modelProvider,
      modelContextWindow,
      runtimeProvider,
      selectedSkills,
      attachments,
      capabilities,
      sessionId,
    });
    return jsonResponse({ run: publicSnapshot(run) }, 202);
  });

  addRoute(routes, "GET", "/workspace/:id/agent-runs", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const url = new URL(ctx.request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const limit = readLimit(url.searchParams.get("limit"));
    const manager = await managerPromise;
    const runs = manager.list({ workspaceId: workspace.id, sessionId, limit });
    return jsonResponse({ items: runs.map(publicSnapshot) });
  });

  addRoute(routes, "GET", "/workspace/:id/agent-runs/:runId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const manager = await managerPromise;
    const run = requireRun(manager, ctx.params.runId, workspace.id);
    return jsonResponse({ run: publicSnapshot(run) });
  });

  addRoute(routes, "GET", "/workspace/:id/agent-runs/:runId/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const manager = await managerPromise;
    const run = requireRun(manager, ctx.params.runId, workspace.id);
    return eventStreamResponse(manager, run.id);
  });

  addRoute(routes, "POST", "/workspace/:id/agent-runs/:runId/cancel", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const manager = await managerPromise;
    const run = requireRun(manager, ctx.params.runId, workspace.id);
    manager.cancel(run.id);
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "POST", "/workspace/:id/agent-runs/:runId/approvals/:approvalId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const manager = await managerPromise;
    const run = requireRun(manager, ctx.params.runId, workspace.id);
    const body = await readJsonBody(ctx.request);
    const reply = readApprovalReply(body.reply);
    if (!manager.replyApproval(run.id, ctx.params.approvalId, reply)) {
      throw new ApiError(404, "agent_approval_not_found", "Agent approval request not found");
    }
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

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result.slice(0, 16);
}

function readAttachments(value: unknown): AgentRunAttachment[] {
  if (!Array.isArray(value)) return [];
  const result: AgentRunAttachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = readStringField(item, "name").slice(0, 240) || "image";
    const mime = readStringField(item, "mime").toLowerCase();
    const dataUrl = readStringField(item, "dataUrl");
    const expectedPrefix = `data:${mime};base64,`;
    if (!mime.startsWith("image/") || !dataUrl.toLowerCase().startsWith(expectedPrefix)) {
      throw new ApiError(400, "invalid_payload", "agent run attachments must be image data URLs");
    }
    if (dataUrl.length > 25_000_000) {
      throw new ApiError(400, "invalid_payload", "agent run image attachments must be smaller than 25 MB");
    }
    result.push({ name, mime, dataUrl });
    if (result.length >= 8) break;
  }
  return result;
}

function readMode(value: unknown): AgentRunMode {
  if (value === "codex" || value === "grok-build" || value === "multi-agent") return value;
  throw new ApiError(400, "invalid_payload", "mode must be codex, grok-build, or multi-agent");
}

function readApprovalMode(value: unknown): AgentRunApprovalMode {
  if (value === undefined || value === null || value === "") return "auto-review";
  if (value === "ask" || value === "auto-review" || value === "full-access" || value === "custom") return value;
  throw new ApiError(400, "invalid_payload", "approvalMode must be ask, auto-review, full-access, or custom");
}

function readApprovalReply(value: unknown): AgentRunApprovalReply {
  if (value === "once" || value === "always" || value === "reject") return value;
  throw new ApiError(400, "invalid_payload", "reply must be once, always, or reject");
}

function readLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const candidate = value[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function readFirstString(value: unknown, keys: string[]): string {
  for (const key of keys) {
    const candidate = readStringField(value, key);
    if (candidate) return candidate;
  }
  return "";
}

function isCompanyLocalProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === "company-local" || normalized.startsWith("company-local-");
}

function resolveProviderBaseUrl(provider: unknown): string {
  const options = isRecord(provider) && isRecord(provider.options) ? provider.options : {};
  return readFirstString(options, ["baseURL", "baseUrl", "base_url"])
    || readFirstString(provider, ["baseURL", "baseUrl", "base_url"]);
}

function resolveProviderApiKey(provider: unknown): string {
  const options = isRecord(provider) && isRecord(provider.options) ? provider.options : {};
  const auth = isRecord(provider) && isRecord(provider.auth) ? provider.auth : {};
  return readFirstString(options, ["apiKey", "api_key", "key"])
    || readFirstString(auth, ["apiKey", "api_key", "key"])
    || readFirstString(provider, ["apiKey", "api_key", "key"]);
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function resolveRuntimeModelContextWindow(
  runtimeOpencode: RuntimeOpencodeConfig,
  providerId: string | undefined,
  modelId: string | undefined,
): number | undefined {
  const providerKey = providerId?.trim();
  const modelKey = modelId?.trim();
  if (!providerKey || !modelKey) return undefined;
  const providers = isRecord(runtimeOpencode.provider) ? runtimeOpencode.provider : {};
  const provider = providers[providerKey];
  if (!isRecord(provider)) return undefined;
  const models = isRecord(provider.models) ? provider.models : {};
  const model = models[modelKey];
  if (!isRecord(model)) return undefined;
  const limit = isRecord(model.limit) ? model.limit : {};
  return readPositiveInteger(limit.context);
}

async function resolveRuntimeProvider(
  config: ServerConfig,
  runtimeOpencode: RuntimeOpencodeConfig,
  requestedProviderId: string | undefined,
): Promise<AgentRunInput["runtimeProvider"]> {
  const providers = isRecord(runtimeOpencode.provider) ? runtimeOpencode.provider : {};
  const entries = Object.entries(providers);
  const requested = requestedProviderId?.trim() ?? "";
  const matchingEntry = requested
    ? entries.find(([providerId]) => providerId === requested)
    : undefined;
  const fallbackEntry = entries.find(([providerId]) => isCompanyLocalProviderId(providerId)
    && (!requested || isCompanyLocalProviderId(requested)));
  const entry = matchingEntry ?? fallbackEntry;
  if (!entry) return undefined;
  const [providerId, provider] = entry;
  const baseUrl = resolveProviderBaseUrl(provider);
  if (!baseUrl) return undefined;
  const apiKey = resolveProviderApiKey(provider) || await readOpencodeProviderApiKey(config, [
    providerId,
    ...(requested && requested !== providerId ? [requested] : []),
  ]);
  return {
    providerId,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
  };
}

function resolveOpencodeAuthPaths(config: ServerConfig): string[] {
  const paths: string[] = [];
  const addPath = (path: string) => {
    const trimmed = path.trim();
    if (trimmed && !paths.includes(trimmed)) paths.push(trimmed);
  };
  const override = process.env.OPENCODE_AUTH_FILE?.trim();
  if (override) addPath(override);
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) addPath(join(xdgDataHome, "opencode", "auth.json"));
  if (config.configPath && config.configPath.includes("openwork-dev-data")) {
    const marker = "openwork-dev-data";
    const root = config.configPath.slice(0, config.configPath.indexOf(marker) + marker.length);
    addPath(join(root, "xdg", "data", "opencode", "auth.json"));
  }
  addPath(join(runtimeStorageDir(config), "opencode", "auth.json"));
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
    addPath(join(appData, "opencode", "auth.json"));
    addPath(join(appData, "openwork", "opencode", "auth.json"));
    addPath(join(appData, "com.differentai.openwork", "openwork-dev-data", "xdg", "data", "opencode", "auth.json"));
    addPath(join(appData, "com.differentai.openwork.dev", "openwork-dev-data", "xdg", "data", "opencode", "auth.json"));
    return paths;
  }
  addPath(join(homedir(), ".local", "share", "opencode", "auth.json"));
  return paths;
}

async function readOpencodeProviderApiKey(config: ServerConfig, providerIds: string[]): Promise<string> {
  for (const authPath of resolveOpencodeAuthPaths(config)) {
    try {
      const raw = await readFile(authPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) continue;
      for (const providerId of providerIds) {
        const entry = parsed[providerId];
        if (!isRecord(entry)) continue;
        if (readStringField(entry, "type") !== "api") continue;
        const key = readStringField(entry, "key");
        if (key) return key;
      }
    } catch {
      // Try the next local OpenCode auth store candidate.
    }
  }
  return "";
}

function requireRun(manager: AgentRunManager, runId: string, workspaceId: string): AgentRunSnapshot {
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

function eventStreamResponse(manager: AgentRunManager, runId: string): Response {
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
