import { BrandLogo } from "@/components/shared/brand-logo";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";

/**
 * Single-user brand block in the sidebar header. Same footprint the old demo
 * workspace switcher had — logo, name, one line of context.
 */
export function BrandMark() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex h-12 items-center gap-2 px-2">
          <BrandLogo className="size-8 shrink-0 text-sidebar-foreground" />
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">Freelance Copilot</span>
            <span className="truncate text-xs text-sidebar-foreground/70">
              Personal workspace
            </span>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
