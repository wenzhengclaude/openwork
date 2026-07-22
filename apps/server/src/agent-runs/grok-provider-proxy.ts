import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type RuntimeProviderConfig = {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
};

export type GrokProviderProxy = {
  baseUrl: string;
  close: () => Promise<void>;
};

type SseNormalizationState = {
  bufferedToolCalls: Map<string, BufferedToolCall>;
  toolCallEnvelope: Record<string, unknown> | null;
};

type BufferedToolCall = {
  choiceIndex: number;
  index: number;
  id: string;
  type: string;
  name: string;
  arguments: string;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export async function startGrokProviderProxy(provider: RuntimeProviderConfig | undefined): Promise<GrokProviderProxy | null> {
  const baseUrl = provider?.baseUrl.trim();
  if (!baseUrl) return null;
  const upstreamBaseUrl = new URL(baseUrl);
  const server = createServer((request, response) => {
    void proxyRequest(request, response, upstreamBaseUrl, provider?.apiKey?.trim() ?? "");
  });
  await listen(server);
  const address = server.address();
  if (!isAddressInfo(address)) {
    await closeServer(server);
    throw new Error("Grok provider proxy did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}${trimTrailingSlash(upstreamBaseUrl.pathname)}`,
    close: () => closeServer(server),
  };
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamBaseUrl: URL,
  apiKey: string,
): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const upstreamUrl = upstreamRequestUrl(upstreamBaseUrl, requestUrl);
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method ?? "GET",
      headers: upstreamRequestHeaders(request, apiKey),
      body: await requestBody(request),
    });
    await writeUpstreamResponse(response, upstreamResponse, requestUrl.pathname);
  } catch (error) {
    writeProxyError(response, error);
  }
}

function upstreamRequestUrl(upstreamBaseUrl: URL, requestUrl: URL): URL {
  const basePath = trimTrailingSlash(upstreamBaseUrl.pathname);
  const requestPath = stripProxyBasePath(requestUrl.pathname, basePath);
  const upstreamUrl = new URL(upstreamBaseUrl.href);
  upstreamUrl.pathname = `${basePath}${requestPath}`.replace(/\/{2,}/g, "/");
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl;
}

function stripProxyBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname || "/";
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname || "/";
}

function upstreamRequestHeaders(request: IncomingMessage, apiKey: string): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

async function requestBody(request: IncomingMessage): Promise<string | undefined> {
  const method = request.method?.toUpperCase() ?? "GET";
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks).toString("utf8");
}

async function writeUpstreamResponse(response: ServerResponse, upstreamResponse: Response, pathname: string): Promise<void> {
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const status = upstreamResponse.status;
  copyResponseHeaders(response, upstreamResponse.headers, contentType);
  response.statusCode = status;
  response.statusMessage = upstreamResponse.statusText;
  if (contentType.toLowerCase().includes("text/event-stream")) {
    await writeNormalizedSse(response, upstreamResponse);
    return;
  }
  if (shouldNormalizeModelsResponse(pathname, contentType)) {
    const text = await upstreamResponse.text();
    response.end(normalizeModelsJsonText(text) ?? text);
    return;
  }
  if (shouldNormalizeJsonResponse(pathname, contentType)) {
    const text = await upstreamResponse.text();
    response.end(normalizeOpenAiJsonText(text, false, currentUnixSeconds()) ?? text);
    return;
  }
  const body = await upstreamResponse.arrayBuffer();
  response.end(Buffer.from(body));
}

function copyResponseHeaders(response: ServerResponse, headers: Headers, contentType: string): void {
  for (const [name, value] of headers.entries()) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || key === "content-encoding") continue;
    response.setHeader(name, value);
  }
  if (contentType.toLowerCase().includes("text/event-stream")) {
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache");
  }
}

async function writeNormalizedSse(response: ServerResponse, upstreamResponse: Response): Promise<void> {
  if (!upstreamResponse.body) {
    response.end();
    return;
  }
  const state: SseNormalizationState = {
    bufferedToolCalls: new Map(),
    toolCallEnvelope: null,
  };
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    pending += decoder.decode(next.value, { stream: true });
    pending = writeCompleteSseLines(response, pending, state);
  }
  pending += decoder.decode();
  if (pending) {
    writeNormalizedSseLines(response, normalizeSseLine(pending.replace(/\r$/, ""), state));
  }
  for (const payload of flushBufferedToolCalls(state, currentUnixSeconds())) {
    writeNormalizedSseLines(response, [`data: ${JSON.stringify(payload)}`]);
  }
  response.end();
}

