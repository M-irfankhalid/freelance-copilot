import { useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  Download,
  Eye,
  Info,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";

import { ChipEditor } from "@/components/shared/chip-editor";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api/hooks";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";

interface WriterDefaults {
  proposalSystemInstructions: string;
  proposalWritingInstructions: string;
}

interface ProfileResponse {
  profile: UserProfile | null;
  aiBrief: string | null;
  writerDefaults: WriterDefaults;
}

const emptyProfile: UserProfile = {
  name: "",
  email: "",
  freelancerUsername: undefined,
  title: "",
  hourlyRateLabel: "",
  about: "",
  skills: [],
  skillIds: [],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  ignoredCountries: [],
  customInstructions: "",
  relevancyInstructions: "",
  portfolioSummary: "",
  proposalTemplates: "",
  proposalSystemInstructions: "",
  proposalWritingInstructions: "",
  importedFromFreelancer: false,
};

function toPayload(profile: UserProfile) {
  const text = (value: string | null | undefined): string => value ?? "";
  const name = text(profile.name).trim();
  const title = text(profile.title).trim();
  const hourlyRate = text(profile.hourlyRateLabel).trim();
  const about = text(profile.about).trim();
  const customInstructions = text(profile.customInstructions).trim();
  const relevancyInstructions = text(profile.relevancyInstructions).trim();
  const portfolioSummary = text(profile.portfolioSummary).trim();
  const proposalTemplates = text(profile.proposalTemplates).trim();
  const proposalSystemInstructions = text(
    profile.proposalSystemInstructions
  ).trim();
  const proposalWritingInstructions = text(
    profile.proposalWritingInstructions
  ).trim();

  return {
    freelancerUsername: profile.freelancerUsername ?? null,
    name: name.length > 0 ? name : null,
    title: title.length > 0 ? title : null,
    hourlyRate: hourlyRate.length > 0 ? hourlyRate : null,
    about: about.length > 0 ? about : null,
    skills: profile.skills ?? [],
    skillIds: profile.skillIds ?? [],
    preferredProjectTypes: profile.preferredProjectTypes ?? [],
    wants: profile.wants ?? [],
    notWants: profile.notWants ?? [],
    ignoredCountries: profile.ignoredCountries ?? [],
    customInstructions:
      customInstructions.length > 0 ? customInstructions : null,
    relevancyInstructions:
      relevancyInstructions.length > 0 ? relevancyInstructions : null,
    portfolioSummary: portfolioSummary.length > 0 ? portfolioSummary : null,
    proposalTemplates: proposalTemplates.length > 0 ? proposalTemplates : null,
    proposalSystemInstructions,
    proposalWritingInstructions,
  };
}

function fingerprint(profile: UserProfile): string {
  return JSON.stringify(toPayload(profile));
}

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof NetworkError) return "Cannot reach the server";
  if (cause instanceof ApiError) return cause.message;
  return fallback;
}

/** Friendly labels for server field errors — raw keys are too technical. */
const FIELD_LABELS: Record<string, string> = {
  name: "Full name",
  title: "Professional title",
  hourlyRate: "Hourly rate",
  about: "About",
  skills: "Skills",
  wants: "Wants",
  notWants: "Not wants",
  ignoredCountries: "Ignored countries",
  customInstructions: "Proposal instructions",
  relevancyInstructions: "Screening instructions",
  portfolioSummary: "Portfolio evidence",
  proposalTemplates: "Example proposals",
  proposalSystemInstructions: "System instructions",
  proposalWritingInstructions: "Writing instructions",
};

