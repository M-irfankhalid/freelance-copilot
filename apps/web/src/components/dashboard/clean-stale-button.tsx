import { useState } from "react";
import { Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, ApiError, NetworkError } from "@/lib/api/client";

interface CleanResponse {
  ok: true;
  removed: { jobs: number; proposals: number; bids: number };
}

/**
 * "Clean" action shown on the Jobs and Proposals pages. Permanently deletes
 * locally stored projects older than 24h plus their proposals and stored bid
 * data — submitted-bid history is always kept. Requires an explicit confirm.
 */
export function CleanStaleButton({ onCleaned }: { onCleaned: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmClean = async () => {
    setPending(true);
    setError(null);
    try {
      await api<CleanResponse>("/api/jobs/clean", { method: "POST" });
      setOpen(false);
      onCleaned();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2 data-icon="inline-start" aria-hidden />
        Clean
      </Button>
      <Dialog open={open} onOpenChange={(nowOpen) => !nowOpen && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clean old projects?</DialogTitle>
            <DialogDescription>
              This permanently deletes projects stored more than 24 hours ago,
              along with their proposals and stored bid data. Your submitted
              bid history is kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmClean()}
              disabled={pending}
            >
              <Trash2 data-icon="inline-start" aria-hidden />
              {pending ? "Cleaning…" : "Clean"}
            </Button>
          </DialogFooter>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </DialogContent>
      </Dialog>
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
