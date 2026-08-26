import { Badge } from "@/components/ui/badge";

/**
 * Temporary stand-in for a section that has not been built yet.
 * Each description mirrors the corresponding phase in FRONTEND_ROADMAP.md.
 */
export function SectionPlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-balance text-muted-foreground">
        {description}
      </p>
      <Badge variant="outline" className="mt-2 font-normal text-muted-foreground">
        {phase}
      </Badge>
    </div>
  );
}
