import {
  REFERENCE_COMPRESSION_THRESHOLD_BYTES,
  REFERENCE_WEBP_QUALITY,
  compressReferenceImageFile,
  needsReferenceCompression,
} from "../../../legacy-modules/features/ai-shared/referenceImageCompression.js";

export const ASSISTANT_REFERENCE_COMPRESSION_THRESHOLD_BYTES = REFERENCE_COMPRESSION_THRESHOLD_BYTES;
export const ASSISTANT_REFERENCE_WEBP_QUALITY = REFERENCE_WEBP_QUALITY;

export function needsAssistantReferenceCompression(file) {
  return needsReferenceCompression(file);
}

export async function compressAssistantReferenceUploadFile(file, { signal } = {}) {
  return compressReferenceImageFile(file, { signal, fallbackToOriginal: false });
}
