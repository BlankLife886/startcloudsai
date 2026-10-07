import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd-mobile";
import zhCN from "antd-mobile/es/locales/zh-CN";
import { AuthProvider } from "@react/auth/AuthContext.jsx";
import { App } from "./app/App.jsx";
import { installColorScheme } from "./app/colorScheme.js";
import { ToastBridge } from "./app/ToastBridge.jsx";
import { OverlayHost } from "./components/overlay/index.js";
import "./styles/base.css";

installColorScheme();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AuthProvider>
        <ToastBridge />
        <OverlayHost />
        <App />
      </AuthProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
