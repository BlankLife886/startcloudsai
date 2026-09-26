export function appendConnectedTextToPrompt(prompt: string, texts: Array<string | undefined>) {
    const upstreamText = texts.filter(Boolean).join("\n\n");
    return upstreamText ? `${prompt}\n\n${upstreamText}` : prompt;
}
