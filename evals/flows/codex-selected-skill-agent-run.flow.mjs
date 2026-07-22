import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const FLOW_ID = "codex-selected-skill-agent-run";
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

async function findWorkspaceWithSapLogin() {
  const workspacesPayload = await api("/workspaces");
  const workspaces = Array.isArray(workspacesPayload.workspaces) ? workspacesPayload.workspaces : [];
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace.id !== "string") continue;
    const tokens = await tokensForWorkspace(workspace);
    const skillsPayload = await api(`/workspace/${encodeURIComponent(workspace.id)}/skills?includeGlobal=true`, { tokens });
    const skills = Array.isArray(skillsPayload.items) ? skillsPayload.items : [];
    if (skills.some((skill) => skill?.name === "sap-login")) return { workspace, tokens };
  }
  throw new Error("No workspace exposes the sap-login skill.");
}

async function waitForRun(workspaceId, runId, tokens) {
  const deadline = Date.now() + 120_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await api(`/workspace/${encodeURIComponent(workspaceId)}/agent-runs/${encodeURIComponent(runId)}`, { tokens });
    const status = latest.run?.status;
    if (status === "completed" || status === "failed" || status === "cancelled") return latest.run;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for Codex selected-skill run ${runId}. Last status: ${latest?.run?.status ?? "unknown"}`);
}

function eventText(run, predicate) {
  return (run.events ?? [])
    .filter(predicate)
    .map((event) => [event.title, event.text].filter(Boolean).join(": "))
    .join("\n");
}

export default {
  id: FLOW_ID,
  title: "Codex consumes the selected Open One skill without broad skill scanning",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Selected sap-login skill reaches Codex through Open One",
      run: async (ctx) => {
        await ctx.prove("A Codex agent run receives sap-login as structured selected skill context", {
          assert: async () => {
            const { workspace, tokens } = await findWorkspaceWithSapLogin();
            const created = await api(`/workspace/${encodeURIComponent(workspace.id)}/agent-runs`, {
              method: "POST",
              tokens,
              body: {
                mode: "codex",
                approvalMode: "auto-review",
                prompt: "the \"sap-login\" skill. Do not execute SAP or run scripts; just confirm selected skill context is available.",
                selectedSkills: ["sap-login"],
                model: "gpt-5.5",
                modelProvider: "company-local",
              },
            });
            const run = await waitForRun(workspace.id, created.run.id, tokens);
            const selectedSkillLoad = eventText(run, (event) => event.type === "tool_call" && event.title === "Load skill sap-login" && event.status === "completed");
            const fullPromptLeak = eventText(run, (event) => event.text?.includes("Open One multi-agent collaboration is enabled."));
            const failedEvents = (run.events ?? []).filter((event) => event.status === "failed" || event.type === "error");

            ctx.assert(run.status === "completed", `Codex selected-skill run completed (actual: ${run.status})`);
            ctx.assert(selectedSkillLoad.includes("sap-login"), "The selected sap-login skill was loaded by the runtime.");
            ctx.assert(!fullPromptLeak, "The internal collaboration prompt was not emitted as user-visible Codex output.");
            ctx.assert(failedEvents.length === 0, `No failed/error agent-run events were emitted (actual: ${failedEvents.length})`);
            ctx.output("Codex selected skill run", [
              `workspace: ${workspace.id}`,
              `run: ${run.id}`,
              `status: ${run.status}`,
              selectedSkillLoad,
            ].filter(Boolean).join("\n"));
          },
        });
      },
    },
  ],
};
