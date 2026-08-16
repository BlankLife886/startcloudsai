import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCurrentAccount,
  getAuthSession,
} from "@react/legacy-modules/services/auth.js";
import storageService from "@react/legacy-modules/services/storage.js";

const AuthContext = createContext(null);

function accountScope(user) {
  return user?.id ? `user_${user.id}` : "guest";
}

export function AuthProvider({ children }) {
  const initialUser = useMemo(() => getAuthSession()?.user || null, []);
  const userRef = useRef(initialUser);
  const [user, setUserState] = useState(() => {
    storageService.setActiveScope(accountScope(initialUser));
    return initialUser;
  });
  const [loading, setLoading] = useState(() => !getAuthSession()?.user);

  const setUser = useCallback((nextUser) => {
    const resolvedUser = typeof nextUser === "function" ? nextUser(userRef.current) : nextUser;
    userRef.current = resolvedUser || null;
    storageService.setActiveScope(accountScope(userRef.current));
    setUserState(userRef.current);
  }, []);

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
