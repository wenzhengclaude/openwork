import { randomUUID } from "node:crypto";
import { CodexRuntime } from "./runtimes/codex-runtime.js";
import { GrokBuildRuntime } from "./runtimes/grok-build-runtime.js";
import type { AgentRunEmitter, AgentRunEvent, AgentRunInput, AgentRunMode, AgentRunSnapshot, AgentRunStatus, AgentRuntime, AgentRuntimeKind } from "./types.js";

type AgentRunRecord = {
  snapshot: AgentRunSnapshot;
  controller: AbortController;
  listeners: Set<(event: AgentRunEvent) => void>;
};

export class AgentRunManager {
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly runtimes: Record<AgentRuntimeKind, AgentRuntime> = {
    codex: new CodexRuntime(),
    "grok-build": new GrokBuildRuntime(),
  };

  start(input: AgentRunInput): AgentRunSnapshot {
    const id = randomUUID();
    const now = Date.now();
    const record: AgentRunRecord = {
      controller: new AbortController(),
      listeners: new Set(),
      snapshot: {
        id,
        workspaceId: input.workspaceId,
        mode: input.mode,
        approvalMode: input.approvalMode,
        status: "starting",
        prompt: input.prompt,
        model: input.model ?? null,
        modelProvider: input.modelProvider ?? null,
        sessionId: input.sessionId ?? null,
        createdAt: now,
        updatedAt: now,
        events: [],
      },
    };
    this.runs.set(id, record);
    const emit = this.createEmitter(record);
    emit({ type: "run_started", title: modeTitle(input.mode), status: "running" });
    void this.runAll(input, record, emit);
    return record.snapshot;
  }

  get(runId: string): AgentRunSnapshot | null {
    return this.runs.get(runId)?.snapshot ?? null;
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
    record.snapshot.status = "cancelled";
    this.createEmitter(record)({ type: "run_completed", title: "Cancelled", status: "cancelled" });
    return true;
  }

  private async runAll(input: AgentRunInput, record: AgentRunRecord, emit: AgentRunEmitter): Promise<void> {
    record.snapshot.status = "running";
    const selected = runtimesForMode(input.mode);
    try {
      await Promise.all(selected.map(async (runtimeKind) => {
        const runtime = this.runtimes[runtimeKind];
        try {
          await runtime.run(input, emit, record.controller.signal);
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
        });
      }
    } catch (error) {
      record.snapshot.status = "failed";
      emit({
        type: "run_completed",
        title: "Failed",
        text: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    }
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
      for (const listener of record.listeners) {
        listener(next);
      }
    };
  }
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
