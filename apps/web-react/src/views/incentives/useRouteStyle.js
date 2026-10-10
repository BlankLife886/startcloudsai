import { useLayoutEffect } from "react";

export function useRouteStyle(styleId, css) {
  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);

    return () => style.remove();
  }, [css, styleId]);
}
