import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "@react/legacy-static/assets/base.css";
import "@react/legacy-static/assets/main.css";
import "@react/legacy-static/assets/css/themes/default.css";
import "@react/legacy-static/assets/css/global-theme-fixes.css";
import "@react/legacy-static/assets/css/image-reveal.css";
import { router } from "./router.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { LocaleProvider } from "./i18n/index.js";
import { installDevPerformanceEntryGuard } from "./utils/devPerformanceEntryGuard.js";
import { installGlobalClickGuard } from "./utils/globalClickGuard.js";
import "./styles.css";

const removeGlobalClickGuard = installGlobalClickGuard();
const removeDevPerformanceEntryGuard = import.meta.env.DEV ? installDevPerformanceEntryGuard() : () => {};
if (import.meta.hot) {
  import.meta.hot.dispose(removeGlobalClickGuard);
  import.meta.hot.dispose(removeDevPerformanceEntryGuard);
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
