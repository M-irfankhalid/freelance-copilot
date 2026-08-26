import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCheck, Copy, ShieldCheck } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Deterministic demo codes so the screen is stable across renders. */
const mockBackupCodes = [
  "4821-9375-A2XC",
  "7702-1184-KQ9M",
  "1550-6643-ZT7B",
  "9908-2371-DW5R",
  "3364-8052-HN1Y",
  "6147-2290-PX8L",
  "2583-7716-JV4F",
  "8029-4437-CM6G",
];

/**
 * Mock signup. Step two presents the one-time backup codes — the only time
 * they are ever shown.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"account" | "codes">("account");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

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
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setStep("codes");
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" placeholder="Jane Cooper" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
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
              required
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 w-full">
            Create account
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
        code can get into this workspace.
      </div>

      <ul className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-2 font-mono text-sm tracking-wide">
        {mockBackupCodes.map((code) => (
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
              void navigator.clipboard?.writeText(mockBackupCodes.join("\n"));
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
