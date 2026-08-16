import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { normalizeCanvasRoutePath } from "@react/legacy-modules/services/canvasApp.js";
import { useAuth } from "./AuthContext.jsx";
import { useAuthPrompt } from "./AuthPromptContext.jsx";

function legacyTarget(value) {
  const normalized = normalizeCanvasRoutePath(value, "");
  if (!normalized) return "/canvas";
  const parsed = new URL(normalized, "https://canvas.starclouds.local");
  if (parsed.pathname === "/config")
    return `/canvas/config${parsed.search}${parsed.hash}`;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function targetRequiresAuth(target) {
  const parsed = new URL(target, "https://canvas.starclouds.local");
  if (parsed.pathname === "/canvas/config" || parsed.pathname.startsWith("/canvas/"))
    return true;
  return ["new", "recent", "choose"].includes(parsed.searchParams.get("mode"));
}

export function CanvasEntryGate({ children }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { requestAuth } = useAuthPrompt();
  const params = new URLSearchParams(location.search);
  const legacyView = params.get("view");
  const target = legacyView
    ? legacyTarget(legacyView)
    : `${location.pathname}${location.search}${location.hash}`;
  const protectedTarget = targetRequiresAuth(target);

  useEffect(() => {
    if (legacyView && !protectedTarget) {
      void navigate(target, { replace: true });
      return;
    }
    if (auth.loading) return;
    if (!auth.isAuthenticated && protectedTarget) {
      requestAuth({
        featureLabel: "无限画布",
        returnTo: `${location.pathname}${location.search}${location.hash}`,
      });
      void navigate("/canvas", { replace: true });
      return;
    }
    if (legacyView) void navigate(target, { replace: true });
  }, [
    auth.isAuthenticated,
    auth.loading,
    legacyView,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    protectedTarget,
    requestAuth,
    target,
  ]);

  if (
    legacyView ||
    (protectedTarget && (auth.loading || !auth.isAuthenticated))
  )
    return null;
  return children;
}
