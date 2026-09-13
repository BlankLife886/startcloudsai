/** Automatic write permission includes node deletion; whole-canvas reset/restore stays explicit. */
export function shouldConfirmHostedCanvasTool(name: string, confirmWrites: boolean, mutates: boolean) {
    return (confirmWrites && mutates) || name === "canvas_clear" || name === "canvas_restore_checkpoint" || name === "canvas_restore_agent_transaction";
}
