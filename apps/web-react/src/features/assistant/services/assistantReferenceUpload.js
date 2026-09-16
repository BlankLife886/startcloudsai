import {
  encodeLossyImageFile,
  outputFilename,
} from "../../../legacy-modules/features/image-compress/compressEngine.js";

export const ASSISTANT_REFERENCE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
export const ASSISTANT_REFERENCE_WEBP_QUALITY = 80;

export function needsAssistantReferenceCompression(file) {
  return Number(file?.size || 0) > ASSISTANT_REFERENCE_COMPRESSION_THRESHOLD_BYTES;
}

export async function compressAssistantReferenceUploadFile(file, { signal } = {}) {
  if (!file) throw new Error("请先选择图片");
  if (!needsAssistantReferenceCompression(file)) return file;

  const encoded = await encodeLossyImageFile(file, {
    format: "webp",
    quality: ASSISTANT_REFERENCE_WEBP_QUALITY,
    maxEdge: 0,
    maxInputBytes: 80 * 1024 * 1024,
    signal,
  });
  return new File(
    [encoded.blob],
    outputFilename(file.name || "reference-image", encoded.format || "webp"),
    {
      type: encoded.mimeType || "image/webp",
      lastModified: Date.now(),
    },
  );
}
