import {
  Bot,
  BrainCircuit,
  Briefcase,
  FileText,
  Gavel,
  LayoutDashboard,
  PlugZap,
  ScrollText,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

export type NavGroup = {
  /** Omit for the primary group, which needs no label. */
  title?: string;
  items: NavItem[];
};

/**
 * Five everyday destinations first; automation and reporting sit below.
 * Advanced tools (proposal flow, run history) live in Settings.
 */
export const navMainGroups: NavGroup[] = [
  {
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Jobs", url: "/jobs", icon: Briefcase },
      { title: "Matches", url: "/matches", icon: Target },
      { title: "Proposals", url: "/proposals", icon: FileText },
      { title: "Bids", url: "/bids", icon: Gavel },
    ],
  },
  {
    title: "Automate",
    items: [
      { title: "Agent", url: "/agent", icon: Sparkles },
      { title: "Automation", url: "/automation", icon: Bot },
    ],
  },
  {
    title: "Insights",
    items: [
      { title: "Analytics", url: "/analytics", icon: TrendingUp },
      { title: "Logs", url: "/logs", icon: ScrollText },
    ],
  },
];

/** Account-level sections pinned to the bottom of the sidebar. */
export const navSecondaryItems: NavItem[] = [
  { title: "Platforms", url: "/platforms", icon: PlugZap },
  { title: "AI settings", url: "/ai-settings", icon: BrainCircuit },
  { title: "Profile", url: "/profile", icon: UserRound },
  { title: "Settings", url: "/settings", icon: Settings },
];

/** All navigable sections flattened — used to resolve breadcrumbs. */
export const allNavItems: NavItem[] = [
  ...navMainGroups.flatMap((group) => group.items),
  ...navSecondaryItems,
];
