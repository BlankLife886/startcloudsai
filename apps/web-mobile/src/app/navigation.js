import { useCallback } from "react";
import { useNavigate } from "react-router";

/** 二级页的返回：站内有上一页就退回去，直接打开的链接则回到兜底页。 */
export function useGoBack(fallback) {
  const navigate = useNavigate();
  return useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [fallback, navigate]);
}
