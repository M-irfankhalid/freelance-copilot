import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Authentication state for the whole app. The status comes from the server's
 * session probe — the frontend never decides auth by itself.
 */

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionUser {
  name: string;
  email: string;
}

interface SessionBody {
  authenticated: boolean;
  authEnabled: boolean;
  needsSetup?: boolean;
  user?: SessionUser | null;
}

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** True when no account exists yet — the frontend can nudge toward /signup. */
  needsSetup: boolean;
  /** Re-probe the session, e.g. after login or logout. Resolves when the
   * refreshed auth state has been applied. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      const body = (await response.json()) as SessionBody;
      setStatus(
        !body.authEnabled
          ? "unauthenticated"
          : body.authenticated
            ? "authenticated"
            : "unauthenticated"
      );
      setUser(body.user ?? null);
      setNeedsSetup(body.needsSetup ?? false);
    } catch {
      // Backend unreachable — land on the static login screen rather than
      // hanging on a skeleton or bouncing during a transient outage.
      setStatus("unauthenticated");
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => response.json() as Promise<SessionBody>)
      .then((body) => {
        if (cancelled) return;
        setStatus(
          !body.authEnabled
            ? "unauthenticated"
            : body.authenticated
              ? "authenticated"
              : "unauthenticated"
        );
        setUser(body.user ?? null);
        setNeedsSetup(body.needsSetup ?? false);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unauthenticated");
          setUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      needsSetup,
      refresh,
    }),
    [status, user, needsSetup, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
