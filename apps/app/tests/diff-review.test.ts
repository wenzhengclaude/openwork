import { describe, expect, test } from "bun:test";

import {
  diffReviewFileFromEditInput,
  diffReviewFilesFromPatchText,
  diffReviewLabel,
} from "../src/react-app/domains/session/review/diff-review";

describe("diff review helpers", () => {
  test("splits apply_patch text into reviewable files", () => {
    const files = diffReviewFilesFromPatchText([
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: src/b.ts",
      "+created",
      "*** End Patch",
    ].join("\n"));

    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(0);
    expect(diffReviewLabel(files)).toBe("Edited 2 files");
  });

  test("builds a review diff from native edit input", () => {
    const file = diffReviewFileFromEditInput(
      "src/app.ts",
      "const name = \"old\";\n",
      "const name = \"new\";\n",
    );

    expect(file?.path).toBe("src/app.ts");
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(1);
    expect(file?.diff).toContain("-const name = \"old\";");
    expect(file?.diff).toContain("+const name = \"new\";");
  });

  test("does not create review files for unchanged edit input", () => {
    expect(diffReviewFileFromEditInput("src/app.ts", "same", "same")).toBeNull();
  });
});
