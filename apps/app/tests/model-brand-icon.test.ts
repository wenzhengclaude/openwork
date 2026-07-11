import { describe, expect, test } from "bun:test";

import { getModelBrand } from "../src/react-app/design-system/model-brand-icon";

describe("hosted model brand icons", () => {
  test("maps hosted aliases to their model vendors", () => {
    expect(getModelBrand("openrouter/fusion")?.file).toBe("openrouter.svg");
    expect(getModelBrand("z-ai/glm-5.2")?.file).toBe("zhipu-color.svg");
    expect(getModelBrand("moonshotai/kimi-k2.7-code")?.file).toBe("kimi-color.svg");
    expect(getModelBrand("tencent/hy3-preview")?.file).toBe("hunyuan-color.svg");
    expect(getModelBrand("gemini-2.5-pro")?.file).toBe("gemini-color.svg");
    expect(getModelBrand("claude-opus-4-5")?.file).toBe("claude-color.svg");
    expect(getModelBrand("gpt-5")?.file).toBe("openai.svg");
  });

  test("keeps unknown aliases on the provider icon fallback", () => {
    expect(getModelBrand("example/unknown-model")).toBeNull();
  });
});
