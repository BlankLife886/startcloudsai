import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { ecommerceBusinessById } from "../features/ecommerce/businesses/businessRegistry.js";
import { ECOMMERCE_MODES } from "../features/ecommerce/ecommerceTools.js";
import { EcommerceModuleStatus } from "../features/ecommerce/EcommerceModuleStatus.jsx";
import { PAGE_STATUS, pageControlForKey } from "../config/pageControls.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { useCommerceModels } from "../features/ecommerce/useCommerceModels.js";
import { EcommerceBusinessSession } from "./EcommerceBusinessSession.jsx";

export function EcommerceDesignView() {
  const [params, setParams] = useSearchParams();
  const { controls } = usePageControls();
  const commerceModels = useCommerceModels(); // 唯一跨模块共享：顶部生成模型；各模块按 key 独立挂载
  const firstSessionRef = useRef("");
  const switchedRef = useRef(false);
  const business = ecommerceBusinessById(params.get("tool") || "shoot");
  const control = pageControlForKey(controls, `ecommerce.${business.id}`);
  const availableModes = useMemo(
    () =>
      ECOMMERCE_MODES.filter(
        (mode) =>
          pageControlForKey(controls, `ecommerce.${mode.id}`).status !==
          PAGE_STATUS.REMOVED,
      ),
    [controls],
  );
  const fallbackMode =
    availableModes.find(
      (mode) =>
        pageControlForKey(controls, `ecommerce.${mode.id}`).status ===
        PAGE_STATUS.NORMAL,
    ) || availableModes[0];

  useEffect(() => {
    if (control.status !== PAGE_STATUS.REMOVED || !fallbackMode) return;
    const next = new URLSearchParams(params);
    next.set("tool", fallbackMode.id);
    setParams(next, { replace: true });
  }, [business.id, control.status, fallbackMode, params, setParams]);
  const availableModeIds = availableModes.map((mode) => mode.id);
  const moduleUnavailable =
    control.status === PAGE_STATUS.MAINTENANCE ||
    control.status === PAGE_STATUS.DEVELOPING;
  const sessionBusinessId =
    control.status === PAGE_STATUS.REMOVED && fallbackMode
      ? fallbackMode.id
      : business.id;
  if (!firstSessionRef.current) firstSessionRef.current = sessionBusinessId;
  if (firstSessionRef.current !== sessionBusinessId) switchedRef.current = true;

  return (
    <div
      className={`ecommerce-module-gate${moduleUnavailable ? " has-overlay" : ""}`}
    >
      <div className="ecommerce-module-gate__base">
        <EcommerceBusinessSession
          key={sessionBusinessId}
          businessId={sessionBusinessId}
          sharedModels={commerceModels}
          animateEntrance={!switchedRef.current} // 切换模块不重播入场动画
          availableModeIds={availableModeIds}
          moduleUnavailable={moduleUnavailable}
        />
      </div>
      {moduleUnavailable && (
        <div className="ecommerce-module-gate__overlay">
          <EcommerceModuleStatus
            mode={business.mode}
            control={control}
            availableModeIds={availableModeIds}
            overlay
          />
        </div>
      )}
    </div>
  );
}
