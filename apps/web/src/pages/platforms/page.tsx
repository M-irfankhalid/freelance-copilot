import { useState } from "react";
import { KeyRound, Lock, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ConnectionBadge } from "@/components/shared/badges";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openRouter as openRouterData, platformCredentials } from "@/lib/data/platforms";

/**
 * BYOC control room. Real values are written once and never displayed again —
 * only masked previews and test results.
 */
export default function PlatformsPage() {
  const [testing, setTesting] = useState<Record<string, "idle" | "busy" | "ok">>({
    freelancer: "idle",
    openrouter: "idle",
  });
  const [replacing, setReplacing] = useState<string | null>(null);
  const [modelId, setModelId] = useState(openRouterData.selectedModelId);

  const runTest = (id: string) => {
    if (testing[id] === "busy") return;
    setTesting((current) => ({ ...current, [id]: "busy" }));
    window.setTimeout(
      () => setTesting((current) => ({ ...current, [id]: "ok" })),
      900
    );
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Platforms"
        description="Your own credentials, encrypted at rest. Test actions make one real API call."
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {platformCredentials.map((platform) => (
          <Card key={platform.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-4 text-muted-foreground" aria-hidden />
                {platform.name}
              </CardTitle>
              <CardDescription>{platform.description}</CardDescription>
              <CardAction>
                <ConnectionBadge status={platform.status} />
              </CardAction>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col justify-center gap-4 py-2">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{platform.keyInputLabel}</p>
                  <p className="truncate font-mono text-sm">{platform.keyPreview}</p>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setReplacing(platform.id)}>
                  Replace
                </Button>
              </div>

              {platform.usage ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{platform.usage.label}</span>
                    <span className="tabular-nums">
                      {platform.usage.used.toLocaleString()} /{" "}
                      {platform.usage.limit.toLocaleString()}
                    </span>
                  </div>
                  <Progress
                    value={(platform.usage.used / platform.usage.limit) * 100}
                    indicatorClassName={
                      platform.usage.used / platform.usage.limit > 0.8
                        ? "bg-warning"
                        : undefined
                    }
                    aria-label={platform.usage.label}
                  />
                </div>
              ) : null}

              {platform.id === "openrouter" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="model">AI model</Label>
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger id="model" className="w-full" aria-label="AI model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {openRouterData.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label} · {model.provider} · {model.contextLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {openRouterData.creditLabel} · {openRouterData.usageThisMonthLabel}
                  </p>
                </div>
              ) : null}

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden />
                Last tested {platform.lastTestedLabel?.replace("Tested ", "")}
              </p>
            </CardContent>

            <CardFooter className="justify-end">
              <Button variant="outline" size="sm" onClick={() => runTest(platform.id)}>
                <RefreshCw
                  className={testing[platform.id] === "busy" ? "animate-spin" : undefined}
                  data-icon="inline-start"
                />
                {testing[platform.id] === "busy"
                  ? "Testing…"
                  : testing[platform.id] === "ok"
                    ? "Working ✓"
                    : "Test connection"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        Credentials are encrypted before storage and never sent back to this page — only
        masked previews like the ones above exist after saving. Nothing is ever written
        to logs.
      </p>

      {/* Replace credential */}
      <Dialog open={replacing !== null} onOpenChange={(open) => !open && setReplacing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace credential</DialogTitle>
            <DialogDescription>
              Paste a fresh value for{" "}
              {platformCredentials.find((c) => c.id === replacing)?.name}. The old one is
              overwritten and never recoverable.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-key">New value</Label>
            <Input id="new-key" type="password" placeholder="Paste the new credential" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(null)}>
              Cancel
            </Button>
            <Button onClick={() => setReplacing(null)}>Save encrypted</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
