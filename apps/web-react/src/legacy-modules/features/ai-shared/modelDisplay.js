function text(value) {
  return String(value == null ? "" : value).trim();
}

function looksLikeInternalModelId(value) {
  const valueText = text(value);
  return !valueText || /^model--/i.test(valueText) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valueText);
}

function modelAliases(model = {}) {
  return [model.id, model.publicModelKey, model.model, model.upstreamModel]
    .map(text)
    .filter(Boolean);
}

/** Resolve a user-facing model name without ever preferring an execution ID. */
export function resolveModelDisplayName(value, models = [], fallback = "图片模型") {
  const source = value && typeof value === "object" ? value : { model: value };
  const direct = [source.modelName, source.modelDisplayName, source.label, source.name, source.params?._modelDisplayName]
    .map(text)
    .find(Boolean);
  if (direct) return direct;

  const keys = [source.publicModelKey, source.model, source.gatewayModelId, source.id]
    .map(text)
    .filter(Boolean);
  const match = (Array.isArray(models) ? models : []).find((model) => {
    const aliases = modelAliases(model);
    return keys.some((key) => aliases.includes(key));
  });
  const label = text(match?.label || match?.name || match?.modelName);
  if (label) return label;

  return text(fallback) || "图片模型";
}

export function normalizeModelLabel(model = {}, fallback = "未命名模型") {
  const label = text(model.label || model.name || model.modelName);
  return label || text(fallback) || "未命名模型";
}

export { looksLikeInternalModelId };
