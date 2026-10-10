import { imageModelMaxCount } from '../../../legacy-modules/features/ai-shared/modelImageCapabilities.js';

export function assistantImageBatchLimit(model, config = {}) {
  const limits = [imageModelMaxCount(model)];
  for (const value of [model?.imageBatchLimit, config.imageBatchLimit, config.concurrency?.imageLimit ?? config.concurrency?.limit]) {
    if (value == null || value === '') continue;
    const limit = Number(value);
    if (Number.isFinite(limit)) limits.push(Math.max(0, Math.floor(limit)));
  }
  return Math.min(...limits);
}

/** Keep server model metadata intact; constrain only models used for new requests. */
export function constrainAssistantImageModels(models, config = {}) {
  return models.map((model) => ({ ...model, maxImages: assistantImageBatchLimit(model, config) }))
    .filter((model) => model.maxImages > 0);
}
