import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext.jsx";
import { useAuthPrompt } from "./AuthPromptContext.jsx";

export function ProtectedCanvasRoute({ children }) {
  const auth = useAuth();
  const location = useLocation();
  const { requestAuth } = useAuthPrompt();

  useEffect(() => {
    if (auth.loading || auth.isAuthenticated) return;
    requestAuth({
      featureLabel: "无限画布",
      returnTo: `${location.pathname}${location.search}${location.hash}`,
    });
  }, [auth.isAuthenticated, auth.loading, location.hash, location.pathname, location.search, requestAuth]);

  if (auth.loading) return null;
  if (!auth.isAuthenticated) return <Navigate replace to="/canvas" />;
  return children || <Outlet />;
}
