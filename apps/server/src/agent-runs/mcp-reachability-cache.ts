const DEFAULT_MCP_PROBE_CACHE_MS = 30_000;

type McpReachabilityCacheEntry = {
  reachable: boolean;
  expiresAt: number;
};

const reachabilityCache = new Map<string, McpReachabilityCacheEntry>();

export async function cachedMcpUrlReachable(input: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<boolean> {
  if (input.signal.aborted) return false;
  const key = cacheKey(input.url, input.headers);
  const now = Date.now();
  const cached = reachabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.reachable;

  const reachable = await probeMcpUrl(input.url, input.headers, input.timeoutMs, input.signal);
  reachabilityCache.set(key, {
    reachable,
    expiresAt: now + mcpProbeCacheMs(),
  });
  return reachable;
}

export function clearMcpReachabilityCacheForTests(): void {
  reachabilityCache.clear();
}

async function probeMcpUrl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await fetch(url, {
      method: "HEAD",
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function cacheKey(url: string, headers: Record<string, string>): string {
  return JSON.stringify({
    url,
    headers: Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)),
  });
}

function mcpProbeCacheMs(): number {
  const raw = process.env.OPENONE_AGENT_MCP_PROBE_CACHE_MS?.trim();
  if (!raw) return DEFAULT_MCP_PROBE_CACHE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MCP_PROBE_CACHE_MS;
  return parsed;
}
