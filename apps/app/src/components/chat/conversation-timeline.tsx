import * as React from "react"
import {
  Bot,
  FileIcon,
  MessageSquareText,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import {
  isFileUIPart,
  isReasoningUIPart,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"

import { currentLocale, t } from "@/i18n"
import { cn } from "@/lib/utils"
import { getFileTitle } from "./utils"

type TimelineEntry = {
  id: string
  y: number
  active: boolean
  title: string
  body: string
  meta: string[]
  icon: LucideIcon
}

type TimelineLayout = {
  containerWidth: number
  containerHeight: number
  railLeft: number
  railTop: number
  railHeight: number
  entries: TimelineEntry[]
}

type ConversationTimelineProps = {
  messages: UIMessage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}

const EMPTY_LAYOUT: TimelineLayout = {
  containerWidth: 0,
  containerHeight: 0,
  railLeft: 0,
  railTop: 0,
  railHeight: 0,
  entries: [],
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  const suffix = "..."
  return `${normalized.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`
}

function messagePlainText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text]
      if (isReasoningUIPart(part)) return [part.text]
      return []
    })
    .join("\n\n")
    .trim()
}

function toolName(part: ToolUIPart | DynamicToolUIPart) {
  if (part.type === "dynamic-tool") return part.toolName
  return part.type.replace(/^tool-/, "")
}

function previewForMessage(message: UIMessage) {
  const text = messagePlainText(message)
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const files = message.parts.filter(isFileUIPart)
  const tools = message.parts.filter(isToolUIPart)
  const meta = [
    ...tools.slice(0, 2).map(toolName),
    ...files.slice(0, 2).map(getFileTitle),
  ]

  if (tools.length > 0 && !lines.length) {
    const title = tools.length === 1 ? t("timeline.tool_call") : t("timeline.tool_calls", { value: tools.length })
    return {
      title,
      body: tools.map(toolName).join(" / "),
      meta,
      icon: Wrench,
    }
  }

  if (files.length > 0 && !lines.length) {
    const title = files.length === 1 ? t("timeline.attached_file") : t("timeline.attached_files", { value: files.length })
    return {
      title,
      body: files.map(getFileTitle).join(" / "),
      meta,
      icon: FileIcon,
    }
  }

  const title = compactText(lines[0] ?? (message.role === "user" ? t("timeline.user_message") : t("timeline.agent_message")), 84)
  const bodySeed = lines.length > 1 ? lines.slice(1).join(" ") : text
  return {
    title,
    body: compactText(bodySeed, 220),
    meta,
    icon: message.role === "user" ? MessageSquareText : Bot,
  }
}

