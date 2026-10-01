/** Compact stable salt leaves room for project/node IDs in the API key limit. */
export function canvasAgentTaskSalt(requestId: string) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (const character of requestId) {
        left = Math.imul(left ^ character.codePointAt(0)!, 0x01000193);
        right = Math.imul(right ^ character.codePointAt(0)!, 0x5bd1e995);
    }
    return `agent-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}
