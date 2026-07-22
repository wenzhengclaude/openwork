import { describe, expect, test } from "bun:test";

import { getModelBehaviorSummary } from "../src/app/lib/model-behavior";

describe("model behavior summary", () => {
  test("shows reasoning controls for company local reasoning models without explicit variants", () => {
    const summary = getModelBehaviorSummary("company-local", {
      name: "GPT-5.5",
      capabilities: { reasoning: true },
    });

    expect(summary.options.map((option) => option.value)).toEqual([null, "low", "medium", "high", "xhigh"]);
    expect(summary.value).toBe("medium");
  });

  test("infers reasoning controls for company local GPT-5 model ids without capabilities", () => {
    const summary = getModelBehaviorSummary("company-local", {
      name: "GPT-5.5",
    }, null, null, "gpt-5.5");

    expect(summary.options.map((option) => option.value)).toEqual([null, "low", "medium", "high", "xhigh"]);
    expect(summary.value).toBe("medium");
  });
});
