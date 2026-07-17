export type AgentRuntimeKind = "codex" | "grok-build";

export type AgentRunMode = AgentRuntimeKind | "multi-agent";

export type AgentRunStatus = "starting" | "running" | "completed" | "cancelled" | "failed";

export type AgentRunEventType =
  | "run_started"
  | "agent_started"
  | "agent_completed"
  | "child_agent_started"
  | "child_agent_completed"
  | "message_delta"
  | "thought_delta"
  | "tool_call"
  | "plan"
  | "log"
  | "error"
  | "run_completed";

export type AgentRunEvent = {
  seq: number;
  runId: string;
  workspaceId: string;
  type: AgentRunEventType;
  timestamp: number;
  runtime?: AgentRuntimeKind;
  agentId?: string;
  parentAgentId?: string;
  title?: string;
  text?: string;
  status?: AgentRunStatus | "pending" | "running" | "completed" | "failed";
  details?: Record<string, unknown>;
};

export type AgentRunInput = {
  workspaceId: string;
  workspacePath: string;
  mode: AgentRunMode;
  prompt: string;
  model?: string;
};

export type AgentRunSnapshot = {
  id: string;
  workspaceId: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  prompt: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  events: AgentRunEvent[];
};

export type AgentRunEmitter = (event: Omit<AgentRunEvent, "seq" | "runId" | "workspaceId" | "timestamp">) => void;

export interface AgentRuntime {
  readonly kind: AgentRuntimeKind;
  run(input: AgentRunInput, emit: AgentRunEmitter, signal: AbortSignal): Promise<void>;
}
