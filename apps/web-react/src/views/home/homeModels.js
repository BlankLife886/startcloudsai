const MODEL_LISTS = [
  ["publicModels", "image"],
  ["imageModels", "image"],
  ["textModels", "text"],
  ["analysisModels", "text"],
  ["videoModels", "video"],
  ["audioModels", "audio"],
  ["backgroundRemovalModels", "image"],
  ["tools", "tool"],
];

const UNAVAILABLE_STATUSES = new Set(["disabled", "private", "maintenance", "hidden", "removed"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function isPublicAvailable(value) {
  return value.enabled !== false
    && value.public !== false
    && value.disabled !== true
    && value.private !== true
    && value.maintenance !== true
    && !UNAVAILABLE_STATUSES.has(firstText(value.status).toLowerCase())
    && firstText(value.visibility).toLowerCase() !== "private";
}

function normalizeModality(value) {
  const modality = firstText(value).toLowerCase();
  if (modality === "chat" || modality === "text") return "text";
  return ["image", "video", "audio"].includes(modality) ? modality : "";
}

function modelModality(model, hint) {
  const explicit = normalizeModality(model.modality) || normalizeModality(model.kind);
  if (explicit) return explicit;
  const capabilities = [model.tool, ...(Array.isArray(model.capabilities) ? model.capabilities : []),
    ...(Array.isArray(model.operations) ? model.operations : [])]
    .filter((value) => typeof value === "string").join(" ").toLowerCase();
  if (/video/.test(capabilities)) return "video";
  if (/audio|speech|voice|music/.test(capabilities)) return "audio";
  if (/text[._-](chat|analysis)|image[._-]understand/.test(capabilities)) return "text";
  if (/image|background[._-]?remove|upscale/.test(capabilities)) return "image";
  return hint || (model.kind === "image_tool" ? "image" : "tool");
}

/** Collect the public runtime catalog without duplicating models assigned to multiple workspaces. */
export function collectHomeModels(runtimeConfig) {
  if (!isRecord(runtimeConfig)) return [];
  const models = new Map();
  const catalogAvailability = new Map();

  const collect = (list, hint = "", authoritative = false) => {
    if (!Array.isArray(list)) return;
    for (const model of list) {
      if (!isRecord(model)) continue;
      const id = firstText(model.id, model.publicModelKey, model.model);
      if (!id) continue;
      const available = isPublicAvailable(model);
      // The first catalog record controls availability; workspace copies cannot re-enable it.
      if (authoritative && !catalogAvailability.has(id)) catalogAvailability.set(id, available);
      if (!available || catalogAvailability.get(id) === false) continue;
      const name = firstText(model.label, model.name);
      if (!name) continue;
      const iconUrl = firstText(model.iconUrl);
      const existing = models.get(id);
      if (existing) {
        if (!existing.iconUrl && iconUrl) existing.iconUrl = iconUrl;
        continue;
      }
      models.set(id, { id, name, iconUrl, modality: modelModality(model, hint) });
    }
  };

  const catalog = isRecord(runtimeConfig.aiModelCatalog) ? runtimeConfig.aiModelCatalog : {};
  collect(catalog.models, "", true);
  collect(catalog.publicModels, "image", true);
  collect(catalog.featurePublicModels, "", true);
  for (const provider of Array.isArray(catalog.providers) ? catalog.providers : []) {
    if (isRecord(provider) && isPublicAvailable(provider)) collect(provider.models, "", true);
  }

  const features = isRecord(runtimeConfig.features) ? runtimeConfig.features : {};
  for (const feature of Object.values(features)) {
    if (!isRecord(feature) || !isPublicAvailable(feature) || !isRecord(feature.config)) continue;
    for (const [key, hint] of MODEL_LISTS) collect(feature.config[key], hint);
  }
  return [...models.values()];
}
