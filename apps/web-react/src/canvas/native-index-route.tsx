import { CanvasEntryGate } from "@react/auth/CanvasEntryGate.jsx";

import { CanvasNativeLayout } from "./native-layout";
import CanvasPage from "@/pages/canvas";

export function CanvasNativeIndexRoute() {
    return (
        <CanvasEntryGate>
            <CanvasNativeLayout>
                <CanvasPage />
            </CanvasNativeLayout>
        </CanvasEntryGate>
    );
}
