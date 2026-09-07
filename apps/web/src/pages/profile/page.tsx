import { useState } from "react";
import { CircleCheck, CircleX, Download, Info, Plus, Save, Sparkles, Trash2 } from "lucide-react";

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
  skillIds: [],
  experience: [],
  portfolio: [],
  certifications: [],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  ignoredCountries: [],
  customInstructions: "",
  userSummary: "",
  relevancyInstructions: "",
  portfolioSummary: "",
  proposalTemplates: "",
  importedFromFreelancer: false,
};

function toPayload(profile: UserProfile) {
  // The profile API stores empty text fields as null, so any of these may be
  // null when loaded back from the server — coerce before calling .trim().
  const text = (value: string | null | undefined): string => value ?? "";
  const name = text(profile.name).trim();
  const title = text(profile.title).trim();
  const hourlyRate = text(profile.hourlyRateLabel).trim();
  const about = text(profile.about).trim();
  const customInstructions = text(profile.customInstructions).trim();
  const userSummary = text(profile.userSummary).trim();
  const relevancyInstructions = text(profile.relevancyInstructions).trim();
  const portfolioSummary = text(profile.portfolioSummary).trim();
  const proposalTemplates = text(profile.proposalTemplates).trim();

  return {
    freelancerUsername: profile.freelancerUsername ?? null,
    name: name.length > 0 ? name : null,
    title: title.length > 0 ? title : null,
    hourlyRate: hourlyRate.length > 0 ? hourlyRate : null,
    about: about.length > 0 ? about : null,
    skills: profile.skills ?? [],
    skillIds: profile.skillIds ?? [],
    experience: (profile.experience ?? []).map((entry) => ({
      role: entry.role,
      company: entry.company,
      periodLabel: entry.periodLabel,
      summary: text(entry.summary).length > 0 ? entry.summary : null,
    })),
    portfolio: (profile.portfolio ?? []).map((item) => ({
      title: item.title,
      url: text(item.url).length > 0 ? item.url : null,
      description: text(item.description).length > 0 ? item.description : null,
    })),
    certifications: profile.certifications ?? [],
    preferredProjectTypes: profile.preferredProjectTypes ?? [],
    wants: profile.wants ?? [],
    notWants: profile.notWants ?? [],
    ignoredCountries: profile.ignoredCountries ?? [],
    customInstructions: customInstructions.length > 0 ? customInstructions : null,
    userSummary: userSummary.length > 0 ? userSummary : null,
    relevancyInstructions:
      relevancyInstructions.length > 0 ? relevancyInstructions : null,
    portfolioSummary: portfolioSummary.length > 0 ? portfolioSummary : null,
    proposalTemplates: proposalTemplates.length > 0 ? proposalTemplates : null,
  };
}

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof NetworkError) return "Cannot reach the server";
  if (cause instanceof ApiError) return cause.message;
  return fallback;
}

/**
 * The server rejects an invalid profile with a zod flatten() body under
 * error.details ({ fieldErrors, formErrors }). Render the field names so a
 * rejected save names its cause instead of showing only the generic message.
 */
function validationDetailLines(details: unknown): string[] {
  if (details === null || typeof details !== "object") return [];
  const d = details as {
    fieldErrors?: Record<string, unknown>;
    formErrors?: unknown;
  };
  const lines: string[] = [];
  for (const [field, raw] of Object.entries(d.fieldErrors ?? {})) {
    const messages = Array.isArray(raw) ? raw.filter((m) => typeof m === "string") : [];
    if (messages.length > 0) lines.push(`${field}: ${messages.join("; ")}`);
  }
  if (Array.isArray(d.formErrors) && d.formErrors.length > 0) {
    lines.push(`form: ${d.formErrors.join("; ")}`);
  }
  return lines;
}

/**
 * The profile API stores empty text fields as null. Normalize a server-loaded
 * profile back to strings/arrays so the form inputs are controlled and saving
 * never trips on a null. Returns null when there is no saved profile.
 */
