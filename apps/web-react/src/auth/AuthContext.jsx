import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAuthSession,
  fetchCurrentAccount,
  getAuthSession,
  setAuthSession,
} from "@react/legacy-modules/services/auth.js";
import storageService from "@react/legacy-modules/services/storage.js";
import { subscribeUserTasks } from "@react/legacy-modules/services/tasksApi.js";

const AuthContext = createContext(null);

function accountScope(user) {
  return user?.id ? `user_${user.id}` : "guest";
}

function mergeAccountUser(current, account) {
  if (!account?.id) return null;
  if (Object.prototype.hasOwnProperty.call(account, "studioFigureUrl")) {
    return account;
  }
  return {
    ...account,
    studioFigureUrl: current?.id === account.id ? current?.studioFigureUrl || null : null,
  };
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
    if (userRef.current?.id) setAuthSession({ user: userRef.current });
    else clearAuthSession();
    setUserState(userRef.current);
  }, []);

  const refresh = useCallback(async () => {
    setLoading((current) => current && !getAuthSession()?.user);
    try {
      const account = await fetchCurrentAccount();
      setUser((current) => mergeAccountUser(current, account));
      return userRef.current;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setUser(null);
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    let disposed = false;
    refresh().catch(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!user?.id) return undefined;
    return subscribeUserTasks();
  }, [user?.id]);

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
