import { useState } from "react";
import { FilePlus2, Loader2, Pencil, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type { FlowFile } from "./flow-types";

export interface ProfileContext {
  freelancerUsername: string | null;
  name: string | null;
  title: string | null;
  hourlyRate: string | null;
  about: string | null;
  skills: string[];
  skillIds: number[];
  preferredProjectTypes: string[];
  wants: string[];
  notWants: string[];
  ignoredCountries: string[];
  customInstructions: string | null;
  userSummary: string | null;
  relevancyInstructions: string | null;
  portfolioSummary: string | null;
  proposalTemplates: string | null;
  proposalSystemInstructions: string | null;
  proposalWritingInstructions: string | null;
}

export type ProfileField = "userSummary" | "portfolioSummary" | "relevancyInstructions";
export type ContextTab = "profile" | "files";

const PROFILE_FIELDS: Array<{
  field: ProfileField;
  label: string;
  hint: string;
  placeholder: string;
  rows: number;
}> = [
  {
    field: "userSummary",
    label: "User summary",
    hint: "Who you are and the work you want. This feeds {{profileSummary}}.",
    placeholder: "Who I am, the work I want, proof of competence, and what to avoid.",
    rows: 6,
  },
  {
    field: "portfolioSummary",
    label: "Portfolio summary",
    hint: "Named projects and outcomes. This supplies proposal evidence.",
    placeholder: "Named projects, outcomes, tech, links, and which claims are safe to repeat.",
    rows: 7,
  },
  {
    field: "relevancyInstructions",
    label: "Relevancy instructions",
    hint: "Used when deciding whether a job is a fit.",
    placeholder: "How to decide whether a job is a fit, what to skip, and what signals matter.",
    rows: 5,
  },
];

const FILE_PRESETS = [
  {
    id: "system",
    label: "System instruction",
    title: "System instruction",
    prefix: "system",
    content:
      "You are writing as me. Use only the facts I provided. Never invent clients, results, links, prices, or timelines. Follow my structure and tone exactly.",
  },
  {
    id: "proposal",
    label: "Proposal instruction",
    title: "Proposal instruction",
    prefix: "proposal",
    content:
      "Write in first person, plainly, with no sales filler. Lead with the client's real problem. Cover every deliverable. Do not use headings unless asked.",
  },
  {
    id: "brief",
    label: "Job brief instruction",
    title: "Job brief instruction",
    prefix: "brief",
    content:
      "Separate what the client explicitly said from what you infer. List deliverables, must-address constraints, risks, dependencies, and one question that could change the plan.",
  },
  {
    id: "judge",
    label: "Judge instruction",
    title: "Judge instruction",
    prefix: "judge",
    content:
      "Judge only the supplied candidates. Prefer specific, technically credible writing over polished generic writing. Penalize unsupported claims, missed requirements, and filler.",
  },
  {
    id: "review",
    label: "Review instruction",
    title: "Review instruction",
    prefix: "review",
    content:
      "Review the draft against the job and my instructions. Return concrete fixes, not a rewrite. Reject fabricated claims and missed deliverables. Preserve specific strengths.",
  },
  {
    id: "question",
    label: "Question and closing rules",
    title: "Question and closing rules",
    prefix: "closing",
    content:
      "Ask at most one question, and only when the answer changes the plan. Do not end with a generic call to action, a summary of the proposal, or a promise you cannot keep.",
  },
] as const;

type FilePreset = (typeof FILE_PRESETS)[number];

function nextFileId(prefix: string, files: FlowFile[]): string {
  const used = new Set(files.map((file) => file.id));
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

interface FlowContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  profile: ProfileContext;
  profileLoading: boolean;
  profileError: string | null;
  profileDirty: boolean;
  savingProfile: boolean;
  onProfileChange: (field: ProfileField, value: string) => void;
  onSaveProfile: () => void;
  showFiles?: boolean;
  files: FlowFile[];
  onCreateFile: (file: FlowFile) => void;
  onUpdateFile: (index: number, file: FlowFile) => void;
  onDeleteFile: (index: number) => void;
  onToggleFile: (index: number, enabled: boolean) => void;
}

export function FlowContextDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
  profile,
  profileLoading,
  profileError,
  profileDirty,
  savingProfile,
  onProfileChange,
  onSaveProfile,
  showFiles = true,
  files,
  onCreateFile,
  onUpdateFile,
  onDeleteFile,
  onToggleFile,
}: FlowContextDialogProps) {
  const [presetId, setPresetId] = useState<FilePreset["id"]>("system");
  const [fileDraft, setFileDraft] = useState<FlowFile | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const closeFileEditor = () => {
    setFileDraft(null);
    setEditingIndex(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) closeFileEditor();
    onOpenChange(next);
  };

  const addFile = () => {
    const preset =
      FILE_PRESETS.find((item) => item.id === presetId) ?? FILE_PRESETS[0];
    setEditingIndex(null);
    setFileDraft({
      id: nextFileId(preset.prefix, files),
      label: preset.title,
      content: preset.content,
      enabled: true,
    });
  };

  const editFile = (index: number) => {
    const file = files[index];
    if (file === undefined) return;
    setEditingIndex(index);
    setFileDraft({ ...file });
  };

  const saveFile = () => {
    if (fileDraft === null) return;
    const id = fileDraft.id.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) {
      return;
    }
    if (files.some((file, index) => index !== editingIndex && file.id === id)) {
      return;
    }
    const next = { ...fileDraft, id, label: fileDraft.label.trim() || id };
    if (editingIndex === null) {
      onCreateFile(next);
    } else {
      onUpdateFile(editingIndex, next);
    }
    closeFileEditor();
  };

  const invalidId =
    fileDraft !== null && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fileDraft.id.trim());
  const duplicateId =
    fileDraft !== null &&
    files.some(
      (file, index) => index !== editingIndex && file.id === fileDraft.id.trim()
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4 pr-14">
          <DialogTitle>Profile inputs</DialogTitle>
          <DialogDescription>
            Verified facts and instructions that every proposal can use.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => onTabChange(value as ContextTab)}>
          <div className="border-b px-4 py-3">
            <TabsList className="w-full">
              <TabsTrigger value="profile">Profile inputs</TabsTrigger>
              {showFiles ? (
                <TabsTrigger value="files">
                  Files
                  <Badge variant="secondary" className="ml-1">
                    {files.length}
                  </Badge>
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>

          <TabsContent value="profile" className="grid gap-5 p-4">
            {profileLoading ? (
              <p className="text-sm text-muted-foreground">Loading profile…</p>
            ) : null}
            {PROFILE_FIELDS.map((item) => (
              <div key={item.field} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Label htmlFor={`profile-${item.field}`}>{item.label}</Label>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </div>
                <Textarea
                  id={`profile-${item.field}`}
                  rows={item.rows}
                  value={profile[item.field] ?? ""}
                  disabled={profileLoading || profileError !== null}
                  placeholder={item.placeholder}
                  onChange={(event) => onProfileChange(item.field, event.target.value)}
                />
              </div>
            ))}
            {profileError !== null ? (
              <p className="text-sm text-destructive">{profileError}</p>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Saved separately from the flow. These fields never leave your profile.
              </p>
              <Button
                onClick={onSaveProfile}
                disabled={
                  !profileDirty || savingProfile || profileLoading || profileError !== null
                }
              >
                {savingProfile ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save profile
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="files" className="p-4">
            {fileDraft === null ? (
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <Select
                    value={presetId}
                    onValueChange={(value) => setPresetId(value as FilePreset["id"])}
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILE_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={addFile} disabled={files.length >= 25}>
                    <FilePlus2 className="size-4" />
                    New file
                  </Button>
                </div>

                {files.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No files yet. Start with a system, proposal, judge, or review instruction.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {files.map((file, index) => (
                      <div
                        key={file.id}
                        className="flex items-start gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{file.label}</p>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {file.id}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {file.content.trim() || "Empty file"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Switch
                            checked={file.enabled}
                            onCheckedChange={(checked) => onToggleFile(index, checked)}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${file.label}`}
                            onClick={() => editFile(index)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            aria-label={`Delete ${file.label}`}
                            onClick={() => onDeleteFile(index)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {editingIndex === null ? "New file" : "Edit file"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Attach this file to a node, then reference{" "}
                      {`{{file_${fileDraft.id || "id"}}}`} or use{" "}
                      <code>{"{{files}}"}</code>.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={closeFileEditor}>
                    Back to list
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label>File ID</Label>
                    <Input
                      className="font-mono text-xs"
                      value={fileDraft.id}
                      onChange={(event) =>
                        setFileDraft({ ...fileDraft, id: event.target.value })
                      }
                    />
                    {invalidId ? (
                      <p className="text-xs text-destructive">
                        Start with a letter. Use letters, numbers, and underscores.
                      </p>
                    ) : duplicateId ? (
                      <p className="text-xs text-destructive">This ID is already used.</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Label</Label>
                    <Input
                      value={fileDraft.label}
                      onChange={(event) =>
                        setFileDraft({ ...fileDraft, label: event.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Content</Label>
                  <Textarea
                    rows={14}
                    className="font-mono text-xs"
                    value={fileDraft.content}
                    onChange={(event) =>
                      setFileDraft({ ...fileDraft, content: event.target.value })
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label>Enabled</Label>
                    <p className="text-xs text-muted-foreground">
                      Disabled files stay in the library but render empty.
                    </p>
                  </div>
                  <Switch
                    checked={fileDraft.enabled}
                    onCheckedChange={(checked) =>
                      setFileDraft({ ...fileDraft, enabled: checked })
                    }
                  />
                </div>

                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button variant="outline" onClick={closeFileEditor}>
                    Cancel
                  </Button>
                  <Button onClick={saveFile} disabled={invalidId || duplicateId}>
                    <Save className="size-4" />
                    Save file
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
