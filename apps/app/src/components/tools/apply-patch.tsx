"use client"

import { Tool } from "@/components/ui/tool"
import type { ApplyPatchToolPart } from "@/lib/build-in-tools"
import {
  diffReviewFilesFromPatchText,
  diffReviewId,
  diffReviewLabel,
  normalizeDiffReviewFiles,
  type DiffReviewRequest,
} from "@/react-app/domains/session/review/diff-review"

interface ApplyPatchToolProps {
  part: ApplyPatchToolPart
  onOpenDiffReview?: (review: DiffReviewRequest) => void
}

function getApplyPatchToolTitle(part: ApplyPatchToolPart): string | null {
  if (part.state === "output-error") {
    return "Apply patch attempted"
  }

  if (part.state !== "output-available") {
    return null
  }

  return "Apply patch"
}

export function ApplyPatchTool({ part, onOpenDiffReview }: ApplyPatchToolProps) {
  const files = normalizeDiffReviewFiles(diffReviewFilesFromPatchText(part.input.patchText))
  const review = files.length > 0
    ? {
      id: diffReviewId("opencode-apply-patch", files),
      label: diffReviewLabel(files),
      files,
    }
    : undefined

  return (
    <Tool
      toolPart={part}
      title={getApplyPatchToolTitle(part) ?? undefined}
      diffReview={review}
      onOpenDiffReview={onOpenDiffReview}
    />
  )
}
