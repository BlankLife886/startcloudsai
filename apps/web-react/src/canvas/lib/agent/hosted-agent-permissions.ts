/**
 * Automatic write permission includes ordinary node deletion. Clearing the
 * entire canvas is a high-impact action and stays explicit even when an Agent
 * has automatic write permission, just like restore operations.
 */
export function shouldConfirmHostedCanvasTool(name: string, confirmWrites: boolean, mutates: boolean) {
    return (confirmWrites && mutates)
        || name === "canvas_clear"
        || name === "canvas_restore_checkpoint"
        || name === "canvas_restore_agent_transaction";
}
