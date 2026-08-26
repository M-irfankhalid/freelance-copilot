import { useState } from "react";
import { Bot, Pause, Play, TriangleAlert, Zap } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { automationRuns, automationSettings as initialSettings } from "@/lib/data/platforms";
import type { AutomationSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Automation control. Auto-bid is off until explicitly switched on, and even
 * then it is fenced by threshold, bounds, and a daily cap.
 */
export default function AutomationPage() {
  const [settings, setSettings] = useState<AutomationSettings>(initialSettings);

  const update = <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const capUsed = Math.min((settings.bidsToday / settings.dailyCap) * 100, 100);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Automation"
        description="How hard the worker runs — and how much it may do without you."
        actions={
          <Button
            variant={settings.paused ? "default" : "outline"}
            onClick={() => update("paused", !settings.paused)}
          >
            {settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
            {settings.paused ? "Resume worker" : "Pause worker"}
          </Button>
        }
      />

      {!settings.paused ? null : (
        <p className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="size-4 text-warning" aria-hidden />
          Worker paused — no scans or actions run until you resume.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Worker pipeline</CardTitle>
            <CardDescription>
              Each step can run unattended; bidding always stops for review first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <div className="flex items-center justify-between py-3 first:pt-0">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="scan-interval">Scan interval</Label>
                <p className="text-xs font-normal text-muted-foreground">
                  Poll Freelancer.com for new jobs. Minimum 30 seconds.
                </p>
              </div>
              <Select
                value={String(settings.scanIntervalSeconds)}
                onValueChange={(value) => update("scanIntervalSeconds", Number(value))}
              >
                <SelectTrigger id="scan-interval" className="w-44" aria-label="Scan interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every 60 seconds</SelectItem>
                  <SelectItem value="120">Every 2 minutes</SelectItem>
                  <SelectItem value="300">Every 5 minutes</SelectItem>
                  <SelectItem value="600">Every 10 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(
              [
                ["autoAnalyze", "Automatic analysis", "Send new jobs to the AI after each scan"],
                ["autoMatch", "Automatic matching", "Score every analyzed job against your profile"],
                ["autoDraft", "Automatic proposals", "Draft proposals for strong matches into the approval queue"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`toggle-${key}`}>{label}</Label>
                  <p className="text-xs font-normal text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  id={`toggle-${key}`}
                  checked={settings[key]}
                  onCheckedChange={(checked) => update(key, checked)}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Auto-bid */}
        <Card className={cn(!settings.autobidEnabled && "opacity-95")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap
                className={cn("size-4", settings.autobidEnabled ? "text-warning" : "text-muted-foreground")}
                aria-hidden
              />
              Auto-bid
            </CardTitle>
            <CardDescription>
              Off by default. When on, bids that clear your score threshold are placed
              inside these bounds without review.
            </CardDescription>
            <CardAction>
              <Switch
                id="toggle-autobid"
                checked={settings.autobidEnabled}
                onCheckedChange={(checked) => update("autobidEnabled", checked)}
                aria-label="Enable auto-bid"
              />
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1.5 flex justify-between text-sm">
                <span>Daily usage</span>
                <span className="font-medium tabular-nums">
                  {settings.bidsToday} / {settings.dailyCap} bids today
                </span>
              </div>
              <Progress
                value={capUsed}
                aria-label="Daily bid usage"
                indicatorClassName={capUsed >= 100 ? "bg-destructive" : undefined}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Worker pauses auto-bidding when the cap is reached; resumes tomorrow.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="min-score">Minimum match score</Label>
                <Input
                  id="min-score"
                  type="number"
                  min={50}
                  max={100}
                  value={settings.minMatchScore}
                  onChange={(event) => update("minMatchScore", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="daily-cap">Daily bid cap</Label>
                <Input
                  id="daily-cap"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.dailyCap}
                  onChange={(event) => update("dailyCap", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="min-bid">Minimum bid ($)</Label>
                <Input
                  id="min-bid"
                  type="number"
                  min={0}
                  value={settings.minBid}
                  onChange={(event) => update("minBid", Number(event.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="max-bid">Maximum bid ($)</Label>
                <Input
                  id="max-bid"
                  type="number"
                  min={0}
                  value={settings.maxBid}
                  onChange={(event) => update("maxBid", Number(event.target.value))}
                />
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              The AI picks each amount between ${settings.minBid.toLocaleString()} and $
              {settings.maxBid.toLocaleString()} based on job size. Every decision lands in
              Logs with its reasoning.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden />
            Recent pipeline activity
          </CardTitle>
          <Separator className="mt-3" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {automationRuns.map((run) => (
            <div key={run.id} className="flex items-start gap-3 rounded-lg border p-2.5 text-sm">
              <span
                className={cn(
                  "mt-0.5 size-2 shrink-0 rounded-full",
                  run.result === "ok" && "bg-success",
                  run.result === "skipped" && "bg-warning",
                  run.result === "error" && "bg-destructive"
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{run.action}</p>
                <p className="truncate text-xs text-muted-foreground">{run.detail}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {run.timeLabel}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
