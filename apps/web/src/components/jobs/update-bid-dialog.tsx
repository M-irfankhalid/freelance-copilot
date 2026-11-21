import { useState } from "react";
import { Pencil, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, NetworkError } from "@/lib/api/client";

/** The user's bid as the job page knows it, or null when none is on record. */
export interface MyBid {
  id: string;
  freelancerBidId: number | null;
  amount: number;
  milestonePercentage: number;
  description: string;
}

export interface UpdateBidValues {
  description: string;
  amount: number;
  milestonePercentage: number;
}

interface UpdateBidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** The bid on record for this project, when there is one. */
  myBid: MyBid | null;
  /** Fallbacks for a project we have no bid row for — the page's own fields. */
  fallback: { description: string; amount: string; milestonePercentage: string };
  onUpdated: (values: UpdateBidValues) => void;
}

interface FindResponse {
  bid: { id: number; amount: number | null; description: string | null } | null;
}

/**
 * Edit a bid that is already on Freelancer.com.
 *
 * Freelancer's update endpoint is keyed by its own bid id, so the dialog asks
 * for one. When the app placed the bid it already knows the id and fills it in;
 * when it did not, the user can type the id or press Find to have the project's
 * bids looked up once — that lookup is never made on their behalf.
 */
export function UpdateBidDialog({
  open,
  onOpenChange,
  projectId,
  myBid,
  fallback,
  onUpdated,
}: UpdateBidDialogProps) {
  // Held here rather than in the form so the dialog cannot be dismissed
  // mid-update. The form below is unmounted while the dialog is closed, which
  // is what reseeds its fields from the current bid on every open.
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <UpdateBidForm
          projectId={projectId}
          myBid={myBid}
          fallback={fallback}
          onUpdated={onUpdated}
          onOpenChange={onOpenChange}
          submitting={submitting}
          onSubmittingChange={setSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}

interface UpdateBidFormProps extends Omit<UpdateBidDialogProps, "open"> {
  submitting: boolean;
  onSubmittingChange: (busy: boolean) => void;
}

function UpdateBidForm({
  onOpenChange,
  projectId,
  myBid,
  fallback,
  onUpdated,
  submitting,
  onSubmittingChange,
}: UpdateBidFormProps) {
  // Seeded once per open: a cancelled edit never leaks into the next one, and a
  // refresh behind the dialog cannot overwrite what is being typed.
  const [bidId, setBidId] = useState(() => {
    const recorded = myBid?.freelancerBidId ?? null;
    return recorded !== null ? String(recorded) : "";
  });
  const [amount, setAmount] = useState(myBid !== null ? String(myBid.amount) : fallback.amount);
  const [milestone, setMilestone] = useState(
    myBid !== null ? String(myBid.milestonePercentage) : fallback.milestonePercentage
  );
  const [description, setDescription] = useState(
    myBid !== null ? myBid.description : fallback.description
  );
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const findBid = async () => {
    if (finding) return;
    setFinding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<FindResponse>(`/api/bids/project/${projectId}/find`);
      if (res.bid === null) {
        setNotice(
          "No bid of yours was found on this project. Enter the bid id from Freelancer.com instead."
        );
        return;
      }
      setBidId(String(res.bid.id));
      // Only fill what is still blank — never overwrite something the user typed.
      if (amount.trim() === "" && res.bid.amount !== null) {
        setAmount(String(Math.round(res.bid.amount)));
      }
      if (description.trim() === "" && res.bid.description !== null) {
        setDescription(res.bid.description);
      }
      setNotice(`Found your bid on this project (id ${res.bid.id}).`);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setFinding(false);
    }
  };

  const submit = async () => {
    const parsedId = Number(bidId.trim());
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setError("Enter the numeric bid id from Freelancer.com.");
      return;
    }
    const parsedAmount = Number(amount.trim());
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setError("Bid amount must be a whole number greater than zero.");
      return;
    }
    const parsedMilestone = Number(milestone.trim());
    if (!Number.isFinite(parsedMilestone) || parsedMilestone < 20 || parsedMilestone > 100) {
      setError("Milestone percentage must be between 20 and 100.");
      return;
    }
    if (description.trim() === "") {
      setError("The bid description cannot be empty.");
      return;
    }

    onSubmittingChange(true);
    setError(null);
    try {
      await api(`/api/bids/project/${projectId}`, {
        method: "PUT",
        // AI-free and network-bound upstream, but still well inside the default.
        timeoutMs: 45_000,
        body: {
          freelancerBidId: parsedId,
          description,
          amount: parsedAmount,
          milestonePercentage: parsedMilestone,
        },
      });
      onUpdated({
        description,
        amount: parsedAmount,
        milestonePercentage: parsedMilestone,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      onSubmittingChange(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update bid</DialogTitle>
        <DialogDescription>
          Changes the bid already on Freelancer.com. This edits the existing bid —
          it does not place a new one.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="update-bid-id" className="text-xs font-medium">
            Bid ID
          </Label>
          <div className="flex gap-2">
            <Input
              id="update-bid-id"
              inputMode="numeric"
              placeholder="e.g. 1234567"
              className="h-9"
              value={bidId}
              onChange={(e) => setBidId(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => void findBid()}
              disabled={finding || submitting}
            >
              <Search data-icon="inline-start" className="size-4" />
              {finding ? "Searching…" : "Find"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {myBid?.freelancerBidId != null
              ? "Recorded when this bid was placed. Find re-checks it on Freelancer.com."
              : "Not on record for this bid. Find looks it up on Freelancer.com, or copy it from your bid there."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="update-bid-amount" className="text-xs font-medium">
              Bid amount ($)
            </Label>
            <Input
              id="update-bid-amount"
              type="number"
              className="h-9"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="update-bid-milestone" className="text-xs font-medium">
              Milestone % <span className="text-muted-foreground">(20–100)</span>
            </Label>
            <Input
              id="update-bid-milestone"
              type="number"
              min={20}
              max={100}
              step={1}
              className="h-9"
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="update-bid-description" className="text-xs font-medium">
            Description
          </Label>
          <Textarea
            id="update-bid-description"
            rows={10}
            className="resize-none text-sm leading-relaxed"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice && !error ? (
        <p className="text-sm text-muted-foreground">{notice}</p>
      ) : null}

      <DialogFooter className="sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={submitting || finding}>
          <Pencil data-icon="inline-start" className="size-4" />
          {submitting ? "Updating…" : "Update bid"}
        </Button>
      </DialogFooter>
    </>
  );
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) {
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}
