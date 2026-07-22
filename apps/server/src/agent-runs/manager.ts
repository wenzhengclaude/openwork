import { randomUUID } from "node:crypto";
import { CodexRuntime } from "./runtimes/codex-runtime.js";
import { GrokBuildRuntime } from "./runtimes/grok-build-runtime.js";
import type { AgentRunStore } from "./store.js";
import type { AgentRunApprovalReply, AgentRunEmitter, AgentRunEvent, AgentRunInput, AgentRunMode, AgentRuntimeApprovalRequest, AgentRunSnapshot, AgentRunStatus, AgentRuntime, AgentRuntimeKind } from "./types.js";

type AgentRunRecord = {
  snapshot: AgentRunSnapshot;
  controller: AbortController;
  listeners: Set<(event: AgentRunEvent) => void>;
  approvals: Map<string, PendingApproval>;
};

type AgentRunListOptions = {
  workspaceId: string;
  sessionId?: string;
  limit?: number;
};

type PendingApproval = {
  resolve: (reply: AgentRunApprovalReply) => void;
};

export class AgentRunManager {
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly runtimes: Record<AgentRuntimeKind, AgentRuntime> = {
    codex: new CodexRuntime(),
    "grok-build": new GrokBuildRuntime(),
  };

  constructor(private readonly store?: AgentRunStore) {}

  start(input: AgentRunInput): AgentRunSnapshot {
    const id = randomUUID();
    const now = Date.now();
    const record: AgentRunRecord = {
      controller: new AbortController(),
      listeners: new Set(),
      approvals: new Map(),
      snapshot: {
        id,
        workspaceId: input.workspaceId,
        mode: input.mode,
        approvalMode: input.approvalMode,
        status: "starting",
        prompt: input.prompt,
        model: input.model ?? null,
        modelProvider: input.modelProvider ?? null,
        modelContextWindow: input.modelContextWindow ?? null,
        sessionId: input.sessionId ?? null,
        attachments: input.attachments ?? [],
        createdAt: now,
        updatedAt: now,
        events: [],
      },
    };
    this.runs.set(id, record);
    const emit = this.createEmitter(record);
    record.snapshot.status = "running";
    emit({
      type: "run_started",
      title: modeTitle(input.mode),
      status: "running",
      details: openOneRunDetails(input.mode, "run_started"),
    });
    void this.runAll(input, record, emit);
    return record.snapshot;
  }

  get(runId: string): AgentRunSnapshot | null {
    return this.runs.get(runId)?.snapshot ?? this.store?.get(runId) ?? null;
  }

