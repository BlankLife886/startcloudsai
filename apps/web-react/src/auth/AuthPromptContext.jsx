import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { setUnauthorizedHandler } from "@react/legacy-modules/services/apiClient.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import { useAuth } from "./AuthContext.jsx";
import { AuthRequiredDialog } from "./AuthRequiredDialog.jsx";
import "@react/legacy-styles/generated/components/auth/AuthRequiredDialog.css";

const AuthPromptContext = createContext(null);
const SCROLL_LOCK_OWNER = "global-auth-prompt";
const AUTH_BACKGROUND_URL = "/brand/auth-manga-bg.png";

const pageLabels = {
  "/assistant": "AI 助手",
  "/ecommerce-design": "AI 电商",
  "/ai-illustration-coloring": "插画染色",
  "/tools/background-remove": "背景移除",
  "/design-workshop": "UI 设计稿",
  "/model-sheet": "模型设计",
  "/game-art": "游戏设计",
  "/canvas": "无限画布",
  "/check-in": "每日签到",
  "/history": "历史记录",
  "/profile": "个人中心",
  "/submissions": "我的投稿",
  "/wallet": "我的钱包",
  "/orders": "我的订单",
  "/account": "账号设置",
  "/notifications": "通知中心",
  "/assets": "我的资产",
  "/materials": "我的资产",
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
  const authBackgroundReadyRef = useRef(Promise.resolve());
  const [prompt, setPrompt] = useState(null);

  const requestAuth = useCallback(
    (options = {}) => {
      if (auth.isAuthenticated) return false;
      setPrompt({
        featureLabel: options.featureLabel || pageLabel(location.pathname),
        detail: options.detail || "登录后即可保存创作记录，同步个人素材，首次注册自动创建账号。",
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
    return () => {
      setBodyScrollLock(SCROLL_LOCK_OWNER, false);
    };
  }, [close, prompt]);

  useEffect(() => {
    if (!prompt) return undefined;
    const image = new Image();
    image.src = AUTH_BACKGROUND_URL;
    authBackgroundReadyRef.current = image.decode
      ? image.decode().catch(() => undefined)
      : new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        });
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [prompt]);

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
    async (mode) => {
      const target = prompt?.returnTo || `${location.pathname}${location.search}${location.hash}`;
      await authBackgroundReadyRef.current;
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
