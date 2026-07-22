import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

export type RuntimeOpencodeConfig = {
  default_agent?: string;
  plugin?: string[];
  disabled_providers?: string[];
  mcp?: Record<string, Record<string, unknown>>;
  permission?: {
    external_directory?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
};

const runtimeOpencodeConfigs = sqliteTable("runtime_opencode_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

type RuntimeOpencodeDb = {
  close: () => void;
  get: (workspaceId: string) => { configJson: string } | undefined;
  list: () => { workspaceId: string; configJson: string }[];
  upsert: (value: { workspaceId: string; configJson: string; updatedAt: number }) => void;
};

const DEVICE_RUNTIME_CONFIG_ID = "__openone_device__";
const COMPANY_LOCAL_PROVIDER_ID = "company-local";
const COMPANY_LOCAL_PROVIDER_ID_PREFIX = `${COMPANY_LOCAL_PROVIDER_ID}-`;
const DEFAULT_COMPANY_LOCAL_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompanyLocalProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === COMPANY_LOCAL_PROVIDER_ID || normalized.startsWith(COMPANY_LOCAL_PROVIDER_ID_PREFIX);
}

function isKnownImageInputModel(modelId: string): boolean {
  return /(?:^|[-_./])(?:qwen(?:[-_.]?\d+(?:[-_.]\d+)?)?[-_.]?vl|llava|internvl|minicpm[-_.]?v|glm[-_.]?4v|gpt[-_.]?4o|gpt[-_.]?5(?:[-_.]\d+)?|vision|multimodal)(?:[-_./]|$)/i.test(modelId.trim());
}

function isKnownReasoningEffortModel(modelId: string): boolean {
  return /^(?:gpt[-_.]?5(?:[-_.][a-z0-9]+)*|codex(?:[-_.][a-z0-9]+)*)$/i.test(modelId.trim());
}

function normalizedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => typeof item === "string" ? item.trim().toLowerCase() : "").filter(Boolean)));
}

function withString(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

function enhanceCompanyLocalModel(modelId: string, model: Record<string, unknown>): Record<string, unknown> {
  let next: Record<string, unknown> | null = null;
  if (isKnownImageInputModel(modelId)) {
    const modalities = isRecord(model.modalities) ? model.modalities : {};
    const input = normalizedStringList(modalities.input);
    const output = normalizedStringList(modalities.output);
    const nextModalities = {
      ...modalities,
      input: withString(input.length ? input : ["text"], "image"),
      output: output.length ? output : ["text"],
    };
    next = {
      ...(next ?? model),
      modalities: nextModalities,
      attachment: true,
    };
  }

  if (isKnownReasoningEffortModel(modelId)) {
    const current = next ?? model;
    const capabilities = isRecord(current.capabilities) ? current.capabilities : {};
    const variants = isRecord(current.variants) ? current.variants : {};
    const nextVariants = { ...variants };
    for (const effort of DEFAULT_COMPANY_LOCAL_REASONING_EFFORTS) {
      if (isRecord(nextVariants[effort])) continue;
      nextVariants[effort] = { reasoningEffort: effort };
    }
    next = {
      ...current,
      capabilities: { ...capabilities, reasoning: true },
      variants: nextVariants,
    };
  }

  return next ?? model;
}

function enhanceCompanyLocalProvider(providerId: string, provider: unknown): unknown {
  if (!isCompanyLocalProviderId(providerId) || !isRecord(provider)) return provider;
  const models = isRecord(provider.models) ? provider.models : undefined;
  if (!models) return provider;
  const nextModels = Object.fromEntries(
    Object.entries(models).map(([modelId, model]) => [
      modelId,
      isRecord(model) ? enhanceCompanyLocalModel(modelId, model) : model,
    ]),
  );
  return {
    ...provider,
    models: nextModels,
  };
}

function enhanceRuntimeProviders(provider: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(provider).map(([providerId, value]) => [providerId, enhanceCompanyLocalProvider(providerId, value)]),
  );
}

function companyLocalProvidersFrom(provider: unknown): Record<string, unknown> {
  if (!isRecord(provider)) return {};
  return Object.fromEntries(
    Object.entries(provider).filter(([providerId, value]) => isCompanyLocalProviderId(providerId) && isRecord(value)),
  );
}

function mergeDeviceCompanyLocalProviders(
  workspaceConfig: RuntimeOpencodeConfig,
  deviceConfig: RuntimeOpencodeConfig,
): RuntimeOpencodeConfig {
  const deviceProviders = companyLocalProvidersFrom(deviceConfig.provider);
  if (Object.keys(deviceProviders).length === 0) return workspaceConfig;
  const workspaceProviders = isRecord(workspaceConfig.provider) ? workspaceConfig.provider : {};
  return normalizeRuntimeOpencodeConfig({
    ...workspaceConfig,
    provider: {
      ...deviceProviders,
      ...workspaceProviders,
    },
  });
}

