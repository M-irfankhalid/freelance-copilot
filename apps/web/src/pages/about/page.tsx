import { Bot, ExternalLink, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Release version, kept in sync with the server package version. */
const APP_VERSION = "1.0.0";

const FEATURES = [
  "Job discovery through configurable polling",
  "AI job analysis and matching against your profile",
  "Project file inspection",
  "AI proposal generation grounded in your real profile",
  "Manual bidding with a review step",
  "Opt-in auto-bidding with score threshold, bid bounds, and daily cap",
  "Full system activity logs and analytics",
];

const SAFEGUARDS = [
  "Single user and self-hosted — your data and credentials live on your own server.",
  "Credentials are encrypted at rest and never logged, committed, or sent to the frontend.",
  "Auto-bidding is off by default and only ever runs inside the limits you set.",
  "The AI never invents skills, experience, portfolio, or client history — output is validated before it is used.",
];

/** About this project — brand, mission, and who's behind it. */
export default function AboutPage() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="About"
        description="What Freelance Copilot is, how it keeps you in control, and who's behind it."
      />

      <Card size="sm">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="size-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-lg leading-none font-semibold">
                  Freelance Copilot
                </span>
                <Badge variant="outline">v{APP_VERSION}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">
                A self-hosted AI agent for freelancers on Freelancer.com.
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed">
            Freelance Copilot finds relevant projects on Freelancer.com, matches them
            against your real profile, and drafts quality proposals — so you can focus
            on your work while the agent handles discovery. Every proposal is grounded
            in facts you have verified, and nothing is submitted without your say-so.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Bring your own credentials: the app runs with your own Freelancer.com access
            token and OpenRouter API key. It is built for one user per installation.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" aria-hidden />
              What it does
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              {FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
              Controls &amp; privacy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              {SAFEGUARDS.map((safeguard) => (
                <li key={safeguard}>{safeguard}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-warning/30 bg-warning/[0.06] ring-warning/15">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning">
            <TriangleAlert className="size-4" aria-hidden />
            Please use this responsibly
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-card-foreground/90">
            Do not use Freelance Copilot to spam Freelancer.com or to send mass,
            unsolicited, or low-quality bids. It is built for good-faith use only:
            bidding on projects that genuinely match your profile. The whole point is to
            help real freelancers spend less time hunting and more time delivering — not
            to flood the platform. Abusing a freelancing marketplace can get accounts
            suspended and hurts the freelancers who use it honestly. Always respect
            Freelancer.com's Terms of Service and this tool's own safety limits.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Open source</CardTitle>
          <CardDescription>
            Built and maintained by Muhammad Irfan Khalid, released as open source by
            sofNxt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href="https://irfankhalid.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            irfankhalid.com
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <a
            href="https://sofNxt.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            sofNxt.com
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </CardContent>
        <CardFooter className="flex-col items-start gap-1.5">
          <span className="text-xs text-muted-foreground">
            Released under the MIT License. © 2026 Muhammad Irfan Khalid.
          </span>
          <span className="text-xs text-muted-foreground/80">
            Freelance Copilot is an independent project and is not affiliated with,
            endorsed by, or sponsored by Freelancer.com.
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
