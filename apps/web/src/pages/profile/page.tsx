import { useState } from "react";
import { CircleCheck, CircleX, Download, Info, Plus, Save, Trash2 } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api/hooks";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import type { UserProfile } from "@/lib/types";

/**
 * The single source of truth the agent may know about the user. Loads from
 * the API, imports from Freelancer.com on demand, and everything is editable
 * before being saved back.
 */

const emptyProfile: UserProfile = {
  name: "",
  email: "",
  freelancerUsername: undefined,
  title: "",
  hourlyRateLabel: "",
  about: "",
  skills: [],
  experience: [],
  portfolio: [],
  certifications: [],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  customInstructions: "",
  importedFromFreelancer: false,
};

function toPayload(profile: UserProfile) {
  return {
    freelancerUsername: profile.freelancerUsername ?? null,
    name: profile.name.trim().length > 0 ? profile.name.trim() : null,
    title: profile.title.trim().length > 0 ? profile.title.trim() : null,
    hourlyRate: profile.hourlyRateLabel.trim().length > 0 ? profile.hourlyRateLabel.trim() : null,
    about: profile.about.trim().length > 0 ? profile.about : null,
    skills: profile.skills,
    experience: profile.experience.map((entry) => ({
      role: entry.role,
      company: entry.company,
      periodLabel: entry.periodLabel,
      summary: entry.summary.length > 0 ? entry.summary : null,
    })),
    portfolio: profile.portfolio.map((item) => ({
      title: item.title,
      url: item.url.length > 0 ? item.url : null,
      description: item.description.length > 0 ? item.description : null,
    })),
    certifications: profile.certifications,
    preferredProjectTypes: profile.preferredProjectTypes,
    wants: profile.wants,
    notWants: profile.notWants,
    customInstructions:
      profile.customInstructions.trim().length > 0
        ? profile.customInstructions
        : null,
  };
}

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof NetworkError) return "Cannot reach the server";
  if (cause instanceof ApiError) return cause.message;
  return fallback;
}