function validationDetailLines(details: unknown): string[] {
  if (details === null || typeof details !== "object") return [];
  const d = details as {
    fieldErrors?: Record<string, unknown>;
    formErrors?: unknown;
  };
  const lines: string[] = [];
  for (const [field, raw] of Object.entries(d.fieldErrors ?? {})) {
    const messages = Array.isArray(raw)
      ? raw.filter((m) => typeof m === "string")
      : [];
    if (messages.length > 0) {
      lines.push(`${FIELD_LABELS[field] ?? field}: ${messages.join("; ")}`);
    }
  }
  if (Array.isArray(d.formErrors) && d.formErrors.length > 0) {
    lines.push(`form: ${d.formErrors.join("; ")}`);
  }
  return lines;
}

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
    relevancyInstructions: text(p.relevancyInstructions),
    portfolioSummary: text(p.portfolioSummary),
    proposalTemplates: text(p.proposalTemplates),
    proposalSystemInstructions: text(p.proposalSystemInstructions),
    proposalWritingInstructions: text(p.proposalWritingInstructions),
    skills: p.skills ?? [],
    skillIds: p.skillIds ?? [],
    preferredProjectTypes: p.preferredProjectTypes ?? [],
    wants: p.wants ?? [],
    notWants: p.notWants ?? [],
    ignoredCountries: p.ignoredCountries ?? [],
  };
}

