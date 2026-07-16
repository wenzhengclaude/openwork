export const COMPANY_LOCAL_PROVIDER_ID = "company-local";
export const COMPANY_LOCAL_PROVIDER_NAME = "\u516c\u53f8\u672c\u5730\u6a21\u578b";

export type CompanyLocalProviderModel = {
  id: string;
  name: string;
  contextWindow?: number;
  outputLimit?: number;
  reasoning?: boolean;
  modalities?: {
    input: string[];
    output: string[];
  };
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

function normalizedModalities(model: Pick<CompanyLocalProviderModel, "modalities">) {
  const input = Array.from(new Set((model.modalities?.input ?? []).map((modality) => modality.trim().toLowerCase()).filter(Boolean)));
  const output = Array.from(new Set((model.modalities?.output ?? []).map((modality) => modality.trim().toLowerCase()).filter(Boolean)));
  if (!input.length && !output.length) return undefined;
  return {
    input,
    output: output.length ? output : ["text"],
  };
}

export function companyLocalModelSupportsReasoning(model: Pick<CompanyLocalProviderModel, "id" | "reasoning">): boolean {
  return model.reasoning === true || (model.reasoning !== false && isKnownOpenAiReasoningModel(model.id));
}

export function companyLocalModelSupportsImageInput(model: Pick<CompanyLocalProviderModel, "modalities">): boolean {
  return normalizedModalities(model)?.input.includes("image") ?? false;
}

export function setCompanyLocalModelImageInput(
  model: CompanyLocalProviderModel,
  enabled: boolean,
): CompanyLocalProviderModel {
  const modalities = normalizedModalities(model);
  const input = modalities?.input ?? ["text"];
  const nextInput = enabled
    ? Array.from(new Set([...input, "image"]))
    : input.filter((modality) => modality !== "image");
  return {
    ...model,
    modalities: {
      input: nextInput,
      output: modalities?.output ?? ["text"],
    },
  };
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
        modalities: normalizedModalities(model),
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
        const supportsImageInput = companyLocalModelSupportsImageInput(model);
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
            ...(model.modalities === undefined
              ? {}
              : {
                  modalities: model.modalities,
                  ...(supportsImageInput ? { attachment: true } : {}),
                }),
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
