import { useLayoutEffect } from "react";

export function useRouteStyle(activate, deactivate) {
  useLayoutEffect(() => {
    activate();
    return deactivate;
  }, [activate, deactivate]);
}
