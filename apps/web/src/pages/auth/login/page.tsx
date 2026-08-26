import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { AuthShell } from "@/components/auth/auth-shell";
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

/** Mock login. The forgot-password path consumes a backup code. */
export default function LoginPage() {
  const navigate = useNavigate();
  const [recovering, setRecovering] = useState(false);
  const [backupCode, setBackupCode] = useState("");

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
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            navigate("/dashboard");
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              defaultValue="muhammad@novaweb.studio"
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
              required
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 w-full">
            Log in
          </Button>
        </form>
      </AuthShell>

      <Dialog open={recovering} onOpenChange={setRecovering}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Use a backup code</DialogTitle>
            <DialogDescription>
              Enter one of the one-time codes you saved when you registered.
              Each code works once and is then invalidated.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-code">Backup code</Label>
            <Input
              id="backup-code"
              value={backupCode}
              onChange={(event) => setBackupCode(event.target.value)}
              placeholder="e.g. 4821-9375-A2XC"
              className="font-mono uppercase"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecovering(false)}>
              Cancel
            </Button>
            <Button disabled={backupCode.trim().length === 0}>
              Recover account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
