export type FlowStepType = "brief" | "write" | "judge" | "review" | "revise" | "custom" | "final";

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowStep {
  id: string;
  label: string;
  type: FlowStepType;
  enabled: boolean;
  system: string;
  user: string;
  model: string | null;
  temperature: number | null;
  timeoutSeconds: number | null;
  position: FlowPosition | null;
  fileIds: string[];
}

export interface FlowFile {
  id: string;
  label: string;
  content: string;
  enabled: boolean;
}

export interface FlowConfig {
  enabled: boolean;
  steps: FlowStep[];
  files: FlowFile[];
}

export const FLOW_STEP_LABELS: Record<FlowStepType, string> = {
  brief: "Structured brief",
  write: "Write / candidate",
  judge: "Judge candidates",
  review: "Review draft",
  revise: "Revise draft",
  custom: "Custom AI call",
  final: "Final output",
};

export const FLOW_STEP_HELP: Record<FlowStepType, string> = {
  brief: "Turns the job and your context into a structured brief for later nodes.",
  write: "Calls the selected model and saves its text as a proposal candidate.",
  judge: "Compares two or more write candidates and picks one.",
  review: "Checks the current draft and returns a verdict plus revision notes.",
  revise: "Rewrites the current draft using the review notes and your instructions.",
  custom: "Free-form AI call. Use it for research, an outline, a critique, or any extra phase.",
  final: "Copies the latest text as the final proposal. No API call.",
};

export const FLOW_VARIABLE_GROUPS: Array<{
  label: string;
  variables: Array<{ name: string; hint: string }>;
}> = [
  {
    label: "Job",
    variables: [
      { name: "jobJson", hint: "Job title, description, budget, skills" },
      { name: "jobBriefJson", hint: "Structured brief, if a brief node ran" },
      { name: "evidence", hint: "Selected portfolio evidence" },
      { name: "playbook", hint: "Matched saved playbook" },
      { name: "candidatesJson", hint: "All write candidates and scores" },
    ],
  },
  {
    label: "You",
    variables: [
      { name: "profileFacts", hint: "Verified profile facts" },
      { name: "profileSummary", hint: "Your summary from Profile inputs" },
      { name: "ownerInstructions", hint: "Your screening and writing instructions" },
      { name: "ownerTemplates", hint: "Your saved proposal templates" },
      { name: "samples", hint: "Distilled voice guide, never raw samples" },
    ],
  },
  {
    label: "Rules",
    variables: [
      { name: "policyJson", hint: "Commercial and format policy" },
      { name: "antiAiTells", hint: "Phrases and moves to avoid" },
      { name: "hardChecks", hint: "Hard requirements" },
    ],
  },
  {
    label: "Flow",
    variables: [
      { name: "draft", hint: "Current draft text" },
      { name: "lastOutput", hint: "Text returned by the previous phase" },
      { name: "reviewJson", hint: "Latest structured review" },
      { name: "revisionInstructions", hint: "Latest review fixes as a list" },
      { name: "mustKeep", hint: "Strengths the revision must preserve" },
      { name: "stepOutputsJson", hint: "Every earlier step output keyed by id" },
      { name: "files", hint: "Content of the files attached to this node" },
    ],
  },
];

export function newFlowStep(index: number, position?: FlowPosition): FlowStep {
  return {
    id: `step_${index}`,
    label: `Step ${index}`,
    type: "custom",
    enabled: true,
    system:
      "You are helping the owner write a freelance proposal. Use only the facts and files provided. Follow the owner's instructions exactly. Return only the requested text.",
    user: `JOB:
{{jobJson}}

VERIFIED PROFILE FACTS:
{{profileFacts}}

{{files}}

Write the next part now.`,
    model: null,
    temperature: null,
    timeoutSeconds: null,
    position: position ?? null,
    fileIds: [],
  };
}