  list(options: AgentRunListOptions): AgentRunSnapshot[] {
    const sessionId = options.sessionId?.trim() ?? "";
    const memoryRuns = [...this.runs.values()]
      .map((record) => record.snapshot)
      .filter((snapshot) => snapshot.workspaceId === options.workspaceId)
      .filter((snapshot) => !sessionId || snapshot.sessionId === sessionId);
    const persistedRuns = this.store?.list({
      workspaceId: options.workspaceId,
      ...(sessionId ? { sessionId } : {}),
    }) ?? [];
    const byId = new Map<string, AgentRunSnapshot>();
    for (const snapshot of persistedRuns) byId.set(snapshot.id, snapshot);
    for (const snapshot of memoryRuns) byId.set(snapshot.id, snapshot);
    const sorted = [...byId.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
    const limit = normalizedListLimit(options.limit, Boolean(sessionId));
    return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
  }

  subscribe(runId: string, listener: (event: AgentRunEvent) => void): (() => void) | null {
    const record = this.runs.get(runId);
    if (!record) return null;
    for (const event of record.snapshot.events) {
      listener(event);
    }
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }

  cancel(runId: string): boolean {
    const record = this.runs.get(runId);
    if (!record) return false;
    if (record.snapshot.status === "completed" || record.snapshot.status === "failed" || record.snapshot.status === "cancelled") {
      return true;
    }
    record.controller.abort();
    this.rejectPendingApprovals(record);
    record.snapshot.status = "cancelled";
    this.createEmitter(record)({
      type: "run_completed",
      title: "Cancelled",
      status: "cancelled",
      details: openOneRunDetails(record.snapshot.mode, "run_completed"),
    });
    this.persist(record);
    return true;
  }

  replyApproval(runId: string, approvalId: string, reply: AgentRunApprovalReply): boolean {
    const record = this.runs.get(runId);
    const approval = record?.approvals.get(approvalId);
    if (!record || !approval) return false;
    record.approvals.delete(approvalId);
    approval.resolve(reply);
    this.createEmitter(record)({
      type: "approval_resolved",
      title: reply === "reject" ? "Permission denied" : "Permission approved",
      status: "completed",
      details: { approvalId, reply },
    });
    this.persist(record);
    return true;
  }

  private async runAll(input: AgentRunInput, record: AgentRunRecord, emit: AgentRunEmitter): Promise<void> {
    record.snapshot.status = "running";
    const selected = runtimesForMode(input.mode);
    try {
      await Promise.all(selected.map(async (runtimeKind) => {
        const runtime = this.runtimes[runtimeKind];
        const runtimeInput: AgentRunInput = {
          ...input,
          requestApproval: (request) => this.requestApproval(record, emit, runtimeKind, request),
        };
        try {
          await runtime.run(runtimeInput, emit, record.controller.signal);
        } catch (error) {
          if (record.controller.signal.aborted) return;
          emit({
            type: "error",
            runtime: runtimeKind,
            agentId: runtimeKind,
            title: `${runtimeKind} failed`,
            text: error instanceof Error ? error.message : String(error),
            status: "failed",
          });
        }
      }));
      if (!record.controller.signal.aborted) {
        const failed = record.snapshot.events.some((event) => event.type === "error");
        record.snapshot.status = failed ? "failed" : "completed";
        emit({
          type: "run_completed",
          title: failed ? "Completed with errors" : "Completed",
          status: failed ? "failed" : "completed",
          details: openOneRunDetails(input.mode, "run_completed"),
        });
      }
    } catch (error) {
      record.snapshot.status = "failed";
      this.rejectPendingApprovals(record);
      emit({
        type: "run_completed",
        title: "Failed",
        text: error instanceof Error ? error.message : String(error),
        status: "failed",
        details: openOneRunDetails(input.mode, "run_completed"),
      });
    }
  }

  private requestApproval(
    record: AgentRunRecord,
    emit: AgentRunEmitter,
    runtime: AgentRuntimeKind,
    request: AgentRuntimeApprovalRequest,
  ): Promise<AgentRunApprovalReply> {
    const approvalId = randomUUID();
    const createdAt = Date.now();
    const approval = {
      id: approvalId,
      runtime,
      agentId: request.agentId,
      title: request.title,
      permission: request.permission,
      patterns: request.patterns,
      metadata: request.metadata,
      createdAt,
    };
    return new Promise<AgentRunApprovalReply>((resolve) => {
      record.approvals.set(approvalId, { resolve });
      emit({
        type: "approval_requested",
        runtime,
        agentId: request.agentId,
        title: request.title,
        status: "pending",
        details: { approval },
      });
    });
  }

  private rejectPendingApprovals(record: AgentRunRecord): void {
    for (const [, approval] of record.approvals) {
      approval.resolve("reject");
    }
    record.approvals.clear();
  }

  private createEmitter(record: AgentRunRecord): AgentRunEmitter {
    return (event) => {
      const seq = record.snapshot.events.length + 1;
      const next: AgentRunEvent = {
        ...event,
        seq,
        runId: record.snapshot.id,
        workspaceId: record.snapshot.workspaceId,
        timestamp: Date.now(),
      };
      record.snapshot.events.push(next);
      record.snapshot.updatedAt = next.timestamp;
      if (event.status === "failed") record.snapshot.status = "failed";
      this.persist(record);
      for (const listener of record.listeners) {
        listener(next);
      }
    };
  }

  private persist(record: AgentRunRecord): void {
    this.store?.upsert(record.snapshot);
  }
}

function normalizedListLimit(value: number | undefined, scopedToSession: boolean): number | undefined {
  if (value === undefined) return scopedToSession ? undefined : 8;
  return Math.max(1, Math.min(value, 200));
}

function runtimesForMode(mode: AgentRunMode): AgentRuntimeKind[] {
  if (mode === "codex") return ["codex"];
  if (mode === "grok-build") return ["grok-build"];
  return ["codex", "grok-build"];
}

function modeTitle(mode: AgentRunMode): string {
  if (mode === "codex") return "Codex run";
  if (mode === "grok-build") return "Grok Build run";
  return "Open One multi-agent run";
}

function openOneRunDetails(mode: AgentRunMode, phase: "run_started" | "run_completed"): Record<string, unknown> {
  return {
    sourceProtocol: "open-one-agent-run",
    sourceType: mode,
    activityKind: mode === "multi-agent" ? "orchestration" : "runtime_run",
    phase,
    mode,
    runtimes: runtimesForMode(mode),
  };
}
