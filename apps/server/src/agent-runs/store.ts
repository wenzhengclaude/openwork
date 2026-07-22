import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerConfig } from "../types.js";
import { ensureDir } from "../utils.js";
import type {
  AgentRunApprovalMode,
  AgentRunAttachment,
  AgentRunEvent,
  AgentRunEventType,
  AgentRunMode,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRuntimeKind,
} from "./types.js";

type AgentRunListOptions = {
  workspaceId: string;
  sessionId?: string;
  limit?: number;
};

export type AgentRunStore = {
  close: () => void;
  get: (runId: string) => AgentRunSnapshot | null;
  list: (options: AgentRunListOptions) => AgentRunSnapshot[];
  upsert: (snapshot: AgentRunSnapshot) => void;
};

type AgentRunRow = {
  runId: string;
  workspaceId: string;
  sessionId: string | null;
  snapshotJson: string;
  createdAt: number;
  updatedAt: number;
};

const agentRunSnapshots = sqliteTable("agent_run_snapshots", {
  runId: text("run_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  sessionId: text("session_id"),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

function createTableSql() {
  return [
    "CREATE TABLE IF NOT EXISTS agent_run_snapshots (",
    "run_id TEXT PRIMARY KEY NOT NULL,",
    "workspace_id TEXT NOT NULL,",
    "session_id TEXT,",
    "snapshot_json TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "updated_at INTEGER NOT NULL",
    ")",
  ].join(" ");
}

function createIndexSql() {
  return "CREATE INDEX IF NOT EXISTS agent_run_snapshots_workspace_session_updated_idx ON agent_run_snapshots (workspace_id, session_id, updated_at)";
}

async function openAgentRunStore(path: string): Promise<AgentRunStore> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run(createTableSql());
    sqlite.run(createIndexSql());
    const db = drizzle(sqlite);
    return {
      close: () => sqlite.close(),
      get: (runId) => rowToSnapshot(
        db
          .select()
          .from(agentRunSnapshots)
          .where(eq(agentRunSnapshots.runId, runId))
          .get(),
      ),
      list: (options) => {
        const sessionId = options.sessionId?.trim();
        const where = sessionId
          ? and(eq(agentRunSnapshots.workspaceId, options.workspaceId), eq(agentRunSnapshots.sessionId, sessionId))
          : eq(agentRunSnapshots.workspaceId, options.workspaceId);
        const rows = db
          .select()
          .from(agentRunSnapshots)
          .where(where)
          .orderBy(desc(agentRunSnapshots.updatedAt))
          .all();
        return rowsToSnapshots(rows, options.limit);
      },
      upsert: (snapshot) => {
        db
          .insert(agentRunSnapshots)
          .values(snapshotToRow(snapshot))
          .onConflictDoUpdate({
            target: agentRunSnapshots.runId,
            set: snapshotToRow(snapshot),
          })
          .run();
      },
    };
  }

  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(createTableSql());
  sqlite.exec(createIndexSql());
  const get = sqlite.prepare("SELECT run_id AS runId, workspace_id AS workspaceId, session_id AS sessionId, snapshot_json AS snapshotJson, created_at AS createdAt, updated_at AS updatedAt FROM agent_run_snapshots WHERE run_id = ?");
  const listByWorkspace = sqlite.prepare("SELECT run_id AS runId, workspace_id AS workspaceId, session_id AS sessionId, snapshot_json AS snapshotJson, created_at AS createdAt, updated_at AS updatedAt FROM agent_run_snapshots WHERE workspace_id = ? ORDER BY updated_at DESC");
  const listBySession = sqlite.prepare("SELECT run_id AS runId, workspace_id AS workspaceId, session_id AS sessionId, snapshot_json AS snapshotJson, created_at AS createdAt, updated_at AS updatedAt FROM agent_run_snapshots WHERE workspace_id = ? AND session_id = ? ORDER BY updated_at DESC");
  const upsert = sqlite.prepare("INSERT INTO agent_run_snapshots (run_id, workspace_id, session_id, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET workspace_id = excluded.workspace_id, session_id = excluded.session_id, snapshot_json = excluded.snapshot_json, created_at = excluded.created_at, updated_at = excluded.updated_at");
  return {
    close: () => sqlite.close(),
    get: (runId) => rowToSnapshot(get.get(runId)),
    list: (options) => {
      const sessionId = options.sessionId?.trim();
      const rows = sessionId ? listBySession.all(options.workspaceId, sessionId) : listByWorkspace.all(options.workspaceId);
      return rowsToSnapshots(rows, options.limit);
    },
    upsert: (snapshot) => {
      const row = snapshotToRow(snapshot);
      upsert.run(row.runId, row.workspaceId, row.sessionId, row.snapshotJson, row.createdAt, row.updatedAt);
    },
  };
}

const storesByPath = new Map<string, Promise<AgentRunStore>>();

export function agentRunStore(config: ServerConfig): Promise<AgentRunStore> {
  const path = runtimeDbPath(config);
  const existing = storesByPath.get(path);
  if (existing) return existing;
  const store = openAgentRunStore(path);
  storesByPath.set(path, store);
  return store;
}

export async function closeAgentRunStoresForTests(): Promise<void> {
  const stores = Array.from(storesByPath.values());
  storesByPath.clear();
  for (const store of stores) {
    (await store).close();
  }
}

function snapshotToRow(snapshot: AgentRunSnapshot): AgentRunRow {
  return {
    runId: snapshot.id,
    workspaceId: snapshot.workspaceId,
    sessionId: snapshot.sessionId,
    snapshotJson: JSON.stringify(snapshot),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function rowsToSnapshots(rows: unknown[], limit: number | undefined): AgentRunSnapshot[] {
  const snapshots = rows.flatMap((row) => {
    const snapshot = rowToSnapshot(row);
    return snapshot ? [snapshot] : [];
  });
  return typeof limit === "number" ? snapshots.slice(0, limit) : snapshots;
}

function rowToSnapshot(row: unknown): AgentRunSnapshot | null {
  if (!isRecord(row)) return null;
  const snapshotJson = stringField(row, "snapshotJson");
  if (!snapshotJson) return null;
  try {
    return normalizeSnapshot(JSON.parse(snapshotJson));
  } catch {
    return null;
  }
}

function normalizeSnapshot(value: unknown): AgentRunSnapshot | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id");
  const workspaceId = stringField(value, "workspaceId");
  const mode = readMode(value.mode);
  const approvalMode = readApprovalMode(value.approvalMode);
  const status = readRunStatus(value.status);
  const prompt = stringField(value, "prompt");
  const createdAt = numberField(value, "createdAt");
  const updatedAt = numberField(value, "updatedAt");
  if (!id || !workspaceId || !mode || !approvalMode || !status || !prompt || createdAt === null || updatedAt === null) {
    return null;
  }
  const modelContextWindow = numberField(value, "modelContextWindow");
  return {
    id,
    workspaceId,
    mode,
    approvalMode,
    status,
    prompt,
    model: nullableStringField(value, "model"),
    modelProvider: nullableStringField(value, "modelProvider"),
    modelContextWindow,
    sessionId: nullableStringField(value, "sessionId"),
    attachments: readAttachments(value.attachments),
    createdAt,
    updatedAt,
    events: readEvents(value.events),
  };
}

function readEvents(value: unknown): AgentRunEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const event = readEvent(item);
    return event ? [event] : [];
  });
}

