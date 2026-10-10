// 改图结果和原图配对，供“对比原图”滑块使用。
//
// 只有改图才有“原图”：方案动作是 edit，或者直接在图片模式下只带一张参考图生成。
// 多张参考图合成一张时说不清哪张是原图，不提供对比。多图方案里每张图按自己的参考图配对。

function identity(image) {
  return String(image?.id || image?.fileKey || image?.dataUrl || image?.url || "").trim();
}

function uniqueImages(images) {
  const seen = new Set();
  const out = [];
  for (const image of Array.isArray(images) ? images : []) {
    const key = identity(image);
    if (!image || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(image);
  }
  return out;
}

function triggeringUserMessage(message, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const index = list.findIndex((item) => item?.id === message?.id);
  for (let cursor = (index < 0 ? list.length : index) - 1; cursor >= 0; cursor -= 1) {
    if (list[cursor]?.role === "user") return list[cursor];
    if (list[cursor]?.kind === "context-divider") return null;
  }
  return null;
}

function itemReferenceIds(item) {
  const ids = Array.isArray(item?.referenceImageIds) ? item.referenceImageIds : item?.referencedImageIds;
  return Array.isArray(ids) ? ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
}

/**
 * 返回和 message.images 一一对应的原图（找不到时为 null）。
 * 返回空数组表示这条消息不是改图。
 */
export function imageEditSources(message, messages) {
  const images = Array.isArray(message?.images) ? message.images : [];
  if (message?.role !== "assistant" || !images.length) return [];
  const user = triggeringUserMessage(message, messages);
  const references = uniqueImages(user?.referenceImages);
  if (!references.length) return [];

  const list = Array.isArray(messages) ? messages : [];
  const proposal = user?.proposalSourceMessageId
    ? list.find((item) => item?.id === user.proposalSourceMessageId)?.proposal
    : null;
  const isEdit = proposal ? proposal.action === "edit" : references.length === 1;
  if (!isEdit) return [];

  const byId = new Map(references.map((image) => [identity(image), image]));
  for (const image of references) if (image?.id) byId.set(String(image.id), image);
  const items = Array.isArray(message.imagePlanItems) && message.imagePlanItems.length
    ? message.imagePlanItems
    : Array.isArray(user?.imagePlanItems) ? user.imagePlanItems : [];

  return images.map((image, index) => {
    if (image?.deleted || image?.deletedByHistory) return null;
    const ids = itemReferenceIds(items[index]);
    if (ids.length === 1) return byId.get(ids[0]) || null;
    if (ids.length > 1) return null;
    return references.length === 1 ? references[0] : null;
  });
}