const PORTFOLIO_TEMPLATE = `### Project name
What you built:
Result:
Link:`;

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "FC";
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export default function ProfilePage() {
  const stored = useApi<ProfileResponse>("/api/profile");
  const [override, setOverride] = useState<UserProfile | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [tab, setTab] = useState("about");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const baseProfile =
    normalizeProfile(stored.data?.profile ?? null) ?? emptyProfile;
  const form = override ?? baseProfile;
  const baseline = savedFingerprint ?? fingerprint(baseProfile);
  const dirty = fingerprint(form) !== baseline;
  const brief = stored.data?.aiBrief ?? "";
  const writerDefaults = stored.data?.writerDefaults;

  const update = (patch: Partial<UserProfile>) =>
    setOverride({ ...form, ...patch });

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    update({ [key]: value } as Partial<UserProfile>);

  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportNote(null);
    try {
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
        skills: draft.skills ?? form.skills,
        skillIds: draft.skillIds ?? form.skillIds,
        wants: draft.wants ?? form.wants,
        importedFromFreelancer: true,
      });
      setSavedFingerprint(null);
      setTab("about");
      setImportNote({
        ok: true,
        message: `Imported @${draft.freelancerUsername ?? "unknown"}. Review the fields, then save.`,
      });
    } catch (cause) {
      setImportNote({ ok: false, message: errorText(cause, "Import failed") });
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    if (saving || !dirty) return;
    const snapshot = form;
    const nextFingerprint = fingerprint(snapshot);
    setSaving(true);
    setSaveError(null);
    try {
      await api("/api/profile", { method: "PUT", body: toPayload(snapshot) });
      setOverride(snapshot);
      setSavedFingerprint(nextFingerprint);
      setImportNote(null);
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

  const discard = () => {
    setOverride(null);
    setSavedFingerprint(null);
    setSaveError(null);
    setImportNote(null);
  };

  const resetWriterInstructions = () => {
    if (!writerDefaults) return;
    set("proposalSystemInstructions", writerDefaults.proposalSystemInstructions);
    set("proposalWritingInstructions", writerDefaults.proposalWritingInstructions);
  };

  const addPortfolioTemplate = () => {
    const current = (form.portfolioSummary ?? "").trim();
    set(
      "portfolioSummary",
      current.length > 0 ? `${current}\n\n${PORTFOLIO_TEMPLATE}` : PORTFOLIO_TEMPLATE
    );
  };

  const copyBrief = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (stored.isLoading && override === null) {
    return (
      <div className="flex flex-col gap-4 md:gap-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const checks: Array<{
    label: string;
    done: boolean;
    tab: "about" | "find" | "write";
  }> = [
    {
      label: "Name, title, rate, and about",
      done:
        form.name.trim().length > 0 &&
        form.title.trim().length > 0 &&
        form.hourlyRateLabel.trim().length > 0 &&
        form.about.trim().length > 0,
      tab: "about",
    },
    {
      label: "At least three skills",
      done: form.skills.length >= 3,
      tab: "about",
    },
    {
      label: "Portfolio evidence",
      done: (form.portfolioSummary ?? "").trim().length > 0,
      tab: "about",
    },
    {
      label: "Job preferences or screening rules",
      done:
        form.wants.length > 0 ||
        form.notWants.length > 0 ||
        form.ignoredCountries.length > 0 ||
        (form.relevancyInstructions ?? "").trim().length > 0,
      tab: "find",
    },
    {
      label: "Proposal instructions",
      done: form.customInstructions.trim().length > 0,
      tab: "write",
    },
  ];

  const doneCount = checks.filter((check) => check.done).length;
  const fullyReady = doneCount === checks.length;
  const readinessPercent = Math.round((doneCount / checks.length) * 100);

  return (
    <div className="flex flex-col gap-4 pb-4 md:gap-6">
      <PageHeader
        title="Profile"
        description="One verified source of truth for screening, analysis, and proposals."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void runImport()}
              disabled={importing || saving}
            >
              {importing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {importing ? "Fetching…" : "Import from Freelancer"}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !dirty || importing}
            >
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

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Avatar size="lg">
            <AvatarFallback className="text-sm font-medium">
              {initialsFor(form.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-medium">
                {form.name.trim().length > 0 ? form.name : "Your profile"}
              </p>
              {form.freelancerUsername ? (
                <Badge variant="outline" className="font-normal">
                  @{form.freelancerUsername}
                </Badge>
              ) : null}
              {dirty ? (
                <Badge
                  variant="outline"
                  className="border-warning/40 font-normal text-warning"
                >
                  Unsaved changes
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {form.title.trim().length > 0
                ? form.title
                : "Add a professional title so clients know what you do."}
              {form.hourlyRateLabel.trim().length > 0
                ? ` · ${form.hourlyRateLabel}`
                : ""}
            </p>
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-64">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">
                {doneCount} of {checks.length} ready
              </span>
              <button
                type="button"
                onClick={() => setTab("ai")}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                View checklist
              </button>
            </div>
            <div
              role="progressbar"
              aria-label="Profile readiness"
              aria-valuemin={0}
              aria-valuemax={checks.length}
              aria-valuenow={doneCount}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  fullyReady ? "bg-success" : "bg-primary"
                )}
                style={{ width: `${readinessPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {fullyReady
                ? "Everything the AI needs is in place."
                : "Finish the remaining items for tighter matches."}
            </p>
          </div>
        </CardContent>
      </Card>

      {stored.error !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex items-start gap-2">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
            {stored.error.message}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => stored.refetch()}
            disabled={stored.isLoading}
          >
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      ) : null}

      {saveError !== null ? (
        <p className="flex items-start gap-2 whitespace-pre-line rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{saveError}</span>
        </p>
      ) : null}

      {form.importedFromFreelancer && !(importNote?.ok ?? false) ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-sm">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          Imported from{" "}
          <span className="font-medium">
            @{form.freelancerUsername ?? "Freelancer.com"}
          </span>
          . Manual edits still win over future imports.
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
          {importNote.ok ? (
            importNote.message
          ) : (
            <>
              <CircleX className="size-4 shrink-0" aria-hidden />
              {importNote.message}
            </>
          )}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border bg-muted/60 p-1">
          <TabsTrigger value="about" className="gap-2 px-3 py-2">
            <UserRound aria-hidden />
            About you
          </TabsTrigger>
          <TabsTrigger value="find" className="gap-2 px-3 py-2">
            <Target aria-hidden />
            What to find
          </TabsTrigger>
          <TabsTrigger value="write" className="gap-2 px-3 py-2">
            <PenLine aria-hidden />
            How to write
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2 px-3 py-2">
            <Eye aria-hidden />
            What the AI sees
          </TabsTrigger>
        </TabsList>

        <TabsContent value="about" className="flex flex-col gap-4 pt-1">
          <Card>
            <CardHeader>
              <CardTitle>The basics</CardTitle>
              <CardDescription>
                How clients and the AI identify you. Keep this factual.
              </CardDescription>
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
                  onChange={(event) =>
                    set("hourlyRateLabel", event.target.value)
                  }
                  placeholder="e.g. $35/hr"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="p-title">Professional title</Label>
                <Input
                  id="p-title"
                  value={form.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder="e.g. Full-stack developer"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="p-about">About</Label>
                <Textarea
                  id="p-about"
                  rows={5}
                  value={form.about}
                  onChange={(event) => set("about", event.target.value)}
                  placeholder="What you build, who you help, and the results you deliver."
                />
                <p className="text-xs text-muted-foreground">
                  Describe real experience only. The AI never invents facts.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
              <CardDescription>
                Used as Freelancer search keywords and as verified facts in
                analysis and proposals.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ChipEditor
                values={form.skills}
                onChange={(skills) => set("skills", skills)}
                placeholder="Add a skill"
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Search className="size-3.5 shrink-0" aria-hidden />
                More accurate skills mean better job fetching and stronger
                matches.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Portfolio evidence</CardTitle>
              <CardDescription>
                Real projects the proposal writer may reference. Add only work
                you can stand behind.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Textarea
                aria-label="Portfolio summary"
                rows={10}
                value={form.portfolioSummary}
                onChange={(event) =>
                  set("portfolioSummary", event.target.value)
                }
                placeholder={PORTFOLIO_TEMPLATE}
                className="bg-background font-mono text-[13px] leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Include what you built, the result, and a real link when you
                  have one.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addPortfolioTemplate}
                >
                  <Plus data-icon="inline-start" />
                  Add project template
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="find" className="flex flex-col gap-4 pt-1">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle>Job filters</CardTitle>
                <CardDescription>
                  Cheap checks applied before any AI call.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <Label>Wants</Label>
                  <ChipEditor
                    values={form.wants}
                    onChange={(wants) => set("wants", wants)}
                    placeholder="e.g. React"
                  />
                  <p className="text-xs text-muted-foreground">
                    Jobs mentioning these rank higher.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Not wants</Label>
                  <ChipEditor
                    values={form.notWants}
                    onChange={(notWants) => set("notWants", notWants)}
                    placeholder="e.g. crypto"
                  />
                  <p className="text-xs text-muted-foreground">
                    Matching jobs are rejected outright.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Ignored countries</Label>
                  <ChipEditor
                    values={form.ignoredCountries}
                    onChange={(ignoredCountries) =>
                      set("ignoredCountries", ignoredCountries)
                    }
                    placeholder="Add a country name or ISO code"
                  />
                  <p className="text-xs text-muted-foreground">
                    Matched by name or code, e.g. Pakistan or PK.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Screening instructions</CardTitle>
                <CardDescription>
                  Plain-language guidance for the fast relevance model.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Textarea
                  id="relevancy-instructions"
                  aria-label="Screening instructions"
                  rows={8}
                  value={form.relevancyInstructions}
                  onChange={(event) =>
                    set("relevancyInstructions", event.target.value)
                  }
                  placeholder='e.g. "Prioritize long-term React work. Avoid web3 and WordPress."'
                  className="bg-background text-[13px]"
                />
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Used with the job title, description, budget, and client trust
                  signals. Irrelevant jobs are stored but never analyzed or bid
                  on.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="write" className="flex flex-col gap-4 pt-1">
          <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
            <CardHeader>
              <CardTitle>Your proposal instructions</CardTitle>
              <CardDescription>
                Standing orders applied last, after all profile facts and
                examples.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Textarea
                id="proposal-instructions"
                aria-label="Proposal instructions"
                rows={6}
                value={form.customInstructions}
                onChange={(event) =>
                  set("customInstructions", event.target.value)
                }
                placeholder="Tone, structure, what you will or will not offer, and how you want to close."
                className="bg-background text-[13px]"
              />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Use this for personal preferences. It cannot make the writer
                claim facts that are missing from your profile.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Example proposals</CardTitle>
              <CardDescription>
                Optional samples that guide tone and structure. The writer must
                never copy untrue details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                aria-label="Example proposals"
                rows={9}
                value={form.proposalTemplates}
                onChange={(event) =>
                  set("proposalTemplates", event.target.value)
                }
                placeholder={
                  "## Fixed-price example\n...\n\n## Hourly example\n..."
                }
                className="bg-background font-mono text-[13px] leading-relaxed"
              />
            </CardContent>
          </Card>

          <details className="group rounded-xl bg-card ring-1 ring-foreground/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex flex-col gap-1">
                <span className="font-heading text-base font-medium">
                  Advanced writer rules
                </span>
                <span className="text-sm text-muted-foreground">
                  The system prompt and pre-instructions sent before your facts.
                </span>
              </div>
              <span className="text-sm text-muted-foreground group-open:hidden">
                Show
              </span>
              <span className="hidden text-sm text-muted-foreground group-open:inline">
                Hide
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t p-4">
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Most people never need to change these. Your proposal
                instructions above still apply last.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proposal-system-instructions">
                  System instructions
                </Label>
                <Textarea
                  id="proposal-system-instructions"
                  aria-label="Proposal system instructions"
                  rows={6}
                  value={form.proposalSystemInstructions}
                  onChange={(event) =>
                    set("proposalSystemInstructions", event.target.value)
                  }
                  className="bg-background font-mono text-[13px] leading-relaxed"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="proposal-writing-instructions">
                  Writing instructions
                </Label>
                <Textarea
                  id="proposal-writing-instructions"
                  aria-label="Proposal writing instructions"
                  rows={10}
                  value={form.proposalWritingInstructions}
                  onChange={(event) =>
                    set("proposalWritingInstructions", event.target.value)
                  }
                  className="bg-background font-mono text-[13px] leading-relaxed"
                />
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetWriterInstructions}
                  disabled={!writerDefaults}
                >
                  <RotateCcw data-icon="inline-start" />
                  Restore defaults
                </Button>
              </div>
            </div>
          </details>
        </TabsContent>

        <TabsContent value="ai" className="flex flex-col gap-4 pt-1">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <Card className="border-primary/25 bg-primary/[0.03] ring-primary/15">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" aria-hidden />
                  Profile brief
                </CardTitle>
                <CardDescription>
                  Built automatically from your saved facts. This is what the AI
                  is grounded on.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {dirty ? (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] p-2.5 text-xs">
                    <CircleAlert
                      className="mt-0.5 size-3.5 shrink-0 text-warning"
                      aria-hidden
                    />
                    You have unsaved edits. Save the profile to rebuild this
                    preview.
                  </p>
                ) : null}
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 font-mono text-[13px] leading-relaxed">
                  {brief.length > 0
                    ? brief
                    : "No saved profile yet. Fill in the other tabs and save to build the AI brief."}
                </pre>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Read-only by design. Edit the source facts instead.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyBrief()}
                    disabled={brief.length === 0}
                    aria-live="polite"
                  >
                    <Copy data-icon="inline-start" />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Readiness</CardTitle>
                <CardDescription>
                  {doneCount} of {checks.length} items complete. Select an open
                  item to edit it. Better inputs produce tighter matches and
                  proposals.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {checks.map((check) => (
                  <button
                    key={check.label}
                    type="button"
                    onClick={() => setTab(check.tab)}
                    className="flex items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {check.done ? (
                      <CircleCheck
                        className="size-4 shrink-0 text-success"
                        aria-hidden
                      />
                    ) : (
                      <CircleAlert
                        className="size-4 shrink-0 text-warning"
                        aria-hidden
                      />
                    )}
                    <span
                      className={
                        check.done
                          ? "text-sm text-muted-foreground"
                          : "text-sm font-medium"
                      }
                    >
                      {check.label}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Where each part is used</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Search className="size-4 text-muted-foreground" aria-hidden />
                  Job fetching
                </div>
                <p className="text-xs text-muted-foreground">
                  Skills become search keywords. Wants, not-wants, ignored
                  countries, and screening instructions filter results.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Target className="size-4 text-muted-foreground" aria-hidden />
                  Analysis
                </div>
                <p className="text-xs text-muted-foreground">
                  The brief gives the analysis model verified skills, rate,
                  portfolio, and fit preferences.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <PenLine
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  Proposals
                </div>
                <p className="text-xs text-muted-foreground">
                  Proposals combine the brief, portfolio, examples, writer rules,
                  and your instructions applied last.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dirty ? (
        <div
          role="status"
          aria-live="polite"
          className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <p className="flex items-center gap-2 text-sm">
            <CircleAlert className="size-4 text-warning" aria-hidden />
            You have unsaved profile changes.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={saving || importing}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void save()}
              disabled={saving || importing}
            >
              <Save data-icon="inline-start" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
