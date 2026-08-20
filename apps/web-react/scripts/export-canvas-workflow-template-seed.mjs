import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CANVAS_WORKFLOW_TEMPLATES, createCanvasProjectFromTemplate } from "../src/canvas/templates/canvas-workflow-templates.ts";

const outputPath = resolve(process.argv[2] || "../server/internal/store/canvas_workflow_template_defaults.json");
const rows = CANVAS_WORKFLOW_TEMPLATES.map((template, index) => {
    const project = createCanvasProjectFromTemplate(template);
    return {
        slug: template.id,
        title: template.title,
        category: template.category,
        categoryLabel: template.categoryLabel,
        industry: template.industry,
        summary: template.summary,
        platforms: template.platforms,
        deliverables: template.deliverables,
        accent: template.accent,
        nodeCount: template.nodeCount,
        enabled: true,
        sort: index * 10,
        document: {
            version: 3,
            nodes: project.nodes,
            connections: project.connections,
            backgroundMode: project.backgroundMode,
            showImageInfo: project.showImageInfo,
            viewport: project.viewport,
        },
    };
});

await writeFile(outputPath, `${JSON.stringify(rows)}\n`);
console.log(`Exported ${rows.length} canvas templates to ${outputPath}`);
