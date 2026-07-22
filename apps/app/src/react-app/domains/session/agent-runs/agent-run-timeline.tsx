/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { AlertCircle, Braces, Check, ChevronDown, ChevronRight, Cpu, FilePen, GitBranch, Hammer, Sparkles, Square, SquareTerminal, X } from "lucide-react";
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool";
import { cn } from "@/lib/utils";
import type { OpenworkAgentRun, OpenworkAgentRunEvent, OpenworkAgentRuntimeKind } from "@/app/lib/openwork-server";
import {
  createDiffReviewFile,
  diffReviewId,
  diffReviewLabel,
  normalizeDiffReviewFiles,
  type DiffReviewFile,
  type DiffReviewRequest,
} from "../review/diff-review";

type AgentRunTimelineProps = {
  run: OpenworkAgentRun;
  onCancel?: (runId: string) => void;
  onOpenDiffReview?: (review: DiffReviewRequest) => void;
};

type AgentNode = {
  id: string;
  parentId: string | null;
  runtime: OpenworkAgentRuntimeKind | "coordinator";
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: number;
  order: number;
};

type TimelineEvent = {
  id: string;
  runtime: OpenworkAgentRuntimeKind | "coordinator";
  title: string;
  text: string;
  status: AgentNode["status"];
};

type SingleActivityRow =
  | {
    kind: "heading";
    id: string;
    title: string;
    text: string;
  }
  | {
    kind: "item";
    id: string;
    title: string;
    text: string;
    status: AgentNode["status"];
    variant: "skill" | "command" | "tool" | "log" | "error" | "approval" | "file_edit";
    command: string;
    cwd: string;
    detail: string;
    path?: string;
    diff?: string;
  };

type SingleActivityItemRow = Extract<SingleActivityRow, { kind: "item" }>;

type SingleActivityRenderRow =
  | SingleActivityRow
  | {
    kind: "group";
    id: string;
    title: string;
    text: string;
    items: SingleActivityItemRow[];
    defaultOpen: boolean;
  };

export function AgentRunTimeline(props: AgentRunTimelineProps) {
  if (props.run.mode !== "multi-agent") {
    return <SingleAgentRunTimeline {...props} />;
  }
  return <MultiAgentRunTimeline {...props} />;
}

function SingleAgentRunTimeline(props: AgentRunTimelineProps) {
  const rows = useMemo(() => buildSingleActivityRenderRows(props.run.events), [props.run.events]);
  const isRunning = props.run.status === "running" || props.run.status === "starting";
  if (rows.length === 0) return null;

  return (
    <section className="relative space-y-5 py-1 text-gray-10" aria-live="polite">
      {isRunning ? (
        <button
          type="button"
          className="absolute right-0 top-0 inline-flex size-7 items-center justify-center rounded-full text-gray-9 transition-colors hover:bg-gray-2 hover:text-gray-12"
          onClick={() => props.onCancel?.(props.run.id)}
          title="停止"
          aria-label="停止"
        >
          <Square size={11} fill="currentColor" />
        </button>
      ) : null}
      <div className="space-y-5 pr-9">
        {rows.map((row) => row.kind === "heading" ? (
          <div key={row.id} className="space-y-1">
            <div className="text-[15px] font-semibold leading-6 text-gray-11">{row.title}</div>
            {row.text ? <div className="whitespace-pre-wrap text-sm leading-6 text-gray-9">{row.text}</div> : null}
          </div>
        ) : row.kind === "group" ? (
          <SingleActivityGroup key={row.id} row={row} onOpenDiffReview={props.onOpenDiffReview} />
        ) : (
          <SingleActivityItem key={row.id} row={row} onOpenDiffReview={props.onOpenDiffReview} />
        ))}
      </div>
    </section>
  );
}

function SingleActivityGroup(props: {
  row: Extract<SingleActivityRenderRow, { kind: "group" }>;
  onOpenDiffReview?: (review: DiffReviewRequest) => void;
}) {
  const [open, setOpen] = useState(props.row.defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const reviewFiles = diffReviewFilesFromRows(props.row.items);
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[15px] font-semibold leading-6 text-gray-9 transition-colors hover:text-gray-11"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <span className="min-w-0 truncate">{props.row.title}</span>
          <Chevron className="size-4 shrink-0" strokeWidth={1.8} />
        </button>
        {reviewFiles.length > 0 ? (
          <ReviewButton
            onClick={() => openDiffReview(props.onOpenDiffReview, "agent-group", reviewFiles)}
          />
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2">
          {props.row.text ? <div className="whitespace-pre-wrap text-sm leading-6 text-gray-9">{props.row.text}</div> : null}
          {props.row.items.map((item) => <SingleActivityItem key={item.id} row={item} compact onOpenDiffReview={props.onOpenDiffReview} />)}
        </div>
      ) : null}
    </div>
  );
}

