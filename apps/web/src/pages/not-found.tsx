import { Link } from "react-router";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Compass className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold">Page not found</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          The page you are looking for does not exist or has been moved.
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
