import { describe, expect, test } from "bun:test";

import {
  buildCompanyLocalProviderConfig,
  COMPANY_LOCAL_PROVIDER_ID,
  COMPANY_LOCAL_PROVIDER_NAME,
  companyLocalModelSupportsImageInput,
  resolveCompanyLocalReasoningEffort,
  setCompanyLocalModelImageInput,
} from "../src/react-app/domains/settings/company-local-provider";

describe("company local provider config", () => {
  test("keeps only the models selected for the current API key", () => {
    expect(buildCompanyLocalProviderConfig({
      baseUrl: " http://models.example.test/v1 ",
      models: [
        { id: " model-a ", name: " Model A " },
        { id: "model-b", name: "" },
      ],
    })).toEqual({
      [COMPANY_LOCAL_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: COMPANY_LOCAL_PROVIDER_NAME,
        options: { baseURL: "http://models.example.test/v1" },
        models: {
          "model-a": { name: "Model A" },
          "model-b": { name: "model-b" },
        },
      },
    });
  });

  test("adds real reasoning variants and reported token limits for compatible models", () => {
    expect(buildCompanyLocalProviderConfig({
      baseUrl: "https://models.example.test/v1",
      models: [{
        id: "gpt-5.5",
        name: "GPT-5.5",
        contextWindow: 353_000,
        outputLimit: 32_000,
      }],
    })).toEqual({
      [COMPANY_LOCAL_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: COMPANY_LOCAL_PROVIDER_NAME,
        options: { baseURL: "https://models.example.test/v1" },
        models: {
          "gpt-5.5": {
            name: "GPT-5.5",
            limit: { context: 353_000, output: 32_000 },
            capabilities: { reasoning: true },
            variants: {
              low: { reasoningEffort: "low" },
              medium: { reasoningEffort: "medium" },
              high: { reasoningEffort: "high" },
              xhigh: { reasoningEffort: "xhigh" },
            },
          },
        },
      },
    });
    expect(resolveCompanyLocalReasoningEffort(COMPANY_LOCAL_PROVIDER_ID, "gpt-5.5", "high")).toBe("high");
    expect(resolveCompanyLocalReasoningEffort(COMPANY_LOCAL_PROVIDER_ID, "claude-opus", "high")).toBeUndefined();
  });

  test("persists image input support for multimodal models", () => {
    const model = setCompanyLocalModelImageInput({
      id: "minimax-m27-with-qwen-vl",
      name: "MiniMax M27 with Qwen VL",
    }, true);

    expect(companyLocalModelSupportsImageInput(model)).toBe(true);
    expect(buildCompanyLocalProviderConfig({
      baseUrl: "http://models.example.test/v1",
      models: [model],
    })).toEqual({
      [COMPANY_LOCAL_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: COMPANY_LOCAL_PROVIDER_NAME,
        options: { baseURL: "http://models.example.test/v1" },
        models: {
          "minimax-m27-with-qwen-vl": {
            name: "MiniMax M27 with Qwen VL",
            modalities: { input: ["text", "image"], output: ["text"] },
            attachment: true,
          },
        },
      },
    });
  });
});
