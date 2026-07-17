import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

type JsonRpcResponse = {
  id: number;
  result?: JsonValue;
  error?: {
    code?: number;
    message?: string;
    data?: JsonValue;
  };
};

type JsonRpcNotification = {
  method: string;
  params?: JsonValue;
};

type JsonRpcServerRequest = {
  id: number;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotificationHandler = (message: JsonRpcNotification) => void;
export type JsonRpcServerRequestHandler = (message: JsonRpcServerRequest) => JsonObject | null;
export type JsonRpcLogHandler = (line: string) => void;

export type StdioJsonRpcClientOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  includeJsonrpc?: boolean;
  onNotification?: JsonRpcNotificationHandler;
  onRequest?: JsonRpcServerRequestHandler;
  onStderr?: JsonRpcLogHandler;
};

type PendingRequest = {
  resolve: (value: JsonValue | undefined) => void;
  reject: (error: Error) => void;
};

export class StdioJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdout: Interface;
  private readonly stderr: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly includeJsonrpc: boolean;
  private readonly onNotification?: JsonRpcNotificationHandler;
  private readonly onRequest?: JsonRpcServerRequestHandler;
  private readonly onStderr?: JsonRpcLogHandler;
  private nextId = 1;
  private closed = false;

  constructor(options: StdioJsonRpcClientOptions) {
    this.includeJsonrpc = options.includeJsonrpc === true;
    this.onNotification = options.onNotification;
    this.onRequest = options.onRequest;
    this.onStderr = options.onStderr;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    this.stdout = createInterface({ input: this.child.stdout });
    this.stderr = createInterface({ input: this.child.stderr });
    this.stdout.on("line", (line) => this.handleStdoutLine(line));
    this.stderr.on("line", (line) => this.onStderr?.(line));
    this.child.on("error", (error) => this.closeWithError(error));
    this.child.on("close", (code, signal) => {
      this.closed = true;
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.closeWithError(new Error(`Agent process exited with ${suffix}`));
    });
  }

  request(method: string, params?: JsonObject): Promise<JsonValue | undefined> {
    if (this.closed) {
      return Promise.reject(new Error("Agent process is closed"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = this.includeJsonrpc
      ? { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }
      : { id, method, ...(params ? { params } : {}) };
    return new Promise<JsonValue | undefined>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: JsonObject): void {
    if (this.closed) return;
    const payload = this.includeJsonrpc
      ? { jsonrpc: "2.0", method, ...(params ? { params } : {}) }
      : { method, ...(params ? { params } : {}) };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
  }

  dispose(): void {
    this.closed = true;
    this.stdout.close();
    this.stderr.close();
    this.child.kill();
    this.closeWithError(new Error("Agent process disposed"));
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = parseJsonObject(trimmed);
    if (!parsed) {
      this.onStderr?.(trimmed);
      return;
    }
    const id = typeof parsed.id === "number" ? parsed.id : null;
    const method = typeof parsed.method === "string" ? parsed.method : null;
    if (id !== null) {
      if (method) {
        const result = this.onRequest?.({ id, method, params: parsed.params }) ?? {};
        this.respond(id, result);
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      const response = parseResponse(parsed, id);
      if (response.error) {
        pending.reject(new Error(response.error.message || `JSON-RPC request ${id} failed`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    if (method) {
      this.onNotification?.({ method, params: parsed.params });
    }
  }

  private respond(id: number, result: JsonObject): void {
    if (this.closed) return;
    const payload = this.includeJsonrpc
      ? { jsonrpc: "2.0", id, result }
      : { id, result };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
  }

  private closeWithError(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function parseJsonObject(input: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(input);
    if (isUnknownJsonObject(value)) return value;
  } catch {
    return null;
  }
  return null;
}

function isUnknownJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function parseResponse(value: JsonObject, id: number): JsonRpcResponse {
  const errorValue = value.error;
  const error =
    errorValue && typeof errorValue === "object" && !Array.isArray(errorValue)
      ? {
          code: typeof errorValue.code === "number" ? errorValue.code : undefined,
          message: typeof errorValue.message === "string" ? errorValue.message : undefined,
          data: isJsonValue(errorValue.data) ? errorValue.data : undefined,
        }
      : undefined;
  return {
    id,
    result: isJsonValue(value.result) ? value.result : undefined,
    error,
  };
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: JsonValue | undefined, key: string): string {
  if (!isJsonObject(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

export function readNestedString(value: JsonValue | undefined, keys: string[]): string {
  let current: JsonValue | undefined = value;
  for (const key of keys) {
    if (!isJsonObject(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

export function extractText(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (!isJsonObject(value)) return "";
  const direct = ["text", "delta", "message", "content", "title"]
    .map((key) => readString(value, key))
    .find((text) => text.trim());
  if (direct) return direct;
  const contentText = readNestedString(value, ["content", "text"]);
  if (contentText) return contentText;
  const updateContentText = readNestedString(value, ["update", "content", "text"]);
  if (updateContentText) return updateContentText;
  return "";
}

export function containsNeedle(value: JsonValue | undefined, needle: string): boolean {
  const lowerNeedle = needle.toLowerCase();
  return JSON.stringify(value ?? "").toLowerCase().includes(lowerNeedle);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      if (!isJsonValue(item)) return false;
    }
    return true;
  }
  return false;
}
