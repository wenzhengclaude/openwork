import { describe, expect, test } from "bun:test";

import {
  getModelBrand,
  getModelProviderFamily,
} from "../src/react-app/design-system/model-brand-icon";

describe("hosted model brand icons", () => {
  test("maps hosted aliases to their model vendors", () => {
    expect(getModelBrand("openrouter/fusion")?.file).toBe("openrouter.svg");
    expect(getModelBrand("z-ai/glm-5.2")?.file).toBe("zhipu-color.svg");
    expect(getModelBrand("moonshotai/kimi-k2.7-code")?.file).toBe("kimi-color.svg");
    expect(getModelBrand("tencent/hy3-preview")?.file).toBe("hunyuan-color.svg");
  });

  test("keeps unknown aliases on the provider icon fallback", () => {
    expect(getModelBrand("example/unknown-model")).toBeNull();
  });

  test("uses the existing official Claude and OpenAI provider marks", () => {
    expect(getModelProviderFamily("anthropic/claude-sonnet")?.providerId).toBe("anthropic");
    expect(getModelProviderFamily("openai/gpt-5")?.providerId).toBe("openai");
  });
});
