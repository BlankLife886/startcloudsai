type CanvasProjectSnapshot = {
    id: string;
    revision?: number;
    updatedAt: string;
};

export function mergeCanvasProjectSnapshots<T extends CanvasProjectSnapshot>(cloudProjects: T[], localProjects: T[]) {
    const localById = new Map(localProjects.map((project) => [project.id, project]));
    const localNewerIds: string[] = [];
    const projects = cloudProjects.map((cloud) => {
        const local = localById.get(cloud.id);
        const sameRevision = Boolean(local?.revision && cloud.revision && local.revision === cloud.revision);
        if (!local || !sameRevision || local.updatedAt <= cloud.updatedAt) return cloud;
        localNewerIds.push(local.id);
        return local;
    });
    return { projects, localNewerIds };
}

