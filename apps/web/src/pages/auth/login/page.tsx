import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { TriangleAlert } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { useAuth } from "@/lib/auth";
import { ApiError, NetworkError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Real login against the backend. Forgot-password consumes a backup code. */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recovery dialog state
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveringBusy, setRecoveringBusy] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const intended = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  async function postJson(path: string, body: unknown): Promise<Response> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      throw new ApiError(
        response.status,
        payload?.error?.code ?? "UNKNOWN",
        payload?.error?.message ?? "Request failed"
      );
    }
    return response;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await postJson("/api/auth/login", { email, password });
      refresh();
      navigate(intended, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof NetworkError
          ? "Cannot reach the server"
          : cause instanceof ApiError
            ? cause.message
            : "Login failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitRecovery = async () => {
    if (recoveringBusy) return;
    setRecoveringBusy(true);
    setRecoverError(null);
    try {
      await postJson("/api/auth/recover", { code, password: newPassword });
      setRecovered(true);
    } catch (cause) {
      setRecoverError(cause instanceof ApiError ? cause.message : "Recovery failed");
    } finally {
      setRecoveringBusy(false);
    }
  };

  return (
    <>
      <AuthShell
        title="Welcome back"
        description="Log in to your Freelancer Agent workspace."
        footer={
          <>
            New here?{" "}
            <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error !== null ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                onClick={() => setRecovering(true)}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </AuthShell>

      <Dialog
        open={recovering}
        onOpenChange={(open) => {
          setRecovering(open);
          if (!open) {
            setRecovered(false);
            setRecoverError(null);
            setCode("");
            setNewPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          {recovered ? (
            <>
              <DialogHeader>
                <DialogTitle>Password updated</DialogTitle>
                <DialogDescription>
                  Your password was changed and other sessions were signed out.
                  Log in with the new password now.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setRecovering(false)}>Back to login</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Use a backup code</DialogTitle>
                <DialogDescription>
                  Enter one of the one-time codes from registration together with
                  the new password you want. Each code works once.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {recoverError !== null ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
                    {recoverError}
                  </p>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="backup-code">Backup code</Label>
                  <Input
                    id="backup-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    className="font-mono uppercase"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={10}
                    placeholder="At least 10 characters"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRecovering(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={submitRecovery}
                  disabled={
                    recoveringBusy || code.trim().length === 0 || newPassword.length < 10
                  }
                >
                  {recoveringBusy ? "Resetting…" : "Reset password"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
