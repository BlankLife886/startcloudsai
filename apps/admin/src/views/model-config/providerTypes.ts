export type ProviderAdapter = "openai" | "crun" | "gemini" | "dashscope" | "minimax";
export type AuthStyle = "" | "bearer" | "x-api-key" | "x-goog-api-key" | "bearer+x-api-key";
export type ImageAPI = "" | "standard";
export type ImageSizeParam = "" | "aspect_ratio" | "none";
export type PresetRegion = "global" | "cn" | "relay";

/** Per-vendor request rewrites; see server modelconfig.RequestCompat. */
export interface RequestCompat {
  dropParams?: string[];
  renameParams?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  imageSizeParam?: ImageSizeParam;
  /** Gemini-native only: where the upstream puts generated images. */
  imageResponse?: ImageResponse;
  /** Gemini-native only: which chat endpoint the model is called through. */
  chatApi?: ChatAPI;
  /** OpenAI-compatible vendors: how reference images are sent. */
  imageEdit?: ImageEdit;
  /** Image parameter profile ID; the server keeps a copy of its rules in imageParamRules. */
  imageParams?: string;
  imageParamRules?: ImageParamRules | null;
}

export type ImageSizeMode = "size" | "aspect_ratio" | "aspect_tier" | "none";
export type ImageQualityMode = "send" | "map" | "drop";

/** How the platform's unified image options become one upstream family's fields. */
export interface ImageParamRules {
  sizeMode: ImageSizeMode;
  aspectField?: string;
  aspectRatios?: string[];
  tierField?: string;
  tierValues?: Record<string, string>;
  qualityMode: ImageQualityMode;
  qualityMap?: Record<string, string>;
  drop?: string[];
}

/** Model options suggested when a model picks the profile. */
export interface ImageParamCapabilities {
  resolutions?: string[];
  aspectRatios?: string[];
  qualities?: string[];
  maxReferenceImages?: number | null;
}

export interface ImageParamProfile {
  id: string;
  name: string;
  description?: string;
  rules: ImageParamRules;
  capabilities: ImageParamCapabilities;
}

export const IMAGE_SIZE_MODE_OPTIONS: Array<{ value: ImageSizeMode; label: string }> = [
  { value: "size", label: "size=宽x高（OpenAI）" },
  { value: "aspect_ratio", label: "只发比例" },
  { value: "aspect_tier", label: "比例 + 分辨率档位" },
  { value: "none", label: "不发尺寸" },
];

export const IMAGE_QUALITY_MODE_OPTIONS: Array<{ value: ImageQualityMode; label: string }> = [
  { value: "send", label: "原样发送" },
  { value: "map", label: "按对照表换值" },
  { value: "drop", label: "不发送" },
];

export type ImageEdit = "" | "json_image_url" | "json_generations";

export const IMAGE_EDIT_OPTIONS: Array<{ value: ImageEdit; label: string; hint: string }> = [
  { value: "", label: "multipart 上传（OpenAI 标准）", hint: "POST /images/edits，表单上传图片" },
  { value: "json_image_url", label: "JSON：image_url 对象", hint: "POST /images/edits，image: {type: image_url, url}（xAI Grok）" },
  { value: "json_generations", label: "JSON：生图接口 image 字段", hint: "POST /images/generations，image: data URI 或数组（豆包 Seedream）" },
];

export type ChatAPI = "" | "v1";

export type ImageResponse = "" | "text_url" | "text_data_uri";

export interface ProviderRoute {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeoutSecs: number;
  maxConcurrency: number;
  enabled: boolean;
}

export interface ModelProvider {
  id: string;
  name: string;
  adapter: ProviderAdapter;
  vendor?: string;
  apiPath?: string;
  authStyle?: AuthStyle;
  imageApi?: ImageAPI;
  compat?: RequestCompat | null;
  baseUrl: string;
  apiKey: string;
  timeoutSecs: number;
  maxConcurrency: number;
  enabled: boolean;
  discoveredModels: string[];
  routes: ProviderRoute[];
}

export interface ProviderPreset {
  id: string;
  name: string;
  region: PresetRegion;
  description?: string;
  adapter: ProviderAdapter;
  baseUrl: string;
  apiPath?: string;
  authStyle?: AuthStyle;
  imageApi?: ImageAPI;
  compat?: RequestCompat | null;
  keyUrl?: string;
}

