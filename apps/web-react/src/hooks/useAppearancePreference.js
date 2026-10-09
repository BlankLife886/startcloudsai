import { useEffect, useState } from "react";
import { readAppearancePreference } from "../theme/appearance.js";

function readPreference() {
  return document.documentElement.dataset.colorSchemePreference || readAppearancePreference();
}

// 当前外观偏好（light / dark / system），随 setAppearance 实时更新
export function useAppearancePreference() {
  const [preference, setPreference] = useState(readPreference);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setPreference(readPreference()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-color-scheme-preference"] });
    return () => observer.disconnect();
  }, []);

  return preference;
}