export function ConversationTimeline({ messages, scrollRef, contentRef }: ConversationTimelineProps) {
  const [layout, setLayout] = React.useState<TimelineLayout>(EMPTY_LAYOUT)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const locale = currentLocale()

  const previews = React.useMemo(() => {
    const next = new Map<string, ReturnType<typeof previewForMessage>>()
    for (const message of messages) {
      next.set(message.id, previewForMessage(message))
    }
    return next
  }, [messages, locale])

  const updateLayout = React.useCallback(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content || messages.length === 0) {
      setLayout(EMPTY_LAYOUT)
      return
    }

    const scrollRect = scroll.getBoundingClientRect()
    const railTop = 16
    const railHeight = Math.max(96, scroll.clientHeight - railTop * 2)
    const railLeft = scroll.clientWidth < 720 ? 28 : 36
    const activeCenter = scroll.scrollTop + scroll.clientHeight * 0.34
    const messageElements = new Map<string, HTMLElement>()

    for (const node of content.querySelectorAll("[data-message-id]")) {
      if (node instanceof HTMLElement) {
        const id = node.getAttribute("data-message-id")
        if (id) messageElements.set(id, node)
      }
    }

    const measured = messages.flatMap((message) => {
      const element = messageElements.get(message.id)
      const preview = previews.get(message.id)
      if (!element || !preview) return []

      const rect = element.getBoundingClientRect()
      const topInScroll = rect.top - scrollRect.top + scroll.scrollTop
      const y = clamp((topInScroll / Math.max(scroll.scrollHeight, 1)) * railHeight, 0, railHeight)
      const distance = Math.abs(topInScroll - activeCenter)
      return [{
        id: message.id,
        y,
        distance,
        title: preview.title,
        body: preview.body,
        meta: preview.meta,
        icon: preview.icon,
      }]
    })

    let activeId: string | null = null
    let activeDistance = Number.POSITIVE_INFINITY
    for (const entry of measured) {
      if (entry.distance < activeDistance) {
        activeDistance = entry.distance
        activeId = entry.id
      }
    }

    setLayout({
      containerWidth: scrollRect.width,
      containerHeight: scrollRect.height,
      railLeft,
      railTop,
      railHeight,
      entries: measured.map((entry) => ({
        id: entry.id,
        y: entry.y,
        active: entry.id === activeId,
        title: entry.title,
        body: entry.body,
        meta: entry.meta,
        icon: entry.icon,
      })),
    })
  }, [contentRef, messages, previews, scrollRef])

  const requestUpdate = React.useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      updateLayout()
    })
  }, [updateLayout])

  React.useEffect(() => {
    updateLayout()
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return

    scroll.addEventListener("scroll", requestUpdate, { passive: true })
    window.addEventListener("resize", requestUpdate)

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestUpdate)
    observer?.observe(scroll)
    observer?.observe(content)

    return () => {
      scroll.removeEventListener("scroll", requestUpdate)
      window.removeEventListener("resize", requestUpdate)
      observer?.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [contentRef, requestUpdate, scrollRef, updateLayout])

  if (layout.entries.length === 0) return null

  const hoveredEntry = layout.entries.find((entry) => entry.id === hoveredId) ?? null
  const previewWidth = Math.min(520, Math.max(260, layout.containerWidth - layout.railLeft - 72))
  const previewLeft = clamp(layout.railLeft + 44, 12, Math.max(12, layout.containerWidth - previewWidth - 12))
  const previewTop = hoveredEntry
    ? clamp(layout.railTop + hoveredEntry.y - 44, 12, Math.max(12, layout.containerHeight - 180))
    : 0

  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-testid="conversation-timeline-overlay">
      <div
        className="absolute pointer-events-auto"
        data-testid="conversation-timeline-rail"
        onMouseLeave={() => setHoveredId(null)}
        style={{
          left: layout.railLeft - 22,
          top: layout.railTop,
          height: layout.railHeight,
          width: 44,
        }}
      >
        {layout.entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-label={entry.title}
            className="group/marker absolute left-1/2 flex h-5 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm outline-none"
            data-testid="conversation-timeline-marker"
            data-active={entry.active ? "true" : "false"}
            onMouseEnter={() => setHoveredId(entry.id)}
            onClick={() => {
              const target = contentRef.current?.querySelector(`[data-message-id="${CSS.escape(entry.id)}"]`)
              if (target instanceof HTMLElement) {
                target.scrollIntoView({ block: "center", behavior: "smooth" })
              }
            }}
            style={{ top: entry.y }}
          >
            <span
              data-testid="conversation-timeline-tick"
              className={cn(
                "h-0.5 rounded-full transition-[width,background-color,opacity] duration-150",
                entry.active
                  ? "w-3 bg-foreground opacity-95"
                  : "w-2.5 bg-muted-foreground/30 opacity-100 group-hover/marker:w-3 group-hover/marker:bg-foreground group-hover/marker:opacity-95"
              )}
            />
          </button>
        ))}
      </div>

      {hoveredEntry ? (
        <div
          className="absolute rounded-[18px] border border-border bg-background/95 p-4 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-md"
          data-testid="conversation-timeline-preview"
          style={{
            left: previewLeft,
            top: previewTop,
            width: previewWidth,
          }}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <hoveredEntry.icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-1 text-sm font-semibold leading-6 text-foreground">
                {hoveredEntry.title}
              </div>
              {hoveredEntry.body ? (
                <div className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {hoveredEntry.body}
                </div>
              ) : null}
              {hoveredEntry.meta.length > 0 ? (
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {hoveredEntry.meta.slice(0, 3).map((item) => (
                    <span key={item} className="max-w-40 truncate rounded-full bg-muted px-2 py-1">
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
