import { isReasoningUIPart, isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai"
import type { ThreadStatus } from "@/lib/messages"

interface MessageGroup {
  messages: UIMessageWithIndex[]
}

export type UIMessageWithIndex = { index: number, message: UIMessage }
type MessageListItem = MessageGroup | UIMessageWithIndex

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

export function getMessagesText(messages: UIMessage[]): string {
  return messages
    .map(getMessageText)
    .filter(Boolean)
    .join("\n\n")
}

export function getLastTextPart(message: UIMessage): UIMessage | null {
  const lastTextPart = message.parts.findLast((part) => part.type === "text")

  return lastTextPart ? { ...message, parts: [lastTextPart] } : null
}

export function getFileTitle(part: FileUIPart) {
  if (part.filename) {
    return part.filename
  }

  if (part.url.startsWith("data:")) {
    return "Attached file"
  }

  return part.url || "File"
}

export function getMediaBadge(part: FileUIPart) {
  if (part.mediaType && part.mediaType !== "application/octet-stream") {
    return part.mediaType.replace(/^application\//, "").replace(/^text\//, "").toUpperCase()
  }

  return part.filename?.split(".").pop()?.toUpperCase() ?? null
}

export function getMessageCreated(message: UIMessage): number | null {
  const metadata: unknown = message.metadata
  if (!metadata || typeof metadata !== "object" || !("opencode" in metadata)) return null

  const opencode: unknown = metadata.opencode
  if (!opencode || typeof opencode !== "object" || !("created" in opencode)) return null

  const created: unknown = opencode.created
  return typeof created === "number" ? created : null
}

export function formatMessageTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  if (date.toDateString() === now.toDateString()) {
    return time
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })

  return `${day}, ${time}`
}

export function isMessageGroup(item: MessageListItem): item is MessageGroup {
  return "messages" in item
}

export function groupMessages(messages: UIMessage[], status: ThreadStatus): MessageListItem[] {
  const items: MessageListItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (message.role !== "assistant") {
      items.push({ index, message })
      index++
      continue
    }

    const assistantMessages: UIMessageWithIndex[] = []

    while (index < messages.length && messages[index].role === "assistant") {
      assistantMessages.push({ message: messages[index], index });
      index++
    }

    items.push({ messages: assistantMessages });
  }

  return items
}

type AssistantRenderGroup =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; isStreaming: boolean }
  | { kind: "file"; part: FileUIPart }
  | { kind: "tool"; part: ToolUIPart | DynamicToolUIPart }

function stripProcessPreamble(value: string): string {
  const processMarkers = [
    "我先确认",
    "我会先",
    "我已经确认流程",
    "我继续找",
    "接下来我会",
    "现在我会",
    "现在开始执行",
    "工作目录解析",
    "临时目录",
    "日志已启动",
    "选择器初始化",
    "初始化连接选择器",
    "只读/初始化探测",
    "技能文件",
    "读取它的",
    "I'll use",
    "I will use",
    "Using the selected",
    "I'll resolve",
    "I'm rerunning",
    "I'm setting",
    "I'm doing",
    "I'm starting",
    "I'm initializing",
    "I'm asking",
    "sandbox helper failed",
    "work-directory probe",
    "connection selector",
    "per-run scratch",
    "read its instructions",
    "work directory",
    "temporary directory",
    "probe",
    "selector",
  ]
  const markerHits = processMarkers.filter((marker) => value.includes(marker)).length
  if (markerHits < 2) return value

  const actionMarkers = [
    "请回复",
    "请选择",
    "请提供",
    "需要你提供",
    "要继续",
    "下一步需要",
    "我需要你",
    "请告诉我",
    "I need",
    "Reply with",
    "Please provide",
    "Please send",
    "Please choose",
    "Choose",
  ]
  let start = -1
  for (const marker of actionMarkers) {
    const index = value.lastIndexOf(marker)
    if (index > start) start = index
  }
  if (start <= 0) return value

  const trimmed = value.slice(start).trim()
  return trimmed || value
}

export function getAssistantRenderGroups(
  parts: UIMessage["parts"],
  showThinking: boolean
): AssistantRenderGroup[] {
  const filteredParts = parts.filter((part) => showThinking || !isReasoningUIPart(part))
  const groups: AssistantRenderGroup[] = []

  const appendText = (text: string) => {
    const displayText = stripProcessPreamble(text)
    if (!displayText) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "text") {
      previous.text = stripProcessPreamble(`${previous.text}${text}`)
      return
    }

    groups.push({ kind: "text", text: displayText })
  }

  const appendReasoning = (part: UIMessage["parts"][number]) => {
    if (!isReasoningUIPart(part)) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "reasoning") {
      previous.text += part.text
      previous.isStreaming = previous.isStreaming || part.state === "streaming"
      return
    }

    if (!part.text.trim()) {
      return
    }

    groups.push({ kind: "reasoning", text: part.text, isStreaming: part.state === "streaming" })
  }

  for (const part of filteredParts) {
    if (part.type === "text") {
      appendText(part.text)
      continue
    }

    if (isReasoningUIPart(part)) {
      if (showThinking) {
        appendReasoning(part)
      }
      continue
    }

    if (part.type === "file") {
      groups.push({ kind: "file", part })
      continue
    }

    if (isToolUIPart(part)) {
      groups.push({ kind: "tool", part })
    }
  }

  return groups
}
