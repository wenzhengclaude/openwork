/** @jsxImportSource react */
import { useMemo } from "react";
import { Braces, Check, Cpu, GitBranch, Hammer, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenworkAgentRun, OpenworkAgentRunEvent, OpenworkAgentRuntimeKind } from "@/app/lib/openwork-server";

type AgentNode = {
  id: string;
  parentId: string | null;
  runtime: OpenworkAgentRuntimeKind | "coordinator";
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: number;
};

export function AgentRunTimeline(props: {
  run: OpenworkAgentRun;
  onCancel?: (runId: string) => void;
}) {
  const nodes = useMemo(() => buildAgentNodes(props.run.events), [props.run.events]);
  const roots = nodes.filter((node) => !node.parentId);
  const childrenByParent = useMemo(() => {
    const next = new Map<string, AgentNode[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const current = next.get(node.parentId) ?? [];
      current.push(node);
      next.set(node.parentId, current);
    }
    return next;
  }, [nodes]);

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-dls-border bg-dls-surface/90 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-dls-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentBadge runtime="coordinator" status={props.run.status === "starting" ? "running" : props.run.status} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-12">{runModeLabel(props.run.mode)}</div>
            <div className="truncate text-xs text-gray-10">{runStatusLabel(props.run.status)}</div>
          </div>
        </div>
        {props.run.status === "running" || props.run.status === "starting" ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dls-border px-2.5 text-xs font-medium text-gray-11 transition-colors hover:bg-gray-2"
            onClick={() => props.onCancel?.(props.run.id)}
          >
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        ) : null}
      </div>
      <div className="space-y-2 px-4 py-3">
        {roots.map((node) => (
          <AgentNodeRow key={node.id} node={node} children={childrenByParent.get(node.id) ?? []} />
        ))}
      </div>
    </section>
  );
}

