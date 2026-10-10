import { useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import { STACK_PAGES, TABS, TabsLayout } from "./TabsLayout.jsx";

const router = createBrowserRouter([
  { path: "/", element: <Navigate replace to="/home" /> },
  // 旧地址：灵感已并入首页的“提示词”。
  { path: "/inspire", element: <Navigate replace to="/home?tab=prompts" /> },
  // 页面由 TabsLayout 自己保持挂载并切换显示，这里只负责地址匹配。
  { element: <TabsLayout />, children: [...TABS, ...STACK_PAGES].map((page) => ({ path: page.path, element: null })) },
  // 手机版没有的页面（例如助手里“去画布 / 电商工作台”这类站内跳转）交给电脑版打开。
  { path: "*", element: <DesktopFallback /> },
], { basename: "/m" });

function DesktopFallback() {
  const location = useLocation();
  useEffect(() => {
    window.location.replace(`${location.pathname}${location.search}${location.hash}`);
  }, [location]);
  return null;
}

export function App() {
  return <RouterProvider router={router} />;
}
