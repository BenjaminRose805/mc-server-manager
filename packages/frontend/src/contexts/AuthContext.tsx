import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { UserRole, AuthResponse } from "@mc-server-manager/shared";
import {
  refreshAccessToken,
  logout as logoutApi,
  getAuthStatus,
} from "@/api/auth";
import { logger } from "@/utils/logger";

interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName?: string;
}

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean;
  singleUserMode: boolean;
  login: (response: AuthResponse) => void;
  logout: () => Promise<void>;
}

interface JWTPayload {
  sub: string;
  username: string;
  role: UserRole;
  displayName?: string;
  exp: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [singleUserMode, setSingleUserMode] = useState(false);
  const [refreshTimer, setRefreshTimer] = useState<number | null>(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
    setAccessToken(null);
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      setRefreshTimer(null);
    }
  }, [refreshTimer]);

  const scheduleRefresh = useCallback(
    (token: string) => {
      const payload = decodeJWT(token);
      if (!payload) return;

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = payload.exp - now;
      const refreshIn = Math.max(0, expiresIn - 60);

      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }

      const timer = window.setTimeout(async () => {
        const storedRefreshToken = localStorage.getItem("refreshToken");
        if (!storedRefreshToken) {
          clearAuth();
          return;
        }

        try {
          const response = await refreshAccessToken(storedRefreshToken);
          localStorage.setItem("accessToken", response.accessToken);
          if (response.refreshToken) {
            localStorage.setItem("refreshToken", response.refreshToken);
          }
          setAccessToken(response.accessToken);
          scheduleRefresh(response.accessToken);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.warn("Token refresh failed", { error: errorMsg });
          clearAuth();
        }
      }, refreshIn * 1000);

      setRefreshTimer(timer);
    },
    [refreshTimer, clearAuth],
  );

  const login = useCallback(
    (response: AuthResponse) => {
      localStorage.setItem("accessToken", response.accessToken);
      localStorage.setItem("refreshToken", response.refreshToken);
      setAccessToken(response.accessToken);
      setUser({
        id: response.user.id,
        username: response.user.username,
        role: response.user.role,
        displayName: response.user.displayName,
      });
      setNeedsSetup(false);
      setSingleUserMode(false);
      scheduleRefresh(response.accessToken);
    },
    [scheduleRefresh],
  );

  const logout = useCallback(async () => {
    const storedRefreshToken = localStorage.getItem("refreshToken");
    if (storedRefreshToken) {
      try {
        await logoutApi(storedRefreshToken);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn("Logout API call failed", { error: errorMsg });
      }
    }
    clearAuth();
  }, [clearAuth]);

  useEffect(() => {
    (async () => {
      try {
        const status = await getAuthStatus();
        if (status.setupRequired) {
          setNeedsSetup(true);
          setSingleUserMode(true);
          setIsLoading(false);
          return;
        }

        if (!status.multiUser) {
          setSingleUserMode(true);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.debug("Auth status check failed", { error: errorMsg });
        // If status endpoint fails, proceed with token-based auth
      }

      const storedToken = localStorage.getItem("accessToken");
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      const payload = decodeJWT(storedToken);
      if (!payload) {
        clearAuth();
        setIsLoading(false);
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        const storedRefreshToken = localStorage.getItem("refreshToken");
        if (!storedRefreshToken) {
          clearAuth();
          setIsLoading(false);
          return;
        }

        try {
          const response = await refreshAccessToken(storedRefreshToken);
          localStorage.setItem("accessToken", response.accessToken);
          if (response.refreshToken) {
            localStorage.setItem("refreshToken", response.refreshToken);
          }
          setAccessToken(response.accessToken);
          const newPayload = decodeJWT(response.accessToken);
          if (newPayload) {
            setUser({
              id: newPayload.sub,
              username: newPayload.username,
              role: newPayload.role,
              displayName: newPayload.displayName,
            });
            scheduleRefresh(response.accessToken);
          }
          setIsLoading(false);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.warn("Initial token refresh failed", { error: errorMsg });
          clearAuth();
          setIsLoading(false);
        }
      } else {
        setAccessToken(storedToken);
        setUser({
          id: payload.sub,
          username: payload.username,
          role: payload.role,
          displayName: payload.displayName,
        });
        scheduleRefresh(storedToken);
        setIsLoading(false);
      }
    })();
  }, [clearAuth, scheduleRefresh]);

  const value: AuthContextValue = {
    user,
    accessToken,
    isAuthenticated: !!user || singleUserMode,
    isLoading,
    needsSetup,
    singleUserMode,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