function companyLocalDeviceConfigFrom(config: RuntimeOpencodeConfig): RuntimeOpencodeConfig {
  const provider = companyLocalProvidersFrom(config.provider);
  return Object.keys(provider).length ? { provider } : {};
}

function collectLegacyDeviceCompanyLocalConfig(db: RuntimeOpencodeDb): RuntimeOpencodeConfig {
  const provider: Record<string, unknown> = {};
  for (const row of db.list()) {
    if (row.workspaceId === DEVICE_RUNTIME_CONFIG_ID) continue;
    Object.assign(provider, companyLocalProvidersFrom(parseRuntimeOpencodeConfig(row.configJson).provider));
  }
  return Object.keys(provider).length ? normalizeRuntimeOpencodeConfig({ provider }) : {};
}

function syncDeviceCompanyLocalConfig(db: RuntimeOpencodeDb, updatedAt: number): void {
  const deviceConfig = companyLocalDeviceConfigFrom(collectLegacyDeviceCompanyLocalConfig(db));
  db.upsert({
    workspaceId: DEVICE_RUNTIME_CONFIG_ID,
    configJson: JSON.stringify(deviceConfig),
    updatedAt,
  });
}

function normalizeRuntimeOpencodeConfig(value: unknown): RuntimeOpencodeConfig {
  if (!isRecord(value)) return {};
  const defaultAgent = typeof value.default_agent === "string" ? value.default_agent : undefined;
  const plugin = Array.isArray(value.plugin) ? value.plugin.filter((item) => typeof item === "string") : undefined;
  const disabledProviders = Array.isArray(value.disabled_providers)
    ? value.disabled_providers.filter((item) => typeof item === "string")
    : undefined;
  const mcp = isRecord(value.mcp) ? value.mcp as Record<string, Record<string, unknown>> : undefined;
  const permission = isRecord(value.permission) ? value.permission : undefined;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : undefined;
  const provider = isRecord(value.provider) ? enhanceRuntimeProviders(value.provider) : undefined;
  return {
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),
    ...(plugin ? { plugin } : {}),
    ...(disabledProviders ? { disabled_providers: disabledProviders } : {}),
    ...(mcp ? { mcp } : {}),
    ...(externalDirectory ? { permission: { external_directory: externalDirectory } } : {}),
    ...(provider ? { provider } : {}),
  };
}

function parseRuntimeOpencodeConfig(configJson: string): RuntimeOpencodeConfig {
  try {
    return normalizeRuntimeOpencodeConfig(JSON.parse(configJson));
  } catch {
    return {};
  }
}

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

/** Directory holding runtime state (the SQLite DB and derived files). */
export function runtimeStorageDir(config: ServerConfig): string {
  return dirname(runtimeDbPath(config));
}

export type RuntimeOpencodeConfigWriteListener = (config: ServerConfig, workspaceId: string) => void;

const writeListeners = new Set<RuntimeOpencodeConfigWriteListener>();

/**
 * Observe runtime config writes. Used to keep derived state (e.g. the
 * engine-visible runtime config file) in sync with the DB. Returns an
 * unsubscribe function. Listeners must not throw.
 */
export function onRuntimeOpencodeConfigWrite(listener: RuntimeOpencodeConfigWriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

async function openRuntimeDb(path: string): Promise<RuntimeOpencodeDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const db = drizzle(sqlite);
    return {
      close: () => sqlite.close(),
      get: (workspaceId) => db
        .select()
        .from(runtimeOpencodeConfigs)
        .where(eq(runtimeOpencodeConfigs.workspaceId, workspaceId))
        .get(),
      list: () => db
        .select()
        .from(runtimeOpencodeConfigs)
        .all()
        .flatMap((row) => typeof row.workspaceId === "string" && typeof row.configJson === "string"
          ? [{ workspaceId: row.workspaceId, configJson: row.configJson }]
          : []),
      upsert: ({ workspaceId, configJson, updatedAt }) => {
        db
          .insert(runtimeOpencodeConfigs)
          .values({ workspaceId, configJson, updatedAt })
          .onConflictDoUpdate({
            target: runtimeOpencodeConfigs.workspaceId,
            set: { configJson, updatedAt },
          })
          .run();
      },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const get = sqlite.prepare("SELECT config_json AS configJson FROM runtime_opencode_configs WHERE workspace_id = ?");
  const list = sqlite.prepare("SELECT workspace_id AS workspaceId, config_json AS configJson FROM runtime_opencode_configs");
  const upsert = sqlite.prepare("INSERT INTO runtime_opencode_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at");
  return {
    close: () => sqlite.close(),
    get: (workspaceId) => {
      const row = get.get(workspaceId);
      if (!isRecord(row) || typeof row.configJson !== "string") return undefined;
      return { configJson: row.configJson };
    },
    list: () => list.all().flatMap((row) => {
      if (!isRecord(row) || typeof row.workspaceId !== "string" || typeof row.configJson !== "string") return [];
      return [{ workspaceId: row.workspaceId, configJson: row.configJson }];
    }),
    upsert: ({ workspaceId, configJson, updatedAt }) => {
      upsert.run(workspaceId, configJson, updatedAt);
    },
  };
}

const dbByPath = new Map<string, Promise<RuntimeOpencodeDb>>();

async function runtimeDb(config: ServerConfig): Promise<RuntimeOpencodeDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const db = openRuntimeDb(path);
  dbByPath.set(path, db);
  return db;
}

