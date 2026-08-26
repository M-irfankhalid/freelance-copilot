import { useState } from "react";
import { Bot, Check, PencilLine, RefreshCw, Send } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ProposalStatusBadge } from "@/components/dashboard/status-badges";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { proposals as allProposals } from "@/lib/data/proposals";
import type { ProposalRecord } from "@/lib/types";

/**
 * Proposal pipeline. The approval queue is the heart of it: drafts generated
 * by the agent wait here until a human approves or edits them.
 */
export default function ProposalsPage() {
  const [proposals, setProposals] = useState<ProposalRecord[]>(allProposals);
  const [editing, setEditing] = useState<ProposalRecord | null>(null);
  const [draftText, setDraftText] = useState("");

  const queue = proposals.filter((p) => p.status === "awaiting_approval");

  const openEditor = (proposal: ProposalRecord) => {
    setEditing(proposal);
    setDraftText(proposal.content);
  };

  const saveEdit = () => {
    if (!editing) return;
    setProposals((current) =>
      current.map((p) =>
        p.id === editing.id ? { ...p, content: draftText, updatedLabel: "just now" } : p
      )
    );
    setEditing(null);
  };

  const approve = (id: string) =>
    setProposals((current) =>
      current.map((p) =>
        p.id === id ? { ...p, status: "queued", updatedLabel: "just now" } : p
      )
    );

  const regenerate = (proposal: ProposalRecord) => {
    setProposals((current) =>
      current.map((p) =>
        p.id === proposal.id
          ? {
              ...p,
              content: `${p.content}\n\n— regenerated with a stronger opening line referencing the client's own words.`,
              updatedLabel: "just now",
            }
          : p
      )
    );
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Proposals"
        description="Agent drafts grounded in your profile. Nothing is sent until you approve."
      />

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
                    <Button variant="ghost" size="sm" onClick={() => regenerate(proposal)}>
                      <RefreshCw data-icon="inline-start" />
                      Regenerate
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEditor(proposal)}>
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
                      ${proposal.bidAmount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <ProposalStatusBadge status={proposal.status} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {proposal.updatedLabel}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="xs" onClick={() => openEditor(proposal)}>
                        View / edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Drafts */}
        <TabsContent value="drafts" className="flex flex-col gap-4">
          {proposals.filter((p) => p.status === "draft").length === 0 ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No saved drafts. Drafts you start manually will collect here.
            </p>
          ) : null}
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
              disabled={!editing}
            >
              <RefreshCw data-icon="inline-start" />
              Regenerate
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={saveEdit}>
                <Send data-icon="inline-start" />
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
