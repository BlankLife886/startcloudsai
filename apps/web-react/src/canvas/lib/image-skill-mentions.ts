export type ImageSkillItem = {
    id: string;
    slug: string;
    name: string;
    description: string;
    instruction?: string;
    storage: string;
};

export type PromptLibraryItem = {
    id: string;
    title: string;
    prompt: string;
};

export const SKILL_LIBRARY_UPDATED_EVENT = "starclouds:skill-library-updated";

type SkillLibraryModule = {
    loadSkillLibrary: (options?: { fresh?: boolean }) => Promise<{ items: ImageSkillItem[] }>;
    expandSkillMentions: (text: string) => Promise<{ prompt: string; skills: ImageSkillItem[] }>;
};

type SkillCompositionModule = {
    skillMentionToken: (skill: { name?: string; slug?: string }) => string;
};

type PromptsApiModule = {
    listPrompts: (options?: {
        type?: string;
        search?: string;
        limit?: number;
        signal?: AbortSignal;
    }) => Promise<{ items: PromptLibraryItem[] }>;
};

function skillLibrary() {
    return import("../../features/skills/skillLibrary.js") as Promise<SkillLibraryModule>;
}

function skillComposition() {
    return import("../../features/skills/skillComposition.js") as Promise<SkillCompositionModule>;
}

function promptsApi() {
    return import("../../legacy-modules/services/promptsApi.js") as Promise<PromptsApiModule>;
}

export async function loadSkillLibrary(options?: { fresh?: boolean }) {
    const mod = await skillLibrary();
    return mod.loadSkillLibrary(options);
}

export async function expandSkillMentions(text: string) {
    const mod = await skillLibrary();
    return mod.expandSkillMentions(text);
}

export async function skillMentionToken(skill: { name?: string; slug?: string }) {
    const mod = await skillComposition();
    return mod.skillMentionToken(skill);
}

export async function listPromptLibrary(options?: {
    type?: string;
    search?: string;
    limit?: number;
    signal?: AbortSignal;
}) {
    const mod = await promptsApi();
    return mod.listPrompts(options);
}
