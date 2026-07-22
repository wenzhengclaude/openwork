import { describe, expect, test } from "bun:test";

import {
  buildCompanyLocalProviderConfig,
  COMPANY_LOCAL_PROVIDER_NAME,
  companyLocalModelSupportsImageInput,
  resolveCompanyLocalProviderId,
  resolveCompanyLocalReasoningEffort,
  setCompanyLocalModelImageInput,
  setCompanyLocalModelReasoningEfforts,
} from "../src/react-app/domains/settings/company-local-provider";

describe("company local provider config", () => {
  test("keeps only the models selected for the current API key", () => {
    const baseUrl = " http://models.example.test/v1 ";
    expect(buildCompanyLocalProviderConfig({
      baseUrl,
      models: [
        { id: " model-a ", name: " Model A " },
        { id: "model-b", name: "" },
      ],
    })).toEqual({
      [resolveCompanyLocalProviderId(baseUrl)]: {
        npm: "@ai-sdk/openai-compatible",
        name: `${COMPANY_LOCAL_PROVIDER_NAME} (http://models.example.test/v1)`,
        options: { baseURL: "http://models.example.test/v1" },
        models: {
          "model-a": { name: "Model A" },
          "model-b": { name: "model-b" },
        },
      },
    });
  });

  test("adds returned reasoning variants and reported token limits for compatible models", () => {
    const baseUrl = "https://models.example.test/v1";
    expect(buildCompanyLocalProviderConfig({
      baseUrl,
      models: [{
        id: "company-reasoning",
        name: "Company Reasoning",
        contextWindow: 353_000,
        outputLimit: 32_000,
        reasoning: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      }],
    })).toEqual({
      [resolveCompanyLocalProviderId(baseUrl)]: {
        npm: "@ai-sdk/openai-compatible",
        name: `${COMPANY_LOCAL_PROVIDER_NAME} (https://models.example.test/v1)`,
        options: { baseURL: "https://models.example.test/v1" },
        models: {
          "company-reasoning": {
            name: "Company Reasoning",
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
    expect(resolveCompanyLocalReasoningEffort(resolveCompanyLocalProviderId(baseUrl), "company-reasoning", "high")).toBe("high");
    expect(resolveCompanyLocalReasoningEffort("openai", "company-reasoning", "high")).toBeUndefined();
  });

  test("does not infer reasoning controls from a model name alone", () => {
    const baseUrl = "https://models.example.test/v1";
    expect(buildCompanyLocalProviderConfig({
      baseUrl,
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
    })).toEqual({
      [resolveCompanyLocalProviderId(baseUrl)]: {
        npm: "@ai-sdk/openai-compatible",
        name: `${COMPANY_LOCAL_PROVIDER_NAME} (https://models.example.test/v1)`,
        options: { baseURL: "https://models.example.test/v1" },
        models: {
          "gpt-5.5": {
            name: "GPT-5.5",
            modalities: { input: ["text", "image"], output: ["text"] },
            attachment: true,
          },
        },
      },
    });
  });

  test("allows admins to confirm reasoning effort support when a relay omits metadata", () => {
    const baseUrl = "https://models.example.test/v1";
    const model = setCompanyLocalModelReasoningEfforts({ id: "gpt-5.5", name: "GPT-5.5" }, true);

    expect(buildCompanyLocalProviderConfig({
      baseUrl,
      models: [model],
    })).toEqual({
      [resolveCompanyLocalProviderId(baseUrl)]: {
        npm: "@ai-sdk/openai-compatible",
        name: `${COMPANY_LOCAL_PROVIDER_NAME} (https://models.example.test/v1)`,
        options: { baseURL: "https://models.example.test/v1" },
        models: {
          "gpt-5.5": {
            name: "GPT-5.5",
            capabilities: { reasoning: true },
            variants: {
              low: { reasoningEffort: "low" },
              medium: { reasoningEffort: "medium" },
              high: { reasoningEffort: "high" },
              xhigh: { reasoningEffort: "xhigh" },
            },
            modalities: { input: ["text", "image"], output: ["text"] },
            attachment: true,
          },
        },
      },
    });
  });

  test("persists image input support for multimodal models", () => {
    const baseUrl = "http://models.example.test/v1";
    const model = setCompanyLocalModelImageInput({
      id: "minimax-m27-with-qwen-vl",
      name: "MiniMax M27 with Qwen VL",
    }, true);

    expect(companyLocalModelSupportsImageInput(model)).toBe(true);
    expect(buildCompanyLocalProviderConfig({
      baseUrl,
      models: [model],
    })).toEqual({
      [resolveCompanyLocalProviderId(baseUrl)]: {
        npm: "@ai-sdk/openai-compatible",
        name: `${COMPANY_LOCAL_PROVIDER_NAME} (http://models.example.test/v1)`,
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

  test("maps different relay URLs to separate provider ids", () => {
    const first = buildCompanyLocalProviderConfig({
      baseUrl: "http://10.10.150.4:31080",
      models: [{ id: "model-a", name: "Model A" }],
    });
    const second = buildCompanyLocalProviderConfig({
      baseUrl: "http://10.10.150.5:31080",
      models: [{ id: "model-b", name: "Model B" }],
    });

    expect(Object.keys(first)).toEqual([resolveCompanyLocalProviderId("http://10.10.150.4:31080")]);
    expect(Object.keys(second)).toEqual([resolveCompanyLocalProviderId("http://10.10.150.5:31080")]);
    expect(Object.keys(first)[0]).not.toBe(Object.keys(second)[0]);
  });
});