export async function closeRuntimeOpencodeConfigStoresForTests(): Promise<void> {
  const stores = Array.from(dbByPath.values());
  dbByPath.clear();
  for (const store of stores) {
    (await store).close();
  }
}

export function runtimePluginList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.plugin) ? config.plugin.filter((item) => typeof item === "string") : [];
}

export function runtimeDisabledProviderList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.disabled_providers)
    ? config.disabled_providers.filter((item) => typeof item === "string")
    : [];
}

export function runtimeMcpMap(config: RuntimeOpencodeConfig): Record<string, Record<string, unknown>> {
  return isRecord(config.mcp) ? config.mcp as Record<string, Record<string, unknown>> : {};
}

export function runtimeExternalDirectory(config: RuntimeOpencodeConfig): Record<string, unknown> {
  const permission = isRecord(config.permission) ? config.permission : null;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : null;
  return externalDirectory ?? {};
}

/**
 * Per-provider merge for runtime config patches: record values upsert the
 * provider, explicit `null` deletes it (so clients can remove runtime-managed
 * providers, e.g. cloud imports, without racing a read-modify-write of the
 * whole map). Returns undefined when the resulting map is empty.
 */
export function mergeRuntimeProviderUpdate(
  current: unknown,
  update: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(isRecord(current) ? current : {}) };
  for (const [providerId, value] of Object.entries(update)) {
    if (value === null) {
      delete next[providerId];
    } else if (isRecord(value)) {
      next[providerId] = value;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

export async function readRuntimeOpencodeConfig(config: ServerConfig, workspaceId: string): Promise<RuntimeOpencodeConfig> {
  const db = await runtimeDb(config);
  const row = db.get(workspaceId);
  const workspaceConfig = row ? parseRuntimeOpencodeConfig(row.configJson) : {};
  if (workspaceId === DEVICE_RUNTIME_CONFIG_ID) return workspaceConfig;
  const deviceRow = db.get(DEVICE_RUNTIME_CONFIG_ID);
  const deviceConfig = deviceRow
    ? parseRuntimeOpencodeConfig(deviceRow.configJson)
    : collectLegacyDeviceCompanyLocalConfig(db);
  return mergeDeviceCompanyLocalProviders(workspaceConfig, deviceConfig);
}

export async function writeRuntimeOpencodeConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig,
): Promise<{ config: RuntimeOpencodeConfig; changed: boolean }> {
  const db = await runtimeDb(config);
  const row = db.get(workspaceId);
  const current = row ? parseRuntimeOpencodeConfig(row.configJson) : {};
  const next = normalizeRuntimeOpencodeConfig(updater(current));
  const now = Date.now();
  const configJson = JSON.stringify(next);
  if (row?.configJson === configJson) {
    return { config: next, changed: false };
  }
  db.upsert({ workspaceId, configJson, updatedAt: now });
  if (workspaceId !== DEVICE_RUNTIME_CONFIG_ID) {
    syncDeviceCompanyLocalConfig(db, now);
  }
  for (const listener of writeListeners) listener(config, workspaceId);
  return { config: next, changed: true };
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  runtime: RuntimeOpencodeConfig,
): Record<string, unknown> {
  const persistedPermission = isRecord(persisted.permission) ? persisted.permission : {};
  const persistedExternalDirectory = isRecord(persistedPermission.external_directory)
    ? persistedPermission.external_directory
    : {};
  return {
    ...persisted,
    plugin: [
      ...(Array.isArray(persisted.plugin) ? persisted.plugin.filter((item) => typeof item === "string") : []),
      ...runtimePluginList(runtime),
    ],
    disabled_providers: [
      ...(Array.isArray(persisted.disabled_providers) ? persisted.disabled_providers.filter((item) => typeof item === "string") : []),
      ...runtimeDisabledProviderList(runtime),
    ].filter((item, index, list) => list.indexOf(item) === index),
    mcp: {
      ...(isRecord(persisted.mcp) ? persisted.mcp : {}),
      ...runtimeMcpMap(runtime),
    },
    permission: {
      ...persistedPermission,
      external_directory: {
        ...persistedExternalDirectory,
        ...runtimeExternalDirectory(runtime),
      },
    },
    ...(runtime.provider ? { provider: { ...(isRecord(persisted.provider) ? persisted.provider : {}), ...runtime.provider } } : {}),
    ...(runtime.default_agent ? { default_agent: runtime.default_agent } : {}),
  };
}
