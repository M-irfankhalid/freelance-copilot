import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/api/hooks";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type { DiscordEvent, DiscordSettings } from "@/lib/types";

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
 * Shown on both the Settings and Platforms pages.
 */
export function DiscordCard() {
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
