export const COMPANY_LOCAL_PROVIDER_ID = "company-local";
export const COMPANY_LOCAL_PROVIDER_NAME = "公司本地模型";

export type CompanyLocalProviderModel = {
  id: string;
  name: string;
  contextWindow?: number;
  outputLimit?: number;
  reasoning?: boolean;
};

export type CompanyLocalProviderInstallInput = {
  baseUrl: string;
  apiKey: string;
  models: CompanyLocalProviderModel[];
};

const COMPANY_LOCAL_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

function isKnownOpenAiReasoningModel(modelId: string): boolean {
  return /^gpt[-_.]?5(?:[-_.]|$)/i.test(modelId.trim());
}

export function companyLocalModelSupportsReasoning(model: Pick<CompanyLocalProviderModel, "id" | "reasoning">): boolean {
  return model.reasoning === true || (model.reasoning !== false && isKnownOpenAiReasoningModel(model.id));
}

export function resolveCompanyLocalReasoningEffort(
  providerId: string,
  modelId: string,
  variant: string | null,
): string | undefined {
  const normalized = variant?.trim().toLowerCase();
  if (providerId !== COMPANY_LOCAL_PROVIDER_ID || !isKnownOpenAiReasoningModel(modelId) || !normalized) return undefined;
  return COMPANY_LOCAL_REASONING_EFFORTS.some((effort) => effort === normalized)
    ? normalized
    : undefined;
}

export function buildCompanyLocalProviderConfig(input: Pick<CompanyLocalProviderInstallInput, "baseUrl" | "models">) {
  const models = Object.fromEntries(
    input.models
      .map((model) => ({
        id: model.id.trim(),
        name: model.name.trim() || model.id.trim(),
        contextWindow: model.contextWindow,
        outputLimit: model.outputLimit,
        reasoning: model.reasoning,
      }))
      .filter((model) => model.id)
      .map((model) => {
        const reportedContext = model.contextWindow;
        const reportedOutput = model.outputLimit;
        const context = typeof reportedContext === "number" && Number.isSafeInteger(reportedContext) && reportedContext > 0
          ? reportedContext
          : undefined;
        const output = typeof reportedOutput === "number" && Number.isSafeInteger(reportedOutput) && reportedOutput > 0
          ? reportedOutput
          : undefined;
        const supportsReasoning = companyLocalModelSupportsReasoning(model);
        return [
          model.id,
          {
            name: model.name,
            ...(context === undefined && output === undefined
              ? {}
              : {
                  limit: {
                    ...(context === undefined ? {} : { context }),
                    ...(output === undefined ? {} : { output }),
                  },
                }),
            ...(supportsReasoning
              ? {
                  capabilities: { reasoning: true },
                  variants: Object.fromEntries(
                    COMPANY_LOCAL_REASONING_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
                  ),
                }
              : {}),
          },
        ];
      }),
  );

  return {
    [COMPANY_LOCAL_PROVIDER_ID]: {
      npm: "@ai-sdk/openai-compatible",
      name: COMPANY_LOCAL_PROVIDER_NAME,
      options: { baseURL: input.baseUrl.trim() },
      models,
    },
  };
}