function normalizeProfile(p: UserProfile | null): UserProfile | null {
  if (p === null) return null;
  const text = (value: string | null | undefined): string => value ?? "";
  return {
    ...p,
    name: text(p.name),
    title: text(p.title),
    hourlyRateLabel: text(p.hourlyRateLabel),
    about: text(p.about),
    customInstructions: text(p.customInstructions),
    userSummary: text(p.userSummary),
    relevancyInstructions: text(p.relevancyInstructions),
    portfolioSummary: text(p.portfolioSummary),
    proposalTemplates: text(p.proposalTemplates),
    skills: p.skills ?? [],
    skillIds: p.skillIds ?? [],
    experience: p.experience ?? [],
    portfolio: p.portfolio ?? [],
    certifications: p.certifications ?? [],
    preferredProjectTypes: p.preferredProjectTypes ?? [],
    wants: p.wants ?? [],
    notWants: p.notWants ?? [],
    ignoredCountries: p.ignoredCountries ?? [],
  };
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
  const [generatingSummary, setGeneratingSummary] = useState(false);

  const form: UserProfile =
    override ?? normalizeProfile(stored.data?.profile ?? null) ?? emptyProfile;

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
          skillIds: number[];
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
        skillIds: draft.skillIds ?? form.skillIds,
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

  const runGenerateSummary = async () => {
    if (generatingSummary) return;
    setGeneratingSummary(true);
    try {
      const result = await api<{ summary: string }>("/api/ai/summary", {
        method: "POST",
        // Generation can take ~120s server-side; wait for it instead of
        // aborting at the default 10s and reporting a network error.
        timeoutMs: 150_000,
        body: {},
      });
      // Load the saved summary back into the form so the box updates
      void stored.refetch();
      // Show summary in an alert or could store/display it
      alert(`User summary generated (saved server-side):\n\n${result.summary.substring(0, 500)}...`);
      void stored.refetch();
    } catch (cause) {
      alert(`Failed to generate summary: ${cause instanceof Error ? cause.message : "Unknown error"}`);
    } finally {
      setGeneratingSummary(false);
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
      let text = errorText(cause, "Could not save profile");
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR") {
        const lines = validationDetailLines(cause.details);
        if (lines.length > 0) text += "\n" + lines.join("\n");
      }
      setSaveError(text);
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runImport()} disabled={importing}>
              <Download
                className={importing ? "animate-bounce" : undefined}
                data-icon="inline-start"
              />
              {importing ? "Fetching…" : "Import from Freelancer.com"}
            </Button>
            <Button onClick={runGenerateSummary} disabled={generatingSummary || saving}>
              <Sparkles
                className={generatingSummary ? "animate-pulse" : undefined}
                data-icon="inline-start"
              />
              {generatingSummary ? "Generating summary…" : "Generate user summary"}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {justSaved ? (
                <CircleCheck data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {justSaved ? "Saved" : saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        }
      />

      {saveError !== null ? (
        <p className="flex items-start gap-2 whitespace-pre-line rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{saveError}</span>
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
            <div className="flex flex-col gap-1.5">
              <Label>Ignored countries — jobs from these are never analyzed</Label>
              <ChipEditor
                values={form.ignoredCountries}
                onChange={(ignoredCountries) => set("ignoredCountries", ignoredCountries)}
                placeholder="Add a country name or ISO code"
              />
              <p className="text-xs text-muted-foreground">
                Matched by name or ISO code (e.g. "Pakistan" or "PK"). Jobs from
                ignored countries are stored but never sent to the AI.
              </p>
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
          <CardTitle>User summary (AI-generated)</CardTitle>
          <CardDescription>
            A concise professional summary based on your verified profile facts.
            Used in every AI analysis and proposal. You can edit it directly or
            regenerate it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="User summary"
            rows={8}
            value={form.userSummary || ""}
            onChange={(event) => set("userSummary", event.target.value)}
            placeholder="No user summary yet. Click 'Generate user summary' below or write your own."
            className="bg-background font-mono text-[13px] leading-relaxed"
          />
        </CardContent>
        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">
            Generate replaces the current text — edit is kept when you Save.
          </p>
          <Button variant="outline" size="sm" onClick={() => void runGenerateSummary()} disabled={generatingSummary}>
            <Sparkles
              className={generatingSummary ? "animate-pulse" : undefined}
              data-icon="inline-start"
            />
            {generatingSummary ? "Generating…" : "Generate user summary"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
        <CardHeader>
          <CardTitle>Relevancy instructions</CardTitle>
          <CardDescription>
            Standing orders for the fast relevance model that screens jobs before
            anything else runs. Example: "no web3 or WordPress projects".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="relevancy-instructions"
            aria-label="Relevancy instructions"
            rows={4}
            value={form.relevancyInstructions || ""}
            onChange={(event) => set("relevancyInstructions", event.target.value)}
            className="bg-background font-mono text-[13px]"
          />
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Sent to the relevance model alongside the job title and description.
            Jobs flagged as irrelevant are stored but never analyzed or bid on.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
          <CardHeader>
            <CardTitle>Portfolio summary</CardTitle>
            <CardDescription>
              Markdown describing your portfolio projects. Used as context when
              writing proposals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              aria-label="Portfolio summary"
              rows={10}
              value={form.portfolioSummary || ""}
              onChange={(event) => set("portfolioSummary", event.target.value)}
              placeholder="## Projects&#10;&#10;Describe real projects only — the AI never invents them."
              className="bg-background font-mono text-[13px] leading-relaxed"
            />
          </CardContent>
        </Card>

        <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
          <CardHeader>
            <CardTitle>Proposal templates</CardTitle>
            <CardDescription>
              One markdown block holding all your example proposals. The writer
              uses these to match tone and structure for each job.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              aria-label="Proposal templates"
              rows={10}
              value={form.proposalTemplates || ""}
              onChange={(event) => set("proposalTemplates", event.target.value)}
              placeholder="## Template: fixed-price job&#10;...&#10;&#10;## Template: hourly job&#10;..."
              className="bg-background font-mono text-[13px] leading-relaxed"
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
        <CardHeader>
          <CardTitle>Proposal instructions</CardTitle>
          <CardDescription>
            Standing orders for AI proposal writing. The agent follows these only
            when generating a proposal, alongside your portfolio summary and
            proposal templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="proposal-instructions"
            aria-label="Proposal instructions"
            rows={5}
            value={form.customInstructions || ""}
            onChange={(event) => set("customInstructions", event.target.value)}
            className="bg-background font-mono text-[13px]"
          />
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Tell the writer how to pitch you — tone, structure, and what you will or
            won't offer (pricing, timeline, delivery). These can never override the
            truth rule: no invented skills, experience, or history.
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
