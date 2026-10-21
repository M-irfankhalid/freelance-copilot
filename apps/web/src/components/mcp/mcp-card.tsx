import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  CircleCheck,
  CircleX,
  ExternalLink,
  KeyRound,
  Lock,
  RefreshCw,
} from "lucide-react";

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
import type { McpState, McpStatus } from "@/lib/types";

const TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const API_KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

function statusLabel(status: McpStatus): string {
  switch (status.state) {
    case "connected":
      return "Connected";
    case "starting":
      return "Starting…";
    case "error":
      return "Needs attention";
    case "disconnected":
      return "Ready";
    case "not_configured":
      return "Not configured";
  }
}

/**
 * User-facing Secure MCP Tunnel setup. Everything is managed from this card:
 * no terminal commands. The runtime API key is encrypted at rest and never
 * returned by the API, only a masked preview.
 */
export function McpCard() {
  const { data, error, isLoading, refetch } = useApi<McpState>("/api/mcp");
  const [tunnelIdDraft, setTunnelIdDraft] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [allowWritesDraft, setAllowWritesDraft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<
    "connect" | "disconnect" | "forget" | "writes" | null
  >(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const settings = data?.settings ?? null;
  const status = data?.status ?? null;
  const configured = settings?.configured ?? false;
  const tunnelId = tunnelIdDraft ?? settings?.tunnelId ?? "";
  const allowWrites = allowWritesDraft ?? settings?.allowWrites ?? true;
  const running = status?.running ?? false;
  const pollState = status?.state;
  const pollRunning = status?.running;

  // Keep polling while the process is coming up or running. This catches a
  // rejected runtime key shortly after the first connection.
  useEffect(() => {
    if (pollState === undefined) return;
    if (pollState !== "starting" && !pollRunning) return;
    const timer = window.setInterval(refetch, 5_000);
    return () => window.clearInterval(timer);
  }, [pollState, pollRunning, refetch]);

  const connect = async () => {
    if (busy !== null) return;
    if (!configured && (tunnelId.trim() === "" || apiKey.trim() === "")) {
      setActionError("Enter the tunnel ID and runtime API key first.");
      return;
    }
    setBusy("connect");
    setActionError(null);
    setFeedback(null);
    try {
      const body: { tunnelId?: string; apiKey?: string; allowWrites?: boolean } = {};
      if (tunnelId.trim() !== (settings?.tunnelId ?? "")) body.tunnelId = tunnelId.trim();
      if (apiKey.trim() !== "") body.apiKey = apiKey.trim();
      if (allowWritesDraft !== null) body.allowWrites = allowWritesDraft;

      await api<McpState>("/api/mcp/connect", {
        method: "POST",
        body,
        timeoutMs: 180_000,
      });
      setApiKey("");
      setTunnelIdDraft(null);
      setAllowWritesDraft(null);
      setFeedback(
        "Tunnel connected. In ChatGPT, add a custom connector, choose Tunnel, and select this tunnel."
      );
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (busy !== null) return;
    setBusy("disconnect");
    setActionError(null);
    setFeedback(null);
    try {
      await api<McpState>("/api/mcp/disconnect", {
        method: "POST",
        timeoutMs: 30_000,
      });
      setFeedback("Tunnel stopped. It will stay disconnected after a server restart.");
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    if (busy !== null) return;
    setBusy("forget");
    setActionError(null);
    setFeedback(null);
    try {
      await api<McpState>("/api/mcp", { method: "DELETE", timeoutMs: 30_000 });
      setApiKey("");
      setTunnelIdDraft(null);
      setAllowWritesDraft(null);
      setFeedback("Tunnel settings removed.");
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setBusy(null);
    }
  };

  const changeWrites = async (enabled: boolean) => {
    if (busy !== null) return;
    if (!configured) {
      setAllowWritesDraft(enabled);
      return;
    }
    setBusy("writes");
    setActionError(null);
    setFeedback(null);
    setAllowWritesDraft(enabled);
    try {
      await api<McpState>("/api/mcp", {
        method: "PUT",
        body: { allowWrites: enabled },
        timeoutMs: 120_000,
      });
      setAllowWritesDraft(null);
      setFeedback(
        enabled
          ? "ChatGPT can now update data, drafts, and place confirmed bids."
          : "Write access is off. ChatGPT can only read your data."
      );
      refetch();
    } catch (cause) {
      setAllowWritesDraft(null);
      setActionError(messageFor(cause));
    } finally {
      setBusy(null);
    }
  };

  const badgeClass =
    status?.state === "connected"
      ? "border-transparent bg-success/10 text-success"
      : status?.state === "error"
        ? "border-transparent bg-destructive/10 text-destructive"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" aria-hidden />
          ChatGPT &amp; MCP
        </CardTitle>
        <CardDescription>
          Connect ChatGPT to your saved profile and recent proposals through an
          outbound-only Secure MCP Tunnel. No public port is opened.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={badgeClass}>
            {status === null ? "Loading…" : statusLabel(status)}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-tunnel-id">Tunnel ID</Label>
            <Input
              id="mcp-tunnel-id"
              value={tunnelId}
              onChange={(event) => setTunnelIdDraft(event.target.value)}
              placeholder="tunnel_…"
              spellCheck={false}
              className="font-mono text-sm"
              disabled={busy !== null}
            />
            <p className="text-xs text-muted-foreground">
              Create a tunnel in{" "}
              <ExternalTextLink href={TUNNELS_URL}>OpenAI Platform</ExternalTextLink>{" "}
              and associate it with your ChatGPT workspace.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-runtime-key">Runtime API key</Label>
            <Input
              id="mcp-runtime-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                configured
                  ? "Leave blank to keep the saved key"
                  : "Paste the tunnel runtime API key"
              }
              className="font-mono text-sm"
              disabled={busy !== null}
            />
            {settings?.apiKeyPreview !== null &&
            settings?.apiKeyPreview !== undefined ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="size-3.5 shrink-0" aria-hidden />
                Saved: <span className="font-mono">{settings.apiKeyPreview}</span>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Create the runtime key in{" "}
              <ExternalTextLink href={API_KEYS_URL}>OpenAI API keys</ExternalTextLink>.
              It is encrypted before storage and never sent back to this page.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="mcp-allow-writes">Allow changes</Label>
              <p className="text-xs text-muted-foreground">
                ChatGPT may update profile fields, scan and analyze jobs, edit
                drafts, and place a bid only after explicit confirmation. It
                cannot contact clients or change automation limits.
              </p>
            </div>
            <Switch
              id="mcp-allow-writes"
              checked={allowWrites}
              disabled={busy !== null}
              onCheckedChange={(enabled) => void changeWrites(enabled)}
              aria-label="Allow ChatGPT to make changes"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void connect()} disabled={busy !== null}>
              <RefreshCw
                className={busy === "connect" ? "animate-spin" : undefined}
                data-icon="inline-start"
              />
              {busy === "connect"
                ? "Installing & connecting…"
                : status?.state === "connected"
                  ? "Reconnect"
                  : "Connect"}
            </Button>
            {running || status?.state === "starting" ? (
              <Button
                variant="outline"
                onClick={() => void disconnect()}
                disabled={busy !== null}
              >
                {busy === "disconnect" ? "Stopping…" : "Disconnect"}
              </Button>
            ) : null}
            {configured ? (
              <Button
                variant="ghost"
                onClick={() => void forget()}
                disabled={busy !== null}
              >
                {busy === "forget" ? "Removing…" : "Forget"}
              </Button>
            ) : null}
          </div>

          {feedback !== null ? (
            <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-sm text-success">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              {feedback}
            </p>
          ) : null}
          {actionError !== null ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
              <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
              {actionError}
            </p>
          ) : null}
          {status?.lastError !== null && status?.lastError !== undefined ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
              <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
              {status.lastError}
            </p>
          ) : null}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {status?.clientVersion !== null && status?.clientVersion !== undefined
              ? `Tunnel client ${status.clientVersion} installed`
              : "The official tunnel client downloads automatically on first connect (about 30 MB)."}
          </p>
          {error !== null && data === null ? (
            <p className="text-sm text-destructive">
              Could not load MCP settings — is the server running?
            </p>
          ) : null}
          {isLoading && data === null ? (
            <p className="text-xs text-muted-foreground">Loading MCP settings…</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
          <p className="text-sm font-medium">One-time setup</p>
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-muted-foreground">
            <li>
              Create a tunnel and runtime API key in{" "}
              <ExternalTextLink href={TUNNELS_URL}>OpenAI Platform</ExternalTextLink>.
              Keep the tunnel associated with the ChatGPT workspace that will use it.
            </li>
            <li>
              Paste both values here and press <strong>Connect</strong>. The tunnel
              client is downloaded, verified, and started for you.
            </li>
            <li>
              In{" "}
              <ExternalTextLink href={CONNECTORS_URL}>ChatGPT connectors</ExternalTextLink>,
              add a custom connector, choose <strong>Tunnel</strong>, and select this
              tunnel. Use <strong>No authentication</strong>; the MCP server has no
              public endpoint.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Then start a chat, type <span className="font-mono">@</span>, pick the
            connector, and ask it to read your profile or a recent proposal. Write
            tools require approval in ChatGPT.
          </p>
          <p className="text-xs text-muted-foreground">
            Full MCP support, including writes, requires a ChatGPT Business,
            Enterprise, or Edu workspace. Pro and personal accounts may be read-only.
            Workspace permissions still apply.
          </p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The tunnel only makes outbound connections. This app never opens a public
            MCP port.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ExternalTextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
