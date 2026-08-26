import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for the platforms route. Handles errors from API calls
 * or unexpected runtime issues gracefully within the app shell.
 */
export class PlatformsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <PlatformsErrorView
          error={error}
          retry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function PlatformsErrorView({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">We couldn&apos;t load platforms</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Your credentials page failed to load. Retry, or check back in a few
          minutes if the problem persists.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground/70">
            Error reference: {error.digest}
          </p>
        ) : null}
      </div>
      <Button size="sm" variant="outline" onClick={retry}>
        <RefreshCw data-icon="inline-start" aria-hidden />
        Try again
      </Button>
    </div>
  );
}