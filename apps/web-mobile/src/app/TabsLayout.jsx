import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { DotLoading } from "antd-mobile";
import { HomeIcon, PaletteIcon, PersonIcon, ReceiptIcon, SparkleIcon } from "@mobile/components/icons.jsx";
import { TabBar } from "./TabBar.jsx";
import "./tabs.css";

const HomePage = lazy(() => import("../pages/home/HomePage.jsx"));
const DesignPage = lazy(() => import("../pages/design/DesignPage.jsx"));
const AssistantPage = lazy(() => import("../pages/assistant/AssistantPage.jsx"));
const OrdersPage = lazy(() => import("../pages/placeholder/OrdersPage.jsx"));
const MePage = lazy(() => import("../pages/me/MePage.jsx"));
const CreatePage = lazy(() => import("../pages/create/CreatePage.jsx"));

// 与 App 底栏相同的五个入口与顺序。
export const TABS = [
  { path: "/home", title: "首页", icon: HomeIcon, Page: HomePage },
  { path: "/design", title: "设计", icon: PaletteIcon, Page: DesignPage },
  { path: "/assistant", title: "助手", icon: SparkleIcon, featured: true, Page: AssistantPage },
  { path: "/orders", title: "订单", icon: ReceiptIcon, Page: OrdersPage },
  { path: "/me", title: "我的", icon: PersonIcon, Page: MePage },
];

// 从 Tab 打开的二级页：不显示底栏，但同样保持挂载，返回后草稿与滚动位置都在。
export const STACK_PAGES = [
  { path: "/create", Page: CreatePage },
];

const PAGES = [...TABS, ...STACK_PAGES];

function PageFallback() {
  return <div className="m-page-fallback"><DotLoading color="primary" /></div>;
}

// 输入框聚焦时（手机上即键盘弹出）收起 Tab 栏，把空间让给输入。
function useEditingFlag() {
  useEffect(() => {
    let timer = 0;
    const editable = (node) => node?.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable=true]");
    const onFocusIn = (event) => {
      if (!editable(event.target)) return;
      window.clearTimeout(timer);
      document.documentElement.dataset.editing = "true";
    };
    const onFocusOut = () => {
      // 在两个输入框之间切换时不闪一下 Tab 栏。
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!editable(document.activeElement)) delete document.documentElement.dataset.editing;
      }, 120);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      delete document.documentElement.dataset.editing;
    };
  }, []);
}

/**
 * 底部 Tab 外壳。访问过的页面保持挂载（只是隐藏），切回来时内容、草稿和滚动位置都还在，
 * 不会重新加载；再次点当前 Tab 回到顶部。
 */
export function TabsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = PAGES.find((page) => location.pathname.startsWith(page.path)) || TABS[0];
  const stack = STACK_PAGES.includes(active);
  const [visited, setVisited] = useState(() => new Set([active.path]));
  const scrollPositions = useRef(new Map());
  const previous = useRef(active.path);
  useEditingFlag();

  useLayoutEffect(() => {
    if (previous.current === active.path) return;
    previous.current = active.path;
    window.scrollTo(0, scrollPositions.current.get(active.path) || 0);
  }, [active.path]);

  // 离开页面前记下滚动位置（包括从 Tab 打开二级页、再返回的情况）。
  useEffect(() => {
    const path = active.path;
    const onScroll = () => scrollPositions.current.set(path, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active.path]);

  useEffect(() => {
    setVisited((current) => (current.has(active.path) ? current : new Set(current).add(active.path)));
  }, [active.path]);

  const switchTo = (index) => {
    const tab = TABS[index];
    if (tab.path === active.path) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigator.vibrate?.(8);
    navigate(tab.path);
  };

  return (
    <div className={`m-tabs${stack ? " is-stack" : ""}`}>
      {PAGES.filter((page) => visited.has(page.path) || page.path === active.path).map(({ path, Page }) => (
        <section key={path} className="m-tab-page" hidden={path !== active.path}>
          <Suspense fallback={<PageFallback />}>
            <Page active={path === active.path} />
          </Suspense>
        </section>
      ))}
      <TabBar tabs={TABS} activeIndex={Math.max(0, TABS.indexOf(active))} onSelect={switchTo} />
    </div>
  );
}
