import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { setUnauthorizedHandler } from "@react/legacy-modules/services/apiClient.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import { useAuth } from "./AuthContext.jsx";
import { AuthRequiredDialog } from "./AuthRequiredDialog.jsx";
import "@react/legacy-styles/generated/components/auth/AuthRequiredDialog.css";

const AuthPromptContext = createContext(null);
const SCROLL_LOCK_OWNER = "global-auth-prompt";

const pageLabels = {
  "/assistant": "AI 助手",
  "/ecommerce-design": "AI 电商",
  "/ai-illustration-coloring": "插画染色",
  "/tools/background-remove": "背景移除",
  "/design-workshop": "UI 设计稿",
  "/model-sheet": "模型设计",
  "/game-art": "游戏设计",
  "/canvas": "智能画布",
  "/check-in": "每日签到",
  "/history": "历史记录",
  "/profile": "个人中心",
  "/submissions": "我的投稿",
  "/wallet": "钱包",
  "/account": "账号设置",
  "/notifications": "通知中心",
  "/materials": "素材库",
  "/feedback": "问题反馈",
  "/text-to-image": "文生图",
};

function pageLabel(pathname) {
  return pageLabels[pathname] || (pathname.startsWith("/incentive-plans") ? "创作激励" : "当前功能");
}

export function AuthPromptProvider({ children }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationKey = `${location.pathname}${location.search}${location.hash}`;
  const lastActionRef = useRef({ at: 0, locationKey: "" });
  const [prompt, setPrompt] = useState(null);

  const requestAuth = useCallback(
    (options = {}) => {
      if (auth.isAuthenticated) return false;
      setPrompt({
        featureLabel: options.featureLabel || pageLabel(location.pathname),
        detail: options.detail || "登录后即可保存创作记录、同步个人素材，并在不同设备继续操作。首次邮箱验证会自动创建免费账号。",
        returnTo: options.returnTo || `${location.pathname}${location.search}${location.hash}`,
      });
      return true;
    },
    [auth.isAuthenticated, location.hash, location.pathname, location.search],
  );

  const close = useCallback(() => setPrompt(null), []);

  useEffect(() => {
    if (auth.isAuthenticated) setPrompt(null);
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!prompt) {
      setBodyScrollLock(SCROLL_LOCK_OWNER, false);
      return undefined;
    }
    setBodyScrollLock(SCROLL_LOCK_OWNER, true, { freezeViewport: true });
    const onKeyDown = (event) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      setBodyScrollLock(SCROLL_LOCK_OWNER, false);
    };
  }, [close, prompt]);

  useEffect(() => {
    const markAction = (event) => {
      if (event.target?.closest?.("a[href]")) {
        lastActionRef.current = { at: 0, locationKey: "" };
        return;
      }
      if (event.target?.closest?.("button, input[type='submit'], [role='button']")) {
        lastActionRef.current = { at: Date.now(), locationKey };
      }
    };
    document.addEventListener("pointerdown", markAction, true);
    setUnauthorizedHandler(() => {
      const lastAction = lastActionRef.current;
      if (
        !auth.isAuthenticated &&
        lastAction.locationKey === locationKey &&
        Date.now() - lastAction.at < 15_000
      ) requestAuth();
    });
    return () => {
      document.removeEventListener("pointerdown", markAction, true);
      setUnauthorizedHandler(null);
    };
  }, [auth.isAuthenticated, locationKey, requestAuth]);

  const continueToAuth = useCallback(
    (mode) => {
      const target = prompt?.returnTo || `${location.pathname}${location.search}${location.hash}`;
      setPrompt(null);
      navigate(`/auth?mode=${mode}&redirect=${encodeURIComponent(target)}`);
    },
    [location.hash, location.pathname, location.search, navigate, prompt?.returnTo],
  );

  const value = useMemo(() => ({ requestAuth, closeAuthPrompt: close }), [close, requestAuth]);

  return (
    <AuthPromptContext.Provider value={value}>
      {children}
      <AuthRequiredDialog
        open={Boolean(prompt)}
        featureLabel={prompt?.featureLabel}
        detail={prompt?.detail}
        onClose={close}
        onContinue={continueToAuth}
      />
    </AuthPromptContext.Provider>
  );
}

export function useAuthPrompt() {
  const value = useContext(AuthPromptContext);
  if (!value) throw new Error("useAuthPrompt must be used inside AuthPromptProvider");
  return value;
}
