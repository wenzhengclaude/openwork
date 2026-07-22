"use client"

import { Tool } from "@/components/ui/tool"
import type { EditToolPart } from "@/lib/build-in-tools"
import { parseFilename } from "@/components/tools/path"
import {
  diffReviewFileFromEditInput,
  diffReviewId,
  type DiffReviewRequest,
} from "@/react-app/domains/session/review/diff-review"

interface EditToolProps {
  part: EditToolPart
  onOpenDiffReview?: (review: DiffReviewRequest) => void
}

function getEditToolTitle(part: EditToolPart): string | null {
  const filename = parseFilename(part.input.filePath)

  if (part.state === "output-error") {
    return `Update attempted ${filename}`
  }

  if (part.state !== "output-available") {
    return null
  }

  return `Updated ${filename}`
}

export function EditTool({ part, onOpenDiffReview }: EditToolProps) {
  const file = diffReviewFileFromEditInput(part.input.filePath, part.input.oldString, part.input.newString)
  const review = file
    ? {
      id: diffReviewId("opencode-edit", [file]),
      label: `Review ${parseFilename(part.input.filePath)}`,
      files: [file],
    }
    : undefined

  return (
    <Tool
      toolPart={part}
      title={getEditToolTitle(part) ?? undefined}
      diffReview={review}
      onOpenDiffReview={onOpenDiffReview}
    />
  )
}