export default function ProfilePage() {
  const stored = useApi<{ profile: UserProfile | null }>("/api/profile");

  // Edits live in `override`; the rendered form is override ?? server ?? empty.
  // This keeps loading order deterministic without effect-driven state.
  const [override, setOverride] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const form: UserProfile =
    override ?? stored.data?.profile ?? emptyProfile;

  const update = (patch: Partial<UserProfile>) =>
    setOverride({ ...form, ...patch });

  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportNote(null);
    try {
      // Server field names differ slightly (hourlyRate vs hourlyRateLabel).
      const body = await api<{
        profile: {
          freelancerUsername: string | null;
          name: string | null;
          title: string | null;
          hourlyRate: string | null;
          about: string | null;
          skills: string[];
          wants: string[];
        };
      }>("/api/profile/import", { method: "POST" });
      const draft = body.profile;
      setOverride({
        ...form,
        name: draft.name ?? form.name,
        freelancerUsername: draft.freelancerUsername ?? form.freelancerUsername,
        title: draft.title ?? form.title,
        hourlyRateLabel: draft.hourlyRate ?? form.hourlyRateLabel,
        about: draft.about ?? form.about,
        // Imported skills/wants replace; manual-only sections are preserved.
        skills: draft.skills ?? form.skills,
        wants: draft.wants ?? form.wants,
        importedFromFreelancer: true,
      });
      setImportNote({
        ok: true,
        message: `Imported @${draft.freelancerUsername ?? "unknown"} — review below, then Save.`,
      });
    } catch (cause) {
      setImportNote({ ok: false, message: errorText(cause, "Import failed") });
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api("/api/profile", { method: "PUT", body: toPayload(form) });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
      void stored.refetch();
    } catch (cause) {
      setSaveError(errorText(cause, "Could not save profile"));
    } finally {
      setSaving(false);
    }
  };

  if (stored.isLoading && override === null) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    update({ [key]: value } as Partial<UserProfile>);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Profile"
        description="Everything proposals may use about you. The agent never invents facts."
        actions={
          <>
            <Button variant="outline" onClick={() => void runImport()} disabled={importing}>
              <Download
                className={importing ? "animate-bounce" : undefined}
                data-icon="inline-start"
              />
              {importing ? "Fetching…" : "Import from Freelancer.com"}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {justSaved ? (
                <CircleCheck data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {justSaved ? "Saved" : saving ? "Saving…" : "Save profile"}
            </Button>
          </>
        }
      />

      {saveError !== null ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          {saveError}
        </p>
      ) : null}

      {form.importedFromFreelancer ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-sm">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          Imported from{" "}
          <span className="font-medium">@{form.freelancerUsername ?? "Freelancer.com"}</span>
          {" "}— manual additions always win over re-imports.
        </p>
      ) : null}

      {importNote !== null ? (
        <p
          className={
            importNote.ok
              ? "rounded-xl border border-success/25 bg-success/[0.06] p-3 text-sm"
              : "flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          }
        >
          {importNote.ok ? importNote.message : (
            <>
              <CircleX className="size-4 shrink-0" aria-hidden />
              {importNote.message}
            </>
          )}
        </p>
      ) : null}

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
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-rate">Hourly rate</Label>
            <Input
              id="p-rate"
              value={form.hourlyRateLabel}
              onChange={(event) => set("hourlyRateLabel", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-title">Professional title</Label>
            <Input
              id="p-title"
              value={form.title}
              onChange={(event) => set("title", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-about">About</Label>
            <Textarea
              id="p-about"
              rows={4}
              value={form.about}
              onChange={(event) => set("about", event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

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
              values={form.skills}
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
              <ChipEditor values={form.wants} onChange={(wants) => set("wants", wants)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Not-wants — matching jobs are rejected outright</Label>
              <ChipEditor values={form.notWants} onChange={(notWants) => set("notWants", notWants)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Experience</CardTitle>
          <CardDescription>Only real roles — proposals cite these verbatim.</CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                update({
                  experience: [
                    ...form.experience,
                    { role: "", company: "", periodLabel: "", summary: "" },
                  ],
                })
              }
            >
              <Plus data-icon="inline-start" />
              Add role
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {form.experience.map((entry, index) => (
            <div key={index} className="rounded-lg border p-3.5">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={entry.role}
                  placeholder="Role"
                  aria-label={"Role " + (index + 1)}
                  onChange={(e) =>
                    update({
                      experience: form.experience.map((x, i) =>
                        i === index ? { ...x, role: e.target.value } : x
                      ),
                    })
                  }
                />
                <Input
                  value={entry.company}
                  placeholder="Company"
                  aria-label={"Company " + (index + 1)}
                  onChange={(e) =>
                    update({
                      experience: form.experience.map((x, i) =>
                        i === index ? { ...x, company: e.target.value } : x
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={"Remove role " + (index + 1)}
                  onClick={() =>
                    update({
                      experience: form.experience.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <Input
                value={entry.periodLabel}
                placeholder="Period, e.g. 2021 - present"
                aria-label={"Period " + (index + 1)}
                className="mt-2"
                onChange={(e) =>
                  update({
                    experience: form.experience.map((x, i) =>
                      i === index ? { ...x, periodLabel: e.target.value } : x
                    ),
                  })
                }
              />
              <Textarea
                value={entry.summary}
                placeholder="What you did there — one or two sentences"
                aria-label={"Summary " + (index + 1)}
                rows={2}
                className="mt-2"
                onChange={(e) =>
                  update({
                    experience: form.experience.map((x, i) =>
                      i === index ? { ...x, summary: e.target.value } : x
                    ),
                  })
                }
              />
            </div>
          ))}
          {form.experience.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles added yet.</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    portfolio: [
                      ...form.portfolio,
                      { title: "", url: "", description: "" },
                    ],
                  })
                }
              >
                <Plus data-icon="inline-start" />
                Add item
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {form.portfolio.map((item, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    value={item.title}
                    placeholder="Project title"
                    aria-label={"Portfolio title " + (index + 1)}
                    onChange={(e) =>
                      update({
                        portfolio: form.portfolio.map((x, i) =>
                          i === index ? { ...x, title: e.target.value } : x
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={"Remove item " + (index + 1)}
                    onClick={() =>
                      update({
                        portfolio: form.portfolio.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Input
                  value={item.url}
                  placeholder="https://…"
                  aria-label={"Portfolio URL " + (index + 1)}
                  className="mt-2"
                  onChange={(e) =>
                    update({
                      portfolio: form.portfolio.map((x, i) =>
                        i === index ? { ...x, url: e.target.value } : x
                      ),
                    })
                  }
                />
              </div>
            ))}
            {form.portfolio.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing added yet.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Certifications & project types</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Certifications</Label>
              <ChipEditor
                values={form.certifications}
                onChange={(certifications) => set("certifications", certifications)}
                placeholder="Add a certification"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Preferred project types</Label>
              <ChipEditor
                values={form.preferredProjectTypes}
                onChange={(preferredProjectTypes) =>
                  set("preferredProjectTypes", preferredProjectTypes)
                }
                placeholder="e.g. Fixed price under $5,000"
              />
            </div>
          </CardContent>
        </Card>
      </div>

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
            value={form.customInstructions}
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
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving}>
            <Save data-icon="inline-start" />
            {justSaved ? "Saved ✓" : saving ? "Saving…" : "Save instructions"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
