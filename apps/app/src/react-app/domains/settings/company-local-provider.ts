export const COMPANY_LOCAL_PROVIDER_ID = "company-local";
export const COMPANY_LOCAL_PROVIDER_ID_PREFIX = `${COMPANY_LOCAL_PROVIDER_ID}-`;
export const COMPANY_LOCAL_PROVIDER_NAME = "\u516c\u53f8\u672c\u5730\u6a21\u578b";

export type CompanyLocalProviderModel = {
  id: string;
  name: string;
  contextWindow?: number;
  outputLimit?: number;
  reasoning?: boolean;
  reasoningEfforts?: string[];
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

const DEFAULT_COMPANY_LOCAL_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

function providerUrlIdentity(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return trimmed;
  }
}

function slugPart(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "endpoint";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function providerEndpointLabel(baseUrl: string): string {
  return providerUrlIdentity(baseUrl);
}

function isKnownImageInputModel(modelId: string): boolean {
  return /(?:^|[-_./])(?:qwen(?:[-_.]?\d+(?:[-_.]\d+)?)?[-_.]?vl|llava|internvl|minicpm[-_.]?v|glm[-_.]?4v|gpt[-_.]?4o|gpt[-_.]?5(?:[-_.]\d+)?|vision|multimodal)(?:[-_./]|$)/i.test(modelId.trim());
}

export function isCompanyLocalProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === COMPANY_LOCAL_PROVIDER_ID || normalized.startsWith(COMPANY_LOCAL_PROVIDER_ID_PREFIX);
}

export function resolveCompanyLocalProviderId(baseUrl: string): string {
  const identity = providerUrlIdentity(baseUrl);
  const slug = slugPart(identity).slice(0, 48);
  return `${COMPANY_LOCAL_PROVIDER_ID_PREFIX}${slug}-${stableHash(identity)}`;
}

export function resolveCompanyLocalProviderName(baseUrl: string): string {
  const label = providerEndpointLabel(baseUrl);
  return label ? `${COMPANY_LOCAL_PROVIDER_NAME} (${label})` : COMPANY_LOCAL_PROVIDER_NAME;
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

function normalizeReasoningEffort(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

export function companyLocalReasoningEfforts(model: Pick<CompanyLocalProviderModel, "reasoningEfforts">): string[] {
  const efforts = (model.reasoningEfforts ?? []).flatMap((effort) => {
    const normalized = normalizeReasoningEffort(effort);
    return normalized ? [normalized] : [];
  });
  return Array.from(new Set(efforts));
}

export function companyLocalModelSupportsReasoning(model: Pick<CompanyLocalProviderModel, "reasoning" | "reasoningEfforts">): boolean {
  return model.reasoning === true || companyLocalReasoningEfforts(model).length > 0;
}

export function companyLocalModelSupportsImageInput(model: Pick<CompanyLocalProviderModel, "id" | "modalities">): boolean {
  return normalizedModalities(model)?.input.includes("image") ?? isKnownImageInputModel(model.id);
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

export function setCompanyLocalModelReasoningEfforts(
  model: CompanyLocalProviderModel,
  enabled: boolean,
): CompanyLocalProviderModel {
  if (!enabled) {
    return {
      ...model,
      reasoning: model.reasoning === true ? true : undefined,
      reasoningEfforts: undefined,
    };
  }
  return {
    ...model,
    reasoning: true,
    reasoningEfforts: [...DEFAULT_COMPANY_LOCAL_REASONING_EFFORTS],
  };
}

export function resolveCompanyLocalReasoningEffort(
  providerId: string,
  _modelId: string,
  variant: string | null,
): string | undefined {
  const normalized = variant ? normalizeReasoningEffort(variant) : "";
  return isCompanyLocalProviderId(providerId) && normalized ? normalized : undefined;
}

export function buildCompanyLocalProviderConfig(input: Pick<CompanyLocalProviderInstallInput, "baseUrl" | "models">) {
  const models = Object.fromEntries(
    input.models
      .map((model) => {
        const id = model.id.trim();
        const modalities = normalizedModalities(model)
          ?? (isKnownImageInputModel(id) ? { input: ["text", "image"], output: ["text"] } : undefined);
        return {
          id,
          name: model.name.trim() || id,
          contextWindow: model.contextWindow,
          outputLimit: model.outputLimit,
          reasoning: model.reasoning,
          reasoningEfforts: companyLocalReasoningEfforts(model),
          modalities,
        };
      })
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
        const reasoningEfforts = companyLocalReasoningEfforts(model);
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
                  ...(reasoningEfforts.length
                    ? {
                        variants: Object.fromEntries(
                          reasoningEfforts.map((effort) => [effort, { reasoningEffort: effort }]),
                        ),
                      }
                    : {}),
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
    [resolveCompanyLocalProviderId(input.baseUrl)]: {
      npm: "@ai-sdk/openai-compatible",
      name: resolveCompanyLocalProviderName(input.baseUrl),
      options: { baseURL: input.baseUrl.trim() },
      models,
    },
  };
}
