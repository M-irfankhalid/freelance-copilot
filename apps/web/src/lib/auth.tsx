import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Authentication state for the whole app. The status comes from the server's
 * session probe — the frontend never decides auth by itself.
 *
 * While the backend reports `authEnabled: false` (true until Phase 4), the
 * status is "unavailable" and route protection is bypassed so the rest of
 * the app stays usable during development.
 */

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

interface SessionBody {
  authenticated: boolean;
  authEnabled: boolean;
}

const AuthContext = createContext<{ status: AuthStatus; refresh: () => void } | null>(
  null
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => response.json() as Promise<SessionBody>)
      .then((body) => {
        if (cancelled) return;
        setStatus(
          body.authEnabled
            ? body.authenticated
              ? "authenticated"
              : "unauthenticated"
            : "unavailable"
        );
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = {
    status,
    refresh: () => setNonce((n) => n + 1),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
