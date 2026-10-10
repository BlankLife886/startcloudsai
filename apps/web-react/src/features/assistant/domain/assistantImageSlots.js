// 多张出图的逐张状态：服务端保存每张图时记下它是第几张（image.index），
// 没出来的那几张就是缺的位置；旧数据没有 index 时按顺序算。

export function imageSlotIndex(image, position) {
  const index = Number(image?.index);
  return Number.isInteger(index) && index >= 0 ? index : position;
}

// 按位置排好的格子：[{ index, image | null }]，长度是要出的张数。
export function imageSlots(message) {
  const images = Array.isArray(message?.images) ? message.images : [];
  const expected = Math.max(images.length, Math.floor(Number(message?.count) || 0), 1);
  const byIndex = new Map();
  images.forEach((image, position) => {
    const index = imageSlotIndex(image, position);
    if (!byIndex.has(index)) byIndex.set(index, image);
  });
  return Array.from({ length: expected }, (_, index) => ({ index, image: byIndex.get(index) || null }));
}

// 已经结束、但有几张没出来：返回缺的位置（从 0 开始）。
export function missingImageSlots(message) {
  if (!message || message.role !== "assistant" || message.pending || message.status !== "complete") return [];
  if (message.kind !== "image" || message.error) return [];
  return imageSlots(message).filter((slot) => !slot.image).map((slot) => slot.index);
}