function AgentNodeRow(props: { node: AgentNode; children: AgentNode[] }) {
  return (
    <div>
      <div className="flex items-start gap-3 rounded-lg px-2 py-2">
        <AgentBadge runtime={props.node.runtime} status={props.node.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-12">{props.node.title}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClass(props.node.status))}>
              {props.node.status}
            </span>
          </div>
          {props.node.summary ? (
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-10">{props.node.summary}</div>
          ) : null}
        </div>
      </div>
      {props.children.length > 0 ? (
        <div className="ml-5 border-l border-dls-border pl-5">
          {props.children.map((child) => (
            <AgentNodeRow key={child.id} node={child} children={[]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentBadge(props: { runtime: AgentNode["runtime"]; status: AgentNode["status"] }) {
  const Icon = iconForRuntime(props.runtime);
  return (
    <div className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-xl border bg-white shadow-sm", badgeClass(props.runtime, props.status))}>
      <Icon size={17} strokeWidth={1.9} />
      <span className={cn("absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-white text-[9px]", statusDotClass(props.status))}>
        {props.status === "completed" ? <Check size={10} /> : props.status === "failed" ? <X size={10} /> : null}
      </span>
    </div>
  );
}

function buildAgentNodes(events: OpenworkAgentRunEvent[]): AgentNode[] {
  const nodes = new Map<string, AgentNode>();
  const coordinator = ensureNode(nodes, {
    id: "coordinator",
    parentId: null,
    runtime: "coordinator",
    title: "Open One Coordinator",
  });
  for (const event of events) {
    if (event.type === "run_started") {
      coordinator.status = "running";
      coordinator.summary = event.title ?? "";
      coordinator.updatedAt = event.timestamp;
      continue;
    }
    if (event.type === "run_completed") {
      coordinator.status = event.status === "failed" || event.status === "cancelled" ? event.status : "completed";
      coordinator.summary = event.title ?? event.text ?? "";
      coordinator.updatedAt = event.timestamp;
      continue;
    }
    const runtime = event.runtime ?? "coordinator";
    const id = event.agentId?.trim() || runtime;
    const node = ensureNode(nodes, {
      id,
      parentId: event.parentAgentId ?? null,
      runtime,
      title: event.title || defaultTitle(runtime),
    });
    node.updatedAt = event.timestamp;
    if (event.title) node.title = event.title;
    if (event.type === "agent_started" || event.type === "child_agent_started") {
      node.status = "running";
    } else if (event.type === "agent_completed" || event.type === "child_agent_completed") {
      node.status = event.status === "failed" ? "failed" : "completed";
    } else if (event.type === "error") {
      node.status = "failed";
    }
    if (event.text) {
      node.summary = appendSummary(node.summary, event.text);
    } else if (event.type === "tool_call" || event.type === "plan") {
      node.summary = event.title ?? node.summary;
    }
  }
  return [...nodes.values()].sort((left, right) => left.updatedAt - right.updatedAt);
}

function ensureNode(
  nodes: Map<string, AgentNode>,
  seed: { id: string; parentId: string | null; runtime: AgentNode["runtime"]; title: string },
): AgentNode {
  const current = nodes.get(seed.id);
  if (current) return current;
  const next: AgentNode = {
    id: seed.id,
    parentId: seed.parentId,
    runtime: seed.runtime,
    title: seed.title,
    status: "pending",
    summary: "",
    updatedAt: 0,
  };
  nodes.set(seed.id, next);
  return next;
}

function appendSummary(current: string, next: string): string {
  const merged = `${current}${next}`.replace(/\s+/g, " ").trim();
  if (merged.length <= 220) return merged;
  return `...${merged.slice(-217)}`;
}

function runModeLabel(mode: OpenworkAgentRun["mode"]): string {
  if (mode === "codex") return "Codex";
  if (mode === "grok-build") return "Grok Build";
  return "Multi-agent collaboration";
}

function runStatusLabel(status: OpenworkAgentRun["status"]): string {
  if (status === "starting") return "Starting runtimes";
  if (status === "running") return "Agents are collaborating";
  if (status === "completed") return "Finished";
  if (status === "cancelled") return "Cancelled";
  return "Needs attention";
}

function defaultTitle(runtime: AgentNode["runtime"]): string {
  if (runtime === "codex") return "Codex";
  if (runtime === "grok-build") return "Grok Build";
  return "Open One Coordinator";
}

function iconForRuntime(runtime: AgentNode["runtime"]) {
  if (runtime === "codex") return Braces;
  if (runtime === "grok-build") return Hammer;
  if (runtime === "coordinator") return GitBranch;
  return Cpu;
}

function badgeClass(runtime: AgentNode["runtime"], status: AgentNode["status"]): string {
  const active = status === "running";
  if (runtime === "codex") return active ? "border-blue-7 text-blue-11 ring-2 ring-blue-4/60" : "border-blue-5 text-blue-10";
  if (runtime === "grok-build") return active ? "border-gray-9 text-gray-12 ring-2 ring-gray-5/70" : "border-gray-6 text-gray-11";
  if (runtime === "coordinator") return active ? "border-violet-7 text-violet-11 ring-2 ring-violet-4/60" : "border-violet-5 text-violet-10";
  return "border-emerald-5 text-emerald-10";
}

function statusClass(status: AgentNode["status"]): string {
  if (status === "running") return "bg-blue-3 text-blue-11";
  if (status === "completed") return "bg-green-3 text-green-11";
  if (status === "failed") return "bg-red-3 text-red-11";
  if (status === "cancelled") return "bg-gray-3 text-gray-11";
  return "bg-amber-3 text-amber-11";
}

function statusDotClass(status: AgentNode["status"]): string {
  if (status === "running") return "bg-blue-9 text-white";
  if (status === "completed") return "bg-green-9 text-white";
  if (status === "failed") return "bg-red-9 text-white";
  if (status === "cancelled") return "bg-gray-9 text-white";
  return "bg-amber-9 text-white";
}
