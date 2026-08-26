import {
  Bot,
  Briefcase,
  FileText,
  Gavel,
  LayoutDashboard,
  PlugZap,
  ScrollText,
  Settings,
  Target,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Static demo counters shown until real data exists. */
  badge?: string;
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
      { title: "Jobs", url: "/jobs", icon: Briefcase, badge: "12" },
      { title: "Matches", url: "/matches", icon: Target, badge: "8" },
      { title: "Proposals", url: "/proposals", icon: FileText, badge: "3" },
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
  { title: "Automation", url: "/automation", icon: Bot },
  { title: "Profile", url: "/profile", icon: UserRound },
  { title: "Settings", url: "/settings", icon: Settings },
];

/** All navigable sections flattened — used to resolve breadcrumbs. */
export const allNavItems: NavItem[] = [
  ...navMainGroups.flatMap((group) => group.items),
  ...navSecondaryItems,
];
