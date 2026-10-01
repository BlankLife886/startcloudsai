import type { CanvasNodeData } from "../../types/canvas.ts";
import { canvasWorkflowValueFingerprint } from "./canvas-workflow-signature.ts";

type ShotReference = { storageKey?: string; url?: string; dataUrl?: string };

/** Durable identity of one reference. A session-scoped source has none. */
function referenceIdentity(reference: ShotReference) {
    const source = String(reference.storageKey || reference.url || "").trim();
    return /^(?:data:|blob:)/i.test(source) ? "" : source;
}

/**
 * Signs everything the server receives for one image: the trimmed prompt, the
 * resolved task params, the image count, and the ordered reference keys.
 * Reference order is significant because edit models read references
 * positionally, so the list must not be sorted.
 *
 * Returns null when any reference lacks a durable identity. A blob or data
 * source cannot be compared across runs, and reusing an image on an
 * uncomparable input would silently serve a stale result.
 */
export function canvasShotInputSignature(input: {
    prompt: string;
    params: unknown;
    count: number;
    references: ShotReference[];
}) {
    const references = input.references.map(referenceIdentity);
    if (references.some((identity) => !identity)) return null;
    return canvasWorkflowValueFingerprint({
        prompt: String(input.prompt || "").trim(),
        params: input.params,
        count: input.count,
        references,
    });
}

/** Where a shot's pixels live once a generation lands, in the order a success writes them. */
function canvasShotImageSource(node: CanvasNodeData) {
    const metadata = node.metadata || {};
    return String(metadata.storageKey || metadata.content || "").trim();
}

/**
 * An existing image may be reused only when it was produced by exactly this
 * input and is still the image that input produced.
 *
 * Both halves matter. The signature is written only when a shot succeeds, so a
 * failed shot keeps the signature of its last success and can never match the
 * inputs it failed on. The recorded output is checked against the node's
 * current pixels so that anything which replaced them since — task recovery, an
 * Agent edit, a manual upload — is detected without this module having to know
 * every path that can write an image.
 */
export function canvasShotIsReusable(node: CanvasNodeData | null | undefined, signature: string | null) {
    if (!node || !signature) return false;
    if (node.metadata?.storyboardShotSignature !== signature) return false;
    if (node.metadata?.storyboardStatus !== "succeeded") return false;
    const produced = String(node.metadata?.storyboardShotOutput || "").trim();
    return Boolean(produced) && produced === canvasShotImageSource(node);
}
