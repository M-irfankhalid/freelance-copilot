import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/layout/nav-main";
import { NavSecondary } from "@/components/layout/nav-secondary";
import { UserMenu } from "@/components/layout/user-menu";
import { BrandMark } from "@/components/layout/brand-mark";
import { navMainGroups, navSecondaryItems } from "@/lib/navigation";

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <BrandMark />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navMainGroups} />
        <NavSecondary items={navSecondaryItems} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu variant="sidebar" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
