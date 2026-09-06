import { useState } from "react";
import { KeyRound, LogOut, MessageSquare, ShieldCheck, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/api/hooks";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type { DiscordEvent, DiscordSettings } from "@/lib/types";

/** Account-level settings. Single user — no teams to manage. */
export default function SettingsPage() {
  const { user } = useAuth();
  const [codesOpen, setCodesOpen] = useState(false);
  const [notifyStrongMatch, setNotifyStrongMatch] = useState(true);
  const [notifyDailyDigest, setNotifyDailyDigest] = useState(true);
  const [notifyAutobid, setNotifyAutobid] = useState(true);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Settings"
        description="Account, notifications, and recovery options."
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" defaultValue={user?.name ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-email">Email</Label>
            <Input id="s-email" type="email" defaultValue={user?.email ?? ""} disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-week">Week starts on</Label>
            <Select defaultValue="monday">
              <SelectTrigger id="s-week" className="w-full" aria-label="Week starts on">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">Monday</SelectItem>
                <SelectItem value="sunday">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>What pings you in the bell menu.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {(
            [
              ["Strong match found", notifyStrongMatch, setNotifyStrongMatch],
              ["Daily pipeline digest", notifyDailyDigest, setNotifyDailyDigest],
              ["Auto-bid activity", notifyAutobid, setNotifyAutobid],
            ] as const
          ).map(([label, value, setter]) => (
            <div key={label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <span className="text-sm">{label}</span>
              <Switch checked={value} onCheckedChange={setter} aria-label={label} />
            </div>
          ))}
        </CardContent>
      </Card>

      <DiscordCard />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            Recovery
          </CardTitle>
          <CardDescription>
            Backup codes were generated once at registration and shown a single time.
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setCodesOpen(true)}>
              <KeyRound data-icon="inline-start" />
              View codes
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Each code works exactly once as a password replacement. Generate a new set
            if you suspect the old ones are compromised — this invalidates all existing codes.
          </p>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-xs text-muted-foreground">8 codes · generated at registration</span>
          <Button variant="destructive" size="sm">
            Regenerate codes
          </Button>
        </CardFooter>
      </Card>

      <Card size="sm" className="border-destructive/25 ring-destructive/15">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Reset wipes every job, proposal, bid, and log on this installation. Your
            Freelancer.com and OpenRouter accounts are untouched.
          </p>
          <Button variant="destructive">
            <Trash2 data-icon="inline-start" />
            Reset workspace
          </Button>
        </CardContent>
      </Card>

      {/* Backup codes viewer */}
      <Dialog open={codesOpen} onOpenChange={setCodesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your backup codes</DialogTitle>
            <DialogDescription>
              Shown again for reference. In the real build this requires re-entering your
              password first.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-2 font-mono text-sm tracking-wide">
            {["••••-••••-••••", "••••-••••-••••", "••••-••••-••••", "••••-••••-••••"].map(
              (code, index) => (
                <li
                  key={index}
                  className="rounded-md bg-background px-2 py-1.5 text-center ring-1 ring-foreground/5"
                >
                  {code}
                </li>
              )
            )}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Codes stay masked even here — the backend can verify them but never display
            them twice.
          </p>
        </DialogContent>
      </Dialog>

      <Button variant="ghost" className="w-fit text-muted-foreground">
        <LogOut data-icon="inline-start" />
        Log out of this device
      </Button>
    </div>
  );
}

const EVENT_OPTIONS: Array<{ id: DiscordEvent; label: string; hint: string }> = [
  { id: "match", label: "New qualifying match", hint: "A job clears your match threshold" },
  { id: "needs_review", label: "Needs your review", hint: "Risky client or NDA/IP job sent for manual handling" },
  { id: "bid_placed", label: "Auto-bid placed", hint: "The worker placed a bid for you" },
  { id: "bid_failed", label: "Auto-bid failed", hint: "A bid errored and won't be retried" },
  { id: "api_error", label: "API issue", hint: "Credential or pipeline failures" },
];

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

/**
 * Discord notification channel. The webhook URL is encrypted at rest and never
 * sent back — the API only returns a masked preview and the enabled events.
 */
function DiscordCard() {
  const { data, isLoading, refetch } = useApi<{ settings: DiscordSettings }>(
    "/api/discord"
  );
  const [webhook, setWebhook] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = data?.settings ?? null;
  const configured = settings?.configured ?? false;

  const saveWebhook = async () => {
    if (saving || webhook.trim().length === 0) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await api<{ settings: DiscordSettings }>("/api/discord", {
        method: "PUT",
        body: { webhook: webhook.trim() },
      });
      setWebhook("");
      setFeedback("Webhook saved. Send a test message to confirm it works.");
      refetch();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleEvent = async (event: DiscordEvent, enabled: boolean) => {
    if (settings === null) return;
    setError(null);
    const next = enabled
      ? [...settings.events, event]
      : settings.events.filter((e) => e !== event);
    try {
      await api<{ settings: DiscordSettings }>("/api/discord", {
        method: "PUT",
        body: { events: next },
      });
      refetch();
    } catch (cause) {
      setError(messageFor(cause));
    }
  };

  const sendTest = async () => {
    if (testing) return;
    setTesting(true);
    setError(null);
    setFeedback(null);
    try {
      await api("/api/discord/test", { method: "POST" });
      setFeedback("Test message sent to your Discord channel.");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setTesting(false);
    }
  };

  const removeWebhook = async () => {
    try {
      await api("/api/discord", { method: "DELETE" });
      setFeedback("Webhook removed. Notifications are paused.");
      refetch();
    } catch (cause) {
      setError(messageFor(cause));
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
          Discord notifications
        </CardTitle>
        <CardDescription>
          Push job events to a Discord channel. Your webhook URL is encrypted
          and never shown again after saving.
        </CardDescription>
        <CardAction>
          <Badge
            variant="outline"
            className={
              configured
                ? "border-transparent bg-success/10 text-success"
                : "text-muted-foreground"
            }
          >
            {configured ? "Connected" : "Not configured"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discord-webhook">Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              id="discord-webhook"
              type="password"
              value={webhook}
              onChange={(event) => setWebhook(event.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="font-mono"
            />
            <Button onClick={() => void saveWebhook()} disabled={saving || webhook.trim().length === 0}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {settings?.webhookPreview !== null && settings?.webhookPreview !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Saved: <span className="font-mono">{settings.webhookPreview}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col divide-y">
          {EVENT_OPTIONS.map((option) => (
            <div key={option.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </div>
              <Switch
                checked={settings?.events.includes(option.id) ?? false}
                disabled={!configured}
                onCheckedChange={(enabled) => void toggleEvent(option.id, enabled)}
                aria-label={option.label}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={testing || !configured}>
            {testing ? "Sending…" : "Send test message"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void removeWebhook()} disabled={!configured}>
            Remove webhook
          </Button>
        </div>

        {feedback !== null ? (
          <p className="text-sm text-success">{feedback}</p>
        ) : null}
        {error !== null ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        {isLoading && settings === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
