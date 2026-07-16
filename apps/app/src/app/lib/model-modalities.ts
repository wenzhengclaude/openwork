function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getModelImageInputSupport(model: object): boolean | null {
  if (!isRecord(model)) return null;
  const modalities = model.modalities;
  if (!isRecord(modalities) || !Array.isArray(modalities.input)) return null;
  return modalities.input.some((value) => typeof value === "string" && value.trim().toLowerCase() === "image");
}
