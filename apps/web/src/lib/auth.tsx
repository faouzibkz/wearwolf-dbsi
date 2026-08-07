"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "./api";

export interface Account {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

interface AccountContextValue {
  /** undefined while the initial /api/auth/me check is in flight, null once we know for sure nobody's logged in. */
  account: Account | null | undefined;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<Account>;
  signup: (username: string, password: string, email?: string) => Promise<Account>;
  logout: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: Account }>("/api/auth/me");
      setAccount(data.user);
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<{ user: Account }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setAccount(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (username: string, password: string, email?: string) => {
    const data = await apiFetch<{ user: Account }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password, email: email || undefined }),
    });
    setAccount(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
  }, []);

  const value = useMemo(() => ({ account, refresh, login, signup, logout }), [account, refresh, login, signup, logout]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount() must be used within <AccountProvider>.");
  return ctx;
}

export { ApiError };
