export function shouldPromoteGeneratedImage(primaryImageId: string | undefined, completedImageId: string, currentImageIds: readonly string[]) {
    if (!primaryImageId || primaryImageId === completedImageId) return true;
    return !currentImageIds.includes(primaryImageId);
}
