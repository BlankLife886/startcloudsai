import { useEffect, useState } from "react";

function readIsDark() {
  return document.documentElement.classList.contains("color-scheme-dark");
}

export function useIsDark() {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
