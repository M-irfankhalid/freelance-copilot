import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Briefcase,
  Check,
  ChevronRight,
  FileText,
  Flag,
  Info,
  Loader2,
  MessageSquareQuote,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { AiModelOption } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  FlowContextDialog,
  type ContextTab,
  type ProfileContext,
  type ProfileField,
} from "./flow-context-dialog";
import {
  FLOW_STEP_HELP,
  FLOW_STEP_LABELS,
  newFlowStep,
  type FlowConfig,
  type FlowFile,
  type FlowPosition,
  type FlowStep,
  type FlowStepType,
} from "./flow-types";

type PromptKey = "brief" | "writer" | "judge" | "reviewer" | "reviser" | "deleter";
type StageKey =
  | "brief"
  | "candidates"
  | "judge"
  | "review"
  | "revision"
  | "deletion"
  | "deterministicValidation";
type FlowNodeId =
  | "job"
  | "brief"
  | "draft"
  | "judge"
  | "review"
  | "revise"
  | "trim"
  | "validate"
  | "final"
  | "style"
  | "voice"
  | "profile"
  | "playbooks";

type CanvasSelection =
  | { kind: "node"; id: FlowNodeId }
  | { kind: "step"; id: string };

const FLOW_NODE_WIDTH = 216;
const FLOW_NODE_HEIGHT = 132;
const FLOW_NODE_GAP = 76;
const FLOW_NODE_PAD = 40;

const STAGE_FOR_NODE: Partial<Record<FlowNodeId, StageKey>> = {
  brief: "brief",
  draft: "candidates",
  judge: "judge",
  review: "review",
  revise: "revision",
  trim: "deletion",
  validate: "deterministicValidation",
};

const PROMPT_FOR_NODE: Partial<Record<FlowNodeId, PromptKey>> = {
  brief: "brief",
  draft: "writer",
  judge: "judge",
  review: "reviewer",
  revise: "reviser",
  trim: "deleter",
};

