import { Skeleton } from "@/components/ui/skeleton";

/** Route-level skeleton mirroring the dashboard layout. */
export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </header>

      <section
        aria-label="Loading metrics"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-26 rounded-xl" />
        ))}
      </section>

      <section
        aria-label="Loading pipeline"
        className="grid items-stretch gap-4 lg:grid-cols-3"
      >
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
      </section>
    </div>
  );
}
