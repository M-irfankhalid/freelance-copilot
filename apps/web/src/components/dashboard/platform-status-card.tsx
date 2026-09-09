import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  MessageSquare,
  Plus,
  TriangleAlert,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlatformConnection } from "@/lib/types";

/** Connection health for each supported freelance platform. */
export function PlatformStatusCard({
  platforms,
}: {
  platforms: PlatformConnection[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform connections</CardTitle>
        <CardDescription>Sync status and job coverage.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to="/platforms">
              Manage
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-(--card-spacing)">
        {platforms.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No platforms configured yet.
          </p>
        ) : (
          <ul className="divide-y">
            {platforms.map((platform) => (
              <li
                key={platform.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                  {platform.id === "discord" ? (
                    <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
                  ) : (
                    <Globe className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{platform.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {platform.status === "connected"
                      ? platform.note ??
                        [
                          platform.username ? `@${platform.username}` : null,
                          platform.lastSyncLabel ? `Synced ${platform.lastSyncLabel}` : null,
                          typeof platform.newJobsToday === "number"
                            ? `${platform.newJobsToday} new jobs today`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : platform.note}
                  </p>
                </div>
                <ConnectionControl platform={platform} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionControl({ platform }: { platform: PlatformConnection }) {
  if (platform.status === "connected") {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-transparent bg-success/10 text-success">
        <CheckCircle2 data-icon="inline-start" aria-hidden />
        Connected
      </Badge>
    );
  }

  if (platform.status === "needs_attention") {
    return (
      <>
        <Badge variant="outline" className="hidden shrink-0 gap-1 border-transparent bg-warning/10 text-warning sm:inline-flex">
          <TriangleAlert data-icon="inline-start" aria-hidden />
          Reconnect
        </Badge>
        <Button asChild size="xs" variant="outline" className="sm:hidden">
          <Link to="/platforms">Fix</Link>
        </Button>
      </>
    );
  }

  return (
    <Button asChild size="xs" variant="outline" className="shrink-0">
      <Link to="/platforms">
        <Plus data-icon="inline-start" aria-hidden />
        Connect
      </Link>
    </Button>
  );
}