function SingleActivityItem(props: {
  row: SingleActivityItemRow;
  compact?: boolean;
  onOpenDiffReview?: (review: DiffReviewRequest) => void;
}) {
  if (props.row.variant === "file_edit") {
    return <FileEditActivityItem row={props.row} onOpenDiffReview={props.onOpenDiffReview} />;
  }
  const Icon = singleActivityIcon(props.row.variant);
  const expandable = singleActivityExpandable(props.row);
  const showIcon = props.row.variant !== "skill";
  if (!expandable) {
    return (
      <div className={cn("flex min-w-0 items-start text-gray-9", showIcon ? "gap-3" : "")}>
        {showIcon ? (
          <Icon className={cn("mt-1 size-4 shrink-0", singleActivityIconClass(props.row.variant, props.row.status))} strokeWidth={1.9} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className={cn("line-clamp-1 text-[15px] leading-6", props.row.variant === "error" ? "text-red-11" : "text-gray-10")}>
            {props.row.title}
          </div>
          {props.row.text ? <div className="line-clamp-1 text-sm leading-5 text-gray-8">{props.row.text}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger leftIcon={<Icon className={cn("size-4", singleActivityIconClass(props.row.variant, props.row.status))} strokeWidth={1.9} />}>
          <span className="flex min-w-0 gap-2">
            <span className={cn("shrink-0", props.row.variant === "error" ? "text-red-11" : "text-gray-10")}>{props.row.title}</span>
            {props.row.text ? <span className="min-w-0 grow truncate text-gray-8">{props.row.text}</span> : null}
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="mt-1 overflow-hidden rounded-lg border border-border/70 bg-muted/70 p-1.5">
          <div
            aria-label="Agent tool details"
            className="max-h-72 overflow-auto rounded-md bg-background/70 font-mono text-[12px] leading-5 [scrollbar-gutter:stable_both-edges]"
          >
            {props.row.command ? (
              <pre className="m-0 min-w-max whitespace-pre px-3 py-2 text-foreground">$ {props.row.command}</pre>
            ) : (
              <pre className="m-0 min-w-max whitespace-pre px-3 py-2 text-foreground">{props.row.title}</pre>
            )}
            {props.row.cwd ? (
              <pre className="m-0 min-w-max border-t border-border/60 px-3 py-2 whitespace-pre text-muted-foreground">cwd: {props.row.cwd}</pre>
            ) : null}
            {props.row.detail ? (
              <pre className="m-0 min-w-max border-t border-border/60 px-3 py-2 whitespace-pre text-muted-foreground">
                {props.row.detail}
              </pre>
            ) : null}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  );
}

function FileEditActivityItem(props: {
  row: SingleActivityItemRow;
  onOpenDiffReview?: (review: DiffReviewRequest) => void;
}) {
  const stats = diffStats(props.row.diff ?? "");
  const expandable = singleActivityExpandable(props.row);
  const reviewFiles = diffReviewFilesFromRows([props.row]);
  if (!expandable) {
    return (
      <div className="flex min-w-0 items-start gap-3 text-gray-9">
        <FilePen className={cn("mt-1 size-4 shrink-0", singleActivityIconClass(props.row.variant, props.row.status))} strokeWidth={1.9} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-[15px] leading-6 text-gray-10">{props.row.title}</div>
          {props.row.text ? <div className="line-clamp-1 text-sm leading-5 text-gray-8">{props.row.text}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CollapsibleToolTrigger
            className="min-w-0 flex-1"
            leftIcon={<FilePen className={cn("size-4", singleActivityIconClass(props.row.variant, props.row.status))} strokeWidth={1.9} />}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-gray-10">{props.row.title}</span>
              {props.row.path ? <span className="min-w-0 grow truncate text-gray-8">{props.row.path}</span> : null}
              {stats.additions > 0 ? <span className="shrink-0 text-xs text-green-10">+{stats.additions}</span> : null}
              {stats.deletions > 0 ? <span className="shrink-0 text-xs text-red-10">-{stats.deletions}</span> : null}
            </span>
          </CollapsibleToolTrigger>
          {reviewFiles.length > 0 ? (
            <ReviewButton
              onClick={() => openDiffReview(props.onOpenDiffReview, "agent-file", reviewFiles)}
            />
          ) : null}
        </div>
        <CollapsibleToolContent className="mt-1 overflow-hidden rounded-lg border border-border/70 bg-muted/70 p-1.5">
          {props.row.diff ? (
            <DiffBlock diff={props.row.diff} path={props.row.path ?? props.row.text} />
          ) : (
            <div className="rounded-md bg-background/70 px-3 py-2 text-sm text-gray-9">{props.row.text || props.row.detail}</div>
          )}
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  );
}

function DiffBlock(props: { diff: string; path: string }) {
  const lines = props.diff.split("\n");
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background/80">
      {props.path ? (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 font-mono text-xs text-gray-9">
          <span className="min-w-0 truncate">{props.path}</span>
          <DiffStats diff={props.diff} />
        </div>
      ) : null}
      <div className="max-h-72 overflow-auto font-mono text-[12px] leading-5 [scrollbar-gutter:stable_both-edges]">
        {lines.map((line, index) => (
          <div key={`${index}:${line}`} className={cn("grid min-w-max grid-cols-[3.5rem_1fr]", diffLineClass(line))}>
            <span className="select-none border-r border-border/50 px-2 text-right text-gray-7">{index + 1}</span>
            <span className="whitespace-pre px-3">{line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffStats(props: { diff: string }) {
  const stats = diffStats(props.diff);
  if (stats.additions === 0 && stats.deletions === 0) return null;
  return (
    <span className="shrink-0">
      <span className="text-green-10">+{stats.additions}</span>
      <span className="ml-1 text-red-10">-{stats.deletions}</span>
    </span>
  );
}

function ReviewButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-gray-9 shadow-sm transition-colors hover:bg-gray-2 hover:text-gray-12"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick();
      }}
    >
      审阅
    </button>
  );
}

function diffReviewFilesFromRows(rows: SingleActivityItemRow[]): DiffReviewFile[] {
  return normalizeDiffReviewFiles(rows.flatMap((row) => {
    if (row.variant !== "file_edit" || !row.diff) return [];
    return [createDiffReviewFile({
      id: row.id,
      path: row.path || row.text || row.title,
      diff: row.diff,
    })];
  }));
}

function openDiffReview(
  onOpenDiffReview: ((review: DiffReviewRequest) => void) | undefined,
  idPrefix: string,
  files: DiffReviewFile[],
) {
  const normalizedFiles = normalizeDiffReviewFiles(files);
  if (normalizedFiles.length === 0) return;
  onOpenDiffReview?.({
    id: diffReviewId(idPrefix, normalizedFiles),
    label: diffReviewLabel(normalizedFiles),
    files: normalizedFiles,
  });
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "bg-blue-2/60 text-blue-11";
  if (line.startsWith("+++") || line.startsWith("---")) return "bg-gray-2/70 text-gray-9";
  if (line.startsWith("+")) return "bg-green-2/70 text-green-11";
  if (line.startsWith("-")) return "bg-red-2/70 text-red-11";
  return "text-gray-11";
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function buildSingleActivityRenderRows(events: OpenworkAgentRunEvent[]): SingleActivityRenderRow[] {
  return groupSingleActivityRows(buildSingleActivityRows(events));
}

function MultiAgentRunTimeline(props: AgentRunTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const nodes = useMemo(() => buildAgentNodes(props.run.events), [props.run.events]);
  const events = useMemo(() => buildTimelineEvents(props.run.events), [props.run.events]);
  const roots = nodes.filter((node) => !node.parentId);
  const coordinatorRoot = props.run.mode === "multi-agent"
    ? roots.find((node) => node.runtime === "coordinator") ?? null
    : null;
  const agentRoots = roots.filter((node) => node.runtime !== "coordinator");
  const runStatus = props.run.status === "starting" ? "running" : props.run.status;
  const headerRuntime = headerRuntimeForMode(props.run.mode);
  const chipNodes = useMemo(
    () => visibleChipNodes(props.run.mode, nodes, runStatus),
    [nodes, props.run.mode, runStatus],
  );
  const visibleChips = chipNodes.slice(0, 4);
  const hiddenChipCount = Math.max(0, chipNodes.length - visibleChips.length);
  const statusLabels = runStatusLabels(props.run, nodes);
  const primaryStatusLabel = statusLabels[0] ?? null;
  const secondaryStatusLabels = statusLabels.slice(1);
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
    <section className="space-y-2" aria-live="polite">
      <div className="flex min-w-0 items-start gap-2 text-xs text-gray-10">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {visibleChips.map((node) => (
            <button
              key={node.id}
              type="button"
              className={cn(
                "inline-flex h-8 max-w-[15rem] items-center gap-2 rounded-full border bg-dls-surface px-2.5 text-left shadow-sm transition-colors hover:bg-gray-2",
                chipClass(node.status),
              )}
              onClick={() => setExpanded((current) => !current)}
              title={`${node.title} ${nodeStatusLabel(node.status)}`}
              aria-expanded={expanded}
            >
              <AgentChipIcon runtime={node.runtime} status={node.status} />
              <span className="min-w-0 truncate text-sm text-gray-11">{node.title}</span>
            </button>
          ))}
          {hiddenChipCount > 0 ? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-full border border-dls-border bg-dls-surface px-2.5 text-sm text-gray-10 shadow-sm transition-colors hover:bg-gray-2"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
            >
              +{hiddenChipCount}
            </button>
          ) : null}
          {primaryStatusLabel ? <RunStatusPill label={primaryStatusLabel} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.run.status === "running" || props.run.status === "starting" ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full text-gray-9 transition-colors hover:bg-gray-2 hover:text-gray-12"
              onClick={() => props.onCancel?.(props.run.id)}
              title="停止"
              aria-label="停止"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-full text-gray-9 transition-colors hover:bg-gray-2 hover:text-gray-12"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            title={expanded ? "收起协作详情" : "展开协作详情"}
            aria-label={expanded ? "收起协作详情" : "展开协作详情"}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>
      </div>
      {secondaryStatusLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          {secondaryStatusLabels.map((label) => (
            <RunStatusPill key={label} label={label} />
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface/95 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 border-b border-dls-border px-3 py-2">
            <AgentBadge runtime={headerRuntime} status={runStatus} compact />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-12">{runModeLabel(props.run.mode)}</div>
              <div className="text-xs text-gray-9">{runStatusLabel(props.run.status, props.run.mode)}</div>
            </div>
          </div>
          <div className="space-y-2 px-4 py-3">
            {coordinatorRoot ? (
              <AgentNodeRow node={coordinatorRoot} children={childrenByParent.get(coordinatorRoot.id) ?? []} />
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {agentRoots.map((node) => (
                <AgentNodeRow key={node.id} node={node} children={childrenByParent.get(node.id) ?? []} />
              ))}
            </div>
            {events.length > 0 ? (
              <div className="mt-3 space-y-1.5 border-t border-dls-border pt-3">
                {events.map((event) => (
                  <TimelineEventRow key={event.id} event={event} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildSingleActivityRows(events: OpenworkAgentRunEvent[]): SingleActivityRow[] {
  const rows: SingleActivityRow[] = [];
  const itemIndexByKey = new Map<string, number>();
  const addHeading = (id: string, title: string, text = "") => {
    if (!title.trim()) return;
    rows.push({ kind: "heading", id, title: compactText(title), text: compactTextBlock(text) });
  };
  const upsertItem = (key: string, row: Extract<SingleActivityRow, { kind: "item" }>) => {
    const currentIndex = itemIndexByKey.get(key);
    if (currentIndex === undefined) {
      itemIndexByKey.set(key, rows.length);
      rows.push(row);
      return;
    }
    const current = rows[currentIndex];
    if (current?.kind !== "item") return;
    if (current.variant === "file_edit" && current.diff && row.variant === "file_edit" && !row.diff) {
      rows[currentIndex] = {
        ...row,
        detail: row.detail || current.detail,
        diff: current.diff,
        path: row.path || current.path,
        text: row.text || current.text,
      };
      return;
    }
    rows[currentIndex] = row;
  };

  for (const event of events) {
    if (event.type === "tool_call") {
      const rawTitle = cleanToolTitle(event.title ?? "");
      if (!rawTitle) continue;
      if (isBareGrokToolName(rawTitle, event)) continue;
      const variant = singleActivityVariant(event);
      const command = singleActivityCommand(event, rawTitle, variant);
      upsertItem(singleActivityKey(event), {
        kind: "item",
        id: `${event.seq}:${event.type}`,
        title: singleActivityTitle(event, rawTitle, variant, command),
        text: singleActivityText(event, variant),
        status: eventStatus(event),
        variant,
        command,
        cwd: readDetailString(event.details, "cwd"),
        detail: singleActivityDetail(event, variant),
        path: singleActivityPath(event),
        diff: singleActivityDiff(event),
      });
      continue;
    }
    if (event.type === "plan") {
      addHeading(`${event.seq}:plan`, event.title || "Planning", event.text ?? "");
      continue;
    }
    if (event.type === "approval_requested") {
      upsertItem(singleActivityKey(event), {
        kind: "item",
        id: `${event.seq}:${event.type}`,
        title: event.title || "Requested approval",
        text: compactText(event.text ?? approvalPatternsText(event)),
        status: "pending",
        variant: "approval",
        command: "",
        cwd: "",
        detail: approvalPatternsText(event),
      });
      continue;
    }
    if (event.type === "error") {
      upsertItem(singleActivityKey(event), {
        kind: "item",
        id: `${event.seq}:${event.type}`,
        title: event.title || "Agent error",
        text: compactText(event.text ?? ""),
        status: "failed",
        variant: "error",
        command: "",
        cwd: "",
        detail: event.text ?? "",
      });
    }
  }
  return rows;
}

function groupSingleActivityRows(rows: SingleActivityRow[]): SingleActivityRenderRow[] {
  const result: SingleActivityRenderRow[] = [];
  let heading: Extract<SingleActivityRow, { kind: "heading" }> | null = null;
  let items: SingleActivityItemRow[] = [];

  const flush = () => {
    if (!heading) {
      pushUngroupedActivityItems(result, items);
      items = [];
      return;
    }
    if (items.length === 0) {
      result.push(heading);
    } else {
      result.push({
        kind: "group",
        id: heading.id,
        title: heading.title,
        text: heading.text,
        items,
        defaultOpen: groupDefaultOpen(items),
      });
    }
    heading = null;
    items = [];
  };

  for (const row of rows) {
    if (row.kind === "heading") {
      flush();
      heading = row;
      continue;
    }
    if (heading) {
      items.push(row);
      continue;
    }
    items.push(row);
  }
  flush();
  return result;
}

function pushUngroupedActivityItems(result: SingleActivityRenderRow[], items: SingleActivityItemRow[]): void {
  let executable: SingleActivityItemRow[] = [];
  let fileEdits: SingleActivityItemRow[] = [];
  const flushExecutable = () => {
    if (executable.length === 0) return;
    if (executable.length === 1) {
      result.push(executable[0]);
    } else {
      result.push({
        kind: "group",
        id: `command-group:${executable[0]?.id ?? result.length}`,
        title: `运行了 ${executable.length} 个工具调用`,
        text: "",
        items: executable,
        defaultOpen: groupDefaultOpen(executable),
      });
    }
    executable = [];
  };
  const flushFileEdits = () => {
    if (fileEdits.length === 0) return;
    if (fileEdits.length === 1) {
      result.push(fileEdits[0]);
    } else {
      result.push({
        kind: "group",
        id: `file-edit-group:${fileEdits[0]?.id ?? result.length}`,
        title: fileEditGroupTitle(fileEdits),
        text: "",
        items: fileEdits,
        defaultOpen: groupDefaultOpen(fileEdits),
      });
    }
    fileEdits = [];
  };

  for (const item of items) {
    if (isFileEditActivityItem(item)) {
      flushExecutable();
      fileEdits.push(item);
      continue;
    }
    if (isExecutableActivityItem(item)) {
      flushFileEdits();
      executable.push(item);
      continue;
    }
    flushFileEdits();
    flushExecutable();
    result.push(item);
  }
  flushFileEdits();
  flushExecutable();
}

function groupDefaultOpen(items: SingleActivityItemRow[]): boolean {
  return items.some((item) => item.status === "running" || item.status === "pending" || item.status === "failed");
}

function isExecutableActivityItem(item: SingleActivityItemRow): boolean {
  return item.variant === "command" || item.variant === "tool";
}

function isFileEditActivityItem(item: SingleActivityItemRow): boolean {
  return item.variant === "file_edit";
}

function fileEditGroupTitle(items: SingleActivityItemRow[]): string {
  const stats = items.reduce(
    (total, item) => {
      const next = diffStats(item.diff ?? "");
      return {
        additions: total.additions + next.additions,
        deletions: total.deletions + next.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
  const suffix = stats.additions > 0 || stats.deletions > 0 ? ` +${stats.additions} -${stats.deletions}` : "";
  return `已编辑 ${items.length} 个文件${suffix}`;
}

function isSkillActivityEvent(event: OpenworkAgentRunEvent): boolean {
  if (activitySkillName(event)) return true;
  const itemType = readDetailString(event.details, "itemType");
  const tool = readDetailString(event.details, "tool").toLowerCase();
  return itemType === "dynamicToolCall" && tool === "skill";
}

function activitySkillName(event: OpenworkAgentRunEvent): string {
  return readDetailString(event.details, "skill");
}

function singleActivityKey(event: OpenworkAgentRunEvent): string {
  const title = event.title?.trim() ?? "";
  if (event.type === "tool_call") {
    const activityKind = readDetailString(event.details, "activityKind");
    const path = singleActivityPath(event);
    if (isFileEditActivityKind(activityKind) && path) {
      return `${event.runtime ?? "agent"}:${event.type}:${activityKind}:${normalizeActivityKey(path)}`;
    }
    const skill = activitySkillName(event);
    if (skill) return `${event.runtime ?? "agent"}:${event.type}:skill:${normalizeActivityKey(skill)}`;
    const itemType = readDetailString(event.details, "itemType");
    const command = readDetailString(event.details, "command") || title;
    if ((itemType === "commandExecution" || isCommandLikeTitle(title)) && command) {
      return `${event.runtime ?? "agent"}:${event.type}:command:${normalizeCommandKey(command)}`;
    }
  }
  const itemId = readDetailString(event.details, "itemId");
  if (itemId) return `${event.runtime ?? "agent"}:${event.type}:${itemId}`;
  if (event.type === "tool_call" && title) return `${event.runtime ?? "agent"}:${event.type}:${title}`;
  return `${event.seq}:${event.type}`;
}

function singleActivityVariant(event: OpenworkAgentRunEvent): Extract<SingleActivityRow, { kind: "item" }>["variant"] {
  if (event.type === "error") return "error";
  if (event.type === "approval_requested") return "approval";
  if (event.type === "log") return "log";
  const itemType = readDetailString(event.details, "itemType");
  const title = event.title ?? "";
  if (isFileEditActivityKind(readDetailString(event.details, "activityKind")) || itemType === "fileChange") return "file_edit";
  if (readDetailString(event.details, "command")) return "command";
  if (itemType === "commandExecution" || isCommandLikeTitle(title)) return "command";
  if (isSkillActivityEvent(event)) return "skill";
  return "tool";
}

function singleActivityTitle(
  event: OpenworkAgentRunEvent,
  rawTitle: string,
  variant: SingleActivityItemRow["variant"],
  command: string,
): string {
  if (variant === "command") return commandDisplayTitle(command || rawTitle);
  if (variant === "file_edit") return "已编辑的文件";
  if (variant === "skill") {
    const skill = activitySkillName(event);
    return skill ? `Load skill ${skill}` : rawTitle;
  }
  return rawTitle;
}

function singleActivityText(event: OpenworkAgentRunEvent, variant: Extract<SingleActivityRow, { kind: "item" }>["variant"]): string {
  if (variant === "skill") return "";
  if (variant === "file_edit") return compactText(singleActivityPath(event) || event.text || "");
  if (variant === "command") return compactText(readDetailString(event.details, "cwd") || event.text || "");
  return compactText(event.text ?? "");
}

function singleActivityCommand(
  event: OpenworkAgentRunEvent,
  title: string,
  variant: Extract<SingleActivityRow, { kind: "item" }>["variant"],
): string {
  if (variant !== "command") return "";
  return readDetailString(event.details, "command") || extractFriendlyCommand(title);
}

function singleActivityDetail(event: OpenworkAgentRunEvent, variant: Extract<SingleActivityRow, { kind: "item" }>["variant"]): string {
  if (variant === "command") {
    const text = event.text ?? "";
    const cwd = readDetailString(event.details, "cwd");
    return text && text !== cwd ? text : "";
  }
  if (variant === "file_edit") return singleActivityDiff(event) || event.text || "";
  if (variant === "tool") return event.text ?? "";
  return "";
}

function singleActivityPath(event: OpenworkAgentRunEvent): string {
  return readDetailString(event.details, "path") || readDetailString(event.details, "file") || readDetailString(event.details, "filePath");
}

function singleActivityDiff(event: OpenworkAgentRunEvent): string {
  return readDetailString(event.details, "diff") || readDetailString(event.details, "patch");
}

function isFileEditActivityKind(activityKind: string): boolean {
  return activityKind === "file_write" || activityKind === "file_edit";
}

function singleActivityExpandable(row: Extract<SingleActivityRow, { kind: "item" }>): boolean {
  if (row.variant === "skill") return false;
  if (row.variant === "file_edit") return Boolean(row.diff || row.path || row.detail);
  return Boolean(row.command || row.cwd || row.detail);
}

function singleActivityIcon(variant: Extract<SingleActivityRow, { kind: "item" }>["variant"]) {
  if (variant === "skill") return Sparkles;
  if (variant === "file_edit") return FilePen;
  if (variant === "command") return SquareTerminal;
  if (variant === "error") return AlertCircle;
  if (variant === "approval") return Check;
  return SquareTerminal;
}

function singleActivityIconClass(
  variant: Extract<SingleActivityRow, { kind: "item" }>["variant"],
  status: AgentNode["status"],
): string {
  if (variant === "error" || status === "failed") return "text-red-10";
  if (variant === "skill") return "text-gray-9";
  if (variant === "file_edit") return "text-gray-8";
  if (variant === "approval") return "text-amber-10";
  if (status === "completed") return "text-gray-8";
  return "text-gray-9";
}

function isCommandLikeTitle(title: string): boolean {
  const normalized = title.trim();
  if (!normalized) return false;
  if (/^(?:Execute|Run|Ran)\s+[`"']/i.test(normalized)) return true;
  return /^(?:\$env:|powershell|pwsh|cmd(?:\.exe)?|python|node|bun|pnpm|npm|git|rg|dir|Get-Content|Get-ChildItem|Invoke-)/i.test(normalized)
    || /\s-(?:NoProfile|ExecutionPolicy|Command|File)\b/i.test(normalized);
}

function commandDisplayTitle(command: string): string {
  const display = compactText(extractFriendlyCommand(command));
  return display ? `Ran ${display}` : "Ran command";
}

function extractFriendlyCommand(command: string): string {
  const trimmed = command.trim();
  const actionCommand = extractActionCommand(trimmed);
  if (actionCommand) return actionCommand;
  const powerShellCommand = extractPowerShellCommand(trimmed);
  if (powerShellCommand) return powerShellCommand;
  return trimmed;
}

function extractActionCommand(command: string): string {
  const backtick = command.match(/^(?:Execute|Run|Ran)\s+`([^`]+)`/i);
  if (backtick?.[1]) return backtick[1].trim();
  const quoted = command.match(/^(?:Execute|Run|Ran)\s+["']([^"']+)["']/i);
  if (quoted?.[1]) return quoted[1].trim();
  return "";
}

function extractPowerShellCommand(command: string): string {
  const match = command.match(/\s-Command\s+([\s\S]+)$/i);
  const value = match?.[1]?.trim() ?? "";
  if (!value) return "";
  return stripMatchingQuotes(value);
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeCommandKey(command: string): string {
  return normalizeActivityKey(extractFriendlyCommand(command).replace(/run_[a-z0-9]+/gi, "run_*"));
}

function normalizeActivityKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isBareGrokToolName(title: string, event: OpenworkAgentRunEvent): boolean {
  if (event.runtime !== "grok-build") return false;
  if (readDetailString(event.details, "command") || readDetailString(event.details, "path")) return false;
  return title === "read_file" || title === "run_terminal_command" || title === "read_text_file" || title === "write_file";
}

function approvalPatternsText(event: OpenworkAgentRunEvent): string {
  const details = event.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return "";
  const approval = details.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return "";
  if (!("patterns" in approval) || !Array.isArray(approval.patterns)) return "";
  return approval.patterns.filter((item): item is string => typeof item === "string").join(", ");
}

function compactTextBlock(value: string): string {
  const normalized = previewText(value);
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 237)}...`;
}

function RunStatusPill(props: { label: string }) {
  return (
    <span className={cn("inline-flex h-8 items-center rounded-full border px-2.5 text-sm font-medium", runStatusPillClass(props.label))}>
      {props.label}
    </span>
  );
}

function runStatusPillClass(label: string) {
  if (label.includes("审批")) return "border-amber-6/40 bg-amber-2/60 text-amber-11";
  if (label.includes("开始")) return "border-green-6/40 bg-green-2/60 text-green-11";
  if (label.includes("思考") || label.includes("准备")) return "border-blue-6/40 bg-blue-2/60 text-blue-11";
  return "border-dls-border bg-dls-surface text-gray-10";
}

function AgentNodeRow(props: { node: AgentNode; children: AgentNode[] }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-1/60">
      <div className="flex items-start gap-3 px-2 py-2">
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
        <div className="ml-5 border-l border-dls-border pl-4">
          {props.children.map((child) => (
            <AgentNodeRow key={child.id} node={child} children={[]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimelineEventRow(props: { event: TimelineEvent }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-xs text-gray-10">
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", statusMarkerClass(props.event.status))} />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-gray-11">{props.event.title}</span>
        {props.event.text ? <span className="ml-1 line-clamp-1 text-gray-9">{props.event.text}</span> : null}
      </div>
    </div>
  );
}

function AgentChipIcon(props: { runtime: AgentNode["runtime"]; status: AgentNode["status"] }) {
  const Icon = iconForRuntime(props.runtime);
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", chipIconClass(props.status))}>
      <Icon size={13} strokeWidth={2} />
    </span>
  );
}

function AgentBadge(props: { runtime: AgentNode["runtime"]; status: AgentNode["status"]; compact?: boolean }) {
  const Icon = iconForRuntime(props.runtime);
  return (
    <div className={cn("relative flex shrink-0 items-center justify-center rounded-lg border bg-white shadow-sm", props.compact ? "size-8" : "size-9", badgeClass(props.runtime, props.status))}>
      <Icon size={props.compact ? 15 : 17} strokeWidth={1.9} />
      <span className={cn("absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-white text-[9px]", statusDotClass(props.status))}>
        {props.status === "completed" ? <Check size={10} /> : props.status === "failed" ? <X size={10} /> : null}
      </span>
    </div>
  );
}

function visibleChipNodes(
  mode: OpenworkAgentRun["mode"],
  nodes: AgentNode[],
  runStatus: AgentNode["status"],
): AgentNode[] {
  const childNodes = nodes
    .filter((node) => node.parentId && !isPlaceholderSubagent(node))
    .sort(compareAgentNodes);
  if (childNodes.length > 0) return childNodes;

  const expected = expectedAgentNodes(mode, runStatus);
  const rootAgentNodes = nodes
    .filter((node) => !node.parentId && node.runtime !== "coordinator")
    .sort(compareAgentNodes);
  if (rootAgentNodes.length === 0) return expected;

  const rootByRuntime = new Map(rootAgentNodes.map((node) => [node.runtime, node]));
  const expectedRuntimeNodes = expected.map((node) => rootByRuntime.get(node.runtime) ?? node);
  const expectedRuntimes = new Set(expected.map((node) => node.runtime));
  const extraRootNodes = rootAgentNodes.filter((node) => node.runtime !== "coordinator" && !expectedRuntimes.has(node.runtime));
  return [...expectedRuntimeNodes, ...extraRootNodes];
}

function expectedAgentNodes(mode: OpenworkAgentRun["mode"], runStatus: AgentNode["status"]): AgentNode[] {
  const expectedRuntimes = expectedRuntimesForMode(mode);
  return expectedRuntimes.map((runtime, index) => ({
    id: `expected:${runtime}`,
    parentId: null,
    runtime,
    title: defaultTitle(runtime),
    status: runStatus === "running" ? "running" : runStatus,
    summary: "",
    updatedAt: 0,
    order: index,
  }));
}

function expectedRuntimesForMode(mode: OpenworkAgentRun["mode"]): OpenworkAgentRuntimeKind[] {
  if (mode === "codex") return ["codex"];
  if (mode === "grok-build") return ["grok-build"];
  return ["codex", "grok-build"];
}

function runStatusLabels(run: OpenworkAgentRun, nodes: AgentNode[]): string[] {
  const status = run.status === "starting" ? "running" : run.status;
  if (hasPendingApproval(run.events)) return ["等待审批"];
  if (status === "running") {
    const hasRunningNode = nodes.some((node) => node.runtime !== "coordinator" && node.status === "running");
    if (run.mode === "multi-agent") return hasRunningNode ? ["协作中", "正在处理"] : ["准备协作"];
    return hasRunningNode ? ["已开始工作", "正在思考"] : ["准备中"];
  }
  return [runStatusLabel(status, run.mode)];
}

function hasPendingApproval(events: OpenworkAgentRunEvent[]): boolean {
  const pending = new Set<string>();
  for (const event of events) {
    if (event.type === "approval_requested") {
      const approvalId = readApprovalId(event);
      pending.add(approvalId || `${event.seq}`);
      continue;
    }
    if (event.type === "approval_resolved") {
      const approvalId = readDetailString(event.details, "approvalId");
      if (approvalId) pending.delete(approvalId);
    }
  }
  return pending.size > 0;
}

function readApprovalId(event: OpenworkAgentRunEvent): string {
  const details = event.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return "";
  const approval = details.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return "";
  if (!("id" in approval)) return "";
  const id = approval.id;
  return typeof id === "string" ? id.trim() : "";
}

function readDetailString(details: OpenworkAgentRunEvent["details"], key: string): string {
  if (!details) return "";
  const value = details[key];
  return typeof value === "string" ? value.trim() : "";
}

function buildAgentNodes(events: OpenworkAgentRunEvent[]): AgentNode[] {
  const nodes = new Map<string, AgentNode>();
  const coordinator = ensureNode(nodes, {
    id: "coordinator",
    parentId: null,
    runtime: "coordinator",
    title: defaultTitle("coordinator"),
  });
  for (const event of events) {
    if (event.type === "run_started") {
      coordinator.status = "running";
      coordinator.summary = coordinatorEventSummary(event);
      coordinator.updatedAt = event.timestamp;
      continue;
    }
    if (event.type === "run_completed") {
      coordinator.status = event.status === "failed" || event.status === "cancelled" ? event.status : "completed";
      coordinator.summary = coordinatorEventSummary(event);
      coordinator.updatedAt = event.timestamp;
      continue;
    }
    const runtime = event.runtime ?? "coordinator";
    const id = nodeIdForEvent(event, runtime);
    const node = ensureNode(nodes, {
      id,
      parentId: event.parentAgentId ?? null,
      runtime,
      title: event.title || defaultTitle(runtime),
    });
    node.updatedAt = event.timestamp;
    if (event.type === "agent_started" || event.type === "child_agent_started") {
      if (node.status !== "completed" && node.status !== "failed" && node.status !== "cancelled") {
        node.status = "running";
      }
      if (event.title) node.title = event.title;
    } else if (event.type === "agent_completed" || event.type === "child_agent_completed") {
      node.status = event.status === "failed" ? "failed" : "completed";
      if (event.title) node.title = event.title;
    } else if (event.type === "error") {
      node.status = "failed";
    }
    if (event.text && event.type !== "log") {
      node.summary = appendSummary(node.summary, event.text);
    } else if (event.type === "tool_call" || event.type === "plan") {
      node.summary = event.title ?? node.summary;
    }
  }
  prunePlaceholderSubagents(nodes);
  const terminalStatus = terminalNodeStatus(coordinator.status);
  if (terminalStatus) {
    for (const node of nodes.values()) {
      if (node.status === "running" || node.status === "pending") {
        node.status = terminalStatus === "failed" && node.runtime === "coordinator" ? "failed" : "completed";
      }
    }
  }
  return [...nodes.values()].sort(compareAgentNodes);
}

function buildTimelineEvents(events: OpenworkAgentRunEvent[]): TimelineEvent[] {
  return events
    .filter((event) => event.type === "tool_call" || event.type === "plan" || event.type === "approval_requested" || event.type === "error")
    .slice(-6)
    .map((event) => ({
      id: `${event.seq}:${event.type}`,
      runtime: event.runtime ?? "coordinator",
      title: timelineEventTitle(event),
      text: compactText(event.text ?? ""),
      status: eventStatus(event),
    }));
}

function coordinatorEventSummary(event: OpenworkAgentRunEvent): string {
  const runtimeNames = coordinatorRuntimeNames(event);
  if (event.type === "run_started") return `正在协调 ${runtimeNames}`;
  if (event.status === "failed") return event.text || `${runtimeNames} 协作需要处理`;
  if (event.status === "cancelled") return "协作已停止";
  return `${runtimeNames} 已返回结果`;
}

function coordinatorRuntimeNames(event: OpenworkAgentRunEvent): string {
  const runtimes = readDetailRuntimes(event.details);
  const resolved = runtimes.length > 0 ? runtimes : defaultCollaborationRuntimes();
  return resolved.map(defaultTitle).join(" 和 ");
}

function readDetailRuntimes(details: OpenworkAgentRunEvent["details"]): OpenworkAgentRuntimeKind[] {
  if (!details) return [];
  const value = details.runtimes;
  if (!Array.isArray(value)) return [];
  return value.filter(isRuntimeKind);
}

function isRuntimeKind(value: unknown): value is OpenworkAgentRuntimeKind {
  return value === "codex" || value === "grok-build";
}

function defaultCollaborationRuntimes(): OpenworkAgentRuntimeKind[] {
  return ["codex", "grok-build"];
}

function compareAgentNodes(left: AgentNode, right: AgentNode): number {
  if (!left.parentId && !right.parentId) {
    const root = runtimeRank(left.runtime) - runtimeRank(right.runtime);
    if (root !== 0) return root;
  }
  if (left.parentId === right.parentId) return left.order - right.order;
  return left.order - right.order;
}

function runtimeRank(runtime: AgentNode["runtime"]): number {
  if (runtime === "coordinator") return 0;
  if (runtime === "codex") return 1;
  if (runtime === "grok-build") return 2;
  return 3;
}

function timelineEventTitle(event: OpenworkAgentRunEvent): string {
  if (event.type === "plan") return event.title || "Updated plan";
  if (event.type === "approval_requested") return event.title || "Requested approval";
  if (event.type === "error") return event.title || "Agent error";
  return cleanToolTitle(event.title || "Ran tool");
}

function eventStatus(event: OpenworkAgentRunEvent): AgentNode["status"] {
  if (event.status === "failed" || event.type === "error") return "failed";
  if (event.status === "completed") return "completed";
  if (event.status === "pending") return "pending";
  return "running";
}

function terminalNodeStatus(status: AgentNode["status"]): "completed" | "failed" | "cancelled" | null {
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  return null;
}

function headerRuntimeForMode(mode: OpenworkAgentRun["mode"]): AgentNode["runtime"] {
  if (mode === "codex") return "codex";
  if (mode === "grok-build") return "grok-build";
  return "coordinator";
}

function nodeIdForEvent(event: OpenworkAgentRunEvent, runtime: AgentNode["runtime"]): string {
  const title = event.title?.trim() ?? "";
  if ((event.type === "child_agent_started" || event.type === "child_agent_completed") && isMeaningfulChildTitle(title)) {
    return `child:${runtime}:${event.parentAgentId ?? runtime}:${normalizeNodeKey(title)}`;
  }
  return event.agentId?.trim() || runtime;
}

function isMeaningfulChildTitle(title: string): boolean {
  if (!title) return false;
  const normalized = title.toLowerCase();
  return normalized !== "codex subagent" && normalized !== "grok subagent" && normalized !== "grok-build subagent";
}

function normalizeNodeKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
}

function prunePlaceholderSubagents(nodes: Map<string, AgentNode>): void {
  const hasMeaningfulSibling = new Set<string>();
  for (const node of nodes.values()) {
    if (!node.parentId || isPlaceholderSubagent(node)) continue;
    hasMeaningfulSibling.add(`${node.runtime}:${node.parentId}`);
  }
  for (const [id, node] of nodes.entries()) {
    if (!node.parentId || !isPlaceholderSubagent(node)) continue;
    if (hasMeaningfulSibling.has(`${node.runtime}:${node.parentId}`)) nodes.delete(id);
  }
}

function isPlaceholderSubagent(node: AgentNode): boolean {
  const title = node.title.trim().toLowerCase();
  return !node.summary && (title === "codex subagent" || title === "grok subagent" || title === "grok-build subagent");
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
    order: nodes.size,
  };
  nodes.set(seed.id, next);
  return next;
}

function appendSummary(current: string, next: string): string {
  const left = previewText(current);
  const right = previewText(next);
  const merged = joinPreviewText(left, next, right);
  if (merged.length <= 220) return merged;
  return `...${merged.slice(-217)}`;
}

function joinPreviewText(left: string, rawRight: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return `${left}${needsPreviewSeparator(left, rawRight, right) ? " " : ""}${right}`;
}

function needsPreviewSeparator(left: string, rawRight: string, right: string): boolean {
  if (/^\s/.test(rawRight)) return true;
  if (/^[,.;:!?，。！？、；：)\]}）】]/.test(right)) return false;
  if (/[-/([{（【]$/.test(left)) return false;
  if (/[A-Za-z0-9]$/.test(left) && /^[-/]/.test(right)) return false;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) return false;
  if (/[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff]/.test(right)) return false;
  if (/[\u3400-\u9fff]$/.test(left) && /^[A-Za-z0-9]/.test(right)) return true;
  if (/[A-Za-z0-9]$/.test(left) && /^[\u3400-\u9fff]/.test(right)) return true;
  return /[.!?]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function compactText(value: string): string {
  const normalized = previewText(value);
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137)}...`;
}

function previewText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[，。,.!?])/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToolTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (/^codex item (started|completed)$/i.test(normalized)) return "";
  if (/^codex activity$/i.test(normalized)) return "";
  if (/^grok build tool$/i.test(normalized)) return "";
  return normalized;
}

function runModeLabel(mode: OpenworkAgentRun["mode"]): string {
  if (mode === "codex") return "Codex";
  if (mode === "grok-build") return "Grok Build";
  return "智能体协作";
}

function runStatusLabel(status: OpenworkAgentRun["status"], mode?: OpenworkAgentRun["mode"]): string {
  if (mode === "multi-agent") {
    if (status === "starting") return "准备协作";
    if (status === "running") return "协作中";
    if (status === "completed") return "协作完成";
    if (status === "cancelled") return "已停止";
    return "需要处理";
  }
  if (status === "starting") return "准备中";
  if (status === "running") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已停止";
  return "需要处理";
}

function nodeStatusLabel(status: AgentNode["status"]): string {
  if (status === "pending") return "准备中";
  if (status === "running") return "正在思考";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已停止";
  return "失败";
}

function defaultTitle(runtime: AgentNode["runtime"]): string {
  if (runtime === "codex") return "Codex";
  if (runtime === "grok-build") return "Grok Build";
  return "协作任务";
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

function chipClass(status: AgentNode["status"]): string {
  if (status === "running") return "border-green-4 text-gray-12";
  if (status === "completed") return "border-green-5 text-gray-12";
  if (status === "failed") return "border-red-5 text-gray-12";
  if (status === "cancelled") return "border-gray-5 text-gray-11";
  return "border-amber-4 text-gray-12";
}

function chipIconClass(status: AgentNode["status"]): string {
  if (status === "running") return "bg-green-3 text-green-10";
  if (status === "completed") return "bg-green-4 text-green-11";
  if (status === "failed") return "bg-red-3 text-red-10";
  if (status === "cancelled") return "bg-gray-3 text-gray-10";
  return "bg-amber-3 text-amber-10";
}

function statusDotClass(status: AgentNode["status"]): string {
  if (status === "running") return "bg-blue-9 text-white";
  if (status === "completed") return "bg-green-9 text-white";
  if (status === "failed") return "bg-red-9 text-white";
  if (status === "cancelled") return "bg-gray-9 text-white";
  return "bg-amber-9 text-white";
}

function statusMarkerClass(status: AgentNode["status"]): string {
  if (status === "running") return "bg-blue-9";
  if (status === "completed") return "bg-green-9";
  if (status === "failed") return "bg-red-9";
  if (status === "cancelled") return "bg-gray-9";
  return "bg-amber-9";
}
