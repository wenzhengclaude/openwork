import * as React from "react";
import { FilePen } from "lucide-react";
import { codeToHtml } from "shiki";

import { cn } from "@/lib/utils";
import type { ReviewPanelTab } from "../panel/panel-tab-store";
import { fileName } from "./diff-review";

type DiffReviewPanelProps = {
  tab: ReviewPanelTab;
};

export function DiffReviewPanel({ tab }: DiffReviewPanelProps) {
  const [activeFileId, setActiveFileId] = React.useState(tab.files[0]?.id ?? "");

  React.useEffect(() => {
    if (tab.files.some((file) => file.id === activeFileId)) return;
    setActiveFileId(tab.files[0]?.id ?? "");
  }, [activeFileId, tab.files]);

  const activeFile = tab.files.find((file) => file.id === activeFileId) ?? tab.files[0] ?? null;
  const additions = tab.files.reduce((total, file) => total + file.additions, 0);
  const deletions = tab.files.reduce((total, file) => total + file.deletions, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <FilePen className="size-4 text-gray-9" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-12">{tab.label}</div>
        <DiffStatText additions={additions} deletions={deletions} />
      </div>

      {tab.files.length > 1 ? (
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-2 py-2">
          {tab.files.map((file) => (
            <button
              key={file.id}
              type="button"
              className={cn(
                "flex h-8 max-w-[14rem] shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                file.id === activeFile?.id
                  ? "bg-background text-gray-12 shadow-sm"
                  : "text-gray-9 hover:bg-background/80 hover:text-gray-12",
              )}
              onClick={() => setActiveFileId(file.id)}
              title={file.path}
            >
              <span className="min-w-0 truncate">{fileName(file.path)}</span>
              <DiffStatText additions={file.additions} deletions={file.deletions} />
            </button>
          ))}
        </div>
      ) : null}

      {activeFile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2 font-mono text-xs text-gray-9">
            <span className="min-w-0 truncate">{activeFile.path}</span>
            <DiffStatText additions={activeFile.additions} deletions={activeFile.deletions} />
          </div>
          <DiffLines diff={activeFile.diff} path={activeFile.path} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          No file changes to review.
        </div>
      )}
    </div>
  );
}

type DiffLineRow = {
  key: string;
  line: string;
  lineNumber: number;
  code: string | null;
  syntaxIndex: number | null;
};

function DiffLines({ diff, path }: { diff: string; path: string }) {
  const rows = React.useMemo(() => diffLineRows(diff), [diff]);
  const code = React.useMemo(() => rows.filter((row) => row.code !== null).map((row) => row.code ?? "").join("\n"), [rows]);
  const [highlightedLines, setHighlightedLines] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function highlight() {
      if (!code) {
        if (!cancelled) setHighlightedLines([]);
        return;
      }

      const html = await codeToHtml(code, { lang: languageForPath(path), theme: "github-light" });
      if (!cancelled) setHighlightedLines(shikiLineHtml(html));
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, path]);

  return (
    <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5 [scrollbar-gutter:stable_both-edges]">
      {rows.map((row) => (
        <div key={row.key} className={cn("grid min-w-max grid-cols-[4rem_1fr]", diffLineClass(row.line))}>
          <span className="select-none border-r border-border/50 px-2 text-right text-gray-7">{row.lineNumber}</span>
          <span className="whitespace-pre px-3">
            {row.syntaxIndex === null ? (
              row.line || " "
            ) : (
              <>
                <span className="select-none text-gray-7">{diffMarker(row.line)}</span>
                <span
                  dangerouslySetInnerHTML={{ __html: highlightedLines[row.syntaxIndex] ?? escapeHtml(row.code ?? "") }}
                />
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffStatText(props: { additions: number; deletions: number }) {
  if (props.additions === 0 && props.deletions === 0) return null;
  return (
    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums">
      <span className="text-green-10">+{props.additions}</span>
      <span className="ml-1 text-red-10">-{props.deletions}</span>
    </span>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "bg-blue-2/60 text-blue-11";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("***")) return "bg-gray-2/70 text-gray-9";
  if (line.startsWith("+")) return "bg-green-2/70 text-green-11";
  if (line.startsWith("-")) return "bg-red-2/70 text-red-11";
  return "text-gray-11";
}

function diffLineRows(diff: string): DiffLineRow[] {
  let syntaxIndex = 0;
  return diff.split("\n").map((line, index) => {
    const code = codeLine(line);
    const row: DiffLineRow = {
      key: `${index}:${line}`,
      line,
      lineNumber: index + 1,
      code,
      syntaxIndex: code === null ? null : syntaxIndex,
    };
    if (code !== null) syntaxIndex += 1;
    return row;
  });
}

function codeLine(line: string): string | null {
  if (line.startsWith("@@")) return null;
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("***")) return null;
  if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) return line.slice(1);
  return line;
}

function diffMarker(line: string): string {
  if (line.startsWith("+") || line.startsWith("-")) return line[0];
  if (line.startsWith(" ")) return " ";
  return "";
}

function shikiLineHtml(html: string): string[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const lines = Array.from(document.querySelectorAll(".line")).map((line) => line.innerHTML);
  if (lines.length > 0) return lines;
  return document.querySelector("code")?.innerHTML.split("\n") ?? [];
}

function languageForPath(path: string): string {
  const extension = fileName(path).split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "ps1":
      return "powershell";
    case "sh":
    case "bash":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    case "sql":
      return "sql";
    default:
      return "text";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
