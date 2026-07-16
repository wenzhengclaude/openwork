"use client"

import { SquareTerminalIcon } from "lucide-react"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"
import type { BashToolPart } from "@/lib/build-in-tools"

interface BashToolProps {
  part: BashToolPart
}

export function BashTool({ part }: BashToolProps) {
  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger leftIcon={<SquareTerminalIcon className="size-4" />}>
          <span className="flex gap-2">
            <span className="shrink-0">
              {part.input.description}
            </span>
            <span className="opacity-80 truncate grow">
              {part.input.command}
            </span>
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="mt-1 overflow-hidden rounded-lg border border-border/70 bg-muted/70 p-1.5">
          <div
            aria-label="Command output"
            className="max-h-72 overflow-auto rounded-md bg-background/70 font-mono text-[12px] leading-5 [scrollbar-gutter:stable_both-edges]"
          >
            <pre className="m-0 min-w-max whitespace-pre px-3 py-2 text-foreground">$ {part.input.command}</pre>
            {part.output ? (
              <pre className="m-0 min-w-max border-t border-border/60 px-3 py-2 whitespace-pre text-muted-foreground">
                {part.output}
              </pre>
            ) : null}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
