import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "site" | "openai" | "seedance" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

const unavailable = "本站后台暂未分发视频生成模型";

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    void config;
    void prompt;
    void references;
    void videoReferences;
    void audioReferences;
    void options;
    throw new Error(unavailable);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    await requestVideoGeneration(config, prompt, references, videoReferences, audioReferences, options);
    throw new Error(unavailable);
}

export async function pollVideoGenerationTask(_config: AiConfig, _task: VideoGenerationTask, _options?: RequestOptions): Promise<VideoGenerationTaskState> {
    return { status: "failed", error: unavailable };
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return uploadMediaFile(result.url, "video");
    throw new Error("视频任务没有返回可播放文件");
}
