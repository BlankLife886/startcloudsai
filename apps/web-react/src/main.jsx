import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "@legacy/assets/base.css";
import "@legacy/assets/main.css";
import "@legacy/assets/css/themes/default.css";
import "@legacy/assets/css/global-theme-fixes.css";
import "@legacy/assets/css/image-reveal.css";
import { router } from "./router.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
