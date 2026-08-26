import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  /** Re-probe the session, e.g. after login or logout. */
  refresh: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [nonce, setNonce] = useState(0);

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
        // Backend unreachable — land on the static login screen rather than
        // hanging on a skeleton or bouncing during a transient outage.
        if (!cancelled) setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value: AuthState = {
    status,
    user,
    needsSetup,
    refresh: () => setNonce((n) => n + 1),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
