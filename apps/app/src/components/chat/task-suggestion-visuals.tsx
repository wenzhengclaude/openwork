/** @jsxImportSource react */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { OpenOneMark } from "@/react-app/design-system/open-one-mark";

export type TaskSuggestionKind = "csv" | "browser" | "extension" | "provider" | "prompt";

type TaskSuggestionVisualDetails = {
  src: string;
  alt: string;
  className?: string;
};

const visualDetails: Partial<Record<TaskSuggestionKind, TaskSuggestionVisualDetails>> = {
  csv: {
    src: "/starter-icons/microsoft-excel.svg",
    alt: "Microsoft Excel",
    className: "drop-shadow-[0_12px_18px_rgba(16,124,65,0.20)]",
  },
  browser: {
    src: "/starter-icons/google-chrome.svg",
    alt: "Google Chrome",
    className: "drop-shadow-[0_12px_18px_rgba(26,115,232,0.20)]",
  },
  extension: {
    src: "/starter-icons/mcp.svg",
    alt: "Model Context Protocol",
    className: "rounded-[10px] shadow-[0_14px_26px_-18px_rgba(15,23,42,0.9)]",
  },
};

const openOneKinds: Partial<Record<TaskSuggestionKind, string>> = {
  provider: "model provider",
  prompt: "organization prompt",
};

function OpenOneVisual({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-[15px] bg-[#071319] p-2 shadow-[0_18px_34px_-24px_rgba(2,6,23,0.95)]",
        className,
      )}
    >
      <OpenOneMark className="size-full" />
    </span>
  );
}

export function TaskSuggestionVisual({ kind, className }: { kind: TaskSuggestionKind; className?: string }) {
  const details = visualDetails[kind];

  if (!details) {
    return <OpenOneVisual aria-label={openOneKinds[kind]} className={className} />;
  }

  return (
    <span
      className={cn(
        "flex size-12 shrink-0 items-center justify-center",
        className,
      )}
    >
      <img
        src={resolveExtensionIconSrc(details.src)}
        alt={details.alt}
        draggable={false}
        className={cn("size-11 object-contain", details.className)}
      />
    </span>
  );
}

export const taskSuggestionButtonClass =
  "rounded-2xl border-border/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.76))] p-4 shadow-[0_22px_70px_-48px_rgba(15,23,42,0.76)] transition-[background,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-background hover:shadow-[0_24px_72px_-42px_rgba(15,23,42,0.82)]";
