import { useState } from "react";
import { Tooltip } from "antd";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect }: { onSelect: (prompt: string) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title={t("navigation.prompts")}>
                <button
                    type="button"
                    className="grid size-8 shrink-0 place-items-center rounded-full"
                    style={{ color: theme.node.muted }}
                    onClick={() => setOpen(true)}
                    aria-label={t("navigation.prompts")}
                >
                    <BookOpen className="size-3.5" />
                </button>
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />
        </>
    );
}