const PIPELINE_NODES: Array<{
  id: FlowNodeId;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: "job",
    label: "New job",
    hint: "Post, profile, and evidence",
    icon: Briefcase,
    accent: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
  {
    id: "brief",
    label: "Job brief",
    hint: "Reads the job and extracts the main points",
    icon: FileText,
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  {
    id: "draft",
    label: "Draft",
    hint: "Writes the proposal from the brief",
    icon: Wand2,
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  {
    id: "judge",
    label: "Judge",
    hint: "Picks the strongest draft",
    icon: Scale,
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  {
    id: "review",
    label: "Review",
    hint: "Finds missing or weak parts",
    icon: Check,
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  {
    id: "revise",
    label: "Revise",
    hint: "Fixes the review notes",
    icon: RefreshCw,
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  },
  {
    id: "trim",
    label: "Trim",
    hint: "Removes filler and repetition",
    icon: Scissors,
    accent: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  },
  {
    id: "validate",
    label: "Validate",
    hint: "Checks rules before sending",
    icon: ShieldCheck,
    accent: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
  },
  {
    id: "final",
    label: "Final proposal",
    hint: "The draft you send",
    icon: Flag,
    accent: "bg-primary/10 text-primary",
  },
];

const INPUT_NODES: Array<{
  id: FlowNodeId;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: "style",
    label: "Writing style",
    hint: "Tone, length, and format",
    icon: SlidersHorizontal,
    accent: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
  },
  {
    id: "voice",
    label: "Voice examples",
    hint: "Proposals that sound like you",
    icon: MessageSquareQuote,
    accent: "bg-teal-500/10 text-teal-600 dark:text-teal-300",
  },
  {
    id: "profile",
    label: "Profile check",
    hint: "Facts and evidence quality",
    icon: UserRound,
    accent: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  },
  {
    id: "playbooks",
    label: "Playbooks",
    hint: "Strategies for job types",
    icon: BookOpen,
    accent: "bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
];

const FLOW_STEP_STYLE: Record<FlowStepType, { icon: LucideIcon; accent: string }> = {
  brief: {
    icon: FileText,
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  write: {
    icon: Wand2,
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  judge: {
    icon: Scale,
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  review: {
    icon: Check,
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  revise: {
    icon: RefreshCw,
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  },
  custom: {
    icon: Sparkles,
    accent: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
  },
  final: {
    icon: Flag,
    accent: "bg-primary/10 text-primary",
  },
};

interface CandidateLane {
  id: string;
  label: string;
  guidance: string;
  model: string | null;
  temperature: number | null;
  timeoutSeconds: number | null;
  enabled: boolean;
}

interface EngineConfig {
  version: 1;
  engine: {
    version: 1;
    defaultsVersion: number;
    candidateCount: number;
    shapes: string[];
    candidateLanes: CandidateLane[];
    flow: FlowConfig;
    models: Record<PromptKey, string | null>;
    temperatures: Record<PromptKey, number>;
    timeoutsSeconds: Record<PromptKey, number>;
    stages: Record<StageKey, boolean>;
    maxRevisionAttempts: number;
    maxRepairAttempts: number;
    maxSampleCount: number;
    maxEvidenceItems: number;
    minWordsForDeletion: number;
    shapeGuidance: Record<string, string>;
    contracts: {
      writer: string;
      reviewer: string;
      reviser: string;
    };
  };
  prompts: Record<PromptKey, { system: string; user: string }>;
  policy: {
    version: 1;
    commercials: "body_when_set" | "fields_only" | "if_client_asks";
    words: { min: number; max: number };
    format: "natural" | "structured";
    askQuestion: "never" | "if_useful" | "always";
    maxEvidence: number;
    includeLinks: boolean;
    bannedPhrases: string[];
  };
  checks: {
    hard: string[];
    policy: string[];
    advisory: string[];
    antiAiTells: string[];
  };
}

interface Playbook {
  id: string;
  name: string;
  jobType: string;
  matchKeywords: string[];
  strategy: string;
  openingGuidance: string;
  questionGuidance: string;
  omitGuidance: string;
  active: boolean;
  sortOrder: number;
}

type PlaybookInput = Omit<Playbook, "id">;

interface Sample {
  id: string;
  title: string;
  jobType: string;
  content: string;
  tags: string[];
  outcome: "won" | "lost" | "unknown";
  rating: number;
  preferred: boolean;
  notes: string;
  active: boolean;
}

type SampleInput = Omit<Sample, "id">;

interface ImportableBid {
  id: string;
  jobTitle: string;
  outcome: "in_review" | "won" | "lost" | null;
  submittedLabel: string;
  via: "manual" | "auto";
  proposalExcerpt?: string | null;
}

interface AuditFinding {
  ruleId: string;
  severity: "blocker" | "warning" | "info";
  category: string;
  field: string;
  title: string;
  evidence: string;
  why: string;
  recommendation: string;
  suggestedText?: string;
}

interface AuditView {
  score: number;
  status: "good" | "needs_attention" | "poor" | string;
  summary: string;
  findings: AuditFinding[];
  model?: string | null;
  createdAt?: string;
}

interface AuditSettings {
  version: 1;
  runOnSave: boolean;
  rules: Array<{
    id: string;
    label: string;
    severity: "blocker" | "warning" | "info";
    enabled: boolean;
    instruction: string;
  }>;
  prompt: { system: string; user: string };
  model: string | null;
}

interface ConfigResponse {
  engine: EngineConfig;
  playbooks: Playbook[];
  samples: Sample[];
  auditSettings: AuditSettings;
  latestAudit: AuditView | null;
}

interface ProfileResponse {
  profile: ProfileContext | null;
  aiBrief: string | null;
  writerDefaults: {
    proposalSystemInstructions: string;
    proposalWritingInstructions: string;
  };
}

const CONTRACT_FIELDS: Array<{
  key: keyof EngineConfig["engine"]["contracts"];
  label: string;
  hint: string;
}> = [
  {
    key: "writer",
    label: "Writer contract",
    hint: "Appended after the writer prompt. Supports {{wordTarget}} and {{relationshipGuidance}}.",
  },
  {
    key: "reviewer",
    label: "Reviewer and judge contract",
    hint: "Appended after the reviewer and judge prompts. Supports {{relationshipGuidance}}.",
  },
  {
    key: "reviser",
    label: "Reviser contract",
    hint: "Appended after the reviser prompt. Leave empty to disable it.",
  },
];

const EMPTY_PROFILE_CONTEXT: ProfileContext = {
  freelancerUsername: null,
  name: null,
  title: null,
  hourlyRate: null,
  about: null,
  skills: [],
  skillIds: [],
  preferredProjectTypes: [],
  wants: [],
  notWants: [],
  ignoredCountries: [],
  customInstructions: null,
  userSummary: null,
  relevancyInstructions: null,
  portfolioSummary: null,
  proposalTemplates: null,
  proposalSystemInstructions: null,
  proposalWritingInstructions: null,
};

const PROFILE_FIELDS: ProfileField[] = [
  "userSummary",
  "portfolioSummary",
  "relevancyInstructions",
];

function profilePayload(profile: ProfileContext) {
  const text = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    freelancerUsername: profile.freelancerUsername,
    name: profile.name,
    title: profile.title,
    hourlyRate: profile.hourlyRate,
    about: profile.about,
    skills: profile.skills,
    skillIds: profile.skillIds,
    preferredProjectTypes: profile.preferredProjectTypes,
    wants: profile.wants,
    notWants: profile.notWants,
    ignoredCountries: profile.ignoredCountries,
    customInstructions: profile.customInstructions,
    userSummary: text(profile.userSummary),
    relevancyInstructions: text(profile.relevancyInstructions),
    portfolioSummary: text(profile.portfolioSummary),
    proposalTemplates: profile.proposalTemplates,
    proposalSystemInstructions: profile.proposalSystemInstructions,
    proposalWritingInstructions: profile.proposalWritingInstructions,
  };
}

const EMPTY_PLAYBOOK: PlaybookInput = {
  name: "",
  jobType: "general",
  matchKeywords: [],
  strategy: "",
  openingGuidance: "",
  questionGuidance: "",
  omitGuidance: "",
  active: true,
  sortOrder: 0,
};

const EMPTY_SAMPLE: SampleInput = {
  title: "",
  jobType: "general",
  content: "",
  tags: [],
  outcome: "unknown",
  rating: 3,
  preferred: false,
  notes: "",
  active: true,
};

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function labelForLane(id: string): string {
  return (
    id
      .split(/[_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || "Candidate"
  );
}

function uniqueStepId(steps: FlowStep[]): string {
  const ids = new Set(steps.map((step) => step.id));
  let index = 1;
  while (ids.has(`step_${index}`)) index++;
  return `step_${index}`;
}

function withCandidateLanes(engine: EngineConfig["engine"]): EngineConfig["engine"] {
  if (engine.candidateLanes !== undefined && engine.candidateLanes.length > 0) return engine;

  const shapes = engine.shapes.length > 0 ? engine.shapes : ["short_note"];
  const count = Math.max(1, Math.min(engine.candidateCount, 8));
  const lanes: CandidateLane[] = Array.from({ length: count }, (_value, index) => {
    const shape = shapes[index % shapes.length] ?? "short_note";
    const repeat = Math.floor(index / shapes.length);
    return {
      id: repeat === 0 ? shape : `${shape}-${repeat + 1}`,
      label: labelForLane(shape),
      guidance: engine.shapeGuidance[shape] ?? "",
      model: null,
      temperature: null,
      timeoutSeconds: null,
      enabled: true,
    };
  });
  return { ...engine, candidateLanes: lanes };
}

function syncCandidateLaneFields(engine: EngineConfig["engine"]): void {
  const lanes = engine.candidateLanes;
  engine.candidateCount = Math.max(1, Math.min(lanes.length, 8));
  engine.shapes = lanes.map((lane) => lane.id);
  engine.shapeGuidance = Object.fromEntries(lanes.map((lane) => [lane.id, lane.guidance]));
}

function ensureFlow(engine: EngineConfig["engine"]): FlowConfig {
  engine.flow ??= { enabled: false, steps: [], files: [] };
  return engine.flow;
}

function withFlow(engine: EngineConfig["engine"]): EngineConfig["engine"] {
  const flow = engine.flow ?? { enabled: false, steps: [], files: [] };
  return {
    ...engine,
    flow: {
      ...flow,
      steps: flow.steps.map((step, index) => ({
        ...step,
        position:
          step.position ??
          ({ x: 64, y: 64 + index * 196 } satisfies FlowPosition),
      })),
    },
  };
}

function severityVariant(severity: AuditFinding["severity"]) {
  if (severity === "blocker") return "destructive" as const;
  if (severity === "warning") return "outline" as const;
  return "secondary" as const;
}

export default function ProposalSystemPage() {
  const { data, error, isLoading, refetch } =
    useApi<ConfigResponse>("/api/proposal-system");

  if (isLoading && data === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading proposal flow…
      </div>
    );
  }

  if (error !== null || data === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Proposal flow unavailable</CardTitle>
          <CardDescription>{error?.message ?? "Could not load settings."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <ProposalSystemEditor data={data} refetch={refetch} />;
}

function ProposalSystemEditor({
  data,
  refetch,
}: {
  data: ConfigResponse;
  refetch: () => void;
}) {
  const { toast } = useToast();
  const profileApi = useApi<ProfileResponse>("/api/profile");
  const modelsApi = useApi<{ models: AiModelOption[] }>(
    "/api/credentials/openrouter/models"
  );

  const [profileOverride, setProfileOverride] = useState<ProfileContext | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>("profile");

  const [draft, setDraft] = useState<EngineConfig>(() => {
    const next = clone(data.engine);
    next.engine = withFlow(withCandidateLanes(next.engine));
    return next;
  });
  const baseline = useMemo(() => {
    const next = clone(data.engine);
    next.engine = withFlow(withCandidateLanes(next.engine));
    return next;
  }, [data.engine]);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection>(() => {
    const flow = data.engine.engine.flow;
    const first = flow.steps[0];
    return flow.enabled && first !== undefined
      ? { kind: "step", id: first.id }
      : { kind: "node", id: "draft" };
  });
  const [addType, setAddType] = useState<FlowStepType>("custom");
  const [audit, setAudit] = useState<AuditView | null>(data.latestAudit);
  const [auditing, setAuditing] = useState(false);
  const [auditDraft, setAuditDraft] = useState<AuditSettings>(() =>
    clone(data.auditSettings)
  );
  const [rulesText, setRulesText] = useState(() =>
    JSON.stringify(data.auditSettings.rules, null, 2)
  );
  const [savingAudit, setSavingAudit] = useState(false);
  const [playbookDraft, setPlaybookDraft] = useState<PlaybookInput | null>(null);
  const [editingPlaybook, setEditingPlaybook] = useState<string | null>(null);
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [sampleDraft, setSampleDraft] = useState<SampleInput | null>(null);
  const [editingSample, setEditingSample] = useState<string | null>(null);
  const [savingSample, setSavingSample] = useState(false);
  const [showAllExamples, setShowAllExamples] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBids, setImportBids] = useState<ImportableBid[]>([]);
  const [selectedBidIds, setSelectedBidIds] = useState<Set<string>>(new Set());
  const [loadingBids, setLoadingBids] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const config = draft;
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline]
  );

  const baseProfile = profileApi.data?.profile ?? EMPTY_PROFILE_CONTEXT;
  const profile = profileOverride ?? baseProfile;
  const profileDirty = PROFILE_FIELDS.some(
    (field) => (profile[field] ?? "") !== (baseProfile[field] ?? "")
  );

  const missingQualityInputs: string[] = [];
  if (
    (profile.name ?? "").trim().length === 0 ||
    (profile.title ?? "").trim().length === 0 ||
    (profile.hourlyRate ?? "").trim().length === 0 ||
    (profile.about ?? "").trim().length === 0
  ) {
    missingQualityInputs.push("complete profile facts");
  }
  if ((profile.skills?.length ?? 0) < 3) {
    missingQualityInputs.push("at least three skills");
  }
  if ((profile.portfolioSummary ?? "").trim().length === 0) {
    missingQualityInputs.push("portfolio evidence");
  }
  if (
    (profile.customInstructions ?? "").trim().length === 0 &&
    data.samples.length === 0
  ) {
    missingQualityInputs.push("a writing style or voice examples");
  }

  const updateProfile = (field: ProfileField, value: string) => {
    setProfileOverride({ ...profile, [field]: value });
  };

  const saveProfileContext = async () => {
    setSavingProfile(true);
    try {
      await api("/api/profile", {
        method: "PUT",
        body: profilePayload(profile),
      });
      profileApi.refetch();
      setProfileOverride(null);
      toast({ title: "Profile context saved" });
    } catch (cause) {
      toast({
        title: "Could not save profile context",
        description: messageFor(cause),
        variant: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const update = (mutator: (next: EngineConfig) => void) => {
    setDraft((current) => {
      const next = clone(current);
      mutator(next);
      syncCandidateLaneFields(next.engine);
      return next;
    });
  };

  /** Replace the local draft with a server response after reset/upgrade. */
  const applyServerConfig = (engine: EngineConfig) => {
    const next = clone(engine);
    next.engine = withFlow(withCandidateLanes(next.engine));
    setDraft(next);
  };

  const createFile = (file: FlowFile) => {
    update((next) => {
      ensureFlow(next.engine).files.push(file);
    });
  };

  const updateFile = (index: number, file: FlowFile) => {
    update((next) => {
      const flow = ensureFlow(next.engine);
      const previous = flow.files[index];
      if (previous === undefined) return;
      flow.files[index] = file;
      if (previous.id === file.id) return;
      const from = `{{file_${previous.id}}}`;
      const to = `{{file_${file.id}}}`;
      for (const step of flow.steps) {
        step.fileIds = step.fileIds.map((id) => (id === previous.id ? file.id : id));
        step.system = step.system.split(from).join(to);
        step.user = step.user.split(from).join(to);
      }
    });
  };

  const deleteFile = (index: number) => {
    const removed = config.engine.flow.files[index];
    if (removed === undefined) return;
    update((next) => {
      const flow = ensureFlow(next.engine);
      flow.files.splice(index, 1);
      for (const step of flow.steps) {
        step.fileIds = step.fileIds.filter((id) => id !== removed.id);
      }
    });
  };

  const toggleFile = (index: number, enabled: boolean) => {
    update((next) => {
      const flow = ensureFlow(next.engine);
      const file = flow.files[index];
      if (file !== undefined) file.enabled = enabled;
    });
  };

  const updateLane = (index: number, mutator: (lane: CandidateLane) => void) => {
    update((next) => {
      const lane = next.engine.candidateLanes[index];
      if (lane === undefined) return;
      mutator(lane);
    });
  };

  const addLane = () => {
    update((next) => {
      if (next.engine.candidateLanes.length >= 8) return;
      const used = new Set(next.engine.candidateLanes.map((lane) => lane.id));
      let suffix = next.engine.candidateLanes.length + 1;
      while (used.has(`custom_${suffix}`)) suffix++;
      next.engine.candidateLanes.push({
        id: `custom_${suffix}`,
        label: `Custom candidate ${suffix}`,
        guidance: "",
        model: null,
        temperature: null,
        timeoutSeconds: null,
        enabled: true,
      });
    });
  };

  const removeLane = (index: number) => {
    update((next) => {
      if (next.engine.candidateLanes.length <= 1) return;
      next.engine.candidateLanes.splice(index, 1);
    });
  };

  const moveLane = (index: number, direction: -1 | 1) => {
    update((next) => {
      const target = index + direction;
      if (target < 0 || target >= next.engine.candidateLanes.length) return;
      const [lane] = next.engine.candidateLanes.splice(index, 1);
      if (lane !== undefined) next.engine.candidateLanes.splice(target, 0, lane);
    });
  };

  const updateStep = (index: number, mutator: (step: FlowStep) => void) => {
    update((next) => {
      const step = ensureFlow(next.engine).steps[index];
      if (step !== undefined) mutator(step);
    });
  };

  const addStep = (type: FlowStepType = addType) => {
    if (config.engine.flow.steps.length >= 24) return;
    const id = uniqueStepId(config.engine.flow.steps);
    update((next) => {
      const flow = ensureFlow(next.engine);
      const base = newFlowStep(flow.steps.length + 1);
      flow.steps.push({
        ...base,
        id,
        label: FLOW_STEP_LABELS[type],
        type,
      });
    });
    setSelection({ kind: "step", id });
  };

  const insertStep = (index: number, type: FlowStepType) => {
    if (config.engine.flow.steps.length >= 24) return;
    const id = uniqueStepId(config.engine.flow.steps);
    update((next) => {
      const flow = ensureFlow(next.engine);
      const base = newFlowStep(flow.steps.length + 1);
      flow.steps.splice(index + 1, 0, {
        ...base,
        id,
        label: FLOW_STEP_LABELS[type],
        type,
      });
    });
    setSelection({ kind: "step", id });
  };

  const duplicateStep = (index: number) => {
    if (config.engine.flow.steps.length >= 24) return;
    const source = config.engine.flow.steps[index];
    if (source === undefined) return;
    const id = uniqueStepId(config.engine.flow.steps);
    update((next) => {
      const flow = ensureFlow(next.engine);
      const step = flow.steps[index];
      if (step === undefined) return;
      flow.steps.splice(index + 1, 0, {
        ...step,
        id,
        label: `${step.label} copy`,
        position: null,
        fileIds: [...step.fileIds],
      });
    });
    setSelection({ kind: "step", id });
  };

  const removeStep = (index: number) => {
    update((next) => {
      ensureFlow(next.engine).steps.splice(index, 1);
    });
    const remaining = config.engine.flow.steps.filter((_step, stepIndex) => stepIndex !== index);
    const nextSelected = remaining[index] ?? remaining[index - 1];
    setSelection(
      nextSelected === undefined
        ? { kind: "node", id: "draft" }
        : { kind: "step", id: nextSelected.id }
    );
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= config.engine.flow.steps.length) return;
    update((next) => {
      const steps = ensureFlow(next.engine).steps;
      const [step] = steps.splice(index, 1);
      if (step !== undefined) steps.splice(target, 0, step);
    });
  };

  const setCustomFlowEnabled = (checked: boolean) => {
    if (!checked) {
      update((next) => {
        ensureFlow(next.engine).enabled = false;
      });
      setSelection({ kind: "node", id: "draft" });
      return;
    }
    const seeds: FlowStep[] =
      config.engine.flow.steps.length === 0
        ? [
            {
              ...newFlowStep(1),
              id: "write",
              label: "Write proposal",
              type: "write",
            },
            {
              ...newFlowStep(2),
              id: "final",
              label: "Final output",
              type: "final",
            },
          ]
        : [];
    update((next) => {
      const flow = ensureFlow(next.engine);
      flow.enabled = true;
      if (flow.steps.length === 0) flow.steps.push(...seeds);
    });
    const firstId = config.engine.flow.steps[0]?.id ?? seeds[0]?.id;
    setSelection(firstId === undefined ? { kind: "node", id: "draft" } : { kind: "step", id: firstId });
  };

  const updateAudit = (mutator: (next: AuditSettings) => void) => {
    setAuditDraft((current) => {
      const next = clone(current);
      mutator(next);
      return next;
    });
  };

  const saveEngine = async () => {
    const ids = config.engine.candidateLanes.map((lane) => lane.id.trim());
    if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) {
      setActionError("Candidate lane IDs must be unique and non-empty.");
      return;
    }
    const flow = config.engine.flow;
    const stepIds = flow.steps.map((step) => step.id.trim());
    const validId = /^[a-zA-Z][a-zA-Z0-9_]*$/;
    if (stepIds.some((id) => !validId.test(id)) || new Set(stepIds).size !== stepIds.length) {
      setActionError(
        "Flow node IDs must be unique, start with a letter, and use only letters, numbers, and underscores."
      );
      return;
    }
    if (
      flow.enabled &&
      flow.steps.some(
        (step) =>
          step.enabled &&
          step.type !== "final" &&
          (step.system.trim().length === 0 || step.user.trim().length === 0)
      )
    ) {
      setActionError("Every enabled flow node except Final needs a system and user prompt.");
      return;
    }
    if (
      flow.enabled &&
      !flow.steps.some(
        (step) =>
          step.enabled &&
          (step.type === "write" || step.type === "revise" || step.type === "custom")
      )
    ) {
      setActionError("Enable at least one node that writes text (Write, Revise, or Custom).");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const next = clone(config);
      syncCandidateLaneFields(next.engine);
      await api("/api/proposal-system/engine", {
        method: "PUT",
        body: {
          engine: next.engine,
          prompts: next.prompts,
          policy: next.policy,
          checks: next.checks,
        },
        timeoutMs: 30_000,
      });
      toast({ title: "Proposal flow saved", variant: "success" });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  const resetEngine = async () => {
    setResetting(true);
    setActionError(null);
    try {
      const result = await api<{ engine: EngineConfig }>(
        "/api/proposal-system/engine/reset",
        { method: "POST" }
      );
      applyServerConfig(result.engine);
      toast({ title: "Defaults restored", variant: "success" });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setResetting(false);
    }
  };

  const upgradeEngine = async () => {
    setUpgrading(true);
    setActionError(null);
    try {
      const result = await api<{
        config: EngineConfig;
        upgraded: string[];
        preserved: string[];
        fromVersion: number;
        toVersion: number;
      }>("/api/proposal-system/engine/upgrade", { method: "POST" });
      applyServerConfig(result.config);
      toast({
        title:
          result.upgraded.length > 0
            ? "Defaults upgraded"
            : "Already on the latest defaults",
        description:
          result.preserved.length > 0
            ? `Preserved ${result.preserved.length} customized setting(s).`
            : undefined,
        variant: "success",
      });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setUpgrading(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    setActionError(null);
    try {
      const result = await api<AuditView>("/api/proposal-system/audit/run", {
        method: "POST",
        timeoutMs: 120_000,
      });
      setAudit(result);
      toast({ title: `Audit finished: ${result.score}/100`, variant: "success" });
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setAuditing(false);
    }
  };

  const saveAuditSettings = async () => {
    if (auditDraft === null) return;
    let rules: AuditSettings["rules"];
    try {
      rules = JSON.parse(rulesText) as AuditSettings["rules"];
    } catch {
      setActionError("Audit rules must be valid JSON.");
      return;
    }
    setSavingAudit(true);
    setActionError(null);
    try {
      await api("/api/proposal-system/audit/settings", {
        method: "PUT",
        body: { ...auditDraft, rules },
      });
      toast({ title: "Audit settings saved", variant: "success" });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setSavingAudit(false);
    }
  };

  const savePlaybook = async () => {
    if (playbookDraft === null) return;
    setSavingPlaybook(true);
    setActionError(null);
    try {
      await api(
        editingPlaybook === null
          ? "/api/proposal-system/playbooks"
          : `/api/proposal-system/playbooks/${editingPlaybook}`,
        {
          method: editingPlaybook === null ? "POST" : "PUT",
          body: playbookDraft,
        }
      );
      toast({ title: "Playbook saved", variant: "success" });
      setPlaybookDraft(null);
      setEditingPlaybook(null);
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setSavingPlaybook(false);
    }
  };

  const removePlaybook = async (id: string) => {
    setActionError(null);
    try {
      await api(`/api/proposal-system/playbooks/${id}`, { method: "DELETE" });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    }
  };

  const saveSample = async () => {
    if (sampleDraft === null) return;
    setSavingSample(true);
    setActionError(null);
    try {
      await api(
        editingSample === null
          ? "/api/proposal-system/samples"
          : `/api/proposal-system/samples/${editingSample}`,
        {
          method: editingSample === null ? "POST" : "PUT",
          body: sampleDraft,
        }
      );
      toast({ title: "Voice example saved", variant: "success" });
      setSampleDraft(null);
      setEditingSample(null);
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setSavingSample(false);
    }
  };

  const removeSample = async (id: string) => {
    setActionError(null);
    try {
      await api(`/api/proposal-system/samples/${id}`, { method: "DELETE" });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    }
  };

  const openImportSamples = async () => {
    setImportOpen(true);
    setLoadingBids(true);
    setActionError(null);
    setSelectedBidIds(new Set());
    try {
      const result = await api<{ bids: ImportableBid[] }>("/api/bids");
      setImportBids(result.bids);
    } catch (cause) {
      setImportBids([]);
      setActionError(messageFor(cause));
    } finally {
      setLoadingBids(false);
    }
  };

  const toggleBid = (bidId: string, checked: boolean) => {
    setSelectedBidIds((current) => {
      const next = new Set(current);
      if (checked) next.add(bidId);
      else next.delete(bidId);
      return next;
    });
  };

  const importSelectedSamples = async () => {
    if (selectedBidIds.size === 0) return;
    setImporting(true);
    setActionError(null);
    try {
      const result = await api<{
        imported: number;
        skipped: number;
        notFound: number;
      }>("/api/proposal-system/samples/import", {
        method: "POST",
        body: { bidIds: [...selectedBidIds] },
      });
      const details = [
        result.skipped > 0 ? `${result.skipped} skipped` : null,
        result.notFound > 0 ? `${result.notFound} no longer found` : null,
      ].filter((item): item is string => item !== null);
      toast({
        title: `Imported ${result.imported} proposal(s)`,
        description: details.length > 0 ? details.join(", ") : undefined,
        variant: "success",
      });
      setImportOpen(false);
      setSelectedBidIds(new Set());
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setImporting(false);
    }
  };

  const deleteAllSamples = async () => {
    setDeletingAll(true);
    setActionError(null);
    try {
      const result = await api<{ deleted: number }>("/api/proposal-system/samples", {
        method: "DELETE",
      });
      toast({
        title: `Deleted ${result.deleted} voice example(s)`,
        variant: "success",
      });
      setDeleteAllOpen(false);
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setDeletingAll(false);
    }
  };

  const activeLanes = config.engine.candidateLanes.filter((lane) => lane.enabled).length;
  const activeSamples = data.samples.filter((sample) => sample.active).length;
  const models = modelsApi.data?.models ?? [];
  const customFlowOn = config.engine.flow.enabled;
  const flowSteps = config.engine.flow.steps;
  const nodeY = 72;
  const nodeX = (index: number) => FLOW_NODE_PAD + index * (FLOW_NODE_WIDTH + FLOW_NODE_GAP);
  const canvasWidth =
    FLOW_NODE_PAD * 2 +
    PIPELINE_NODES.length * FLOW_NODE_WIDTH +
    (PIPELINE_NODES.length - 1) * FLOW_NODE_GAP;
  const flowCanvasWidth = Math.max(
    960,
    FLOW_NODE_PAD * 2 +
      Math.max(1, flowSteps.length) * FLOW_NODE_WIDTH +
      Math.max(0, flowSteps.length - 1) * FLOW_NODE_GAP
  );
  const canvasHeight = nodeY + FLOW_NODE_HEIGHT + FLOW_NODE_PAD;

  const nodeInfo = (id: FlowNodeId) =>
    [...PIPELINE_NODES, ...INPUT_NODES].find((node) => node.id === id) ?? PIPELINE_NODES[0]!;

  const stageIsOn = (id: FlowNodeId) => {
    const stage = STAGE_FOR_NODE[id];
    return stage === undefined ? true : config.engine.stages[stage];
  };

  const nodeIsOn = (id: FlowNodeId) => (id === "draft" ? true : stageIsOn(id));

  const nodeMeta = (id: FlowNodeId) => {
    if (id === "job") return "Trigger";
    if (id === "final") return "Output";
    if (id === "draft") {
      return config.engine.stages.candidates
        ? `${Math.max(1, activeLanes)} writer call${activeLanes === 1 ? "" : "s"}`
        : "1 writer call";
    }
    if (!stageIsOn(id)) return "Off";
    if (id === "judge") {
      return activeLanes > 1 ? "Runs with 2+ drafts" : "Needs 2 drafts";
    }
    if (id === "revise") return `Up to ${config.engine.maxRevisionAttempts} attempt(s)`;
    if (id === "trim") return "Runs when needed";
    if (id === "validate") return "Blocks bad drafts";
    return "Runs every time";
  };

  const nodeModel = (id: FlowNodeId) => {
    const key = PROMPT_FOR_NODE[id];
    if (key === undefined) return null;
    return config.engine.models[key] ?? "Proposal model";
  };

  const flowStepModel = (step: FlowStep) =>
    step.type === "final" ? "No API call" : step.model ?? "Proposal model";

  const inputMeta = (id: FlowNodeId) => {
    if (id === "style") {
      return `${config.policy.words.min}-${config.policy.words.max} words`;
    }
    if (id === "voice") {
      return `${activeSamples} active`;
    }
    if (id === "profile") {
      return audit === null ? "Not checked" : `${audit.score}/100`;
    }
    return `${data.playbooks.length} saved`;
  };

  const renderInspectorTitle = (
    id: FlowNodeId,
    badge?: string
  ) => {
    const info = nodeInfo(id);
    const Icon = info.icon;
    return (
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", info.accent)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{info.label}</p>
            {badge === undefined ? null : (
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{info.hint}</p>
        </div>
      </div>
    );
  };

  const renderModelFields = (key: PromptKey) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Model</Label>
        <Input
          list={`proposal-stage-models-${key}`}
          value={config.engine.models[key] ?? ""}
          placeholder="Use the proposal model"
          onChange={(event) =>
            update((next) => {
              const value = event.target.value.trim();
              next.engine.models[key] = value.length > 0 ? value : null;
            })
          }
        />
        <datalist id={`proposal-stage-models-${key}`}>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </datalist>
        <p className="text-[11px] text-muted-foreground">
          Empty uses the model selected on the Platforms page.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Temperature</Label>
        <Input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={config.engine.temperatures[key]}
          onChange={(event) =>
            update((next) => {
              next.engine.temperatures[key] = Number(event.target.value);
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Timeout (seconds)</Label>
        <Input
          type="number"
          min={10}
          max={600}
          value={config.engine.timeoutsSeconds[key]}
          onChange={(event) =>
            update((next) => {
              next.engine.timeoutsSeconds[key] = Number(event.target.value);
            })
          }
        />
      </div>
    </div>
  );

  const renderPrompt = (key: PromptKey) => (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
        Prompt
        <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
          Edit
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="grid gap-3 border-t p-3">
        <div className="flex flex-col gap-1.5">
          <Label>System prompt</Label>
          <Textarea
            rows={5}
            className="font-mono text-xs"
            value={config.prompts[key].system}
            onChange={(event) =>
              update((next) => {
                next.prompts[key].system = event.target.value;
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>User prompt</Label>
          <Textarea
            rows={12}
            className="font-mono text-xs"
            value={config.prompts[key].user}
            onChange={(event) =>
              update((next) => {
                next.prompts[key].user = event.target.value;
              })
            }
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Placeholders use {"{{name}}"} syntax. Keep the existing placeholders unless you
          intentionally want to remove data.
        </p>
      </div>
    </details>
  );

  const renderContract = (key: keyof EngineConfig["engine"]["contracts"]) => {
    const field = CONTRACT_FIELDS.find((item) => item.key === key);
    return (
      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
          Rules
          <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            Edit
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          </span>
        </summary>
        <div className="grid gap-2 border-t p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{field?.hint}</p>
          <Textarea
            rows={10}
            className="font-mono text-xs"
            value={config.engine.contracts[key]}
            onChange={(event) =>
              update((next) => {
                next.engine.contracts[key] = event.target.value;
              })
            }
          />
        </div>
      </details>
    );
  };

  const renderLanes = () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Writer lanes</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Each lane is one candidate style. With multiple writer lanes off, only the style
            the brief picks is written.
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={addLane}
          disabled={config.engine.candidateLanes.length >= 8}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      {config.engine.candidateLanes.map((lane, index) => (
        <div key={`lane-${index}`} className="rounded-lg border p-2.5">
          <div className="flex items-center gap-2">
            <Switch
              checked={lane.enabled}
              aria-label={`Enable ${lane.label}`}
              onCheckedChange={(checked) =>
                updateLane(index, (next) => {
                  next.enabled = checked;
                })
              }
            />
            <Input
              className="h-8 min-w-0 flex-1"
              value={lane.label}
              aria-label="Lane label"
              onChange={(event) =>
                updateLane(index, (next) => {
                  next.label = event.target.value;
                })
              }
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => moveLane(index, -1)}
              disabled={index === 0}
              aria-label="Move lane earlier"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => moveLane(index, 1)}
              disabled={index === config.engine.candidateLanes.length - 1}
              aria-label="Move lane later"
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removeLane(index)}
              disabled={config.engine.candidateLanes.length <= 1}
              aria-label={`Remove ${lane.label}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea
            className="mt-2 text-xs"
            rows={2}
            placeholder="Extra guidance for this candidate only."
            value={lane.guidance}
            onChange={(event) =>
              updateLane(index, (next) => {
                next.guidance = event.target.value;
              })
            }
          />
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground">
              Model overrides
              <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
            </summary>
            <div className="grid gap-2 pt-2 sm:grid-cols-3">
              <Input
                className="h-8 text-xs"
                placeholder="Model"
                value={lane.model ?? ""}
                aria-label="Lane model override"
                onChange={(event) =>
                  updateLane(index, (next) => {
                    const value = event.target.value.trim();
                    next.model = value.length > 0 ? value : null;
                  })
                }
              />
              <Input
                className="h-8 text-xs"
                type="number"
                min={0}
                max={2}
                step={0.1}
                placeholder={`Temp ${config.engine.temperatures.writer}`}
                value={lane.temperature ?? ""}
                aria-label="Lane temperature override"
                onChange={(event) =>
                  updateLane(index, (next) => {
                    next.temperature =
                      event.target.value === "" ? null : Number(event.target.value);
                  })
                }
              />
              <Input
                className="h-8 text-xs"
                type="number"
                min={10}
                max={600}
                placeholder={`Timeout ${config.engine.timeoutsSeconds.writer}`}
                value={lane.timeoutSeconds ?? ""}
                aria-label="Lane timeout override"
                onChange={(event) =>
                  updateLane(index, (next) => {
                    next.timeoutSeconds =
                      event.target.value === "" ? null : Number(event.target.value);
                  })
                }
              />
            </div>
          </details>
        </div>
      ))}
    </div>
  );

  const renderChecks = () => (
    <div className="grid gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Max repair attempts</Label>
        <Input
          type="number"
          min={0}
          max={3}
          value={config.engine.maxRepairAttempts}
          onChange={(event) =>
            update((next) => {
              next.engine.maxRepairAttempts = Number(event.target.value);
            })
          }
        />
      </div>
      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
          Quality checks
          <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
            Edit
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          </span>
        </summary>
        <div className="grid gap-3 border-t p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Hard failures block the draft, policy failures trigger a revision, and advisory items
            only warn.
          </p>
          {(["hard", "policy", "advisory"] as const).map((group) => (
            <div key={group} className="flex flex-col gap-1.5">
              <Label className="capitalize">{group} checks (one per line)</Label>
              <Textarea
                rows={4}
                value={config.checks[group].join("\n")}
                onChange={(event) =>
                  update((next) => {
                    next.checks[group] = lines(event.target.value);
                  })
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label>Anti-AI tells (one per line)</Label>
            <Textarea
              rows={8}
              value={config.checks.antiAiTells.join("\n")}
              onChange={(event) =>
                update((next) => {
                  next.checks.antiAiTells = lines(event.target.value);
                })
              }
            />
          </div>
        </div>
      </details>
    </div>
  );

  const renderValidateInspector = () => (
    <div className="flex flex-col gap-4">
      {renderInspectorTitle("validate", nodeMeta("validate"))}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Run checks before sending</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Blocks a draft that breaks a hard rule and tries one repair.
          </p>
        </div>
        <Switch
          checked={config.engine.stages.deterministicValidation}
          onCheckedChange={(checked) =>
            update((next) => {
              next.engine.stages.deterministicValidation = checked;
            })
          }
        />
      </div>
      {renderChecks()}
    </div>
  );

  const renderStageInspector = (
    id: FlowNodeId,
    options?: {
      contractKey?: keyof EngineConfig["engine"]["contracts"];
      lanes?: boolean;
      attempts?: boolean;
      deletion?: boolean;
    }
  ) => {
    const stage = STAGE_FOR_NODE[id];
    const promptKey = PROMPT_FOR_NODE[id];
    if (stage === undefined || promptKey === undefined) return null;
    return (
      <div className="flex flex-col gap-4">
        {renderInspectorTitle(id, nodeMeta(id))}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">
              {id === "draft" ? "Multiple writer lanes" : "Run this step"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {id === "draft"
                ? "Off uses one writer. On runs every enabled lane and judges the best."
                : "Turn off to skip this step in every proposal."}
            </p>
          </div>
          <Switch
            checked={config.engine.stages[stage]}
            onCheckedChange={(checked) =>
              update((next) => {
                next.engine.stages[stage] = checked;
              })
            }
          />
        </div>
        {renderModelFields(promptKey)}
        {options?.lanes ? renderLanes() : null}
        {options?.attempts ? (
          <div className="flex flex-col gap-1.5">
            <Label>Max revision attempts</Label>
            <Input
              type="number"
              min={0}
              max={3}
              value={config.engine.maxRevisionAttempts}
              onChange={(event) =>
                update((next) => {
                  next.engine.maxRevisionAttempts = Number(event.target.value);
                })
              }
            />
          </div>
        ) : null}
        {options?.deletion ? (
          <div className="flex flex-col gap-1.5">
            <Label>Cleanup threshold (0 = only when over the word limit)</Label>
            <Input
              type="number"
              min={0}
              max={1000}
              value={config.engine.minWordsForDeletion}
              onChange={(event) =>
                update((next) => {
                  next.engine.minWordsForDeletion = Number(event.target.value);
                })
              }
            />
          </div>
        ) : null}
        {options?.contractKey === undefined ? null : renderContract(options.contractKey)}
        {renderPrompt(promptKey)}
      </div>
    );
  };

  const renderStyleInspector = () => (
    <div className="flex flex-col gap-4">
      {renderInspectorTitle("style", `${config.policy.words.min}-${config.policy.words.max} words`)}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Format</Label>
          <Select
            value={config.policy.format}
            onValueChange={(value) =>
              update((next) => {
                next.policy.format = value as EngineConfig["policy"]["format"];
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">Natural prose</SelectItem>
              <SelectItem value="structured">Structured format allowed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Closing question</Label>
          <Select
            value={config.policy.askQuestion}
            onValueChange={(value) =>
              update((next) => {
                next.policy.askQuestion = value as EngineConfig["policy"]["askQuestion"];
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="always">Always end with a question</SelectItem>
              <SelectItem value="if_useful">Only when useful</SelectItem>
              <SelectItem value="never">Never ask a question</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Length</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={20}
              max={1000}
              aria-label="Minimum words"
              className="w-20"
              value={config.policy.words.min}
              onChange={(event) =>
                update((next) => {
                  next.policy.words.min = Number(event.target.value);
                })
              }
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="number"
              min={40}
              max={2000}
              aria-label="Maximum words"
              className="w-20"
              value={config.policy.words.max}
              onChange={(event) =>
                update((next) => {
                  next.policy.words.max = Number(event.target.value);
                })
              }
            />
            <span className="text-sm text-muted-foreground">words</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Price and timeline in text</Label>
          <Select
            value={config.policy.commercials}
            onValueChange={(value) =>
              update((next) => {
                next.policy.commercials = value as EngineConfig["policy"]["commercials"];
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fields_only">Never mention them</SelectItem>
              <SelectItem value="body_when_set">Mention when a value is set</SelectItem>
              <SelectItem value="if_client_asks">Only if the client asks</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
          More style options
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="grid gap-3 border-t p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Max evidence items</Label>
              <Input
                type="number"
                min={0}
                max={5}
                value={config.policy.maxEvidence}
                onChange={(event) =>
                  update((next) => {
                    next.policy.maxEvidence = Number(event.target.value);
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Allow links</p>
                <p className="text-xs text-muted-foreground">Portfolio URLs in the draft</p>
              </div>
              <Switch
                checked={config.policy.includeLinks}
                onCheckedChange={(checked) =>
                  update((next) => {
                    next.policy.includeLinks = checked;
                  })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Banned phrases (one per line)</Label>
            <Textarea
              rows={5}
              value={config.policy.bannedPhrases.join("\n")}
              onChange={(event) =>
                update((next) => {
                  next.policy.bannedPhrases = lines(event.target.value);
                })
              }
            />
          </div>
        </div>
      </details>
    </div>
  );

  const renderVoiceInspector = () => (
    <div className="flex flex-col gap-4">
      {renderInspectorTitle("voice", `${activeSamples} active`)}
      <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        The writer studies these for tone and never copies the text. Prefer real proposals you sent.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={openImportSamples}
          disabled={loadingBids}
        >
          {loadingBids ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Import from bids
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditingSample(null);
            setSampleDraft(clone(EMPTY_SAMPLE));
          }}
        >
          <Plus className="size-4" />
          Add example
        </Button>
      </div>
      {data.samples.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm font-medium">No examples yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Import a past bid or paste a proposal you are happy with.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(showAllExamples ? data.samples : data.samples.slice(0, 4)).map((sample) => (
            <div key={sample.id} className="rounded-lg border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{sample.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {sample.jobType} · {sample.outcome} · {sample.rating}/5
                    {sample.active ? "" : " · off"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setEditingSample(sample.id);
                      setSampleDraft({
                        title: sample.title,
                        jobType: sample.jobType,
                        content: sample.content,
                        tags: sample.tags,
                        outcome: sample.outcome,
                        rating: sample.rating,
                        preferred: sample.preferred,
                        notes: sample.notes,
                        active: sample.active,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${sample.title}`}
                    onClick={() => removeSample(sample.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {sample.content}
              </p>
            </div>
          ))}
          {data.samples.length > 4 ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setShowAllExamples((current) => !current)}
            >
              {showAllExamples ? "Show fewer" : `Show all ${data.samples.length}`}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-destructive"
            onClick={() => setDeleteAllOpen(true)}
          >
            <Trash2 className="size-4" />
            Delete all examples
          </Button>
        </div>
      )}
    </div>
  );

  const renderProfileInspector = () => (
    <div className="flex flex-col gap-4">
      {renderInspectorTitle("profile", audit === null ? "Not checked" : `${audit.score}/100`)}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={runAudit} disabled={auditing}>
          {auditing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {auditing ? "Checking…" : "Run check"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setContextTab("profile");
            setContextOpen(true);
          }}
        >
          <UserRound className="size-4" />
          Edit profile inputs
        </Button>
      </div>
      {audit === null ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Run a check to see whether your profile gives the writer enough verified facts.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold tabular-nums">{audit.score}/100</span>
            <Badge
              variant={
                audit.status === "good"
                  ? "secondary"
                  : audit.status === "poor"
                    ? "destructive"
                    : "outline"
              }
            >
              {audit.status.replace("_", " ")}
            </Badge>
            {audit.model ? (
              <span className="text-[11px] text-muted-foreground">{audit.model}</span>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{audit.summary}</p>
          {audit.findings.length === 0 ? (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground">
              No findings. Keep portfolio evidence and voice examples current.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {audit.findings.map((finding, index) => (
                <div key={`${finding.ruleId}-${index}`} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
                    <p className="text-sm font-medium">{finding.title}</p>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {finding.recommendation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
          Audit settings
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <div className="grid gap-3 border-t p-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Run after profile save</p>
              <p className="text-xs text-muted-foreground">Adds an AI call on every save</p>
            </div>
            <Switch
              checked={auditDraft.runOnSave}
              onCheckedChange={(checked) =>
                updateAudit((next) => {
                  next.runOnSave = checked;
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Audit model override</Label>
            <Input
              value={auditDraft.model ?? ""}
              placeholder="Use proposal model"
              onChange={(event) =>
                updateAudit((next) => {
                  next.model = event.target.value.trim() || null;
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>System prompt</Label>
            <Textarea
              rows={4}
              value={auditDraft.prompt.system}
              onChange={(event) =>
                updateAudit((next) => {
                  next.prompt.system = event.target.value;
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>User prompt</Label>
            <Textarea
              rows={6}
              className="font-mono text-xs"
              value={auditDraft.prompt.user}
              onChange={(event) =>
                updateAudit((next) => {
                  next.prompt.user = event.target.value;
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Rules (JSON)</Label>
            <Textarea
              rows={10}
              className="font-mono text-xs"
              value={rulesText}
              onChange={(event) => setRulesText(event.target.value)}
            />
          </div>
          <Button onClick={saveAuditSettings} disabled={savingAudit}>
            {savingAudit ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save audit settings
          </Button>
        </div>
      </details>
    </div>
  );

  const renderPlaybooksInspector = () => (
    <div className="flex flex-col gap-4">
      {renderInspectorTitle("playbooks", `${data.playbooks.length} saved`)}
      <p className="text-xs leading-relaxed text-muted-foreground">
        A playbook changes the angle and opening for one job type. It is not a template.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          setEditingPlaybook(null);
          setPlaybookDraft(clone(EMPTY_PLAYBOOK));
        }}
      >
        <Plus className="size-4" />
        New playbook
      </Button>
      {data.playbooks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No playbooks yet. Add one when a job type needs a distinct strategy.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.playbooks.map((playbook) => (
            <div key={playbook.id} className="rounded-lg border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{playbook.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {playbook.jobType} · {playbook.active ? "active" : "off"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setEditingPlaybook(playbook.id);
                      setPlaybookDraft({
                        name: playbook.name,
                        jobType: playbook.jobType,
                        matchKeywords: playbook.matchKeywords,
                        strategy: playbook.strategy,
                        openingGuidance: playbook.openingGuidance,
                        questionGuidance: playbook.questionGuidance,
                        omitGuidance: playbook.omitGuidance,
                        active: playbook.active,
                        sortOrder: playbook.sortOrder,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${playbook.name}`}
                    onClick={() => removePlaybook(playbook.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {playbook.strategy}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderStepModelFields = (step: FlowStep, index: number) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Model</Label>
        <Input
          list={`flow-step-models-${step.id}`}
          value={step.model ?? ""}
          placeholder="Use the proposal model"
          onChange={(event) =>
            updateStep(index, (next) => {
              const value = event.target.value.trim();
              next.model = value.length > 0 ? value : null;
            })
          }
        />
        <datalist id={`flow-step-models-${step.id}`}>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </datalist>
        <p className="text-[11px] text-muted-foreground">
          Empty uses the model selected on the Platforms page.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Temperature</Label>
        <Input
          type="number"
          min={0}
          max={2}
          step={0.1}
          placeholder="Inherit"
          value={step.temperature ?? ""}
          onChange={(event) =>
            updateStep(index, (next) => {
              next.temperature =
                event.target.value === "" ? null : Number(event.target.value);
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Timeout (seconds)</Label>
        <Input
          type="number"
          min={10}
          max={600}
          placeholder="Step default"
          value={step.timeoutSeconds ?? ""}
          onChange={(event) =>
            updateStep(index, (next) => {
              next.timeoutSeconds =
                event.target.value === "" ? null : Number(event.target.value);
            })
          }
        />
      </div>
    </div>
  );

  const renderStepInspector = (step: FlowStep, index: number) => {
    const style = FLOW_STEP_STYLE[step.type];
    const Icon = style.icon;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", style.accent)}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{step.label}</p>
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {FLOW_STEP_LABELS[step.type]}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {FLOW_STEP_HELP[step.type]}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Run this node</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Off skips it without deleting it.
            </p>
          </div>
          <Switch
            checked={step.enabled}
            onCheckedChange={(checked) =>
              updateStep(index, (next) => {
                next.enabled = checked;
              })
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              value={step.label}
              onChange={(event) =>
                updateStep(index, (next) => {
                  next.label = event.target.value;
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Node type</Label>
            <Select
              value={step.type}
              onValueChange={(value) =>
                updateStep(index, (next) => {
                  next.type = value as FlowStepType;
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FLOW_STEP_LABELS) as FlowStepType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {FLOW_STEP_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {step.type === "final" ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Final copies the latest draft into the proposal and makes no API call.
          </p>
        ) : (
          <>
            {renderStepModelFields(step, index)}
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium">
                Prompt
                <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                  Edit
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <div className="grid gap-3 border-t p-3">
                <div className="flex flex-col gap-1.5">
                  <Label>System prompt</Label>
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    value={step.system}
                    onChange={(event) =>
                      updateStep(index, (next) => {
                        next.system = event.target.value;
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>User prompt</Label>
                  <Textarea
                    rows={12}
                    className="font-mono text-xs"
                    value={step.user}
                    onChange={(event) =>
                      updateStep(index, (next) => {
                        next.user = event.target.value;
                      })
                    }
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Use placeholders like {"{{jobJson}}"}, {"{{jobBriefJson}}"},{" "}
                  {"{{profileFacts}}"}, {"{{draft}}"}, {"{{lastOutput}}"}, or{" "}
                  {"{{step_<id>}}"} to pass earlier output forward.
                </p>
              </div>
            </details>
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => insertStep(index, "custom")}
            disabled={config.engine.flow.steps.length >= 24}
          >
            <Plus className="size-4" />
            Insert after
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => duplicateStep(index)}
            disabled={config.engine.flow.steps.length >= 24}
          >
            <Sparkles className="size-4" />
            Duplicate
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => moveStep(index, -1)}
            disabled={index === 0}
            aria-label="Move node earlier"
          >
            <ArrowUp />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => moveStep(index, 1)}
            disabled={index === config.engine.flow.steps.length - 1}
            aria-label="Move node later"
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => removeStep(index)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>
    );
  };

  const renderInspector = () => {
    if (selection.kind === "step") {
      const index = config.engine.flow.steps.findIndex((step) => step.id === selection.id);
      const step = index >= 0 ? config.engine.flow.steps[index] : undefined;
      if (step !== undefined) return renderStepInspector(step, index);
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Flow node not found</p>
          <p className="text-sm text-muted-foreground">
            The selected node was removed. Pick another node on the canvas.
          </p>
        </div>
      );
    }
    switch (selection.id) {
      case "job":
        return (
          <div className="flex flex-col gap-4">
            {renderInspectorTitle("job", "Always on")}
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every run starts with the job post, your verified profile facts, and the strongest
              matching evidence. No setup is needed here.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                setContextTab("profile");
                setContextOpen(true);
              }}
            >
              <UserRound className="size-4" />
              Edit profile inputs
            </Button>
          </div>
        );
      case "final":
        return (
          <div className="flex flex-col gap-4">
            {renderInspectorTitle("final", "Output")}
            <p className="text-sm leading-relaxed text-muted-foreground">
              The final proposal is copied from the last approved draft. This step makes no API
              call.
            </p>
            <div className="rounded-lg border p-3 text-sm">
              Target length:{" "}
              <span className="font-medium">
                {config.policy.words.min}-{config.policy.words.max} words
              </span>
            </div>
          </div>
        );
      case "brief":
        return renderStageInspector("brief");
      case "draft":
        return renderStageInspector("draft", { lanes: true, contractKey: "writer" });
      case "judge":
        return renderStageInspector("judge", { contractKey: "reviewer" });
      case "review":
        return renderStageInspector("review", { contractKey: "reviewer" });
      case "revise":
        return renderStageInspector("revise", { attempts: true, contractKey: "reviser" });
      case "trim":
        return renderStageInspector("trim", { deletion: true });
      case "validate":
        return renderValidateInspector();
      case "style":
        return renderStyleInspector();
      case "voice":
        return renderVoiceInspector();
      case "profile":
        return renderProfileInspector();
      case "playbooks":
        return renderPlaybooksInspector();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Proposal flow"
        description="Every draft reads the job, extracts the main points, then writes. Your profile facts, writing style, and voice examples are the inputs that matter — the built-in nodes handle the rest."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="More proposal actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={upgradeEngine} disabled={upgrading}>
                  {upgrading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Upgrade defaults
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={resetEngine}
                  disabled={resetting}
                >
                  {resetting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  Reset defaults
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={saveEngine} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save changes
            </Button>
          </>
        }
      />

      {actionError !== null ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {missingQualityInputs.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5">
          <p className="flex items-start gap-2 text-sm">
            <Info
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span>
              <span className="font-medium">
                For stronger drafts, add {missingQualityInputs.join(", ")}.
              </span>{" "}
              <span className="text-muted-foreground">
                The built-in flow still works without them.
              </span>
            </span>
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/profile">Review profile</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px] xl:items-start">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <p className="text-sm font-medium">Proposal flow</p>
              <p className="text-xs text-muted-foreground">
                {customFlowOn
                  ? "Custom flow is on. Add, remove, and reorder nodes however you want."
                  : "Built-in pipeline: analyse the job, then write. Turn on custom flow to edit the nodes."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {customFlowOn ? (
                <>
                  <Select
                    value={addType}
                    onValueChange={(value) => setAddType(value as FlowStepType)}
                  >
                    <SelectTrigger className="h-8 w-[160px]" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FLOW_STEP_LABELS) as FlowStepType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {FLOW_STEP_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => addStep()}
                    disabled={flowSteps.length >= 24}
                  >
                    <Plus className="size-4" />
                    Add node
                  </Button>
                  <Badge variant="secondary">{flowSteps.length}/24</Badge>
                </>
              ) : null}
              <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                <span className="text-xs font-medium">Custom flow</span>
                <Switch checked={customFlowOn} onCheckedChange={setCustomFlowEnabled} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Inputs
            </span>
            {INPUT_NODES.map((node) => {
              const Icon = node.icon;
              const active = selection.kind === "node" && selection.id === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelection({ kind: "node", id: node.id })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {node.label}
                  <span className="text-[10px] text-muted-foreground">{inputMeta(node.id)}</span>
                </button>
              );
            })}
          </div>
          <div className="h-[320px] overflow-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:20px_20px]">
            <div
              className="relative"
              style={{
                width: customFlowOn ? flowCanvasWidth : canvasWidth,
                height: canvasHeight,
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={canvasWidth}
                height={canvasHeight}
                aria-hidden
              >
                <defs>
                  <marker
                    id="proposal-flow-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
                  </marker>
                </defs>
                {customFlowOn
                  ? flowSteps.slice(1).map((step, index) => {
                      const fromX = nodeX(index) + FLOW_NODE_WIDTH;
                      const toX = nodeX(index + 1);
                      const y = nodeY + FLOW_NODE_HEIGHT / 2;
                      const mid = (fromX + toX) / 2;
                      const from = flowSteps[index]!;
                      const active = from.enabled && step.enabled;
                      return (
                        <path
                          key={`edge-${step.id}`}
                          d={`M ${fromX} ${y} C ${mid} ${y}, ${mid} ${y}, ${toX} ${y}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeDasharray={active ? undefined : "4 4"}
                          markerEnd="url(#proposal-flow-arrow)"
                          className={active ? "text-border" : "text-border/60"}
                        />
                      );
                    })
                  : PIPELINE_NODES.slice(1).map((node, index) => {
                      const fromX = nodeX(index) + FLOW_NODE_WIDTH;
                      const toX = nodeX(index + 1);
                      const y = nodeY + FLOW_NODE_HEIGHT / 2;
                      const mid = (fromX + toX) / 2;
                      const from = PIPELINE_NODES[index]!;
                      const active = nodeIsOn(from.id) && nodeIsOn(node.id);
                      return (
                        <path
                          key={`edge-${node.id}`}
                          d={`M ${fromX} ${y} C ${mid} ${y}, ${mid} ${y}, ${toX} ${y}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeDasharray={active ? undefined : "4 4"}
                          markerEnd="url(#proposal-flow-arrow)"
                          className={active ? "text-border" : "text-border/60"}
                        />
                      );
                    })}
              </svg>

              {customFlowOn ? (
                flowSteps.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center p-8">
                    <div className="max-w-sm rounded-2xl border bg-card/95 p-6 text-center shadow-sm">
                      <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground" />
                      <p className="font-medium">No nodes yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add a node to start building your custom flow.
                      </p>
                      <Button className="mt-4" onClick={() => addStep("write")}>
                        <Plus className="size-4" />
                        Add first node
                      </Button>
                    </div>
                  </div>
                ) : (
                  flowSteps.map((step, index) => {
                    const style = FLOW_STEP_STYLE[step.type];
                    const Icon = style.icon;
                    const selected =
                      selection.kind === "step" && selection.id === step.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setSelection({ kind: "step", id: step.id })}
                        style={{
                          left: nodeX(index),
                          top: nodeY,
                          width: FLOW_NODE_WIDTH,
                          height: FLOW_NODE_HEIGHT,
                        }}
                        className={cn(
                          "absolute flex flex-col rounded-xl border bg-card p-3 text-left shadow-sm transition-all",
                          "hover:border-primary/40 hover:shadow-md",
                          selected && "border-primary/60 ring-2 ring-primary/20",
                          !step.enabled && "opacity-55"
                        )}
                      >
                        <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-border" />
                        <span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-border" />
                        <div className="flex items-start gap-2.5">
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg",
                              style.accent
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{step.label}</p>
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                              {FLOW_STEP_HELP[step.type]}
                            </p>
                          </div>
                        </div>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
                          <span className="truncate">
                            {step.enabled ? flowStepModel(step) : "Off"}
                          </span>
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              step.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                            )}
                          />
                        </div>
                      </button>
                    );
                  })
                )
              ) : (
                PIPELINE_NODES.map((node, index) => {
                  const Icon = node.icon;
                  const enabled = nodeIsOn(node.id);
                  const selected = selection.kind === "node" && selection.id === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelection({ kind: "node", id: node.id })}
                      style={{
                        left: nodeX(index),
                        top: nodeY,
                        width: FLOW_NODE_WIDTH,
                        height: FLOW_NODE_HEIGHT,
                      }}
                      className={cn(
                        "absolute flex flex-col rounded-xl border bg-card p-3 text-left shadow-sm transition-all",
                        "hover:border-primary/40 hover:shadow-md",
                        selected && "border-primary/60 ring-2 ring-primary/20",
                        !enabled && "opacity-55"
                      )}
                    >
                      <span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-border" />
                      <span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-border" />
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg",
                            node.accent
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{node.label}</p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {node.hint}
                          </p>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{nodeMeta(node.id)}</span>
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                          )}
                        />
                      </div>
                      {nodeModel(node.id) === null ? null : (
                        <p className="truncate text-[10px] text-muted-foreground/80">
                          {nodeModel(node.id)}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Card>

        <Card className="xl:sticky xl:top-4">
          <CardContent className="max-h-[600px] overflow-y-auto p-4">
            {renderInspector()}
          </CardContent>
        </Card>
      </div>

      {dirty ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
          <p className="text-sm text-muted-foreground">You have unsaved flow changes.</p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(clone(baseline))}
              disabled={saving}
            >
              Discard
            </Button>
            <Button size="sm" onClick={saveEngine} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      <FlowContextDialog
        open={contextOpen}
        onOpenChange={setContextOpen}
        tab={contextTab}
        onTabChange={setContextTab}
        profile={profile}
        profileLoading={profileApi.isLoading}
        profileError={profileApi.error?.message ?? null}
        profileDirty={profileDirty}
        savingProfile={savingProfile}
        onProfileChange={updateProfile}
        onSaveProfile={() => void saveProfileContext()}
        showFiles={false}
        files={config.engine.flow.files}
        onCreateFile={createFile}
        onUpdateFile={updateFile}
        onDeleteFile={deleteFile}
        onToggleFile={toggleFile}
      />

      <Dialog open={playbookDraft !== null} onOpenChange={(open) => !open && setPlaybookDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPlaybook === null ? "New playbook" : "Edit playbook"}</DialogTitle>
            <DialogDescription>
                A playbook is strategy for one job type. It is not a template or example.
            </DialogDescription>
          </DialogHeader>
          {playbookDraft !== null ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Name</Label>
                  <Input
                    value={playbookDraft.name}
                    onChange={(event) =>
                      setPlaybookDraft({ ...playbookDraft, name: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Job type</Label>
                  <Input
                    value={playbookDraft.jobType}
                    onChange={(event) =>
                      setPlaybookDraft({ ...playbookDraft, jobType: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Match keywords (comma separated)</Label>
                <Input
                  value={playbookDraft.matchKeywords.join(", ")}
                  onChange={(event) =>
                    setPlaybookDraft({
                      ...playbookDraft,
                      matchKeywords: commaList(event.target.value),
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Strategy</Label>
                <Textarea
                  rows={7}
                  value={playbookDraft.strategy}
                  onChange={(event) =>
                    setPlaybookDraft({ ...playbookDraft, strategy: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Opening guidance</Label>
                <Textarea
                  rows={3}
                  value={playbookDraft.openingGuidance}
                  onChange={(event) =>
                    setPlaybookDraft({ ...playbookDraft, openingGuidance: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Question guidance</Label>
                <Textarea
                  rows={3}
                  value={playbookDraft.questionGuidance}
                  onChange={(event) =>
                    setPlaybookDraft({ ...playbookDraft, questionGuidance: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Omit guidance</Label>
                <Textarea
                  rows={3}
                  value={playbookDraft.omitGuidance}
                  onChange={(event) =>
                    setPlaybookDraft({ ...playbookDraft, omitGuidance: event.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label>Active</Label>
                  <Switch
                    checked={playbookDraft.active}
                    onCheckedChange={(checked) =>
                      setPlaybookDraft({ ...playbookDraft, active: checked })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    min={0}
                    value={playbookDraft.sortOrder}
                    onChange={(event) =>
                      setPlaybookDraft({
                        ...playbookDraft,
                        sortOrder: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlaybookDraft(null)}>
              Cancel
            </Button>
            <Button onClick={savePlaybook} disabled={savingPlaybook}>
              {savingPlaybook ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
                <DialogTitle>Import bids as voice examples</DialogTitle>
            <DialogDescription>
              Choose the bids whose writing sounds like you. Imported samples start inactive so you
              can review them before voice analysis uses them.
            </DialogDescription>
          </DialogHeader>
          {loadingBids ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading bids...
            </div>
          ) : importBids.length === 0 ? (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              No submitted bids found. Place a bid first, then import it here.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {selectedBidIds.size} of {importBids.length} selected
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelectedBidIds(
                      selectedBidIds.size === importBids.length
                        ? new Set()
                        : new Set(importBids.map((bid) => bid.id))
                    )
                  }
                >
                  {selectedBidIds.size === importBids.length ? "Clear all" : "Select all"}
                </Button>
              </div>
              <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
                {importBids.map((bid) => (
                  <label
                    key={bid.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedBidIds.has(bid.id)}
                      onCheckedChange={(checked) => toggleBid(bid.id, checked === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{bid.jobTitle}</p>
                        <Badge variant="outline">
                          {(bid.outcome ?? "in_review").replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {bid.submittedLabel} · {bid.via}
                      </p>
                      {bid.proposalExcerpt ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {bid.proposalExcerpt}
                        </p>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={importSelectedSamples}
              disabled={importing || selectedBidIds.size === 0}
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Import selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
                <DialogTitle>Delete all voice examples?</DialogTitle>
            <DialogDescription>
              This permanently deletes {data.samples.length} voice example(s). The writer will stop
              using them for voice analysis. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteAllSamples} disabled={deletingAll}>
              {deletingAll ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sampleDraft !== null} onOpenChange={(open) => !open && setSampleDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
              <DialogTitle>{editingSample === null ? "New voice example" : "Edit voice example"}</DialogTitle>
            <DialogDescription>
              Use a real proposal you wrote. Winning samples from other freelancers are strategy references, not your voice.
            </DialogDescription>
          </DialogHeader>
          {sampleDraft !== null ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Title</Label>
                  <Input
                    value={sampleDraft.title}
                    onChange={(event) =>
                      setSampleDraft({ ...sampleDraft, title: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Job type</Label>
                  <Input
                    value={sampleDraft.jobType}
                    onChange={(event) =>
                      setSampleDraft({ ...sampleDraft, jobType: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Proposal text</Label>
                <Textarea
                  rows={12}
                  value={sampleDraft.content}
                  onChange={(event) =>
                    setSampleDraft({ ...sampleDraft, content: event.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Tags (comma separated)</Label>
                  <Input
                    value={sampleDraft.tags.join(", ")}
                    onChange={(event) =>
                      setSampleDraft({ ...sampleDraft, tags: commaList(event.target.value) })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Outcome</Label>
                  <Select
                    value={sampleDraft.outcome}
                    onValueChange={(value) =>
                      setSampleDraft({
                        ...sampleDraft,
                        outcome: value as SampleInput["outcome"],
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="won">Won</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Rating (1-5)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={sampleDraft.rating}
                    onChange={(event) =>
                      setSampleDraft({
                        ...sampleDraft,
                        rating: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label>Preferred</Label>
                  <Switch
                    checked={sampleDraft.preferred}
                    onCheckedChange={(checked) =>
                      setSampleDraft({ ...sampleDraft, preferred: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label>Active</Label>
                  <Switch
                    checked={sampleDraft.active}
                    onCheckedChange={(checked) =>
                      setSampleDraft({ ...sampleDraft, active: checked })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={sampleDraft.notes}
                  onChange={(event) =>
                    setSampleDraft({ ...sampleDraft, notes: event.target.value })
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSampleDraft(null)}>
              Cancel
            </Button>
            <Button onClick={saveSample} disabled={savingSample}>
              {savingSample ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
