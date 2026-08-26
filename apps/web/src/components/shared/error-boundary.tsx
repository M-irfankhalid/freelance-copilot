import { Component } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Generic error boundary used as a route-level `errorElement` so unhandled
 * errors render a friendly in-app message instead of the raw React dev screen.
 */
export class RouteErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(error);
  }

  override render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
            <TriangleAlert className="size-5 text-destructive" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold">Something went wrong</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              A problem occurred while rendering this page. Reload or try
              navigating elsewhere.
            </p>
            {error.digest ? (
              <p className="text-xs text-muted-foreground/70">
                Error reference: {error.digest}
              </p>
            ) : null}
          </div>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            Reload page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