function writeCompleteSseLines(response: ServerResponse, text: string, state: SseNormalizationState): string {
  let start = 0;
  for (;;) {
    const newlineIndex = text.indexOf("\n", start);
    if (newlineIndex === -1) break;
    const line = text.slice(start, newlineIndex).replace(/\r$/, "");
    writeNormalizedSseLines(response, normalizeSseLine(line, state));
    start = newlineIndex + 1;
  }
  return text.slice(start);
}

function writeNormalizedSseLines(response: ServerResponse, lines: string[]): void {
  lines.forEach((line, index) => {
    if (index > 0 && line.startsWith("data:")) response.write("\n");
    response.write(`${line}\n`);
  });
}

function normalizeSseLine(line: string, state: SseNormalizationState): string[] {
  const match = /^(\s*data:\s*)(.*)$/.exec(line);
  const data = match?.[2]?.trim();
  if (!match || !data) return [line];
  if (data === "[DONE]") {
    return [
      ...flushBufferedToolCalls(state, currentUnixSeconds()).map((payload) => `${match[1]}${JSON.stringify(payload)}`),
      line,
    ];
  }
  const normalized = normalizeOpenAiSseDataText(data, currentUnixSeconds(), state);
  return normalized ? normalized.map((payload) => `${match[1]}${payload}`) : [line];
}

function shouldNormalizeJsonResponse(pathname: string, contentType: string): boolean {
  return pathname.endsWith("/chat/completions") && contentType.toLowerCase().includes("json");
}

function shouldNormalizeModelsResponse(pathname: string, contentType: string): boolean {
  return pathname.endsWith("/models") && contentType.toLowerCase().includes("json");
}

function normalizeModelsJsonText(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    const normalized = normalizeModelsPayload(value);
    return normalized ? JSON.stringify(normalized) : null;
  } catch {
    return null;
  }
}

function normalizeModelsPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  return {
    ...value,
    data: value.data.map(normalizeModelEntry),
  };
}

function normalizeModelEntry(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  if (normalized.stream_tool_calls === undefined && normalized.streamToolCalls === undefined) {
    normalized.stream_tool_calls = false;
  }
  return normalized;
}

function normalizeOpenAiJsonText(text: string, streaming: boolean, created: number): string | null {
  try {
    const value: unknown = JSON.parse(text);
    const normalized = normalizeOpenAiPayload(value, streaming, created);
    return normalized ? JSON.stringify(normalized) : null;
  } catch {
    return null;
  }
}

function normalizeOpenAiSseDataText(text: string, created: number, state: SseNormalizationState): string[] | null {
  try {
    const value: unknown = JSON.parse(text);
    const normalized = normalizeOpenAiPayload(value, true, created);
    if (!normalized) return null;
    const hasToolCallDeltas = bufferToolCallDeltas(normalized, state);
    const payloads: Record<string, unknown>[] = [];
    if (hasToolCallDeltas) {
      const stripped = stripBufferedToolCallDeltas(normalized);
      if (stripped) payloads.push(stripped);
    } else {
      payloads.push(normalized);
    }
    if (hasToolCallFinish(normalized)) {
      payloads.unshift(...flushBufferedToolCalls(state, created));
    }
    return payloads.map((payload) => JSON.stringify(payload));
  } catch {
    return null;
  }
}

function normalizeOpenAiPayload(value: unknown, streaming: boolean, created: number): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const normalized: Record<string, unknown> = { ...value };
  if (!Number.isFinite(normalized.created)) normalized.created = created;
  if (typeof normalized.id !== "string" || !normalized.id) normalized.id = `chatcmpl-openone-${created}`;
  if (typeof normalized.object !== "string" || !normalized.object) {
    normalized.object = streaming ? "chat.completion.chunk" : "chat.completion";
  }
  if (Array.isArray(normalized.choices)) {
    normalized.choices = normalized.choices.map((choice, index) => normalizeChoice(choice, index));
  }
  return normalized;
}

