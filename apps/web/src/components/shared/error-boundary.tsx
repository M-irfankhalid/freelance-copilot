import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Home, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

function errorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return null;
  }
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" ? digest : null;
}

/**
 * Route-level `errorElement`. React Router calls this with the route error via
 * `useRouteError`, so it must not expect children.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const digest = errorDigest(error);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">
          {notFound ? "Page not found" : "Something went wrong"}
        </p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {notFound
            ? "The page you were looking for does not exist or has moved."
            : "A problem occurred while rendering this page. Reload or head back to the dashboard."}
        </p>
        {digest ? (
          <p className="text-xs text-muted-foreground/70">
            Error reference: {digest}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link to="/">
            <Home data-icon="inline-start" aria-hidden />
            Go home
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw data-icon="inline-start" aria-hidden />
          Reload page
        </Button>
      </div>
    </div>
  );
}
