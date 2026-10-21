import {
  Bot,
  BrainCircuit,
  Briefcase,
  FileText,
  Gavel,
  Info,
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
  title: string;
  items: NavItem[];
};

/** Primary workspace sections. */
export const navMainGroups: NavGroup[] = [
  {
    title: "Work",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Agent", url: "/agent", icon: Sparkles },
      { title: "Jobs", url: "/jobs", icon: Briefcase },
      { title: "Matches", url: "/matches", icon: Target },
      { title: "Proposals", url: "/proposals", icon: FileText },
      { title: "Bids", url: "/bids", icon: Gavel },
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
  { title: "Automation", url: "/automation", icon: Bot },
  { title: "Profile", url: "/profile", icon: UserRound },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "About", url: "/about", icon: Info },
];

/** All navigable sections flattened — used to resolve breadcrumbs. */
export const allNavItems: NavItem[] = [
  ...navMainGroups.flatMap((group) => group.items),
  ...navSecondaryItems,
];
