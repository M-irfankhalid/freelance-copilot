import type * as React from "react";
import { Link } from "react-router";
import { Bot } from "lucide-react";

/**
 * Centered shell for unauthenticated screens: brand mark, card content,
 * and a footer swap between login and signup.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <Link
        to="/"
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-4.5" aria-hidden />
        </span>
        Freelance Copilot
      </Link>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children}
      </div>

      {footer ? (
        <p className="text-sm text-muted-foreground">{footer}</p>
      ) : null}
    </div>
  );
}
