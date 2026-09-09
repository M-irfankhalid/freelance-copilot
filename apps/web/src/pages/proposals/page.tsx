import { useMemo, useState } from "react";
import { Bot, Check, MoreHorizontal, PencilLine, RefreshCw, Send, Trash2, X } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { CleanStaleButton } from "@/components/dashboard/clean-stale-button";
import { ProposalStatusBadge } from "@/components/dashboard/status-badges";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import type { ProposalRecord, ProposalStatus } from "@/lib/types";

interface ProposalsListResponse {
  proposals: ProposalRecord[];
}

/**
 * Proposal pipeline. The approval queue is the heart of it: drafts generated
 * by the agent wait here until a human approves or edits them.
 */
export default function ProposalsPage() {
  const { data, error, isLoading, refetch } = useApi<ProposalsListResponse>(
    "/api/proposals"
  );
  const proposals = useMemo(() => data?.proposals ?? [], [data]);
  const [editing, setEditing] = useState<ProposalRecord | null>(null);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProposalRecord | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const queue = proposals.filter((p) => p.status === "awaiting_approval");
  const drafts = proposals.filter((p) => p.status === "draft");

  const openEditor = (proposal: ProposalRecord) => {
    setEditing(proposal);
    setDraftText(proposal.content);
    setActionError(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setActionError(null);
    try {
      await api<{ ok: true }>(`/api/proposals/${editing.id}`, {
        method: "PUT",
        body: {
          content: draftText,
        },
      });
      refetch();
      setEditing(null);
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  /** Move a proposal to a new status via the approval-queue state machine. */
  const changeStatus = async (id: string, status: ProposalStatus) => {
    setActionError(null);
    try {
      await api<{ ok: true }>(`/api/proposals/${id}/status`, {
        method: "PUT",
        body: { status },
      });
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    }
  };

  const approve = (id: string) => changeStatus(id, "queued");

  const approveDraft = (id: string) => changeStatus(id, "approved");

  const declineDraft = (id: string) => changeStatus(id, "declined");

  /** Permanently remove a draft proposal (after confirmation). */
  const confirmDelete = async () => {
    if (deleting === null) return;
    setDeletePending(true);
    setActionError(null);
    try {
      await api<{ ok: true }>(`/api/proposals/${deleting.id}`, {
        method: "DELETE",
      });
      setDeleting(null);
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setDeletePending(false);
    }
  };

  const regenerate = async (proposal: ProposalRecord) => {
    setRegeneratingId(proposal.id);
    setActionError(null);
    try {
      await api<{ ok: true }>(`/api/proposals/${proposal.id}/regenerate`, {
        method: "POST",
        // Generation can take ~180s server-side; wait for it instead of
        // aborting at the default 10s and erroring while the AI finishes.
        timeoutMs: 200_000,
        body: {},
      });
      if (editing?.id === proposal.id) {
        setDraftText("");
      }
      refetch();
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setRegeneratingId(null);
    }
  };

  const isRegenerating = (id: string) => regeneratingId === id;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Proposals"
        description="Agent drafts grounded in your profile. Nothing is sent until you approve."
        actions={<CleanStaleButton onCleaned={() => refetch()} />}
      />

      {error !== null ? (
        <p className="text-sm text-destructive">
          {messageFor(error)} —{" "}
          <button
            className="underline"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            retry
          </button>
        </p>
      ) : null}

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">
            Approval queue
            <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
              {queue.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="all">All proposals</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
        </TabsList>

        {/* Approval queue */}
        <TabsContent value="queue" className="flex flex-col gap-4">
          {queue.length === 0 ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Nothing waiting for approval. Auto-drafted proposals land here.
            </p>
          ) : (
            queue.map((proposal) => (
              <Card key={proposal.id}>
                <CardHeader>
                  <CardTitle>{proposal.jobTitle}</CardTitle>
                  <CardDescription>
                    {proposal.client} · bid ${proposal.bidAmount.toLocaleString()} ·
                    drafted by agent
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex-col items-stretch gap-3 md:flex-row md:items-center">
                  <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {proposal.content.split("\n")[0]}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => regenerate(proposal)}
                      disabled={isRegenerating(proposal.id)}
                    >
                      <RefreshCw
                        data-icon="inline-start"
                        className={isRegenerating(proposal.id) ? "animate-spin" : undefined}
                      />
                      Regenerate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditor(proposal)}
                    >
                      <PencilLine data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button size="sm" onClick={() => approve(proposal.id)}>
                      <Check data-icon="inline-start" />
                      Approve
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))
          )}
        </TabsContent>

        {/* All */}
        <TabsContent value="all">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Bid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((proposal) => (
                  <TableRow key={proposal.id}>
                    <TableCell className="max-w-72 truncate font-medium">
                      {proposal.jobTitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {proposal.client}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {bidLabel(proposal.bidAmount)}
                    </TableCell>
                    <TableCell>
                      <ProposalStatusBadge status={proposal.status} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {proposal.updatedLabel}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openEditor(proposal)}
                        >
                          View / edit
                        </Button>
                        {proposal.status === "draft" ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label="Delete draft"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleting(proposal)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Drafts */}
        <TabsContent value="drafts" className="flex flex-col gap-4">
          {drafts.length === 0 ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No saved drafts. Drafts you start manually will collect here.
            </p>
          ) : (
            drafts.map((proposal) => (
              <Card key={proposal.id}>
                <CardHeader>
                  <CardTitle>{proposal.jobTitle}</CardTitle>
                  <CardDescription>
                    {proposal.client} · {bidLabel(proposal.bidAmount)}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex-col items-stretch gap-3 md:flex-row md:items-center">
                  <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {proposal.content.split("\n")[0]}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => regenerate(proposal)}
                      disabled={isRegenerating(proposal.id)}
                    >
                      <RefreshCw
                        data-icon="inline-start"
                        className={isRegenerating(proposal.id) ? "animate-spin" : undefined}
                      />
                      Regenerate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditor(proposal)}
                    >
                      <PencilLine data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button size="sm" onClick={() => void approveDraft(proposal.id)}>
                      <Check data-icon="inline-start" />
                      Approve
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label="More actions">
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={6}>
                        <DropdownMenuItem onSelect={() => void declineDraft(proposal.id)}>
                          <X aria-hidden />
                          Decline
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(proposal)}
                        >
                          <Trash2 aria-hidden />
                          Delete draft
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardFooter>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Editor dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.jobTitle}</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <Bot className="size-3.5" aria-hidden />
              Drafted only from your profile facts — edit anything that sounds off.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proposal-content">Proposal</Label>
            <Textarea
              id="proposal-content"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              rows={14}
              className="font-mono text-[13px] leading-relaxed"
            />
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => editing && regenerate(editing)}
              disabled={!editing || isRegenerating(editing.id)}
            >
              <RefreshCw data-icon="inline-start" />
              Regenerate
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={saving}>
                <Send data-icon="inline-start" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
          {actionError ? (
            <p className="text-sm text-destructive">{actionError}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deletePending && setDeleting(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete draft?</DialogTitle>
            <DialogDescription>
              This permanently removes the draft proposal for{" "}
              <span className="font-medium text-foreground">{deleting?.jobTitle}</span>. This
              cannot be undone — decline it instead if you want to keep it in your history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deletePending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletePending}
            >
              <Trash2 data-icon="inline-start" />
              {deletePending ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
          {actionError ? (
            <p className="text-sm text-destructive">{actionError}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Bid amount text — drafts have no amount until set at bid time. */
function bidLabel(amount: number | null | undefined): string {
  return amount != null ? `$${amount.toLocaleString()}` : "No bid amount set";
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}