function readEvent(value: unknown): AgentRunEvent | null {
  if (!isRecord(value)) return null;
  const seq = numberField(value, "seq");
  const runId = stringField(value, "runId");
  const workspaceId = stringField(value, "workspaceId");
  const type = readEventType(value.type);
  const timestamp = numberField(value, "timestamp");
  if (seq === null || !runId || !workspaceId || !type || timestamp === null) return null;
  const runtime = readRuntimeKind(value.runtime);
  const status = readEventStatus(value.status);
  return {
    seq,
    runId,
    workspaceId,
    type,
    timestamp,
    ...(runtime ? { runtime } : {}),
    ...(stringField(value, "agentId") ? { agentId: stringField(value, "agentId") } : {}),
    ...(stringField(value, "parentAgentId") ? { parentAgentId: stringField(value, "parentAgentId") } : {}),
    ...(stringField(value, "title") ? { title: stringField(value, "title") } : {}),
    ...(stringField(value, "text") ? { text: stringField(value, "text") } : {}),
    ...(status ? { status } : {}),
    ...(isRecord(value.details) ? { details: value.details } : {}),
  };
}

function readAttachments(value: unknown): AgentRunAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = stringField(item, "name");
    const mime = stringField(item, "mime");
    const dataUrl = stringField(item, "dataUrl");
    return name && mime && dataUrl ? [{ name, mime, dataUrl }] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

function nullableStringField(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readMode(value: unknown): AgentRunMode | null {
  if (value === "codex" || value === "grok-build" || value === "multi-agent") return value;
  return null;
}

function readApprovalMode(value: unknown): AgentRunApprovalMode | null {
  if (value === "ask" || value === "auto-review" || value === "full-access" || value === "custom") return value;
  return null;
}

function readRunStatus(value: unknown): AgentRunStatus | null {
  if (value === "starting" || value === "running" || value === "completed" || value === "cancelled" || value === "failed") return value;
  return null;
}

function readEventStatus(value: unknown): AgentRunEvent["status"] | null {
  if (value === "starting" || value === "running" || value === "completed" || value === "cancelled" || value === "failed" || value === "pending") return value;
  return null;
}

function readRuntimeKind(value: unknown): AgentRuntimeKind | null {
  if (value === "codex" || value === "grok-build") return value;
  return null;
}

function readEventType(value: unknown): AgentRunEventType | null {
  if (
    value === "run_started" ||
    value === "agent_started" ||
    value === "agent_completed" ||
    value === "child_agent_started" ||
    value === "child_agent_completed" ||
    value === "message_delta" ||
    value === "thought_delta" ||
    value === "tool_call" ||
    value === "approval_requested" ||
    value === "approval_resolved" ||
    value === "plan" ||
    value === "log" ||
    value === "error" ||
    value === "run_completed"
  ) {
    return value;
  }
  return null;
}
