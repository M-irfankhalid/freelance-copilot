import * as React from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);
const TOAST_DURATION_MS = 4500;

const variantIcon = {
  success: CircleCheck,
  error: TriangleAlert,
  info: Info,
} satisfies Record<ToastVariant, typeof Info>;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, number>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const item: ToastItem = { ...input, id, variant: input.variant ?? "info" };
      setToasts((items) => [...items.slice(-3), item]);
      const timer = window.setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  React.useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((item) => {
          const Icon = variantIcon[item.variant];
          return (
            <div
              key={item.id}
              role={item.variant === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-card p-3 shadow-lg",
                item.variant === "error" && "border-destructive/30",
                item.variant === "success" && "border-success/30"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground",
                  item.variant === "error" && "bg-destructive/10 text-destructive",
                  item.variant === "success" && "bg-success/10 text-success"
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm leading-tight font-medium">{item.title}</p>
                {item.description ? (
                  <p className="text-xs leading-snug text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return context;
}
