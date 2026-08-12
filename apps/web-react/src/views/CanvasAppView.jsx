import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLocation, useNavigate } from "react-router";
import { CanvasEmbeddedApp } from "@canvas/embedded.tsx";
import {
  CANVAS_AUTH_REQUIRED_MESSAGE,
  CANVAS_APP_PATH,
  normalizeCanvasRoutePath,
} from "@react/legacy-modules/services/canvasApp.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import "@react/legacy-styles/generated/views/CanvasAppView.css";
import "./CanvasAppView.css";

export function CanvasAppView() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDark = useIsDark();
  const { requestAuth } = useAuthPrompt();
  const mountRef = useRef(null);
  const nativeRootRef = useRef(null);
  const lastActionAtRef = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [headerOffset, setHeaderOffset] = useState(0);
  const canvasPath = normalizeCanvasRoutePath(
    new URLSearchParams(location.search).get("view"),
  );

  const syncCanvasPath = useCallback(
    (nextValue) => {
      const nextPath = normalizeCanvasRoutePath(nextValue, "");
      if (!nextPath || nextPath === canvasPath) return;
      const query = new URLSearchParams(location.search);
      if (nextPath === CANVAS_APP_PATH) query.delete("view");
      else query.set("view", nextPath);
      const search = query.toString();
      void navigate(
        { pathname: location.pathname, search: search ? `?${search}` : "" },
        { replace: true },
      );
    },
    [canvasPath, location.pathname, location.search, navigate],
  );

  useEffect(() => {
    const header = document.querySelector(".site-header");
    const update = () =>
      setHeaderOffset(
        Math.max(62, Math.round(header?.getBoundingClientRect().height || 0)),
      );
    update();
    if (!header || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type !== CANVAS_AUTH_REQUIRED_MESSAGE) return;
      if (Date.now() - lastActionAtRef.current > 15_000) return;
      requestAuth({ featureLabel: "智能画布" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [requestAuth]);

  useLayoutEffect(() => {
    if (!mountRef.current) return undefined;
    const nativeRoot = createRoot(mountRef.current);
    nativeRootRef.current = nativeRoot;
    return () => {
      nativeRootRef.current = null;
      nativeRoot.unmount();
    };
  }, []);

  useLayoutEffect(() => {
    nativeRootRef.current?.render(
      <CanvasEmbeddedApp
        path={canvasPath}
        theme={isDark ? "dark" : "light"}
        headerOffset={headerOffset}
        onPathChange={syncCanvasPath}
        onReady={() => setLoaded(true)}
      />,
    );
  }, [canvasPath, headerOffset, isDark, syncCanvasPath]);

  return (
    <section className="canvas-app-view canvas-native-view" aria-busy={!loaded}>
      {!loaded && (
        <div className="canvas-app-loading" role="status">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span>正在加载智能画布...</span>
        </div>
      )}
      <div
        ref={mountRef}
        className={`canvas-native-mount starclouds-hosted${isDark ? " dark" : ""}${loaded ? " is-ready" : ""}`}
        onPointerDownCapture={() => { lastActionAtRef.current = Date.now(); }}
      />
    </section>
  );
}
