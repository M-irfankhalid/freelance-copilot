import { BrandLogo } from "@/components/shared/brand-logo";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/**
 * Single-user brand block in the sidebar header. Same footprint the old demo
 * workspace switcher had — logo, name, one line of context.
 */
export function BrandMark() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <BrandLogo className="size-8 text-sidebar-foreground" />
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">Freelance Copilot</span>
            <span className="truncate text-xs text-sidebar-foreground/70">
              Personal workspace
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
