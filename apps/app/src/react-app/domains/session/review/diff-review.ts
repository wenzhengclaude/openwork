export type DiffReviewFile = {
  id: string;
  path: string;
  diff: string;
  additions: number;
  deletions: number;
};

export type DiffReviewRequest = {
  id?: string;
  label?: string;
  files: DiffReviewFile[];
};

type PatchSection = {
  path: string;
  lines: string[];
};

const PATCH_FILE_HEADER_PATTERN = /^\*\*\* (?:Add File|Update File|Delete File):\s*(.+)$/;
const PATCH_MOVE_TO_PATTERN = /^\*\*\* Move to:\s*(.+)$/;

export function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export function createDiffReviewFile(input: {
  id?: string;
  path: string;
  diff: string;
  additions?: number;
  deletions?: number;
}): DiffReviewFile {
  const stats = diffStats(input.diff);
  return {
    id: input.id ?? stableReviewId(`${input.path}:${input.diff}`),
    path: input.path,
    diff: input.diff,
    additions: input.additions ?? stats.additions,
    deletions: input.deletions ?? stats.deletions,
  };
}

export function normalizeDiffReviewFiles(files: DiffReviewFile[]): DiffReviewFile[] {
  return files.filter((file) => file.path.trim() && file.diff.trim());
}

export function diffReviewLabel(files: DiffReviewFile[]): string {
  if (files.length === 1) return fileName(files[0].path);
  return `Edited ${files.length} files`;
}

export function diffReviewId(prefix: string, files: DiffReviewFile[]): string {
  const seed = files.map((file) => `${file.path}:${file.diff}`).join("|");
  return `review:${prefix}:${stableReviewId(seed)}`;
}

export function diffReviewFilesFromPatchText(patchText: string): DiffReviewFile[] {
  const sections: PatchSection[] = [];
  let current: PatchSection | null = null;

  const pushCurrent = () => {
    if (!current) return;
    sections.push(current);
    current = null;
  };

  for (const line of patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const header = PATCH_FILE_HEADER_PATTERN.exec(line);
    if (header?.[1]) {
      pushCurrent();
      current = { path: header[1].trim(), lines: [line] };
      continue;
    }

    const moveTo = PATCH_MOVE_TO_PATTERN.exec(line);
    if (moveTo?.[1] && current) {
      current.path = moveTo[1].trim();
    }

    if (current) {
      current.lines.push(line);
    }
  }

  pushCurrent();

  if (sections.length === 0) {
    return [createDiffReviewFile({ path: "Patch", diff: patchText })];
  }

  return sections.map((section, index) => createDiffReviewFile({
    id: `patch:${index}:${section.path}`,
    path: section.path,
    diff: section.lines.join("\n"),
  }));
}

export function diffReviewFileFromEditInput(filePath: string, oldString: string, newString: string): DiffReviewFile | null {
  if (!filePath.trim()) return null;
  if (oldString === newString) return null;
  const oldLines = comparableLines(oldString);
  const newLines = comparableLines(newString);
  const diff = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
  return createDiffReviewFile({ path: filePath, diff });
}

export function fileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function comparableLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) return [];
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

function stableReviewId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
