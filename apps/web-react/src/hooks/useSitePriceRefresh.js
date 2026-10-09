import { useEffect, useRef } from "react";
import { fetchRuntimeConfig, onSitePricesChanged } from "@react/legacy-modules/services/runtimeConfig.js";

// 动态调价到点（规则开始或结束）时重新拉取运行时配置并交给 onConfig，页面只用它更新
// 模型列表和价格；用户已选的模型、参数和草稿都不动。
export function useSitePriceRefresh(onConfig) {
  const handlerRef = useRef(onConfig);
  handlerRef.current = onConfig;
  useEffect(() => {
    let active = true;
    const off = onSitePricesChanged(() => {
      // 事件发出前缓存已清空，这里拉到的是新配置；同时监听的几处共用一次请求。
      fetchRuntimeConfig()
        .then((config) => {
          if (active) handlerRef.current?.(config);
        })
        .catch(() => null);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
}
