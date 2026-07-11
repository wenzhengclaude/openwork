/** @jsxImportSource react */

import { ProviderIcon } from "./provider-icon";

type ModelBrand = {
  file: string;
  label: string;
  prefix: string;
  monochrome?: boolean;
};

type ModelProviderFamily = {
  prefix: string;
  providerId: "anthropic" | "openai";
};

const modelBrands: readonly ModelBrand[] = [
  { prefix: "openrouter/", file: "openrouter.svg", label: "OpenRouter", monochrome: true },
  { prefix: "z-ai/", file: "zhipu-color.svg", label: "Zhipu AI" },
  { prefix: "moonshotai/", file: "kimi-color.svg", label: "Kimi" },
  { prefix: "tencent/", file: "hunyuan-color.svg", label: "Tencent Hunyuan" },
  { prefix: "deepseek/", file: "deepseek.svg", label: "DeepSeek", monochrome: true },
  { prefix: "minimax/", file: "minimax.svg", label: "MiniMax", monochrome: true },
];

const modelProviderFamilies: readonly ModelProviderFamily[] = [
  { prefix: "anthropic/", providerId: "anthropic" },
  { prefix: "openai/", providerId: "openai" },
];

export function getModelBrand(modelId: string): ModelBrand | null {
  const normalizedModelId = modelId.trim().toLowerCase();
  return modelBrands.find((brand) => normalizedModelId.startsWith(brand.prefix)) ?? null;
}

export function getModelProviderFamily(modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase();
  return modelProviderFamilies.find((family) => normalizedModelId.startsWith(family.prefix)) ?? null;
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
  const providerFamily = getModelProviderFamily(modelId);

  if (!brand) {
    return (
      <ProviderIcon
        providerId={providerFamily?.providerId ?? providerId}
        providerName={providerName}
        className={className}
        size={size}
      />
    );
  }

  return (
    <img
      src={`/model-brands/${brand.file}`}
      alt={`${brand.label} logo`}
      className={`shrink-0 object-contain ${brand.monochrome ? "dark:invert" : ""} ${className ?? ""}`}
      width={size}
      height={size}
    />
  );
}
