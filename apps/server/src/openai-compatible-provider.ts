import { ApiError } from "./errors.js";

export type OpenAiCompatibleModel = {
  id: string;
  name: string;
  contextWindow?: number;
  outputLimit?: number;
  reasoning?: boolean;
};

export type OpenAiCompatibleModelsResult = {
  baseUrl: string;
  models: OpenAiCompatibleModel[];
};

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_MODELS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function readPositiveInteger(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0) return candidate;
  if (typeof candidate !== "string" || !/^\d+$/.test(candidate.trim())) return undefined;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readFirstPositiveInteger(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = readPositiveInteger(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const candidate = value[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

export function isPrivateNetworkHost(input: string): boolean {
  const host = input.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) return false;
  const [first, second] = values;
  return first === 10 || first === 127 || first === 169 && second === 254 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

export function bypassProxyForPrivateHost(host: string): void {
  if (!isPrivateNetworkHost(host)) return;
  const configured = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const entries = configured.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => entry.toLowerCase() === host.toLowerCase())) return;

  const next = [...entries, host].join(",");
  process.env.NO_PROXY = next;
}

export function normalizeOpenAiCompatibleBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new ApiError(400, "invalid_provider_url", "API URL is required");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "invalid_provider_url", "API URL must be a valid HTTP URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "invalid_provider_url", "API URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "invalid_provider_url", "API URL cannot include credentials, a query, or a fragment");
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = !path || path === "/" ? "/v1" : path.endsWith("/v1") ? path : `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}

export function parseOpenAiCompatibleModels(payload: unknown): OpenAiCompatibleModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];

  const models = new Map<string, OpenAiCompatibleModel>();
  for (const item of payload.data) {
    if (!isRecord(item)) continue;
    const id = readString(item, "id");
    if (!id || models.has(id)) continue;
    const name = readString(item, "name") || readString(item, "display_name") || id;
    const limits = isRecord(item.limits) ? item.limits : isRecord(item.limit) ? item.limit : item;
    const capabilities = isRecord(item.capabilities) ? item.capabilities : item;
    const contextWindow = readFirstPositiveInteger(limits, [
      "context_length",
      "context_window",
      "contextWindow",
      "max_context_length",
      "max_context_tokens",
      "input_token_limit",
    ]);
    const outputLimit = readFirstPositiveInteger(limits, [
      "max_output_tokens",
      "max_completion_tokens",
      "max_tokens",
      "output_token_limit",
    ]);
    const reasoning = readBoolean(item, "supports_reasoning") ?? readBoolean(item, "reasoning") ?? readBoolean(capabilities, "reasoning");
    models.set(id, {
      id,
      name,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(outputLimit === undefined ? {} : { outputLimit }),
      ...(reasoning === true ? { reasoning: true } : {}),
    });
    if (models.size >= MAX_MODELS) break;
  }
  return Array.from(models.values());
}

export async function probeOpenAiCompatibleModels(input: {
  baseUrl: string;
  apiKey: string;
}, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<OpenAiCompatibleModelsResult> {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new ApiError(400, "api_key_required", "API key is required");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    bypassProxyForPrivateHost(new URL(baseUrl).hostname);
    response = await fetchImpl(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Timed out while loading models"
      : "Could not reach the model provider";
    throw new ApiError(502, "provider_unreachable", message);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, "provider_auth_failed", "The provider rejected this API key");
    }
    if (response.status === 404) {
      throw new ApiError(404, "provider_models_not_found", "The provider did not expose /v1/models");
    }
    throw new ApiError(502, "provider_request_failed", "The provider could not load models");
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ApiError(502, "provider_response_too_large", "The provider returned too much model data");
  }

  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(502, "provider_invalid_response", "The provider returned invalid model data");
  }

  const models = parseOpenAiCompatibleModels(payload);
  if (!models.length) {
    throw new ApiError(422, "provider_models_empty", "No models were returned for this API key");
  }
  return { baseUrl, models };
}
