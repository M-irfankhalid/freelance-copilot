import { useState } from "react";
import { Link } from "react-router";
import {
  ChevronRight,
  CircleCheck,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CleanStaleButton } from "@/components/dashboard/clean-stale-button";
import { DiscordCard } from "@/components/discord/discord-card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";

/** Device-local preferences. There is no settings API — this stays in the browser. */
const PREFERENCES_KEY = "freelance-copilot.preferences.v1";

interface Preferences {
  weekStart: "monday" | "sunday";
  notifyStrongMatch: boolean;
  notifyDailyDigest: boolean;
  notifyAutoBid: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  weekStart: "monday",
  notifyStrongMatch: true,
  notifyDailyDigest: true,
  notifyAutoBid: true,
};

function loadPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (raw === null) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences> | null;
    return {
      weekStart: parsed?.weekStart === "sunday" ? "sunday" : "monday",
      notifyStrongMatch: parsed?.notifyStrongMatch !== false,
      notifyDailyDigest: parsed?.notifyDailyDigest !== false,
      notifyAutoBid: parsed?.notifyAutoBid !== false,
    };
  } catch {
    // Corrupt or unavailable storage falls back to defaults.
    return DEFAULT_PREFERENCES;
  }
}

function initialsFor(name: string | undefined): string {
  if (name === undefined || name.trim().length === 0) return "FC";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Account-level settings. Single user — no teams to manage. */
export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [loggingOut, setLoggingOut] = useState(false);

  const updatePreferences = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the in-memory value still applies.
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api<{ ok: true }>("/api/auth/logout", { method: "POST" });
    } catch {
      // Always re-probe below: an expired session should still land on /login.
    } finally {
      // ProtectedRoute redirects once the session probe reports unauthenticated.
      await refresh();
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Settings"
        description="Account, preferences, integrations, and data maintenance."
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            Account
          </CardTitle>
          <CardDescription>
            This installation has a single owner account. Sign-in details stay
            fixed here.
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link to="/profile">
                Freelancer profile
                <ChevronRight data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="text-sm font-medium">
              {initialsFor(user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user?.name ?? "Workspace owner"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email ?? "No email on file"}
            </p>
          </div>
          <Badge variant="outline" className="font-normal">
            <CircleCheck className="size-3.5 text-success" aria-hidden />
            Signed in
          </Badge>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>
            Stored in this browser. Notification delivery is configured per
            integration below.
          </CardDescription>
          <CardAction>
            <Badge variant="outline" className="font-normal">
              This device
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-week">Week starts on</Label>
            <Select
              value={preferences.weekStart}
              onValueChange={(value) =>
                updatePreferences({
                  weekStart: value === "sunday" ? "sunday" : "monday",
                })
              }
            >
              <SelectTrigger
                id="s-week"
                className="w-full"
                aria-label="Week starts on"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">Monday</SelectItem>
                <SelectItem value="sunday">Sunday</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used by analytics and digest ranges.
            </p>
          </div>

          <div className="flex flex-col divide-y rounded-lg border px-3">
            {(
              [
                [
                  "Strong match found",
                  preferences.notifyStrongMatch,
                  (checked: boolean) =>
                    updatePreferences({ notifyStrongMatch: checked }),
                ],
                [
                  "Daily pipeline digest",
                  preferences.notifyDailyDigest,
                  (checked: boolean) =>
                    updatePreferences({ notifyDailyDigest: checked }),
                ],
                [
                  "Auto-bid activity",
                  preferences.notifyAutoBid,
                  (checked: boolean) =>
                    updatePreferences({ notifyAutoBid: checked }),
                ],
              ] as const
            ).map(([label, checked, onChange]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="text-sm">{label}</span>
                <Switch
                  checked={checked}
                  onCheckedChange={onChange}
                  aria-label={label}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <DiscordCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              Password recovery
            </CardTitle>
            <CardDescription>
              Backup codes were generated once at registration and shown a
              single time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Only code hashes are stored, so they cannot be displayed again —
              not even here.
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
              <li>Each of the 8 codes works exactly once.</li>
              <li>
                Use one with “Forgot password?” on the sign-in screen to set a
                new password.
              </li>
              <li>
                If both the password and every code are lost, recovery requires
                access to the server.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card size="sm" className="border-destructive/25">
          <CardHeader>
            <CardTitle>Data maintenance</CardTitle>
            <CardDescription>
              Deletes projects stored more than 24 hours ago, along with their
              proposals and stored bid data.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-sm text-muted-foreground">
              Your account, platform credentials, and submitted-bid history are
              always kept. This cannot be undone.
            </p>
            <CleanStaleButton
              onCleaned={() =>
                toast({
                  title: "Old data cleaned",
                  description: "Projects, proposals, and stored bid data older than 24 hours were removed.",
                  variant: "success",
                })
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Advanced tools</CardTitle>
          <CardDescription>
            Deeper controls most people never need.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {[
            {
              title: "Proposal flow",
              description:
                "Edit the pipeline, prompts, and writing rules used for every draft.",
              href: "/proposal-system",
            },
            {
              title: "Run history",
              description: "Inspect AI decisions and pipeline steps.",
              href: "/proposal-traces",
            },
          ].map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">Session</p>
            <p className="text-xs text-muted-foreground">
              Signing out ends this browser session. You will need your password
              or a backup code to return.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void logout()}
            disabled={loggingOut}
          >
            <LogOut data-icon="inline-start" />
            {loggingOut ? "Signing out…" : "Log out of this device"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
