import { useState } from "react";
import { CircleCheck, Download, Info, Plus, Save, Trash2 } from "lucide-react";

import { ChipEditor } from "@/components/shared/chip-editor";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { profile as initialProfile } from "@/lib/data/profile";
import type { UserProfile } from "@/lib/types";

/**
 * The single source of truth the agent is allowed to know. Import prefills
 * from Freelancer.com; everything is editable and extendable by hand.
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  const save = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Profile"
        description="Everything proposals may use about you. The agent never invents facts."
        actions={
          <>
            <Button variant="outline">
              <Download data-icon="inline-start" />
              Re-import from Freelancer.com
            </Button>
            <Button onClick={save}>
              {saved ? <CircleCheck data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {saved ? "Saved" : "Save profile"}
            </Button>
          </>
        }
      />

      {profile.importedFromFreelancer ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-sm">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          Imported from{" "}
          <span className="font-medium">@{profile.freelancerUsername}</span> — manual
          additions below always win over re-imports.
        </p>
      ) : null}

      {/* Basics */}
      <Card>
        <CardHeader>
          <CardTitle>The basics</CardTitle>
          <CardDescription>How clients and the agent identify you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={profile.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-rate">Hourly rate</Label>
            <Input
              id="p-rate"
              value={profile.hourlyRateLabel}
              onChange={(event) => set("hourlyRateLabel", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-title">Professional title</Label>
            <Input
              id="p-title"
              value={profile.title}
              onChange={(event) => set("title", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-about">About</Label>
            <Textarea
              id="p-about"
              rows={4}
              value={profile.about}
              onChange={(event) => set("about", event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Skills & filters */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Skills</CardTitle>
            <CardDescription>
              Doubled as keywords when the worker searches for jobs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChipEditor
              values={profile.skills}
              onChange={(skills) => set("skills", skills)}
              placeholder="Add a skill"
            />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Relevancy filters</CardTitle>
            <CardDescription>Applied before any AI call — saves tokens.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Wants — jobs mentioning these rank up</Label>
              <ChipEditor values={profile.wants} onChange={(wants) => set("wants", wants)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Not-wants — matching jobs are rejected outright</Label>
              <ChipEditor
                values={profile.notWants}
                onChange={(notWants) => set("notWants", notWants)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Experience */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Experience</CardTitle>
          <CardDescription>Only real roles — proposals cite these verbatim.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm">
              <Plus data-icon="inline-start" />
              Add role
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {profile.experience.map((entry, index) => (
            <div key={`${entry.role}-${index}`} className="rounded-lg border p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{entry.role}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.company} · {entry.periodLabel}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${entry.role}`}
                  onClick={() =>
                    set(
                      "experience",
                      profile.experience.filter((_, i) => i !== index)
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{entry.summary}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Portfolio + certifications */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm">
                <Plus data-icon="inline-start" />
                Add item
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {profile.portfolio.map((item) => (
              <div key={item.title} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{item.title}</p>
                <a
                  href={item.url}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {item.url}
                </a>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Certifications</CardTitle>
          </CardHeader>
          <CardContent>
            <ChipEditor
              values={profile.certifications}
              onChange={(certifications) => set("certifications", certifications)}
              placeholder="Add a certification"
            />
          </CardContent>
        </Card>
      </div>

      {/* Agent instructions */}
      <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
        <CardHeader>
          <CardTitle>Custom AI instructions</CardTitle>
          <CardDescription>
            Standing orders the agent follows in every analysis and proposal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="custom-instructions"
            aria-label="Custom AI instructions"
            rows={5}
            value={profile.customInstructions}
            onChange={(event) => set("customInstructions", event.target.value)}
            className="bg-background font-mono text-[13px]"
          />
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Instructions shape style and structure, but can never override the truth
            rule: no invented skills, experience, or history.
          </p>
        </CardContent>
        <CardFooter className="justify-end">
          <Button variant="outline" size="sm" onClick={save}>
            <Save data-icon="inline-start" />
            {saved ? "Saved ✓" : "Save instructions"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