function bufferToolCallDeltas(payload: Record<string, unknown>, state: SseNormalizationState): boolean {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return false;
  let found = false;
  choices.forEach((choice, fallbackChoiceIndex) => {
    if (!isRecord(choice) || !isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) return;
    found = true;
    state.toolCallEnvelope = payload;
    const choiceIndex = numberValue(choice.index) ?? fallbackChoiceIndex;
    choice.delta.tool_calls.forEach((toolCall, fallbackToolIndex) => {
      if (!isRecord(toolCall)) return;
      const toolIndex = numberValue(toolCall.index) ?? fallbackToolIndex;
      const key = `${choiceIndex}:${toolIndex}`;
      const previous = state.bufferedToolCalls.get(key);
      const next: BufferedToolCall = previous ?? {
        choiceIndex,
        index: toolIndex,
        id: "",
        type: "function",
        name: "",
        arguments: "",
      };
      const id = stringValue(toolCall.id);
      if (id) next.id = id;
      const type = stringValue(toolCall.type);
      if (type) next.type = type;
      const fn = toolCall.function;
      if (isRecord(fn)) {
        const name = stringValue(fn.name);
        if (name) next.name = name;
        const args = stringValue(fn.arguments);
        if (args) next.arguments += args;
      }
      state.bufferedToolCalls.set(key, next);
    });
  });
  return found;
}

function stripBufferedToolCallDeltas(payload: Record<string, unknown>): Record<string, unknown> | null {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return payload;
  const strippedChoices = choices.map((choice) => {
    if (!isRecord(choice) || !isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) return choice;
    const delta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(choice.delta)) {
      if (key !== "tool_calls") delta[key] = value;
    }
    return {
      ...choice,
      delta,
    };
  });
  const stripped = {
    ...payload,
    choices: strippedChoices,
  };
  return hasMeaningfulStreamingPayload(stripped) ? stripped : null;
}

function hasMeaningfulStreamingPayload(payload: Record<string, unknown>): boolean {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return true;
  return choices.some((choice) => {
    if (!isRecord(choice)) return true;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) return true;
    const delta = choice.delta;
    if (!isRecord(delta)) return false;
    return Object.entries(delta).some(([key, value]) => key !== "role" && value !== null && value !== "");
  });
}

function hasToolCallFinish(payload: Record<string, unknown>): boolean {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return false;
  return choices.some((choice) => isRecord(choice) && choice.finish_reason === "tool_calls");
}

function flushBufferedToolCalls(state: SseNormalizationState, created: number): Record<string, unknown>[] {
  const calls = Array.from(state.bufferedToolCalls.values()).filter((call) => call.name.trim().length > 0);
  state.bufferedToolCalls.clear();
  if (calls.length === 0) return [];
  const envelope = state.toolCallEnvelope;
  state.toolCallEnvelope = null;
  const grouped = new Map<number, BufferedToolCall[]>();
  for (const call of calls) {
    const existing = grouped.get(call.choiceIndex);
    if (existing) {
      existing.push(call);
    } else {
      grouped.set(call.choiceIndex, [call]);
    }
  }
  const choices = Array.from(grouped.entries()).map(([choiceIndex, choiceCalls]) => ({
    index: choiceIndex,
    delta: {
      role: "assistant",
      content: null,
      tool_calls: choiceCalls.map((call) => ({
        index: call.index,
        id: call.id || `call_openone_${choiceIndex}_${call.index}`,
        type: call.type || "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    },
    finish_reason: null,
  }));
  const result: Record<string, unknown> = {
    id: stringValue(envelope?.id) || `chatcmpl-openone-${created}`,
    object: stringValue(envelope?.object) || "chat.completion.chunk",
    created: numberValue(envelope?.created) ?? created,
    choices,
  };
  const model = stringValue(envelope?.model);
  if (model) result.model = model;
  const fingerprint = stringValue(envelope?.system_fingerprint);
  if (fingerprint) result.system_fingerprint = fingerprint;
  return [result];
}

function normalizeChoice(choice: unknown, index: number): unknown {
  if (!isRecord(choice)) return choice;
  const normalized: Record<string, unknown> = { ...choice };
  if (!Number.isFinite(normalized.index)) normalized.index = index;
  return normalized;
}

function writeProxyError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    error: {
      message: error instanceof Error ? error.message : String(error),
      type: "openone_grok_provider_proxy_error",
    },
  }));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function isAddressInfo(value: ReturnType<Server["address"]>): value is AddressInfo {
  return value !== null && typeof value === "object" && typeof value.port === "number";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
