/** @jsxImportSource react */

import { ProviderIcon } from "./provider-icon";
import { resolveExtensionIconSrc } from "./extension-icon-src";

type ModelBrand = {
  file: string;
  label: string;
  prefixes: readonly string[];
  monochrome?: boolean;
};

const modelBrands: readonly ModelBrand[] = [
  { prefixes: ["openrouter/", "fusion"], file: "openrouter.svg", label: "OpenRouter", monochrome: true },
  { prefixes: ["z-ai/", "glm-"], file: "zhipu-color.svg", label: "Zhipu AI" },
  { prefixes: ["moonshotai/", "kimi-"], file: "kimi-color.svg", label: "Kimi" },
  { prefixes: ["tencent/", "hunyuan", "hy3"], file: "hunyuan-color.svg", label: "Tencent Hunyuan" },
  { prefixes: ["deepseek/", "deepseek"], file: "deepseek.svg", label: "DeepSeek", monochrome: true },
  { prefixes: ["minimax/", "minimax"], file: "minimax.svg", label: "MiniMax", monochrome: true },
  { prefixes: ["google/", "gemini"], file: "gemini-color.svg", label: "Google Gemini" },
  { prefixes: ["anthropic/", "claude"], file: "claude-color.svg", label: "Claude" },
  { prefixes: ["openai/", "gpt-", "o1", "o3", "o4"], file: "openai.svg", label: "OpenAI", monochrome: true },
];

export function getModelBrand(modelId: string): ModelBrand | null {
  const normalizedModelId = modelId.trim().toLowerCase();
  return modelBrands.find((brand) => brand.prefixes.some((prefix) => normalizedModelId.startsWith(prefix))) ?? null;
}

type ModelBrandIconProps = {
  modelId: string;
  providerId?: string | null;
  providerName?: string | null;
  className?: string;
  size?: number;
};

export function ModelBrandIcon({
  modelId,
  providerId,
  providerName,
  className,
  size = 16,
}: ModelBrandIconProps) {
  const brand = getModelBrand(modelId);

  if (!brand) {
    return (
      <ProviderIcon
        providerId={providerId}
        providerName={providerName}
        className={className}
        size={size}
      />
    );
  }

  return (
    <img
      src={resolveExtensionIconSrc(`/model-brands/${brand.file}`)}
      alt={`${brand.label} logo`}
      className={`shrink-0 object-contain ${brand.monochrome ? "dark:invert" : ""} ${className ?? ""}`}
      width={size}
      height={size}
    />
  );
}
