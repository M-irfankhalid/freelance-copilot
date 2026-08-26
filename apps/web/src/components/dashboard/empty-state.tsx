import type { LucideIcon } from "lucide-react";

/**
 * Shared empty state for dashboard sections. Rendered when a section's data
 * collection is empty so the layout never collapses to blank space.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="mt-1 text-sm font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
