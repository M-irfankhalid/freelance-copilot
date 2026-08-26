import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCheck, Copy, ShieldCheck, TriangleAlert } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { useAuth } from "@/lib/auth";
import { ApiError, NetworkError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Real signup. Step one registers the installation owner; step two presents
 * the server-generated backup codes — the only time they are ever shown.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [step, setStep] = useState<"account" | "codes">("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step two
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        throw new ApiError(
          response.status,
          payload?.error?.code ?? "UNKNOWN",
          payload?.error?.message ?? "Registration failed"
        );
      }
      const body = (await response.json()) as { backupCodes: string[] };
      setCodes(body.backupCodes);
      refresh();
      setStep("codes");
    } catch (cause) {
      setError(
        cause instanceof NetworkError
          ? "Cannot reach the server"
          : cause instanceof ApiError
            ? cause.message
            : "Registration failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "account") {
    return (
      <AuthShell
        title="Create your workspace"
        description="One installation, one owner. You will receive backup codes next."
        footer={
          <>
            Already registered?{" "}
            <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Log in
            </Link>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={register}>
          {error !== null ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              placeholder="Jane Cooper"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </div>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 10 characters"
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Save your backup codes"
      description="These eight one-time codes restore access if you forget your password. They are shown only once."
    >
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        Store them somewhere safe, like a password manager. Anyone holding a
        code can reset this workspace password.
      </div>

      <ul className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-2 font-mono text-sm tracking-wide">
        {codes.map((code) => (
          <li key={code} className="rounded-md px-2 py-1.5 text-center bg-background ring-1 ring-foreground/5">
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
          I have stored my backup codes somewhere safe
        </label>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              void navigator.clipboard?.writeText(codes.join("\n"));
              setCopied(true);
            }}
          >
            {copied ? <CheckCheck data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button
            className="flex-1"
            disabled={!saved}
            onClick={() => navigate("/onboarding")}
          >
            Continue to setup
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
