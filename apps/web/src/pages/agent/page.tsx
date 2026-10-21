import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, NetworkError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface AgentAction {
  tool: string;
  detail: string;
  changedFields?: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
  tone?: "error";
}

const SUGGESTIONS = [
  {
    label: "Review my profile",
    hint: "Find gaps and weak wording",
    prompt: "Review my profile and tell me what is missing.",
    icon: UserRound,
  },
  {
    label: "Diagnose my proposals",
    hint: "See why replies are weak",
    prompt: "Why are my recent proposals weak?",
    icon: FileText,
  },
  {
    label: "Explain an ignored job",
    hint: "Trace the screening decision",
    prompt: "Explain why my last scanned job was ignored.",
    icon: Search,
  },
  {
    label: "Check auto-bid readiness",
    hint: "Review limits and missing data",
    prompt: "What should I fix before enabling auto-bid?",
    icon: ShieldCheck,
  },
];

function newId(): string {
  return crypto.randomUUID();
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError || cause instanceof NetworkError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return "Unknown error";
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((token) => token.length > 0)
    .map((token, index) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong key={index} className="font-semibold">
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code
            key={index}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      return <span key={index}>{token}</span>;
    });
}

function MessageBody({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return null;

        const heading = /^#{1,3}\s+(.*)$/.exec(trimmed);
        if (heading !== null) {
          return (
            <p key={index} className="pt-1 font-semibold">
              {inline(heading[1] ?? "")}
            </p>
          );
        }

        const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
        if (bullet !== null) {
          return (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-current/40" />
              <span>{inline(bullet[1] ?? "")}</span>
            </div>
          );
        }

        const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (numbered !== null) {
          return (
            <div key={index} className="flex items-start gap-2">
              <span className="font-medium tabular-nums text-muted-foreground">
                {numbered[1]}.
              </span>
              <span>{inline(numbered[2] ?? "")}</span>
            </div>
          );
        }

        return <p key={index}>{inline(trimmed)}</p>;
      })}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [allowWrites, setAllowWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    const element = inputRef.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 152)}px`;
  }, [input]);

  const clear = () => {
    setMessages([]);
    setInput("");
  };

  const send = async () => {
    const content = input.trim();
    if (content.length === 0 || busy) return;

    const userMessage: ChatMessage = { id: newId(), role: "user", content };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setBusy(true);

    try {
      const result = await api<{ message: string; actions: AgentAction[] }>(
        "/api/agent/chat",
        {
          method: "POST",
          timeoutMs: 200_000,
          body: {
            messages: history.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            allowWrites,
          },
        }
      );
      setMessages([
        ...history,
        {
          id: newId(),
          role: "assistant",
          content: result.message,
          actions: result.actions,
        },
      ]);
    } catch (cause) {
      setMessages([
        ...history,
        {
          id: newId(),
          role: "assistant",
          content: `I could not complete that request: ${messageFor(cause)}`,
          tone: "error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:gap-6">
      <PageHeader
        title="Agent"
        description="Ask about your profile, job screening, proposals, or automation. It works from your saved data and never invents facts."
        actions={
          <Button
            variant="outline"
            onClick={clear}
            disabled={busy || messages.length === 0}
          >
            <Plus data-icon="inline-start" />
            New chat
          </Button>
        }
      />

      <Card className="gap-0 overflow-hidden rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Sparkles className="size-4" aria-hidden />
              </div>
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading text-sm font-medium">Freelance Copilot</p>
                <Badge variant="outline" className="h-5 bg-muted/30">
                  Agent
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {busy
                  ? "Checking your saved data…"
                  : allowWrites
                    ? "Changes enabled · can save edits"
                    : "Read-only · can inspect and diagnose"}
              </p>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center gap-2.5 rounded-full border px-3 py-1.5 transition-colors",
              allowWrites
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-border bg-muted/30"
            )}
          >
            {allowWrites ? (
              <ShieldAlert className="size-3.5 text-amber-600" aria-hidden />
            ) : (
              <ShieldCheck
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
            )}
            <Label htmlFor="allow-writes" className="cursor-pointer text-xs">
              Allow changes
            </Label>
            <Switch
              id="allow-writes"
              checked={allowWrites}
              onCheckedChange={setAllowWrites}
              disabled={busy}
            />
          </div>
        </div>

        {allowWrites ? (
          <div className="flex gap-3 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs sm:px-5">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-amber-600"
              aria-hidden
            />
            <p className="leading-relaxed">
              <span className="font-medium text-foreground">Changes enabled.</span>{" "}
              The agent can update profile fields, scan and analyze jobs, rewrite
              draft proposals, and change draft pricing or delivery. Approving and
              placing a bid always requires your explicit confirmation. Contacting
              clients and automation safety limits stay off-limits.
            </p>
          </div>
        ) : null}

        <CardContent
          role="log"
          aria-live="polite"
          aria-busy={busy}
          className="flex h-[clamp(360px,54vh,680px)] flex-col gap-5 overflow-y-auto bg-muted/20 px-4 py-5 sm:px-6"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 py-4">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-sm">
                  <Sparkles className="size-5" aria-hidden />
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="font-heading text-lg font-medium">
                    What should we look at?
                  </h2>
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    Profile gaps, ignored jobs, weak proposals, or automation
                    settings — start with a question or a shortcut below.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Badge variant="outline" className="gap-1.5 bg-card">
                    <Database aria-hidden />
                    Reads your saved data
                  </Badge>
                  <Badge variant="outline" className="gap-1.5 bg-card">
                    <ShieldCheck aria-hidden />
                    Bids need your confirmation
                  </Badge>
                </div>
              </div>

              <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => {
                  const Icon = suggestion.icon;
                  return (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={() => {
                        setInput(suggestion.prompt);
                        inputRef.current?.focus();
                      }}
                      disabled={busy}
                      className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center justify-between gap-2 text-sm font-medium">
                          {suggestion.label}
                          <ArrowUpRight
                            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {suggestion.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              const isError = message.tone === "error";
              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-start gap-3",
                    isUser && "flex-row-reverse"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg border shadow-sm",
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : isError
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "bg-card"
                    )}
                  >
                    {isUser ? (
                      <UserRound className="size-4" aria-hidden />
                    ) : isError ? (
                      <AlertTriangle className="size-4" aria-hidden />
                    ) : (
                      <Bot className="size-4" aria-hidden />
                    )}
                  </div>

                  <div
                    className={cn(
                      "flex min-w-0 max-w-[calc(100%-3rem)] flex-col gap-1 sm:max-w-[85%]",
                      isUser ? "items-end" : "items-start"
                    )}
                  >
                    <span className="px-1 text-[11px] font-medium text-muted-foreground">
                      {isUser ? "You" : "Agent"}
                    </span>
                    <div
                      className={cn(
                        "min-w-0 rounded-2xl px-4 py-3 shadow-sm",
                        isUser
                          ? "rounded-tr-sm bg-primary text-primary-foreground"
                          : isError
                            ? "rounded-tl-sm border border-destructive/30 bg-destructive/5 text-destructive"
                            : "rounded-tl-sm border bg-card"
                      )}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {message.content}
                        </p>
                      ) : (
                        <MessageBody text={message.content} />
                      )}

                      {message.actions && message.actions.length > 0 ? (
                        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
                          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                            Saved changes
                          </p>
                          {message.actions.map((action, index) => (
                            <div
                              key={`${message.id}-${action.tool}-${index}`}
                              className="flex items-start gap-2 rounded-lg bg-success/10 px-2.5 py-2 text-xs text-foreground"
                            >
                              <CheckCircle2
                                className="mt-0.5 size-3.5 shrink-0 text-success"
                                aria-hidden
                              />
                              <span className="leading-relaxed">{action.detail}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {busy ? (
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card shadow-sm">
                <Bot className="size-4" aria-hidden />
              </div>
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[11px] font-medium text-muted-foreground">
                  Agent
                </span>
                <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-sm border bg-card px-4 py-3 shadow-sm">
                  <TypingDots />
                  <span className="text-xs text-muted-foreground">
                    Checking your saved data…
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </CardContent>

        <CardFooter className="border-t bg-card p-3 sm:p-4">
          <form
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div
              className={cn(
                "rounded-xl border bg-background shadow-sm transition-all focus-within:ring-3",
                allowWrites
                  ? "focus-within:border-amber-500/50 focus-within:ring-amber-500/15"
                  : "focus-within:border-ring focus-within:ring-ring/20"
              )}
            >
              <Label htmlFor="agent-input" className="sr-only">
                Message the agent
              </Label>
              <Textarea
                id="agent-input"
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask about your profile, a job, or a proposal…"
                disabled={busy}
                className="min-h-[52px] resize-none border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-2">
                <div className="flex min-w-0 items-center gap-2 px-1 text-[11px] text-muted-foreground">
                  {allowWrites ? (
                    <ShieldAlert
                      className="size-3.5 shrink-0 text-amber-600"
                      aria-hidden
                    />
                  ) : (
                    <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="whitespace-nowrap">
                    {allowWrites ? "Can save changes" : "Read-only"}
                  </span>
                  <span className="text-border">·</span>
                  <span className="hidden truncate sm:inline">
                    Enter to send · Shift+Enter for a new line
                  </span>
                </div>
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 rounded-lg"
                  disabled={busy || input.trim().length === 0}
                  aria-label="Send message"
                >
                  {busy ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <ArrowUp aria-hidden />
                  )}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
              The agent only uses saved data. It cannot contact clients or change
              automation limits, and every bid needs your explicit confirmation.
            </p>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
