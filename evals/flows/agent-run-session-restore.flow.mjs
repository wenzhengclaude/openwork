import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const FLOW_ID = "agent-run-session-restore";
const BASE_URL = process.env.OPENWORK_EVAL_SERVER_URL?.trim() || "http://127.0.0.1:4674";
const TOKEN_PATHS = [
  process.env.OPENWORK_EVAL_TOKEN_FILE?.trim(),
  join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "com.differentai.openwork.dev", "openwork-server-tokens.json"),
  join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "com.differentai.openwork", "openwork-server-tokens.json"),
].filter(Boolean);

async function readTokens() {
  for (const tokenPath of TOKEN_PATHS) {
    try {
      const parsed = JSON.parse(await readFile(tokenPath, "utf8"));
      const directToken = typeof parsed.ownerToken === "string" ? parsed.ownerToken : "";
      const directHostToken = typeof parsed.hostToken === "string" ? parsed.hostToken : "";
      if (directToken && directHostToken) return [{ key: "", token: directToken, hostToken: directHostToken }];
      const workspaces = parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {};
      const entries = Object.entries(workspaces).flatMap(([key, value]) => {
        if (!value || typeof value !== "object") return [];
        const token = typeof value.ownerToken === "string"
          ? value.ownerToken
          : typeof value.clientToken === "string"
            ? value.clientToken
            : "";
        const hostToken = typeof value.hostToken === "string" ? value.hostToken : "";
        return token && hostToken ? [{ key: normalizePathKey(key), token, hostToken }] : [];
      });
      if (entries.length > 0) return entries;
    } catch {
      // Try the next known dev token location.
    }
  }
  throw new Error("Could not find Open One dev server tokens.");
}

let tokenEntries;

async function tokensForWorkspace(workspace) {
  tokenEntries ??= await readTokens();
  const workspaceKey = normalizePathKey(workspace?.path ?? "");
  return tokenEntries.find((entry) => entry.key && entry.key === workspaceKey) ?? tokenEntries[0];
}

function normalizePathKey(value) {
  return String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

async function api(path, options = {}) {
  const tokens = options.tokens ?? await tokensForWorkspace(options.workspace);
  const headers = {
    Authorization: `Bearer ${tokens.token}`,
    "x-openwork-host-token": tokens.hostToken,
    ...(options.body ? { "content-type": "application/json" } : {}),
  };
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function firstWorkspace() {
  const workspacesPayload = await api("/workspaces");
  const workspaces = Array.isArray(workspacesPayload.workspaces) ? workspacesPayload.workspaces : [];
  const workspace = workspaces.find((item) => item && typeof item.id === "string");
  if (!workspace) throw new Error("No Open One workspace is available.");
  return { workspace, tokens: await tokensForWorkspace(workspace) };
}

export default {
  id: FLOW_ID,
  title: "Agent runs restore by session after navigation",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Session-scoped agent runs are listable after creation",
      run: async (ctx) => {
        await ctx.prove("The server exposes session-scoped agent runs so the UI can rehydrate them after switching chats", {
          assert: async () => {
            const { workspace, tokens } = await firstWorkspace();
            const sessionId = `fraimz-agent-run-restore-${Date.now()}`;
            const created = await api(`/workspace/${encodeURIComponent(workspace.id)}/agent-runs`, {
              method: "POST",
              tokens,
              body: {
                mode: "codex",
                approvalMode: "auto-review",
                prompt: "Fraimz restore probe. No action needed.",
                sessionId,
                model: "gpt-5.5",
                modelProvider: "company-local",
              },
            });
            const runId = created.run?.id;
            ctx.assert(typeof runId === "string" && runId.length > 0, "The agent run was created with an id.");
            try {
              const listed = await api(
                `/workspace/${encodeURIComponent(workspace.id)}/agent-runs?sessionId=${encodeURIComponent(sessionId)}&limit=4`,
                { tokens },
              );
              const items = Array.isArray(listed.items) ? listed.items : [];
              const restored = items.find((run) => run?.id === runId);
              ctx.assert(Boolean(restored), "The created agent run is returned by the session-scoped list endpoint.");
              ctx.assert(restored.sessionId === sessionId, `The restored run keeps the session id (${restored.sessionId}).`);
              ctx.assert(
                Array.isArray(restored.events) && restored.events.some((event) => event?.type === "run_started"),
                "The restored run includes timeline events for UI rehydration.",
              );
              ctx.output("Restored agent run", [
                `workspace: ${workspace.id}`,
                `session: ${sessionId}`,
                `run: ${runId}`,
                `events: ${restored.events.length}`,
              ].join("\n"));
            } finally {
              await api(`/workspace/${encodeURIComponent(workspace.id)}/agent-runs/${encodeURIComponent(runId)}/cancel`, {
                method: "POST",
                tokens,
              }).catch(() => undefined);
            }
          },
        });
      },
    },
  ],
};
