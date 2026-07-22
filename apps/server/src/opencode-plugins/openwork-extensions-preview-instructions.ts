import { z } from "zod";

const connectStateResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.number(),
  connectEnabled: z.boolean(),
  cloudMcpPresent: z.boolean(),
  googleWorkspace: z.object({
    legacyConfigured: z.boolean(),
  }).passthrough(),
}).passthrough();

export type OpenWorkExtensionConnectState = {
  connectEnabled: boolean;
  cloudMcpPresent: boolean;
  googleWorkspace: {
    legacyConfigured: boolean;
  };
};

export const OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION =
  "If the user asks for something you cannot do with obvious built-in tools, check Open One extensions before saying the capability is unavailable. Use openwork_extension_list_actions to inspect available extension actions, then call the matching action with openwork_extension_call.";

export const OPENWORK_CLOUD_CONNECTION_INSTRUCTION =
  "The Open One Cloud connection is active. For email (Gmail), calendar, Google Drive, and org-connected services such as Notion, Linear, Slack, etc., FIRST call openwork-cloud_search_capabilities with 2-4 keyword variants, then call openwork-cloud_execute_capability with an exact returned name. Do not claim these are unavailable without searching. Open One extensions (openwork_extension_list_actions / openwork_extension_call) remain available for other local actions such as image generation, but do NOT use them for Google Workspace, and never direct the user to Settings > Extensions for Google Workspace; use Settings > Connect. A successful search proves Open One Cloud itself is authorized, so never tell the user to reconnect Open One Cloud because a downstream connector failed. If a result has kind connection_status, name connectionStatus.connectionName and relay connectionStatus.action exactly: use Your Connections for the member, the organization Connections dashboard for an org admin, or the provider admin console for a provider-side failure. After the requested human fixes that connector, search again in the same task. Do not try browser_* or openwork_ui_* workarounds or repeat the same call unchanged; results are live, not cached, so unchanged retries return the same error.";

export const OPENWORK_CONNECT_GOOGLE_WORKSPACE_DISCONNECTED_INSTRUCTION =
  `${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION} Google Workspace is not connected on this device; if the user asks for email, calendar, or Google Drive, tell them to connect their account in Settings > Connect (never Settings > Extensions).`;

const CONNECT_STATE_CACHE_MS = 15_000;

type OpenWorkFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Clock = () => number;
type CachedOpenWorkExtensionDiscoveryInstruction = {
  at: number;
  instruction: string;
};

let cachedOpenWorkExtensionDiscoveryInstruction: CachedOpenWorkExtensionDiscoveryInstruction | null = null;

export function composeOpenWorkExtensionDiscoveryInstruction(state: OpenWorkExtensionConnectState | null): string {
  if (!state || !state.connectEnabled || state.googleWorkspace.legacyConfigured) {
    return OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }
  return state.cloudMcpPresent
    ? OPENWORK_CLOUD_CONNECTION_INSTRUCTION
    : OPENWORK_CONNECT_GOOGLE_WORKSPACE_DISCONNECTED_INSTRUCTION;
}

export function resetOpenWorkExtensionDiscoveryInstructionCacheForTests(): void {
  cachedOpenWorkExtensionDiscoveryInstruction = null;
}

export async function resolveOpenWorkExtensionDiscoveryInstruction(fetcher: OpenWorkFetch = fetch, now: Clock = Date.now): Promise<string> {
  const currentTime = now();
  if (
    cachedOpenWorkExtensionDiscoveryInstruction &&
    currentTime - cachedOpenWorkExtensionDiscoveryInstruction.at < CONNECT_STATE_CACHE_MS
  ) {
    return cachedOpenWorkExtensionDiscoveryInstruction.instruction;
  }

  let instruction = OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  try {
    instruction = composeOpenWorkExtensionDiscoveryInstruction(await fetchOpenWorkConnectState(fetcher));
  } catch {
    instruction = OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION;
  }

  cachedOpenWorkExtensionDiscoveryInstruction = { at: currentTime, instruction };
  return instruction;
}

async function fetchOpenWorkConnectState(fetcher: OpenWorkFetch): Promise<OpenWorkExtensionConnectState> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetcher(`${url}/experimental/connect/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, "Open One connect state request failed"));
  const parsed = connectStateResponseSchema.parse(payload);
  return {
    connectEnabled: parsed.connectEnabled,
    cloudMcpPresent: parsed.cloudMcpPresent,
    googleWorkspace: {
      legacyConfigured: parsed.googleWorkspace.legacyConfigured,
    },
  };
}

function serverUrl(): string {
  return String(process.env.OPENWORK_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.OPENWORK_SERVER_TOKEN || "");
}

function requireOpenWorkServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("Open One extension tools are only available when OpenCode is launched by Open One.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
}
