import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import {
  fetchCurrentAccount,
  getAuthSession,
} from "@react/legacy-modules/services/auth.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getAuthSession()?.user || null);
  const [loading, setLoading] = useState(() => !getAuthSession()?.user);

  const refresh = useCallback(async () => {
    setLoading((current) => current && !getAuthSession()?.user);
    try {
      const account = await fetchCurrentAccount();
      setUser(account || null);
      return account || null;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setUser(null);
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    refresh().catch(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user?.id),
      setUser,
      refresh,
    }),
    [loading, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) {
    return <div className="route-auth-loading" aria-label="正在确认登录状态" />;
  }
  if (!auth.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/auth?mode=login&redirect=${redirect}`} />;
  }
  return <Outlet />;
}
