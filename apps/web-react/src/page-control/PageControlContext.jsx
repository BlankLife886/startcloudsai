import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import {
  getDefaultPageControls,
  isPageEntryVisible,
  normalizePageControls,
  pageControlForKey,
} from "../config/pageControls.js";

const PageControlContext = createContext(null);

export function PageControlProvider({ children }) {
  const [controls, setControls] = useState(getDefaultPageControls);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchRuntimeConfig()
      .then((config) => {
        if (active) setControls(normalizePageControls(config.pageControls));
      })
      .catch(() => null)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      controls,
      loading,
      controlForKey: (key) => pageControlForKey(controls, key),
      isEntryVisible: (keyOrHref) => isPageEntryVisible(controls, keyOrHref),
    }),
    [controls, loading],
  );

  return <PageControlContext.Provider value={value}>{children}</PageControlContext.Provider>;
}

export function usePageControls() {
  const value = useContext(PageControlContext);
  if (!value) throw new Error("usePageControls must be used inside PageControlProvider");
  return value;
}