export interface CatalogEntry {
  id: string;
  kind: "image" | "chat" | "image_tool" | "";
  compatible: boolean;
  incompatibility?: string;
}

export interface ConnectionCheck {
  name: "models" | "chat";
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
}

/** A model the admin chose to import from a provider's catalog. */
export interface ModelImport {
  providerId: string;
  upstreamModel: string;
  kind: "image" | "chat";
  /** The vendor template's default request rules, copied onto the model. */
  compat?: RequestCompat | null;
}

export const REGION_LABELS: Record<PresetRegion, string> = {
  global: "国外厂商",
  cn: "国内厂商",
  relay: "中转 / 自定义",
};

export const AUTH_STYLE_OPTIONS: Array<{ value: AuthStyle; label: string }> = [
  { value: "", label: "协议默认" },
  { value: "bearer", label: "Authorization: Bearer" },
  { value: "x-api-key", label: "x-api-key" },
  { value: "x-goog-api-key", label: "x-goog-api-key（Google）" },
  { value: "bearer+x-api-key", label: "Bearer + x-api-key" },
];

export const IMAGE_API_OPTIONS: Array<{ value: ImageAPI; label: string; hint: string }> = [
  { value: "standard", label: "标准 Images 接口", hint: "官方厂商：只调用 /images/generations 与 /images/edits" },
  { value: "", label: "chatgpt2api 任务协议", hint: "先走可恢复的异步任务接口，不支持时回退标准接口" },
];

export const IMAGE_SIZE_OPTIONS: Array<{ value: ImageSizeParam; label: string }> = [
  { value: "", label: "size=宽x高（OpenAI）" },
  { value: "aspect_ratio", label: "aspect_ratio=比例" },
  { value: "none", label: "不传尺寸" },
];

export const IMAGE_RESPONSE_OPTIONS: Array<{ value: ImageResponse; label: string; hint: string }> = [
  { value: "", label: "原生 inlineData", hint: "Google 官方接口：图片在 parts[].inlineData 里" },
  { value: "text_url", label: "文本里的图片链接", hint: "中转站在文本里返回图片 URL，平台下载后保存" },
  { value: "text_data_uri", label: "文本里的 base64 图片", hint: "中转站在文本里返回 data:image/…;base64,…" },
];

export const CHAT_API_OPTIONS: Array<{ value: ChatAPI; label: string; hint: string }> = [
  { value: "", label: "Gemini 官方 OpenAI 兼容", hint: "{接口路径}/openai/chat/completions，Google 官方接口" },
  { value: "v1", label: "OpenAI 标准路径", hint: "/v1/chat/completions，多数中转站提供" },
];

export function compatIsEmpty(compat?: RequestCompat | null) {
  return !compat || (
    !compat.dropParams?.length &&
    !Object.keys(compat.renameParams || {}).length &&
    !Object.keys(compat.extraBody || {}).length &&
    !compat.imageSizeParam &&
    !compat.imageResponse &&
    !compat.chatApi &&
    !compat.imageEdit &&
    !compat.imageParams
  );
}

/** The OpenAI-compatible root a route resolves to, mirroring the server. */
export function apiRoot(provider: Pick<ModelProvider, "adapter" | "apiPath">, baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return "";
  if (provider.apiPath) return base + provider.apiPath;
  if (provider.adapter === "gemini") return `${base}/v1beta`;
  if (provider.adapter === "dashscope") return `${base}/api/v1`;
  if (provider.adapter === "crun") return base.replace(/\/api\/v1$/, "") + "/api/v1";
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

export function normalizeAPIPath(value: string) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

export const ADAPTER_OPTIONS: Array<{ value: ProviderAdapter; label: string }> = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "gemini", label: "Gemini 原生" },
  { value: "dashscope", label: "百炼原生" },
  { value: "minimax", label: "MiniMax 原生" },
  { value: "crun", label: "CRUN" },
];

export function adapterLabel(adapter: string) {
  return ADAPTER_OPTIONS.find((option) => option.value === adapter)?.label || "OpenAI 兼容";
}
