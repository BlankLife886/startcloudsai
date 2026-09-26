import { useEffect, useState } from "react";
import { Modal } from "antd";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cloudDisplayUrl, cloudFileUrl, isCloudThumbnailUrl, isLocalImageKey } from "@/lib/canvas/canvas-preview-url";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

export function CanvasImageLightbox({ node, image, open, onClose }: { node: CanvasNodeData | null; image?: CanvasNodeImage | null; open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const [src, setSrc] = useState("");
    const [fallback, setFallback] = useState("");

    useEffect(() => {
        if (!open || !node) {
            setSrc("");
            setFallback("");
            return;
        }
        const content = image?.content || node.metadata?.content || "";
        const storageKey = image?.storageKey || node.metadata?.storageKey || "";
        const original = cloudFileUrl(storageKey) || (!isCloudThumbnailUrl(content) ? content : "") || content;
        // 放大预览优先加载展示图（服务端压缩过的大图）；
        // 旧图没有展示图时 onError 回退到原图。
        const display = cloudDisplayUrl(storageKey) || cloudDisplayUrl(content);
        let cancelled = false;
        if (isLocalImageKey(storageKey) || isLocalImageKey(content)) {
            setFallback("");
            void resolveMediaUrl(storageKey || content, original).then((url) => {
                if (!cancelled) setSrc(url || original);
            });
            return () => {
                cancelled = true;
            };
        }
        setSrc(display || original);
        setFallback(display && display !== original ? original : "");
        return () => {
            cancelled = true;
        };
    }, [image, node, open]);

    return (
        <Modal
            className="canvas-image-lightbox"
            rootClassName="canvas-image-lightbox-root"
            title={null}
            open={open}
            centered
            footer={null}
            closable={false}
            width="auto"
            destroyOnHidden
            onCancel={onClose}
        >
            <div data-canvas-no-zoom data-canvas-shortcuts-ignore className="canvas-image-lightbox-stage" onWheel={(event) => event.stopPropagation()}>
                {src ? (
                    <>
                        <img
                            src={src}
                            alt={node?.title || t("assets.kinds.image")}
                            className="canvas-image-lightbox-image"
                            onError={() => {
                                if (fallback && src !== fallback) {
                                    setSrc(fallback);
                                    setFallback("");
                                }
                            }}
                        />
                        <button type="button" className="canvas-image-lightbox-close" onClick={onClose} aria-label={t("canvas.project.close")}>
                            <X className="size-4" />
                        </button>
                    </>
                ) : (
                    <div className="grid h-48 w-72 place-items-center text-[13px] text-white/60">{t("canvas.editors.loading")}</div>
                )}
            </div>
        </Modal>
    );
}
