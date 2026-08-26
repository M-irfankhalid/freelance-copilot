import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck, Trash2 } from "lucide-react";

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
import { currentUser } from "@/lib/data/user";

/** Account-level settings. Single user — no teams to manage. */
export default function SettingsPage() {
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
            <Input id="s-name" defaultValue={currentUser.name} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-email">Email</Label>
            <Input id="s-email" type="email" defaultValue={currentUser.email} disabled />
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
